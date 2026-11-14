"""Load the CityLab reference files and turn them into structured, citable knowledge.

Nothing clinical is hardcoded here: ranges, aliases, urgent thresholds and safety rules are parsed
from the corpus files at startup, and every fact keeps its file name + line number for citations.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class Source:
    file: str
    line: int
    quote: str

    def as_dict(self) -> dict:
        return {"file": self.file, "line": self.line, "quote": self.quote}


@dataclass(frozen=True)
class RangeRule:
    test: str  # canonical key (lowercase)
    sex: str  # "male" | "female" | "all"
    age_min: float
    age_max: float
    low: float | None
    high: float | None
    unit: str  # normalized unit, "" for unitless
    qualitative: str | None  # e.g. "negative" for qualitative tests
    source: Source

    def text(self) -> str:
        sex = "All" if self.sex == "all" else self.sex.capitalize()
        if self.qualitative:
            body = self.qualitative.capitalize()
        else:
            body = f"{_fmt(self.low)} - {_fmt(self.high)} {self.unit}".strip()
        return f"{body} ({sex}, {_fmt(self.age_min)}-{_fmt(self.age_max)} yrs)"


@dataclass(frozen=True)
class UrgentRule:
    test: str
    op: str  # "lt" | "gt"
    threshold: float
    unit: str
    source: Source


@dataclass
class Corpus:
    display_names: dict[str, str] = field(default_factory=dict)  # canonical key -> display name
    aliases: dict[str, tuple[str, Source | None]] = field(default_factory=dict)  # alias -> (canonical, source)
    ranges: list[RangeRule] = field(default_factory=list)
    urgent: list[UrgentRule] = field(default_factory=list)
    rules: dict[str, Source] = field(default_factory=dict)  # privacy / no_diagnosis / missing_demo / unknown / boundary
    reports: dict[str, Path] = field(default_factory=dict)  # patient_id -> report path
    glossary_lines: list[Source] = field(default_factory=list)

    def ranges_for(self, test: str) -> list[RangeRule]:
        return [r for r in self.ranges if r.test == test]

    def urgent_for(self, test: str) -> list[UrgentRule]:
        return [u for u in self.urgent if u.test == test]


def _fmt(x: float | None) -> str:
    if x is None:
        return "?"
    return str(int(x)) if float(x).is_integer() else str(x)


def key(name: str) -> str:
    """Canonical lookup key: lowercase, strip markdown, parentheses content and extra spaces."""
    name = re.sub(r"[*_`]", "", name)
    name = re.sub(r"\(.*?\)", "", name)
    return re.sub(r"\s+", " ", name).strip().lower()


# --- unit normalization -----------------------------------------------------------------------
_UNIT_ALIASES = {
    "mg/dl": "mg/dL",
    "mmol/l": "mmol/L",
    "g/dl": "g/dL",
    "g/l": "g/L",
    "u/l": "U/L",
    "iu/l": "U/L",
    "cells/mcl": "cells/mcL",
    "cells/ul": "cells/mcL",
    "cells/µl": "cells/mcL",
    "cells/μl": "cells/mcL",
    "/mcl": "cells/mcL",
    "/ul": "cells/mcL",
    "/µl": "cells/mcL",
    "/μl": "cells/mcL",
    "cells/mm3": "cells/mcL",
    "/mm3": "cells/mcL",
    "x10^3/ul": "10^3/mcL",
    "x10^3/µl": "10^3/mcL",
    "x10^3/mcl": "10^3/mcL",
    "10^3/ul": "10^3/mcL",
    "10^3/µl": "10^3/mcL",
    "10^3/mcl": "10^3/mcL",
    "k/ul": "10^3/mcL",
    "k/mcl": "10^3/mcL",
    "x10^9/l": "10^9/L",
    "10^9/l": "10^9/L",
    "miu/l": "mIU/L",
    "uiu/ml": "mIU/L",
    "µiu/ml": "mIU/L",
    "μiu/ml": "mIU/L",
    "ng/ml": "ng/mL",
}


def norm_unit(unit: str | None) -> str:
    if not unit:
        return ""
    u = unit.strip().strip(".").replace(" ", "").replace("×", "x").replace("*", "")
    return _UNIT_ALIASES.get(u.lower(), unit.strip().strip("."))


# --- parsing of each reference file --------------------------------------------------------------
_NUM = r"-?\d+(?:\.\d+)?"


def _lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8", errors="replace").splitlines()


def _register(c: Corpus, display: str) -> str:
    k = key(display)
    c.display_names.setdefault(k, re.sub(r"\(.*?\)", "", re.sub(r"[*_`]", "", display)).strip())
    return k


def _parse_glossary(c: Corpus, path: Path) -> None:
    pat = re.compile(r"\*\*(.+?)\*\*\s+(?:is the exact equivalent of|maps to)\s+\*\*(.+?)\*\*")
    for i, ln in enumerate(_lines(path), 1):
        m = pat.search(ln)
        if m:
            src = Source(path.name, i, ln.strip())
            target = _register(c, m.group(2))
            c.aliases[key(m.group(1))] = (target, src)
            c.glossary_lines.append(src)


def _parse_urgent(c: Corpus, path: Path) -> None:
    pat = re.compile(r"^\|\s*\*{0,2}(.+?)\*{0,2}\s*\|\s*(Less than|Greater than)\s*\|\s*(" + _NUM + r")\s*\|\s*(.*?)\s*\|")
    for i, ln in enumerate(_lines(path), 1):
        m = pat.match(ln.strip())
        if m:
            t = _register(c, m.group(1))
            op = "lt" if m.group(2).lower().startswith("less") else "gt"
            c.urgent.append(UrgentRule(t, op, float(m.group(3)), norm_unit(m.group(4)), Source(path.name, i, ln.strip())))
        elif "hit or pass" in ln:
            c.rules["urgent"] = Source(path.name, i, ln.strip())


def _parse_hematology(c: Corpus, path: Path) -> None:
    head = re.compile(r"^\*\s+\*\*(.+?)\*\*\s*:\s*$")
    row = re.compile(
        r"^\*\s+(Male|Female|All)[^(]*\((" + _NUM + r")\s*-\s*(" + _NUM + r")\s*yrs\)\s*:\s*(" + _NUM + r")\s*-\s*(" + _NUM + r")\s*(.*)$",
        re.I,
    )
    current = None
    for i, ln in enumerate(_lines(path), 1):
        s = ln.strip()
        if "Edge Case Rule" in s:
            c.rules["boundary"] = Source(path.name, i, s)
        m = head.match(s)
        if m:
            current = _register(c, m.group(1))
            ab = re.search(r"\((.+?)\)", m.group(1))
            if ab:
                c.aliases.setdefault(key(ab.group(1)), (current, Source(path.name, i, s)))
            continue
        m = row.match(s)
        if m and current:
            sex = m.group(1).lower()
            c.ranges.append(
                RangeRule(current, sex, float(m.group(2)), float(m.group(3)), float(m.group(4)), float(m.group(5)),
                          norm_unit(m.group(6)), None, Source(path.name, i, s))
            )


def _parse_biochem(c: Corpus, path: Path) -> None:
    pat = re.compile(
        r"^\|\s*\*{0,2}(.+?)\*{0,2}\s*\|\s*(Male|Female|All)\s*\|\s*(" + _NUM + r")\s*\|\s*(" + _NUM + r")\s*\|\s*("
        + _NUM + r")\s*\|\s*(" + _NUM + r")\s*\|\s*(.*?)\s*\|",
        re.I,
    )
    for i, ln in enumerate(_lines(path), 1):
        m = pat.match(ln.strip())
        if m:
            t = _register(c, m.group(1))
            c.ranges.append(
                RangeRule(t, m.group(2).lower(), float(m.group(3)), float(m.group(4)), float(m.group(5)), float(m.group(6)),
                          norm_unit(m.group(7)), None, Source(path.name, i, ln.strip()))
            )


def _parse_simple_ranges(c: Corpus, path: Path) -> None:
    num = re.compile(
        r"^\*\s+\*\*(.+?)\*\*\s*:\s*(" + _NUM + r")\s*-\s*(" + _NUM + r")\s*([^(]*?)\s*\(Applicable to (\w+) sexes?,\s*("
        + _NUM + r")\s*-\s*(" + _NUM + r")\s*yrs\)",
        re.I,
    )
    qual = re.compile(
        r"^\*\s+\*\*(.+?)\*\*\s*:\s*([A-Za-z]+)\s*\(Applicable to (\w+) sexes?,\s*(" + _NUM + r")\s*-\s*(" + _NUM + r")\s*yrs\)",
        re.I,
    )
    for i, ln in enumerate(_lines(path), 1):
        s = ln.strip()
        m = num.match(s)
        if m:
            t = _register(c, m.group(1))
            c.ranges.append(
                RangeRule(t, m.group(5).lower(), float(m.group(6)), float(m.group(7)), float(m.group(2)), float(m.group(3)),
                          norm_unit(m.group(4)), None, Source(path.name, i, s))
            )
            continue
        m = qual.match(s)
        if m:
            t = _register(c, m.group(1))
            c.ranges.append(
                RangeRule(t, m.group(3).lower(), float(m.group(4)), float(m.group(5)), None, None, "",
                          m.group(2).lower(), Source(path.name, i, s))
            )


def _parse_safety(c: Corpus, path: Path) -> None:
    tags = {
        "PRIVACY": "privacy",
        "NO DIAGNOSTIC": "no_diagnosis",
        "MISSING DEMOGRAPHICS": "missing_demographics",
        "UNKNOWN TESTS": "unknown_tests",
    }
    for i, ln in enumerate(_lines(path), 1):
        for needle, tag in tags.items():
            if needle in ln and tag not in c.rules:
                c.rules[tag] = Source(path.name, i, ln.strip())


# Extra synonyms for names seen in real reports but not in the glossary. Kept small and explicit;
# every match made through this table is labelled "built-in synonym" in the output (not a file citation).
BUILTIN_SYNONYMS = {
    "hgb": "hemoglobin",
    "haemoglobin": "hemoglobin",
    "white blood cells": "white blood cell count",
    "white blood cell": "white blood cell count",
    "wbc count": "white blood cell count",
    "platelets": "platelet count",
    "platelet": "platelet count",
    "plt count": "platelet count",
    "fasting glucose": "fasting blood sugar",
    "glucose fasting": "fasting blood sugar",
    "fasting plasma glucose": "fasting blood sugar",
    "fpg": "fasting blood sugar",
    "alanine aminotransferase": "alt",
    "aspartate aminotransferase": "ast",
    "total cholesterol": "cholesterol",
    "serum cholesterol": "cholesterol",
    "thyroid stimulating hormone": "tsh",
    "ph": "urine ph",
    "ph level": "urine ph",
    "urine ph level": "urine ph",
    "protein": "urine protein",
    "urine protein level": "urine protein",
    "protein urine": "urine protein",
}


def load_corpus(corpus_dir: Path) -> Corpus:
    c = Corpus()
    files = sorted(corpus_dir.glob("*.md"))
    if not files:
        raise FileNotFoundError(f"No corpus files found in {corpus_dir}")
    for f in files:
        n = f.name.lower()
        if "glossary" in n:
            _parse_glossary(c, f)
        elif "urgent" in n or "dangerous" in n:
            _parse_urgent(c, f)
        elif "hematology" in n:
            _parse_hematology(c, f)
        elif "biochem" in n:
            _parse_biochem(c, f)
        elif "ranges" in n:
            _parse_simple_ranges(c, f)
        elif "safety" in n:
            _parse_safety(c, f)
        m = re.match(r"report_(P\d+)_", f.name, re.I)
        if m:
            c.reports[m.group(1).upper()] = f
    # Register canonical names as self-aliases so lookups by full name work.
    for k in list(c.display_names):
        c.aliases.setdefault(k, (k, None))
    return c


def resolve_test(c: Corpus, raw_name: str) -> tuple[str | None, str | None, Source | None]:
    """Map a raw test name to a canonical key. Returns (canonical, alias_note, source)."""
    k = key(raw_name)
    if k in c.aliases:
        target, src = c.aliases[k]
        target = c.aliases.get(target, (target, None))[0]
        note = None if target == k else f"{raw_name.strip()} = {c.display_names.get(target, target)}"
        return target, note, src
    if k in BUILTIN_SYNONYMS:
        target = BUILTIN_SYNONYMS[k]
        target = c.aliases.get(target, (target, None))[0]
        if target in c.display_names:
            return target, f"{raw_name.strip()} = {c.display_names[target]} (built-in synonym)", None
    return None, None, None
