"""Multi-step pipeline: load -> parse (regex, LLM-extract fallback) -> classify -> LLM explain -> validate.

Includes bonus capabilities:
  - Multilingual output toggle: English ('en'), Urdu ('ur'), and Roman Urdu ('ro-ur')
  - Interactive What-If Value Simulator
  - Printable Doctor Visit Report exporter
  - Live 14-Patient Corpus & 5-Checkpoint Self-Audit
"""
from __future__ import annotations

import json
import logging
import re
import time
import uuid

from .classifier import classify_report, classify_result
from .config import settings
from .corpus import Corpus, Source
from .llm.client import LLMClient, LLMError
from .prompts import CHAT_SYSTEM, CHAT_USER, EXPLAIN_SYSTEM, EXPLAIN_USER, EXTRACT_SYSTEM, LANG_INSTRUCTIONS
from .report_parser import ParsedReport, ParsedResult, parse_report
from .safety import (
    clean_questions,
    get_disclaimer,
    looks_like_diagnosis,
    matches_target_lang,
    norm_lang,
    template_explanation,
    template_questions,
)

log = logging.getLogger("pipeline")


class AppError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def _no_llm_meta(latency_ms: int = 0, reason: str | None = None) -> dict:
    return {
        "provider": None,
        "model": None,
        "latency_ms": latency_ms,
        "tokens": {"prompt": 0, "completion": 0},
        "cached": False,
        "fallback_used": False,
        "llm_used": False,
        "llm_error": reason,
    }


def _localize_clarify(missing: list[str], lang: str, default_en: str | None) -> str | None:
    if not default_en:
        return None
    if lang == "ur":
        what = "عمر اور جنس" if len(missing) == 2 else ("عمر" if missing == ["age"] else "جنس")
        return f"رپورٹ میں مریض کی {what} درج نہیں ہے۔ درست نارمل رینج کا انتخاب اندازے سے نہیں کیا جا سکتا۔ براہِ کرم مریض کی {what} بتائیں تاکہ نتائج کی درجہ بندی کی جا سکے۔"
    if lang == "ro-ur":
        what = "umar (age) aur jins (sex)" if len(missing) == 2 else ("umar (age)" if missing == ["age"] else "jins (sex)")
        return f"Report mein mareez ki {what} darj nahi hai. Normal ranges age aur sex par depend karti hain, is liye andazay se range nahi chuni ja sakti. Baraye meharbani {what} batayein."
    return default_en


def _localize_urgent(urgent_results: list[dict], lang: str, default_en: str | None) -> str | None:
    if not default_en:
        return None
    names = ", ".join(f"{r['test']} ({r['value']} {r['unit']})" for r in urgent_results)
    if lang == "ur":
        return f"فوری توجہ (URGENT): {names} خطرے کی حد تک پہنچ گیا ہے۔ براہِ کرم آج ہی ڈاکٹر سے معائنہ کروائیں یا فوری طبی امداد حاصل کریں۔"
    if lang == "ro-ur":
        return f"URGENT: {names} lab ki critical (khatarnaak) had tak pohanch gaya hai. Baraye meharbani aaj hi doctor ko dikhayein ya fori tibbi imdad lein."
    return default_en


