"""Multi-step pipeline: load -> parse (regex, LLM-extract fallback) -> classify -> LLM explain -> validate."""
from __future__ import annotations

import json
import logging
import re
import time
import uuid

from .classifier import DISCLAIMER, classify_report
from .config import settings
from .corpus import Corpus, Source
from .llm.client import LLMClient, LLMError
from .prompts import CHAT_SYSTEM, CHAT_USER, EXPLAIN_SYSTEM, EXPLAIN_USER, EXTRACT_SYSTEM
from .report_parser import ParsedReport, ParsedResult, parse_report
from .safety import clean_questions, looks_like_diagnosis, template_explanation, template_questions

log = logging.getLogger("pipeline")


class AppError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def _no_llm_meta(latency_ms: int = 0, reason: str | None = None) -> dict:
    return {"provider": None, "model": None, "latency_ms": latency_ms, "tokens": {"prompt": 0, "completion": 0},
            "cached": False, "fallback_used": False, "llm_used": False, "llm_error": reason}


class Pipeline:
    def __init__(self, corpus: Corpus, llm: LLMClient):
        self.c, self.llm = corpus, llm
        self.patients: dict[str, ParsedReport] = {}
        for pid, path in sorted(corpus.reports.items()):
            self.patients[pid] = parse_report(path.read_text(encoding="utf-8"), path.name)

    # ---- patients -------------------------------------------------------------------------
    def list_patients(self) -> list[dict]:
        return [
            {"patient_id": pid, "name": r.name, "age": r.age, "sex": r.sex, "test_count": len(r.results), "file": r.file}
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
            t, v, u = str(item.get("test", "")).strip(), str(item.get("value", "")).strip(), str(item.get("unit", "")).strip()
            if not t or not v:
                continue
            hit = next((i for i, ln in enumerate(lines, 1) if t.lower() in ln.lower() and v in ln), None)
            if hit is None:  # anti-hallucination: drop anything not present in the source text
                continue
            rep.results.append(ParsedResult(t, v, u, hit, lines[hit - 1].strip()))
        return rep, res.meta()

    # ---- analyze --------------------------------------------------------------------------
    async def analyze(self, patient_id: str | None, report_text: str | None, age: float | None, sex: str | None) -> dict:
        t0 = time.perf_counter()
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
                    if isinstance(e, str) and e.strip() and not looks_like_diagnosis(e):
                        r["explanation"] = e.strip()
                s = res.data.get("summary")
                if isinstance(s, str) and s.strip() and not looks_like_diagnosis(s):
                    summary = s.strip()
                questions = clean_questions(res.data.get("doctor_questions"), results)
            except LLMError as e:
                log.warning("llm explain failed, using templates: %s", e)
                meta = _no_llm_meta(reason=e.code)

        for r in results:  # validation step: every result gets a safe explanation
            if not r["explanation"]:
                r["explanation"] = template_explanation(r)
            r.pop("test_key", None)
        if questions is None:
            questions = template_questions(results)
        if cl.urgent_warning and not any("today" in q.lower() or "urgent" in q.lower() or "critical" in q.lower() for q in questions):
            questions = [template_questions([r for r in results if r["status"] == "urgent"])[0]] + questions[:4]
        if summary is None:
            summary = self._template_summary(results)
        if cl.urgent_warning and "doctor today" not in summary.lower():
            summary += " Because one or more results are at a critical level, please see a doctor today."

        meta["latency_ms"] = int((time.perf_counter() - t0) * 1000)
        if extract_meta:
            meta["extraction"] = "llm"
        log.info("analyze request_id=%s patient=%s results=%d state=%s latency_ms=%d llm=%s",
                 request_id, cl.patient["patient_id"], len(results), cl.state, meta["latency_ms"], meta["llm_used"])
        return {
            "request_id": request_id,
            "state": cl.state,
            "patient": cl.patient,
            "clarifying_question": cl.clarifying_question,
            "results": results,
            "urgent_warning": cl.urgent_warning,
            "doctor_questions": questions,
            "summary": summary,
            "disclaimer": DISCLAIMER,
            "meta": meta,
        }

    @staticmethod
    def _template_summary(results: list[dict]) -> str:
        counts: dict[str, int] = {}
        for r in results:
            counts[r["status"]] = counts.get(r["status"], 0) + 1
        n = len(results)
        normal = counts.get("normal", 0)
        parts = [f"{normal} of {n} result{'s' if n != 1 else ''} {'is' if normal == 1 else 'are'} in the normal range."]
        flagged = counts.get("high", 0) + counts.get("low", 0) + counts.get("urgent", 0)
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
        if re.search(r"\b(another|other|different|someone else'?s?|my (?:friend|wife|husband|brother|sister|neighbou?r)'?s?)\b.{0,20}\b(patient|report|results?|records?)\b", q):
            return "another patient"
        return None

    async def chat(self, patient_id: str | None, report_text: str | None, question: str, age: float | None, sex: str | None) -> dict:
        t0 = time.perf_counter()
        question = (question or "").strip()
        if not question:
            raise AppError("EMPTY_INPUT", "Please type a question.", 400)
        if len(question) > settings.max_question_chars:
            raise AppError("INVALID_INPUT", f"Question is longer than {settings.max_question_chars} characters.", 413)
        rep, _ = self._load(patient_id, report_text)
        privacy_src = self.c.rules.get("privacy")

        other = self._other_patient_mentioned(question, rep)
        if other:
            return {
                "answer": (
                    f"I can only discuss the report currently open{f' ({rep.name})' if rep.name else ''}. "
                    "Following CityLab's safety rules, I cannot share or discuss other patients' records."
                ),
                "refused": True,
                "sources": [privacy_src.as_dict()] if privacy_src else [],
                "disclaimer": DISCLAIMER,
                "meta": _no_llm_meta(int((time.perf_counter() - t0) * 1000)),
            }

        cl = classify_report(self.c, rep, age, sex)
        results = [{k: v for k, v in r.items() if k not in ("explanation", "sources", "test_key", "_blocked")} for r in cl.results]
        ref_sources: list[Source] = list(self.c.glossary_lines) + [r.source for r in self.c.ranges] + [u.source for u in self.c.urgent]
        ref_sources += list(self.c.rules.values())
        reference = "\n".join(f"{s.file}:{s.line}: {s.quote}" for s in ref_sources)
        report_lines = [f"{rep.file}:{r.line}: {r.quote}" for r in rep.results]
        reference = "\n".join(report_lines) + "\n" + reference

        if not self.llm.enabled:
            return self._chat_fallback(question, cl, t0, "LLM_DISABLED")
        try:
            res = await self.llm.complete_json(
                CHAT_SYSTEM,
                CHAT_USER.format(
                    patient_json=json.dumps(cl.patient, ensure_ascii=False),
                    results_json=json.dumps(results, ensure_ascii=False, default=str),
                    reference=reference,
                    question=question,
                ),
                temperature=0.2,
                max_tokens=800,
            )
        except LLMError as e:
            return self._chat_fallback(question, cl, t0, e.code)

        answer = res.data.get("answer") if isinstance(res.data.get("answer"), str) else ""
        if not answer.strip() or looks_like_diagnosis(answer):
            return self._chat_fallback(question, cl, t0, "UNSAFE_OUTPUT")
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
                if k in known:  # only keep citations that really exist
                    sources.append(known[k].as_dict())
        meta = res.meta()
        meta["latency_ms"] = int((time.perf_counter() - t0) * 1000)
        return {"answer": answer.strip(), "refused": bool(res.data.get("refused")), "sources": sources,
                "disclaimer": DISCLAIMER, "meta": meta}

    def _chat_fallback(self, question: str, cl, t0: float, reason: str) -> dict:
        q = question.lower()
        hits = [r for r in cl.results if r["test"].lower() in q or r["test_raw"].lower() in q]
        if hits:
            answer = " ".join(f"{r['test']}: {r['reason']} {template_explanation(r)}" for r in hits)
            sources = [s for r in hits for s in r["sources"]]
        else:
            answer = ("I can only answer questions about the tests in this report right now. "
                      "Try asking about a specific test, for example: " + ", ".join(r["test"] for r in cl.results) + ".")
            sources = []
        return {"answer": answer, "refused": False, "sources": sources, "disclaimer": DISCLAIMER,
                "meta": _no_llm_meta(int((time.perf_counter() - t0) * 1000), reason)}
