"""Multi-format laboratory report extractor: PDF, Images (PNG/JPG/WEBP/BMP), DOCX, CSV/TSV, JSON, HTML, MD, TXT."""
from __future__ import annotations

import base64
import csv
import io
import json
import logging
import re
import struct
import xml.etree.ElementTree as ET
import zipfile
import zlib

from .corpus import parse_report
from .llm.client import LLMClient, LLMError
from .pipeline import AppError

log = logging.getLogger("extractor")

VISION_OCR_SYSTEM = """You are CityLab Diagnostics' clinical OCR and document transcription engine.
Extract all patient demographics and laboratory test results from the uploaded document or image.
Never invent or guess values that are not visible in the document.
Return ONLY a JSON object with this exact schema:
{
  "patient_name": "string or null",
  "age": number or null,
  "sex": "male" | "female" | null,
  "tests": [
    {"test": "exact test name as written", "value": "numeric or qualitative value", "unit": "unit as written"}
  ],
  "raw_transcription": "optional markdown transcription if already formatted"
}"""

VISION_OCR_PROMPT = (
    "Transcribe every patient demographic field (Name, Age, Biological Sex) and every laboratory test row "
    "(Test Name, Measured Value, Unit) visible in this lab report into the required JSON schema."
)


def _format_structured_to_markdown(
    name: str | None,
    age: int | float | str | None,
    sex: str | None,
    tests: list[dict],
    source_label: str = "UPLOADED MULTI-FORMAT REPORT",
) -> str:
    lines = [
        f"# CITYLAB DIAGNOSTICS - {source_label}",
        f"* **Patient Full Name**: {name if name else 'Not Provided'}",
        f"* **Recorded Age**: {age if age not in (None, '') else 'Not Provided'}",
        f"* **Biological Sex**: {sex.capitalize() if isinstance(sex, str) and sex else 'Not Provided'}",
        "",
        "## ANALYTICAL RESULTS",
    ]
    for item in tests:
        t = str(item.get("test") or item.get("name") or "").strip()
        v = str(item.get("value") or item.get("result") or "").strip()
        u = str(item.get("unit") or item.get("units") or "").strip()
        if t and v:
            lines.append(f"- **{t}**: {v}{(' ' + u) if u else ''}")
    return "\n".join(lines)


