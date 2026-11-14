"""Classifier tests against every report in the organizer corpus plus tricky variants."""
from pathlib import Path

import pytest

from app.classifier import classify_report
from app.config import settings
from app.corpus import load_corpus
from app.report_parser import parse_report

C = load_corpus(settings.corpus_dir)


def run(pid: str, age=None, sex=None):
    path = C.reports[pid]
    rep = parse_report(path.read_text(encoding="utf-8"), path.name)
    return classify_report(C, rep, age, sex)


def statuses(cl):
    return [(r["test"], r["status"]) for r in cl.results]


def test_corpus_loaded():
    assert len(C.reports) == 14
    assert {"hemoglobin", "alt", "ast", "fasting blood sugar", "tsh", "urine ph", "urine protein"} <= set(C.display_names)
    assert C.aliases["sgpt"][0] == "alt"
    assert len(C.urgent) == 4
    assert {"privacy", "no_diagnosis", "missing_demographics", "unknown_tests", "boundary", "urgent"} <= set(C.rules)


@pytest.mark.parametrize(
    "pid,expected",
    [
        ("P001", [("Hemoglobin", "normal"), ("White Blood Cell Count", "normal")]),
        ("P002", [("ALT", "normal")]),  # SGPT alias, exactly on female upper limit 45
        ("P003", [("Fasting Blood Sugar", "needs_demographics")]),
        ("P004", [("Hemoglobin", "urgent"), ("Platelet Count", "low")]),
        ("P005", [("Fasting Blood Sugar", "high")]),  # 6.0 mmol/L -> 108 mg/dL
        ("P006", [("Serum Ferritin", "cannot_classify")]),
        ("P007", [("TSH", "normal")]),
        ("P008", [("Urine pH", "normal"), ("Urine Protein", "normal")]),
        ("P009", [("ALT", "high"), ("AST", "high")]),
        ("P010", [("Cholesterol", "normal")]),  # exactly 200
        ("P011", [("White Blood Cell Count", "high"), ("Platelet Count", "low")]),
        ("P012", [("AST", "needs_demographics")]),
        ("P013", [("Fasting Blood Sugar", "urgent")]),
        ("P014", [("Fasting Blood Sugar", "normal"), ("AST", "normal")]),
    ],
)
def test_corpus_reports(pid, expected):
    assert statuses(run(pid)) == expected


def test_unit_conversion_shown():
    r = run("P005").results[0]
    assert r["conversion"]["formula"] == "6 × 18 = 108"
    assert r["value"] == 108.0 and r["unit"] == "mg/dL"


def test_alias_note_and_boundary_citation():
    r = run("P002").results[0]
    assert r["alias_note"].startswith("SGPT = ALT")
    assert any(s["file"] == "4_ranges_hematology.md" for s in r["sources"])  # boundary rule cited


def test_missing_demographics_asks_and_override_works():
    cl = run("P012")
    assert cl.state == "needs_demographics" and "sex" in cl.clarifying_question
    assert run("P012", sex="female").results[0]["status"] == "high"  # 44 > 43 (female)
    assert run("P012", sex="male").results[0]["status"] == "normal"  # 44 <= 48 (male)
    assert run("P003", age=40).results[0]["status"] == "high"  # FBS is 'All' sexes; only age needed


def test_urgent_warning():
    cl = run("P013")
    assert cl.urgent_warning and "see a doctor today" in cl.urgent_warning


def classify_text(text, age=None, sex=None):
    return classify_report(C, parse_report(text), age, sex)


def test_messy_pasted_report():
    text = """Name: Test Person
Age: 30 years
Sex: M
Hgb = 13.8 g/dL
Platelets: 1.4 x10^3/uL
SGPT: 56 IU/L
Vitamin D: 20 ng/mL
FBS: 5.5 mmol/L
Cholesterol: 7 furlongs
"""
    got = {r["test"]: r["status"] for r in classify_text(text).results}
    assert got == {
        "Hemoglobin": "normal",  # exactly on male lower limit
        "Platelet Count": "urgent",  # 1.4e3 = 1400 cells/mcL < 50000
        "ALT": "high",  # 56 > 55 male
        "Vitamin D": "cannot_classify",
        "Fasting Blood Sugar": "normal",  # 99 mg/dL, exactly on limit
        "Cholesterol": "cannot_classify",  # unknown unit
    }


def test_age_outside_ranges_cannot_classify():
    cl = classify_text("Age: 10\nSex: Female\nHemoglobin: 12 g/dL")
    assert cl.results[0]["status"] == "cannot_classify"


def test_urgent_detected_even_without_demographics():
    cl = classify_text("Fasting Blood Sugar: 400 mg/dL")
    assert cl.results[0]["status"] == "urgent"
    assert cl.urgent_warning
    assert cl.state == "needs_demographics"  # still asks for age to choose the normal range
