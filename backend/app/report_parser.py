"""Extract demographics and test results from a (noisy) lab report.

Handles the formats seen in the corpus: bullet "Name: value unit", bold markdown bullets,
"Name -> value", markdown tables, and two-line "Test: X / Result: value unit" blocks.
Every extracted item keeps its original line number for citations.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

QUALITATIVE = {"negative", "positive", "trace", "nil", "absent", "present", "normal"}
_VALUE = r"(?P<value>[<>]?\s*\d[\d,]*(?:\.\d+)?|negative|positive|trace|nil|absent|present|\d\+)"
_DEMO_KEYS = re.compile(
    r"^(patient|name|full name|patient full name|age|recorded age|sex|biological sex|gender|mrn|medical record|date|"
    r"date of issuance|dob|date of birth|report|lab|physician|doctor|specimen|collected|received|id)\b",
    re.I,
)


@dataclass
class ParsedResult:
    name: str
    value_raw: str
    unit_raw: str
    line: int
    quote: str


@dataclass
class ParsedReport:
    name: str | None = None
    age: float | None = None
    sex: str | None = None  # "male" | "female" | None
    patient_id: str | None = None
    mrn: str | None = None
    results: list[ParsedResult] = field(default_factory=list)
    demo_lines: dict[str, tuple[int, str]] = field(default_factory=dict)
    file: str = "pasted_report"


def _clean(s: str) -> str:
    return re.sub(r"[*_`]", "", s).strip()


def _parse_sex(v: str) -> str | None:
    v = _clean(v).lower()
    if re.fullmatch(r"(m|male|man)", v):
        return "male"
    if re.fullmatch(r"(f|female|woman)", v):
        return "female"
    return None


def _parse_age(v: str) -> float | None:
    m = re.fullmatch(r"\s*(\d{1,3}(?:\.\d+)?)\s*(?:y|yr|yrs|years?|years old)?\s*", _clean(v), re.I)
    if not m:
        return None
    age = float(m.group(1))
    return age if 0 <= age <= 130 else None


def _demographics(rep: ParsedReport, lines: list[str]) -> None:
    kv = re.compile(r"^[\s\-*•]*\**\s*([A-Za-z][A-Za-z ()/]*?)\s*\**\s*:\s*\**\s*(.*?)\s*$")
    for i, ln in enumerate(lines[:80], 1):  # demographics live in the header
        m = kv.match(ln)
        if not m:
            continue
        k, v = _clean(m.group(1)).lower(), _clean(m.group(2))
        if rep.name is None and k in {"patient full name", "patient name", "name", "full name", "patient"}:
            rep.name = v or None
            rep.demo_lines["name"] = (i, ln.strip())
        elif "age" == k or k.endswith(" age") or k == "age (years)":
            rep.age = _parse_age(v)
            rep.demo_lines["age"] = (i, ln.strip())
        elif k in {"sex", "gender", "biological sex", "sex at birth"}:
            rep.sex = _parse_sex(v)
            rep.demo_lines["sex"] = (i, ln.strip())
        elif "medical record" in k or k == "mrn":
            rep.mrn = v
            pm = re.search(r"P\d{3,}", v, re.I)
            if pm:
                rep.patient_id = pm.group(0).upper()
    if rep.patient_id is None:
        for ln in lines[:80]:
            pm = re.search(r"\bP\d{3}\b", ln)
            if pm:
                rep.patient_id = pm.group(0)
                break


def _results_window(lines: list[str]) -> tuple[int, int]:
    """Return [start, end) line indexes of the results section, skipping boilerplate appendices."""
    start = None
    for i, ln in enumerate(lines):
        if re.search(r"(ANALYTICAL RESULTS|TEST RESULTS|^#+\s*RESULTS|LABORATORY RESULTS)", ln, re.I):
            start = i + 1
            break
    end = len(lines)
    if start is None:  # no results heading: scan everything except boilerplate appendices
        for j, ln in enumerate(lines):
            if re.search(r"^\s*#{1,6}.*APPENDIX", ln, re.I):
                return 0, j
        return 0, end
    for j in range(start, len(lines)):
        if re.match(r"^\s*#{1,6}\s", lines[j]):
            end = j
            break
    return start, end


def _split_value_unit(rest: str) -> tuple[str, str] | None:
    m = re.match(r"^\s*" + _VALUE + r"\s*(?P<unit>[^\s|,;()]*)", rest, re.I)
    if not m:
        return None
    return m.group("value").replace(" ", ""), m.group("unit").strip().strip(".")


def parse_report(text: str, file: str = "pasted_report") -> ParsedReport:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    rep = ParsedReport(file=file)
    _demographics(rep, lines)
    start, end = _results_window(lines)

    inline = re.compile(r"^[\s\-*•]*\**\s*(?P<name>[A-Za-z][A-Za-z0-9 ()/\-'.]*?)\s*\**\s*(?::|->|=>|=|–)\s*\**\s*(?P<rest>.+)$")
    pending_test: tuple[str, int, str] | None = None
    header_seen = False
    for idx in range(start, end):
        raw = lines[idx]
        s = raw.strip()
        lineno = idx + 1
        if not s:
            continue
        # Markdown table rows
        if s.startswith("|"):
            cells = [_clean(c) for c in s.strip("|").split("|")]
            if all(re.fullmatch(r":?-{2,}:?", c or "--") for c in cells):
                continue
            if not header_seen and any(c.lower() in {"test", "test name", "analyte", "result", "value"} for c in cells):
                header_seen = True
                continue
            if len(cells) >= 2:
                vu = _split_value_unit(cells[1])
                if vu:
                    unit = cells[2] if len(cells) >= 3 and cells[2] else vu[1]
                    rep.results.append(ParsedResult(cells[0], vu[0], unit, lineno, s))
            continue
        m = inline.match(s)
        if not m:
            continue
        name, rest = _clean(m.group("name")), m.group("rest")
        lname = name.lower()
        # Two-line blocks: "Test: AST" then "Result: 44 U/L"
        if lname in {"test", "test conducted", "test name", "analyte", "investigation", "parameter"}:
            pending_test = (_clean(rest), lineno, s)
            continue
        if lname in {"result", "value", "value recorded", "observed value", "reading"} and pending_test:
            vu = _split_value_unit(_clean(rest))
            if vu:
                tname, tline, tquote = pending_test
                rep.results.append(ParsedResult(tname, vu[0], vu[1], tline, f"{tquote} / {s}"))
            pending_test = None
            continue
        if _DEMO_KEYS.match(lname) or len(name) > 60:
            continue
        vu = _split_value_unit(_clean(rest))
        if vu:
            rep.results.append(ParsedResult(name, vu[0], vu[1], lineno, s))
    return rep
