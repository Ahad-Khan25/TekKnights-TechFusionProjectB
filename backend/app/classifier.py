"""Deterministic classification: alias -> canonical test, unit conversion, range selection, status.

The LLM never decides normal/low/high/urgent; this module does, so results are exact and reproducible.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .corpus import Corpus, RangeRule, Source, UrgentRule, _fmt, norm_unit, resolve_test
from .report_parser import QUALITATIVE, ParsedReport, ParsedResult

# Standard, well-known conversion factors (not in the corpus files; shown explicitly in every output).
# (canonical test or "*", from unit, to unit) -> (factor, explanation)
CONVERSIONS: dict[tuple[str, str, str], tuple[float, str]] = {
    ("fasting blood sugar", "mmol/L", "mg/dL"): (18.0, "glucose: 1 mmol/L = 18 mg/dL (molar mass 180.16 g/mol)"),
    ("cholesterol", "mmol/L", "mg/dL"): (38.67, "cholesterol: 1 mmol/L = 38.67 mg/dL"),
    ("hemoglobin", "g/L", "g/dL"): (0.1, "1 g/L = 0.1 g/dL"),
    ("*", "10^3/mcL", "cells/mcL"): (1000.0, "1 x10^3/mcL = 1000 cells/mcL"),
    ("*", "10^9/L", "cells/mcL"): (1000.0, "1 x10^9/L = 1000 cells/mcL"),
}

DISCLAIMER = (
    "This is not a diagnosis. Only a licensed doctor can diagnose conditions. "
    "Please discuss these results with your doctor."
)


@dataclass
class Classification:
    patient: dict
    state: str
    clarifying_question: str | None
    results: list[dict]
    urgent_warning: str | None


def _num(value_raw: str) -> float | None:
    v = value_raw.replace(",", "").lstrip("<>").strip()
    try:
        return float(v)
    except ValueError:
        return None


def _convert(test: str, value: float, unit_from: str, unit_to: str) -> tuple[float, dict] | None:
    if unit_from == unit_to:
        return value, None  # type: ignore[return-value]
    for t in (test, "*"):
        conv = CONVERSIONS.get((t, unit_from, unit_to))
        if conv:
            factor, note = conv
            out = round(value * factor, 2)
            return out, {
                "from": f"{_fmt(value)} {unit_from}",
                "to": f"{_fmt(out)} {unit_to}",
                "factor": factor,
                "formula": f"{_fmt(value)} × {_fmt(factor)} = {_fmt(out)}",
                "note": note,
            }
    return None


def _unit_ok(range_unit: str, unit: str) -> bool:
    if range_unit == "":
        return unit in ("", "pH", "ph")
    return unit == range_unit


def _pick_range(cands: list[RangeRule], age: float, sex: str | None) -> RangeRule | None:
    ok = [r for r in cands if (r.sex == "all" or r.sex == sex) and r.age_min <= age <= r.age_max]
    if not ok:
        return None
    # "Age boundaries are inclusive of the upper bound": prefer the band whose upper bound equals the age.
    ok.sort(key=lambda r: (0 if age == r.age_max else 1, 0 if r.sex != "all" else 1))
    return ok[0]


def _urgent_check(c: Corpus, test: str, value: float | None, unit: str) -> tuple[UrgentRule, float] | None:
    if value is None:
        return None
    for u in c.urgent_for(test):
        conv = _convert(test, value, unit, u.unit) if unit != u.unit else (value, None)
        if conv is None:
            continue
        v = conv[0]
        # Directive says "hit or pass these thresholds" -> inclusive comparison.
        if (u.op == "lt" and v <= u.threshold) or (u.op == "gt" and v >= u.threshold):
            return u, v
    return None


def classify_result(c: Corpus, pr: ParsedResult, age: float | None, sex: str | None, report_file: str) -> dict:
    canonical, alias_note, alias_src = resolve_test(c, pr.name)
    unit = norm_unit(pr.unit_raw)
    if unit.lower() == "ph":
        unit = ""
    value = _num(pr.value_raw)
    sources: list[dict] = [Source(report_file, pr.line, pr.quote).as_dict()]
    if alias_src:
        sources.append(alias_src.as_dict())
    out = {
        "test_raw": pr.name,
        "test": c.display_names.get(canonical, pr.name) if canonical else pr.name,
        "test_key": canonical,
        "alias_note": alias_note,
        "value_raw": pr.value_raw,
        "unit_raw": pr.unit_raw,
        "value": value if value is not None else pr.value_raw,
        "unit": unit or pr.unit_raw,
        "conversion": None,
        "reference": None,
        "status": "cannot_classify",
        "reason": "",
        "explanation": "",
        "sources": sources,
    }

    def cannot(reason: str) -> dict:
        out["status"], out["reason"] = "cannot_classify", reason
        if "unknown_tests" in c.rules:
            sources.append(c.rules["unknown_tests"].as_dict())
        return out

    if canonical is None or not c.ranges_for(canonical):
        return cannot(f"'{pr.name}' has no matching range in the reference sheets, so it cannot be classified from the files.")

    cands = c.ranges_for(canonical)
    needs_sex = any(r.sex != "all" for r in cands)
    missing = [m for m, v in (("age", age), ("sex", sex if needs_sex else "n/a")) if v is None]

    urgent = _urgent_check(c, canonical, value, unit)
    if missing:
        out["status"] = "needs_demographics"
        out["_blocked"] = True  # internal flag: range could not be chosen (stripped before responding)
        out["reason"] = (
            f"The patient's {' and '.join(missing)} is missing, so the right normal range cannot be chosen."
        )
        if "missing_demographics" in c.rules:
            sources.append(c.rules["missing_demographics"].as_dict())
        if urgent:
            _apply_urgent(c, out, urgent, sources)
        return out

    rng = _pick_range(cands, age, sex)  # type: ignore[arg-type]
    if rng is None:
        return cannot(f"No range in the files covers a {sex or ''} patient aged {_fmt(age)} for {out['test']}.".replace("  ", " "))
    out["reference"] = {"low": rng.low, "high": rng.high, "unit": rng.unit, "qualitative": rng.qualitative, "text": rng.text()}
    sources.append(rng.source.as_dict())

    if rng.qualitative:
        q = pr.value_raw.strip().lower()
        if q not in QUALITATIVE and not re.fullmatch(r"\d\+", q):
            return cannot(f"Expected a result like '{rng.qualitative.capitalize()}', got '{pr.value_raw}'.")
        out["value"] = pr.value_raw.capitalize()
        if q in (rng.qualitative, "nil", "absent"):
            out["status"], out["reason"] = "normal", f"Result is {pr.value_raw.capitalize()}, which matches the normal result ({rng.qualitative.capitalize()})."
        else:
            out["status"], out["reason"] = "high", f"Result is {pr.value_raw.capitalize()}; the normal result is {rng.qualitative.capitalize()}."
        return out

    if value is None:
        return cannot(f"The value '{pr.value_raw}' is not a number, so it cannot be compared with the range.")
    if not _unit_ok(rng.unit, unit):
        if not unit:
            return cannot(f"No unit was given for {out['test']}; the range uses {rng.unit}, so it cannot be compared safely.")
        conv = _convert(canonical, value, unit, rng.unit)
        if conv is None:
            return cannot(f"The unit '{pr.unit_raw}' cannot be converted to {rng.unit} using the files, so it cannot be classified.")
        value, out["conversion"] = conv
        out["value"], out["unit"] = value, rng.unit

    shown = f"{_fmt(value)} {rng.unit}".strip()
    if value < rng.low:  # type: ignore[operator]
        out["status"], out["reason"] = "low", f"{shown} is below the normal lower limit of {_fmt(rng.low)} {rng.unit}.".replace("  ", " ")
    elif value > rng.high:  # type: ignore[operator]
        out["status"], out["reason"] = "high", f"{shown} is above the normal upper limit of {_fmt(rng.high)} {rng.unit}.".replace("  ", " ")
    else:
        out["status"] = "normal"
        if value in (rng.low, rng.high):
            out["reason"] = f"{shown} sits exactly on the range limit; the range sheet rule says values on a limit are NORMAL."
            if "boundary" in c.rules:
                sources.append(c.rules["boundary"].as_dict())
        else:
            out["reason"] = f"{shown} is within the normal range {rng.text()}."
    if urgent:
        _apply_urgent(c, out, urgent, sources)
    return out


def _apply_urgent(c: Corpus, out: dict, urgent: tuple[UrgentRule, float], sources: list[dict]) -> None:
    rule, v = urgent
    word = "below" if rule.op == "lt" else "above"
    out["status"] = "urgent"
    out["reason"] = (
        f"{_fmt(v)} {rule.unit} is at or {word} the critical limit of {_fmt(rule.threshold)} {rule.unit}. "
        + (out["reason"] if out["reason"] and "missing" not in out["reason"] else "")
    ).strip()
    sources.append(rule.source.as_dict())
    if "urgent" in c.rules:
        sources.append(c.rules["urgent"].as_dict())


def classify_report(c: Corpus, rep: ParsedReport, age: float | None = None, sex: str | None = None) -> Classification:
    age = rep.age if rep.age is not None else age
    sex = rep.sex if rep.sex is not None else sex
    results = [classify_result(c, r, age, sex, rep.file) for r in rep.results]
    missing = [m for m, v in (("age", age), ("sex", sex)) if v is None]
    needs = [r for r in results if r.pop("_blocked", False)]
    clarifying = None
    state = "ok"
    if needs or (missing and not results):
        state = "needs_demographics"
        what = " and ".join(missing)
        clarifying = (
            f"The report does not list the patient's {what}. Normal ranges depend on age and sex, so the right range "
            f"cannot be chosen without guessing. Please tell me the patient's {what} so I can classify the results."
        )
    urgent = [r for r in results if r["status"] == "urgent"]
    urgent_warning = None
    if urgent:
        names = ", ".join(f"{r['test']} ({_fmt(r['value']) if isinstance(r['value'], float) else r['value']} {r['unit']})" for r in urgent)
        urgent_warning = (
            f"URGENT: {names} reached a critical level listed by the lab. Please see a doctor today "
            f"or seek urgent medical care."
        )
    patient = {
        "patient_id": rep.patient_id,
        "name": rep.name,
        "age": age,
        "sex": sex,
        "missing": missing,
    }
    return Classification(patient, state, clarifying, results, urgent_warning)