def _extract_docx(raw_bytes: bytes) -> str:
    """Extract paragraphs and table rows from a .docx file using stdlib zipfile + ElementTree."""
    try:
        with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
            xml_bytes = zf.read("word/document.xml")
    except Exception as e:
        raise AppError("INVALID_FILE", f"Could not read DOCX archive: {e}", 400) from e

    root = ET.fromstring(xml_bytes)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    out_lines: list[str] = []

    body = root.find("w:body", ns)
    if body is None:
        body = root

    for child in body:
        tag = child.tag.split("}")[-1]
        if tag == "p":
            texts = [t.text for t in child.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t") if t.text]
            line = "".join(texts).strip()
            if line:
                out_lines.append(line)
        elif tag == "tbl":
            for row in child.findall(".//w:tr", ns):
                cells: list[str] = []
                for cell in row.findall(".//w:tc", ns):
                    ctext = "".join(
                        t.text for t in cell.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t") if t.text
                    ).strip()
                    cells.append(ctext)
                if any(cells):
                    if len(cells) >= 2 and cells[0].lower() not in ("test", "test name", "biomarker", "parameter"):
                        val_unit = " ".join(c for c in cells[1:3] if c).strip()
                        out_lines.append(f"- **{cells[0]}**: {val_unit}")
                    else:
                        out_lines.append(" | ".join(cells))
    return "\n".join(out_lines)


def _decode_pdf_literal(s: bytes) -> str:
    """Decode PDF literal string (...) handling octal and standard escapes."""
    out = bytearray()
    i = 0
    n = len(s)
    while i < n:
        b = s[i]
        if b == 92 and i + 1 < n:  # backslash
            nxt = s[i + 1]
            if nxt in (110, 114, 116):
                out.append({110: 10, 114: 13, 116: 9}[nxt])
                i += 2
                continue
            if 48 <= nxt <= 55:
                oct_digits = bytes([nxt])
                i += 2
                for _ in range(2):
                    if i < n and 48 <= s[i] <= 55:
                        oct_digits += bytes([s[i]])
                        i += 1
                    else:
                        break
                out.append(int(oct_digits, 8) & 0xFF)
                continue
            out.append(nxt)
            i += 2
        else:
            out.append(b)
            i += 1
    return out.decode("latin-1", errors="ignore")


def _extract_pdf_text_stdlib(raw_bytes: bytes) -> str:
    """Extract text from PDF streams using pypdf (if available) + pure-Python stream/FlateDecode parser."""
    # 1. Try pypdf / pypdf2 if installed
    for mod_name in ("pypdf", "PyPDF2"):
        try:
            mod = __import__(mod_name)
            reader = mod.PdfReader(io.BytesIO(raw_bytes))
            pages = [page.extract_text() or "" for page in reader.pages]
            joined = "\n".join(p.strip() for p in pages if p.strip())
            if len(joined) > 20:
                return joined
        except Exception:
            pass

    # 2. Pure-Python stream extractor (handles uncompressed and /FlateDecode compressed PDF content streams)
    chunks: list[str] = []
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", raw_bytes, re.S):
        stream_data = m.group(1)
        decompressed = stream_data
        for wbits in (zlib.MAX_WBITS, -zlib.MAX_WBITS):
            try:
                decompressed = zlib.decompress(stream_data, wbits)
                break
            except Exception:
                pass
        # Extract text blocks between BT and ET or general Tj / TJ operators
        lines_in_stream: list[str] = []
        for bt in re.finditer(rb"BT(.*?)ET", decompressed, re.S):
            block = bt.group(1)
            parts: list[str] = []
            for tok in re.finditer(rb"\((?:\\.|[^\\()])*\)|\[(?:[^\]]*)\]\s*TJ", block, re.S):
                raw_tok = tok.group(0)
                if raw_tok.startswith(b"("):
                    parts.append(_decode_pdf_literal(raw_tok[1:-1]))
                else:
                    sub = "".join(_decode_pdf_literal(sm.group(0)[1:-1]) for sm in re.finditer(rb"\((?:\\.|[^\\()])*\)", raw_tok))
                    parts.append(sub)
            if parts:
                lines_in_stream.append("".join(parts).strip())
        if lines_in_stream:
            chunks.append("\n".join(l for l in lines_in_stream if l))

    return "\n".join(chunks).strip()


def _extract_image_embedded_text(raw_bytes: bytes) -> str | None:
    """Check if PNG (tEXt / iTXt) or JPEG (COM marker) embeds structured report text metadata."""
    # PNG signature check
    if raw_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        pos = 8
        while pos + 8 <= len(raw_bytes):
            length = struct.unpack(">I", raw_bytes[pos : pos + 4])[0]
            ctype = raw_bytes[pos + 4 : pos + 8]
            cdata = raw_bytes[pos + 8 : pos + 8 + length]
            pos += 12 + length
            if ctype == b"tEXt" and b"\x00" in cdata:
                key, val = cdata.split(b"\x00", 1)
                if key.lower() in (b"citylab_report", b"description", b"comment", b"report_text"):
                    return val.decode("utf-8", errors="ignore")
            elif ctype == b"iTXt":
                parts = cdata.split(b"\x00", 5)
                if len(parts) >= 6 and parts[0].lower() in (b"citylab_report", b"description", b"comment"):
                    return parts[5].decode("utf-8", errors="ignore")
    # JPEG COM (0xFFFE) check
    if raw_bytes.startswith(b"\xff\xd8"):
        m = re.search(rb"\xff\xfe..CITYLAB_REPORT:(.*?)(?:\xff|\Z)", raw_bytes, re.S)
        if m:
            return m.group(1).decode("utf-8", errors="ignore").strip()
    return None


def _extract_csv(text: str) -> str:
    """Convert CSV/TSV laboratory rows into canonical CityLab markdown."""
    delim = "\t" if "\t" in text.splitlines()[0] and "," not in text.splitlines()[0] else ","
    reader = list(csv.reader(io.StringIO(text), delimiter=delim))
    if not reader:
        return text

    name, age, sex = None, None, None
    tests: list[dict] = []
    header = [c.strip().lower() for c in reader[0]]

    has_header = any(h in ("test", "test name", "biomarker", "parameter", "value", "result") for h in header)
    rows = reader[1:] if has_header else reader

    for row in rows:
        cells = [c.strip() for c in row if c.strip()]
        if not cells:
            continue
        klow = cells[0].lower().rstrip(":")
        if klow in ("patient", "patient name", "patient full name", "name") and len(cells) >= 2:
            name = cells[1]
            continue
        if klow in ("age", "recorded age", "patient age") and len(cells) >= 2:
            age = cells[1]
            continue
        if klow in ("sex", "biological sex", "gender") and len(cells) >= 2:
            sex = cells[1]
            continue

        if has_header and len(row) == len(header):
            row_map = dict(zip(header, [c.strip() for c in row]))
            if not name and row_map.get("patient_name") or row_map.get("name"):
                name = row_map.get("patient_name") or row_map.get("name")
            if not age and row_map.get("age"):
                age = row_map.get("age")
            if not sex and (row_map.get("sex") or row_map.get("gender")):
                sex = row_map.get("sex") or row_map.get("gender")
            tname = row_map.get("test") or row_map.get("test name") or row_map.get("biomarker") or row_map.get("parameter")
            tval = row_map.get("value") or row_map.get("result") or row_map.get("measured")
            tunit = row_map.get("unit") or row_map.get("units") or ""
            if tname and tval:
                tests.append({"test": tname, "value": tval, "unit": tunit})
                continue

        if len(cells) >= 2:
            tests.append({"test": cells[0], "value": cells[1], "unit": cells[2] if len(cells) >= 3 else ""})

    if tests:
        return _format_structured_to_markdown(name, age, sex, tests, "CSV LABORATORY REPORT")
    return text


def _extract_json_doc(text: str) -> str:
    """Convert JSON lab report structure into canonical CityLab markdown."""
    try:
        obj = json.loads(text)
    except Exception:
        return text
    if not isinstance(obj, dict):
        return text
    patient = obj.get("patient") if isinstance(obj.get("patient"), dict) else obj
    name = patient.get("name") or patient.get("patient_name")
    age = patient.get("age")
    sex = patient.get("sex") or patient.get("gender")
    raw_tests = obj.get("tests") or obj.get("results") or []
    tests: list[dict] = []
    if isinstance(raw_tests, list):
        for item in raw_tests:
            if isinstance(item, dict):
                tests.append(item)
    elif isinstance(raw_tests, dict):
        for k, v in raw_tests.items():
            tests.append({"test": k, "value": str(v), "unit": ""})
    if tests:
        return _format_structured_to_markdown(name, age, sex, tests, "JSON LABORATORY REPORT")
    return text


async def extract_report_from_file(
    filename: str,
    mime_type: str | None,
    data_base64: str,
    llm: LLMClient,
    client_extracted_text: str | None = None,
) -> dict:
    """Extract canonical CityLab report text from any uploaded file format."""
    fname = (filename or "uploaded_report").strip()
    ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
    mtype = (mime_type or "").strip().lower()

    # Strip data URL prefix if present
    if "," in data_base64 and data_base64.strip().startswith("data:"):
        header_part, data_base64 = data_base64.split(",", 1)
        if not mtype and ":" in header_part and ";" in header_part:
            mtype = header_part.split(":", 1)[1].split(";", 1)[0].lower()

    try:
        raw_bytes = base64.b64decode(data_base64)
    except Exception as e:
        raise AppError("INVALID_FILE", f"Invalid base64 file encoding: {e}", 400) from e

    if len(raw_bytes) > 15 * 1024 * 1024:
        raise AppError("REPORT_TOO_LARGE", "Uploaded file exceeds 15 MB limit.", 413)

    # 1. Word Document (.docx)
    if ext == "docx" or "officedocument.wordprocessingml" in mtype:
        text = _extract_docx(raw_bytes)
        return {"filename": fname, "format": "DOCX", "extracted_text": text, "method": "docx_xml_parser"}

    # 2. CSV / TSV
    if ext in ("csv", "tsv") or mtype in ("text/csv", "text/tab-separated-values"):
        raw_txt = raw_bytes.decode("utf-8-sig", errors="replace")
        text = _extract_csv(raw_txt)
        return {"filename": fname, "format": ext.upper() or "CSV", "extracted_text": text, "method": "tabular_csv_parser"}

    # 3. JSON
    if ext == "json" or mtype == "application/json":
        raw_txt = raw_bytes.decode("utf-8-sig", errors="replace")
        text = _extract_json_doc(raw_txt)
        return {"filename": fname, "format": "JSON", "extracted_text": text, "method": "json_schema_parser"}

    # 4. PDF Document (.pdf)
    if ext == "pdf" or mtype == "application/pdf" or raw_bytes.startswith(b"%PDF"):
        # Check client-extracted text (from PDF.js) or server stdlib PDF stream parser first
        candidate = (client_extracted_text or "").strip() or _extract_pdf_text_stdlib(raw_bytes)
        parsed = parse_report(candidate) if candidate else None
        if parsed and parsed.results:
            return {"filename": fname, "format": "PDF", "extracted_text": candidate, "method": "pdf_stream_extractor"}

        # Fallback to Multimodal Gemini PDF OCR for scanned or font-encoded PDFs
        try:
            mm_res = await llm.complete_multimodal_json(
                VISION_OCR_SYSTEM, VISION_OCR_PROMPT, "application/pdf", data_base64
            )
            d = mm_res.data
            md = _format_structured_to_markdown(
                d.get("patient_name"), d.get("age"), d.get("sex"), d.get("tests") or [], f"PDF REPORT ({fname})"
            )
            return {"filename": fname, "format": "PDF", "extracted_text": md, "method": f"vision_ocr:{mm_res.provider}"}
        except LLMError as e:
            if candidate:
                return {"filename": fname, "format": "PDF", "extracted_text": candidate, "method": "pdf_raw_text"}
            raise AppError("OCR_UNAVAILABLE", f"Could not extract text from scanned PDF ({e}).", 422) from e

    # 5. Images (.png, .jpg, .jpeg, .webp, .bmp, .gif)
    is_image = (
        ext in ("png", "jpg", "jpeg", "webp", "bmp", "gif")
        or mtype.startswith("image/")
        or raw_bytes.startswith(b"\x89PNG")
        or raw_bytes.startswith(b"\xff\xd8")
    )
    if is_image:
        img_mime = mtype if mtype.startswith("image/") else f"image/{'jpeg' if ext in ('jpg', 'jpeg') else (ext or 'png')}"
        # Check embedded diagnostic report chunk first (instantaneous & works offline)
        embedded = _extract_image_embedded_text(raw_bytes)
        if embedded and parse_report(embedded).results:
            return {
                "filename": fname,
                "format": (ext or "IMAGE").upper(),
                "extracted_text": embedded,
                "method": "image_embedded_ocr",
            }
        # Multimodal Vision OCR via Gemini / Groq Llama-4-Scout / OpenRouter
        try:
            mm_res = await llm.complete_multimodal_json(
                VISION_OCR_SYSTEM, VISION_OCR_PROMPT, img_mime, data_base64
            )
            d = mm_res.data
            if d.get("tests"):
                md = _format_structured_to_markdown(
                    d.get("patient_name"),
                    d.get("age"),
                    d.get("sex"),
                    d.get("tests") or [],
                    f"IMAGE OCR REPORT ({fname})",
                )
            else:
                md = d.get("raw_transcription") or ""
            if not md.strip():
                raise AppError("EMPTY_OCR", "No laboratory test values were detected in the uploaded image.", 422)
            return {
                "filename": fname,
                "format": (ext or "IMAGE").upper(),
                "extracted_text": md,
                "method": f"vision_ocr:{mm_res.provider}:{mm_res.model}",
            }
        except LLMError as e:
            if embedded:
                return {"filename": fname, "format": (ext or "IMAGE").upper(), "extracted_text": embedded, "method": "image_metadata"}
            raise AppError(
                "OCR_UNAVAILABLE",
                f"Vision OCR could not process image ({e}). Please ensure your Gemini/Groq API key is active.",
                422,
            ) from e

    # 6. HTML / XML / Markdown / Plain Text (.md, .txt, .html, etc.)
    raw_txt = raw_bytes.decode("utf-8-sig", errors="replace")
    if ext in ("html", "htm") or mtype == "text/html":
        raw_txt = re.sub(r"<script.*?</script>|<style.*?</style>", "", raw_txt, flags=re.S | re.I)
        raw_txt = re.sub(r"<br\s*/?>|</p>|</tr>|</li>|</h\d>", "\n", raw_txt, flags=re.I)
        raw_txt = re.sub(r"</td>|</th>", " | ", raw_txt, flags=re.I)
        raw_txt = re.sub(r"<[^>]+>", "", raw_txt)
    return {"filename": fname, "format": (ext or "TXT").upper(), "extracted_text": raw_txt.strip(), "method": "text_decoder"}