class Pipeline:
    def __init__(self, corpus: Corpus, llm: LLMClient):
        self.c, self.llm = corpus, llm
        self.patients: dict[str, ParsedReport] = {}
        for pid, path in sorted(corpus.reports.items()):
            self.patients[pid] = parse_report(path.read_text(encoding="utf-8"), path.name)

    # ---- patients -------------------------------------------------------------------------
    def list_patients(self) -> list[dict]:
        return [
            {
                "patient_id": pid,
                "name": r.name,
                "age": r.age,
                "sex": r.sex,
                "test_count": len(r.results),
                "file": r.file,
            }
            for pid, r in self.patients.items()
        ]

    def _load(self, patient_id: str | None, report_text: str | None) -> tuple[ParsedReport, str | None]:
        if patient_id:
            pid = patient_id.strip().upper()
            if pid not in self.patients:
                raise AppError("PATIENT_NOT_FOUND", f"No report found for patient '{patient_id}'.", 404)
            path = self.c.reports[pid]
            return parse_report(path.read_text(encoding="utf-8"), path.name), None
        text = (report_text or "").strip()
        if not text:
            raise AppError("EMPTY_INPUT", "Please choose a patient or paste a lab report.", 400)
        if len(text) > settings.max_report_chars:
            raise AppError("REPORT_TOO_LARGE", f"Report is larger than {settings.max_report_chars} characters.", 413)
        return parse_report(text, "pasted_report"), text

    async def _llm_extract(self, text: str) -> tuple[ParsedReport | None, dict | None]:
        """Step 1b: LLM extraction for unfamiliar formats. Every value must appear verbatim in the text."""
        if not self.llm.enabled:
            return None, None
        snippet = text[:12000]
        try:
            res = await self.llm.complete_json(EXTRACT_SYSTEM, snippet, temperature=0.0)
        except LLMError as e:
            log.warning("llm extract failed: %s", e)
            return None, None
        d = res.data
        rep = ParsedReport(file="pasted_report", name=d.get("name") if isinstance(d.get("name"), str) else None)
        if isinstance(d.get("age"), (int, float)) and re.search(rf"\b{int(d['age'])}\b", text):
            rep.age = float(d["age"])
        if d.get("sex") in ("male", "female") and re.search(r"\b(sex|gender)\b", text, re.I):
            rep.sex = d["sex"]
        lines = text.split("\n")
        for item in d.get("results", []) if isinstance(d.get("results"), list) else []:
            if not isinstance(item, dict):
                continue
            t = str(item.get("test", "")).strip()
            v = str(item.get("value", "")).strip()
            u = str(item.get("unit", "")).strip()
            if not t or not v:
                continue
            hit = next((i for i, ln in enumerate(lines, 1) if t.lower() in ln.lower() and v in ln), None)
            if hit is None:
                continue
            rep.results.append(ParsedResult(t, v, u, hit, lines[hit - 1].strip()))
        return rep, res.meta()

    # ---- analyze --------------------------------------------------------------------------
    async def analyze(
        self,
        patient_id: str | None,
        report_text: str | None,
        age: float | None,
        sex: str | None,
        lang: str = "en",
    ) -> dict:
        t0 = time.perf_counter()
        lang = norm_lang(lang)
        request_id = uuid.uuid4().hex[:12]
        rep, raw_text = self._load(patient_id, report_text)
        extract_meta = None
        if not rep.results and raw_text:
            llm_rep, extract_meta = await self._llm_extract(raw_text)
            if llm_rep and llm_rep.results:
                llm_rep.age = rep.age if rep.age is not None else llm_rep.age
                llm_rep.sex = rep.sex or llm_rep.sex
                llm_rep.name = rep.name or llm_rep.name
                rep = llm_rep
        if not rep.results:
            raise AppError("NO_RESULTS_FOUND", "No lab test results could be found in this report.", 422)

        cl = classify_report(self.c, rep, age, sex)
        results = cl.results
        meta = _no_llm_meta()
        summary = None
        questions = None

        if self.llm.enabled:
            compact = [
                {k: r[k] for k in ("test", "alias_note", "value", "unit", "status", "reason")}
                | {"normal_range": (r["reference"] or {}).get("text")}
                for r in results
            ]
            glossary = "\n".join(s.quote for s in self.c.glossary_lines)
            user = EXPLAIN_USER.format(
                lang_instruction=LANG_INSTRUCTIONS[lang],
                age=cl.patient["age"] if cl.patient["age"] is not None else "MISSING",
                sex=cl.patient["sex"] or "MISSING",
                results_json=json.dumps(compact, ensure_ascii=False),
                glossary=glossary,
            )
            try:
                res = await self.llm.complete_json(EXPLAIN_SYSTEM, user)
                meta = res.meta()
                exps = res.data.get("explanations") if isinstance(res.data.get("explanations"), dict) else {}
                lower = {str(k).lower(): v for k, v in exps.items()}
                for r in results:
                    e = exps.get(r["test"]) or lower.get(r["test"].lower()) or lower.get(r["test_raw"].lower())
                    if isinstance(e, str) and e.strip() and not looks_like_diagnosis(e) and matches_target_lang(e, lang):
                        r["explanation"] = e.strip()
                s = res.data.get("summary")
                if isinstance(s, str) and s.strip() and not looks_like_diagnosis(s) and matches_target_lang(s, lang):
                    summary = s.strip()
                questions = clean_questions(res.data.get("doctor_questions"), results, lang)
            except LLMError as e:
                log.warning("llm explain failed, using templates: %s", e)
                meta = _no_llm_meta(reason=e.code)

        for r in results:
            if not r["explanation"]:
                r["explanation"] = template_explanation(r, lang)
            r.pop("test_key", None)
        if questions is None:
            questions = template_questions(results, lang)
        urgent_list = [r for r in results if r["status"] == "urgent"]
        if cl.urgent_warning and urgent_list:
            first_urgent_q = template_questions(urgent_list, lang)[0]
            if not any("today" in q.lower() or "urgent" in q.lower() or "critical" in q.lower() or "آج" in q or "aaj" in q.lower() for q in questions):
                questions = [first_urgent_q] + questions[:4]
        if summary is None:
            summary = self._template_summary(results, lang)
        if cl.urgent_warning:
            if lang == "en" and "doctor today" not in summary.lower():
                summary += " Because one or more results are at a critical level, please see a doctor today."
            elif lang == "ur" and "آج ہی ڈاکٹر" not in summary:
                summary += " چونکہ ایک یا زائد نتائج خطرے کی حد میں ہیں، براہِ کرم آج ہی ڈاکٹر سے رجوع کریں۔"
            elif lang == "ro-ur" and "aaj hi doctor" not in summary.lower():
                summary += " Kyunke aik ya zyada results critical had par hain, baraye meharbani aaj hi doctor ko dikhayein."

        clarify = _localize_clarify(cl.patient["missing"], lang, cl.clarifying_question)
        urgent_warn = _localize_urgent(urgent_list, lang, cl.urgent_warning)

        meta["latency_ms"] = int((time.perf_counter() - t0) * 1000)
        meta["lang"] = lang
        if extract_meta:
            meta["extraction"] = "llm"
        log.info(
            "analyze request_id=%s patient=%s lang=%s results=%d state=%s latency_ms=%d llm=%s",
            request_id,
            cl.patient["patient_id"],
            lang,
            len(results),
            cl.state,
            meta["latency_ms"],
            meta["llm_used"],
        )
        return {
            "request_id": request_id,
            "lang": lang,
            "state": cl.state,
            "patient": cl.patient,
            "clarifying_question": clarify,
            "results": results,
            "urgent_warning": urgent_warn,
            "doctor_questions": questions,
            "summary": summary,
            "disclaimer": get_disclaimer(lang),
            "meta": meta,
        }

    @staticmethod
    def _template_summary(results: list[dict], lang: str = "en") -> str:
        counts: dict[str, int] = {}
        for r in results:
            counts[r["status"]] = counts.get(r["status"], 0) + 1
        n = len(results)
        normal = counts.get("normal", 0)
        flagged = counts.get("high", 0) + counts.get("low", 0) + counts.get("urgent", 0)
        if lang == "ur":
            parts = [f"کل {n} میں سے {normal} نتائج نارمل رینج کے اندر ہیں۔"]
            if flagged:
                parts.append(f"{flagged} نتائج نارمل رینج سے باہر ہیں؛ براہِ کرم ان پر اپنے ڈاکٹر سے بات کریں۔")
            if counts.get("cannot_classify"):
                parts.append(f"{counts['cannot_classify']} ٹیسٹ کی لیب فائلوں سے درجہ بندی نہیں ہو سکی۔")
            if counts.get("needs_demographics"):
                parts.append("کچھ نتائج کی درجہ بندی کے لیے مریض کی عمر یا جنس درکار ہے۔")
            return " ".join(parts)
        if lang == "ro-ur":
            parts = [f"Kul {n} mein se {normal} results normal range ke andar hain."]
            if flagged:
                parts.append(f"{flagged} results normal range se bahar hain; baraye meharbani apne doctor se discuss karein.")
            if counts.get("cannot_classify"):
                parts.append(f"{counts['cannot_classify']} test ko lab ki files se classify nahi kiya ja saka.")
            if counts.get("needs_demographics"):
                parts.append("Kuch results ko classify karne ke liye mareez ki age ya sex darj karna zaroori hai.")
            return " ".join(parts)
        parts = [f"{normal} of {n} result{'s' if n != 1 else ''} {'is' if normal == 1 else 'are'} in the normal range."]
        if flagged:
            parts.append(f"{flagged} {'is' if flagged == 1 else 'are'} outside the normal range; please go through them with your doctor.")
        if counts.get("cannot_classify"):
            parts.append(f"{counts['cannot_classify']} could not be classified from the lab's files.")
        if counts.get("needs_demographics"):
            parts.append("Some results need the patient's age or sex before they can be classified.")
        return " ".join(parts)

    # ---- chat -------------------------------------------------------------------------------
    def _other_patient_mentioned(self, question: str, current: ParsedReport) -> str | None:
        q = question.lower()
        cur_tokens = {t.lower() for t in (current.name or "").split()}
        cur_id = (current.patient_id or "").lower()
        for pid, r in self.patients.items():
            if pid.lower() == cur_id:
                continue
            if re.search(rf"\b{pid.lower()}\b", q):
                return r.name or pid
            if r.name:
                full = r.name.lower()
                if full in q:
                    return r.name
                for tok in full.split():
                    if len(tok) > 2 and tok not in cur_tokens and re.search(rf"\b{re.escape(tok)}\b", q):
                        return r.name
        if re.search(
            r"\b(another|other|different|someone else'?s?|my (?:friend|wife|husband|brother|sister|neighbou?r)'?s?)\b.{0,20}\b(patient|report|results?|records?)\b",
            q,
        ):
            return "another patient"
        return None

    async def chat(
        self,
        patient_id: str | None,
        report_text: str | None,
        question: str,
        age: float | None,
        sex: str | None,
        lang: str = "en",
    ) -> dict:
        t0 = time.perf_counter()
        lang = norm_lang(lang)
        question = (question or "").strip()
        if not question:
            raise AppError("EMPTY_INPUT", "Please type a question.", 400)
        if len(question) > settings.max_question_chars:
            raise AppError("INVALID_INPUT", f"Question is longer than {settings.max_question_chars} characters.", 413)
        rep, _ = self._load(patient_id, report_text)
        privacy_src = self.c.rules.get("privacy")

        other = self._other_patient_mentioned(question, rep)
        if other:
            if lang == "ur":
                ans = f"میں صرف اس وقت کھلی ہوئی رپورٹ{f' ({rep.name})' if rep.name else ''} کے بارے میں بات کر سکتا ہوں۔ سٹی لیب کے حفاظتی قوانین کے مطابق کسی دوسرے مریض کا ریکارڈ شیئر نہیں کیا جا سکتا۔"
            elif lang == "ro-ur":
                ans = f"Main sirf is waqt khuli hui report{f' ({rep.name})' if rep.name else ''} ke baray mein baat kar sakta hoon. CityLab ke safety rules ke mutabiq kisi doosray mareez ka record share nahi kiya ja sakta."
            else:
                ans = (
                    f"I can only discuss the report currently open{f' ({rep.name})' if rep.name else ''}. "
                    "Following CityLab's safety rules, I cannot share or discuss other patients' records."
                )
            return {
                "answer": ans,
                "refused": True,
                "sources": [privacy_src.as_dict()] if privacy_src else [],
                "disclaimer": get_disclaimer(lang),
                "meta": _no_llm_meta(int((time.perf_counter() - t0) * 1000)),
            }

        cl = classify_report(self.c, rep, age, sex)
        results = [
            {k: v for k, v in r.items() if k not in ("explanation", "sources", "test_key", "_blocked")}
            for r in cl.results
        ]
        ref_sources: list[Source] = (
            list(self.c.glossary_lines) + [r.source for r in self.c.ranges] + [u.source for u in self.c.urgent]
        )
        ref_sources += list(self.c.rules.values())
        reference = "\n".join(f"{s.file}:{s.line}: {s.quote}" for s in ref_sources)
        report_lines = [f"{rep.file}:{r.line}: {r.quote}" for r in rep.results]
        reference = "\n".join(report_lines) + "\n" + reference

        if not self.llm.enabled:
            return self._chat_fallback(question, cl, t0, "LLM_DISABLED", lang)
        try:
            res = await self.llm.complete_json(
                CHAT_SYSTEM,
                CHAT_USER.format(
                    lang_instruction=LANG_INSTRUCTIONS[lang],
                    patient_json=json.dumps(cl.patient, ensure_ascii=False),
                    results_json=json.dumps(results, ensure_ascii=False, default=str),
                    reference=reference,
                    question=question,
                ),
                temperature=0.2,
                max_tokens=800,
            )
        except LLMError as e:
            return self._chat_fallback(question, cl, t0, e.code, lang)

        answer = res.data.get("answer") if isinstance(res.data.get("answer"), str) else ""
        if not answer.strip() or looks_like_diagnosis(answer):
            return self._chat_fallback(question, cl, t0, "UNSAFE_OUTPUT", lang)
        known = {(s.file, s.line): s for s in ref_sources}
        for r in rep.results:
            known[(rep.file, r.line)] = Source(rep.file, r.line, r.quote)
        sources = []
        for s in res.data.get("sources", []) if isinstance(res.data.get("sources"), list) else []:
            if isinstance(s, dict):
                try:
                    k = (str(s.get("file")), int(s.get("line")))
                except (TypeError, ValueError):
                    continue
                if k in known:
                    sources.append(known[k].as_dict())
        meta = res.meta()
        meta["latency_ms"] = int((time.perf_counter() - t0) * 1000)
        return {
            "answer": answer.strip(),
            "refused": bool(res.data.get("refused")),
            "sources": sources,
            "disclaimer": get_disclaimer(lang),
            "meta": meta,
        }

    def _chat_fallback(self, question: str, cl, t0: float, reason: str, lang: str = "en") -> dict:
        q = question.lower()
        hits = [r for r in cl.results if r["test"].lower() in q or r["test_raw"].lower() in q]
        if not hits and any(w in q for w in ("meaning", "mean", "explain", "summary", "all", "result", "مطلب", "matlab", "kya")):
            hits = cl.results
        if hits:
            answer = " ".join(f"{r['test']} ({r['value']} {r['unit']}): {template_explanation(r, lang)}" for r in hits)
            sources = [s for r in hits for s in r["sources"]]
        else:
            tests_str = ", ".join(r["test"] for r in cl.results)
            if lang == "ur":
                answer = f"یہ معلومات لیب کی فائلوں میں موجود نہیں ہیں۔ آپ اس رپورٹ کے ان ٹیسٹوں کے بارے میں پوچھ سکتے ہیں: {tests_str}۔"
            elif lang == "ro-ur":
                answer = f"Yeh maloomat lab ki files mein maujood nahi hain. Aap is report ke in tests ke baray mein pooch sakte hain: {tests_str}."
            else:
                answer = f"This is not covered in the lab's files. You can ask about the tests in this report: {tests_str}."
            sources = []
        return {
            "answer": answer,
            "refused": False,
            "sources": sources,
            "disclaimer": get_disclaimer(lang),
            "meta": _no_llm_meta(int((time.perf_counter() - t0) * 1000), reason),
        }

    # ---- bonus 1: What-If simulator ---------------------------------------------------------
    def simulate(self, test: str, value_raw: str, unit_raw: str, age: float | None, sex: str | None, lang: str = "en") -> dict:
        lang = norm_lang(lang)
        pr = ParsedResult(name=test, value_raw=str(value_raw), unit_raw=unit_raw or "", line=1, quote=f"{test}: {value_raw} {unit_raw}".strip())
        res = classify_result(self.c, pr, age, sex, "what_if_simulator")
        res.pop("_blocked", None)
        res["explanation"] = template_explanation(res, lang)
        res.pop("test_key", None)
        return {"result": res, "disclaimer": get_disclaimer(lang)}

    # ---- bonus 2: Printable Doctor Visit Summary export -------------------------------------
    async def export_markdown(
        self,
        patient_id: str | None,
        report_text: str | None,
        age: float | None,
        sex: str | None,
        lang: str = "en",
    ) -> dict:
        data = await self.analyze(patient_id, report_text, age, sex, lang)
        p = data["patient"]
        lines = [
            f"# CityLab Diagnostics — Patient Summary & Doctor Visit Sheet ({lang.upper()})",
            "",
            f"- **Patient**: {p.get('name') or 'Not specified'} ({p.get('patient_id') or 'Custom Report'})",
            f"- **Age / Sex**: {p.get('age') if p.get('age') is not None else 'Missing'} / {p.get('sex') or 'Missing'}",
            "",
        ]
        if data["urgent_warning"]:
            lines += [f"> ⚠️ **{data['urgent_warning']}**", ""]
        if data["clarifying_question"]:
            lines += [f"> ℹ️ **{data['clarifying_question']}**", ""]
        lines += ["## Summary", data["summary"], "", "## Test Results", ""]
        lines += ["| Test | Value | Normal Range | Status | Explanation |", "| :--- | :--- | :--- | :--- | :--- |"]
        for r in data["results"]:
            val = f"{r['value']} {r['unit']}".strip()
            if r["conversion"]:
                val += f" *(converted from {r['conversion']['from']})*"
            ref = (r["reference"] or {}).get("text") or "N/A"
            lines.append(f"| **{r['test']}** | {val} | {ref} | **{r['status'].upper()}** | {r['explanation']} |")
        lines += ["", "## Questions to Ask Your Doctor"]
        for idx, q in enumerate(data["doctor_questions"], 1):
            lines.append(f"{idx}. {q}")
        lines += ["", "## Evidence & Citations"]
        for r in data["results"]:
            cites = ", ".join(f"`{s['file']}:{s['line']}`" for s in r["sources"])
            lines.append(f"- **{r['test']}**: {cites}")
        lines += ["", "---", f"*{data['disclaimer']}*"]
        return {"markdown": "\n".join(lines), "analysis": data}

    # ---- bonus 3: Live 14-Patient Corpus & Checkpoint Audit ---------------------------------
    def run_audit(self) -> dict:
        t0 = time.perf_counter()
        expected = {
            "P001": [("Hemoglobin", "normal"), ("White Blood Cell Count", "normal")],
            "P002": [("ALT", "normal")],
            "P003": [("Fasting Blood Sugar", "needs_demographics")],
            "P004": [("Hemoglobin", "urgent"), ("Platelet Count", "low")],
            "P005": [("Fasting Blood Sugar", "high")],
            "P006": [("Serum Ferritin", "cannot_classify")],
            "P007": [("TSH", "normal")],
            "P008": [("Urine pH", "normal"), ("Urine Protein", "normal")],
            "P009": [("ALT", "high"), ("AST", "high")],
            "P010": [("Cholesterol", "normal")],
            "P011": [("White Blood Cell Count", "high"), ("Platelet Count", "low")],
            "P012": [("AST", "needs_demographics")],
            "P013": [("Fasting Blood Sugar", "urgent")],
            "P014": [("Fasting Blood Sugar", "normal"), ("AST", "normal")],
        }
        cases = []
        passed = 0
        for pid, exp in expected.items():
            rep = self.patients[pid]
            cl = classify_report(self.c, rep)
            got = [(r["test"], r["status"]) for r in cl.results]
            ok = got == exp
            if ok:
                passed += 1
            cases.append({
                "patient_id": pid,
                "name": rep.name,
                "expected": [f"{t}: {s}" for t, s in exp],
                "actual": [f"{t}: {s}" for t, s in got],
                "passed": ok,
            })
        checkpoints = [
            {"id": 1, "name": "Alias & Unit Conversion (SGPT->ALT, mmol/L->mg/dL)", "passed": all(c["passed"] for c in cases if c["patient_id"] in ("P002", "P005", "P014"))},
            {"id": 2, "name": "Boundary Values & Missing Demographics (P002=45, P010=200, P003/P012 ask)", "passed": all(c["passed"] for c in cases if c["patient_id"] in ("P002", "P010", "P003", "P012"))},
            {"id": 3, "name": "Admit Unknown Tests (P006 Serum Ferritin -> cannot_classify)", "passed": all(c["passed"] for c in cases if c["patient_id"] == "P006")},
            {"id": 4, "name": "Privacy Context-Lock (Cross-patient queries refused)", "passed": self._other_patient_mentioned("What was Diana Prince's Hb?", self.patients["P001"]) is not None},
            {"id": 5, "name": "Urgent Warnings & Doctor Questions (P004 Hb 6.5, P013 FBS 350)", "passed": all(c["passed"] for c in cases if c["patient_id"] in ("P004", "P013"))},
        ]
        return {
            "total_patients": len(expected),
            "passed_patients": passed,
            "score_pct": round(100.0 * passed / len(expected), 1),
            "latency_ms": int((time.perf_counter() - t0) * 1000),
            "checkpoints": checkpoints,
            "cases": cases,
        }
