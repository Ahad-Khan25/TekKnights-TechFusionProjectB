"""Plain-language fallback explanations and safety validation of LLM output."""
from __future__ import annotations

import re

# Our own short, plain descriptions of what each test measures (used when the LLM is unavailable
# or its text fails validation).
TEST_INFO = {
    "hemoglobin": "Hemoglobin is the part of red blood cells that carries oxygen around your body.",
    "white blood cell count": "White blood cells are the body's defenders that help fight germs.",
    "platelet count": "Platelets are tiny blood cells that help your blood clot and stop bleeding.",
    "fasting blood sugar": "Fasting blood sugar is the amount of sugar (glucose) in your blood after not eating for several hours.",
    "alt": "ALT is a substance made mostly in the liver; its level gives clues about how the liver is doing.",
    "ast": "AST is a substance found in the liver and muscles; its level gives clues about the liver and muscles.",
    "cholesterol": "Cholesterol is a fatty substance in the blood; the body needs some, but too much can affect blood vessels.",
    "tsh": "TSH is a signal from the brain that tells the thyroid gland (in your neck) how hard to work.",
    "urine ph": "Urine pH shows how acidic or basic your urine is.",
    "urine protein": "Urine protein checks whether protein is leaking into your urine; normally there is none.",
}

STATUS_TEXT = {
    "normal": "Your result is within the normal range.",
    "low": "Your result is lower than the normal range. A low value can have many causes, some harmless; your doctor can explain what it means for you.",
    "high": "Your result is higher than the normal range. A high value can have many causes, some harmless; your doctor can explain what it means for you.",
    "urgent": "Your result has reached a level the lab marks as critical. Please see a doctor today.",
    "cannot_classify": "The lab's reference files do not have a range for this test or unit, so it cannot be classified from the files.",
    "needs_demographics": "The right normal range depends on age and sex, which are missing, so this result cannot be classified yet.",
}

_DIAGNOSIS_PATTERNS = [
    r"\byou (?:have|has|are suffering from|suffer from|are diagnosed)\b(?! (?:a|an|the)? ?(?:normal|high|low|result|value|reading|level|question))",
    r"\b(?:diagnos(?:is|ed) (?:of|with))\b",
    r"\byou are (?:diabetic|anemic|anaemic)\b",
    r"\bthis (?:means|confirms|shows) (?:you|that you) (?:have|are)\b",
    r"\bconfirms? (?:a |an )?(?:disease|diagnosis|condition)\b",
]
_DIAG_RE = re.compile("|".join(_DIAGNOSIS_PATTERNS), re.I)


def looks_like_diagnosis(text: str) -> bool:
    return bool(_DIAG_RE.search(text or ""))


def template_explanation(result: dict) -> str:
    info = TEST_INFO.get(result.get("test_key") or "", "")
    status = STATUS_TEXT.get(result["status"], "")
    return f"{info} {status}".strip()


def template_questions(results: list[dict]) -> list[str]:
    order = {"urgent": 0, "high": 1, "low": 1, "needs_demographics": 2, "cannot_classify": 3}
    flagged = sorted((r for r in results if r["status"] in order), key=lambda r: order[r["status"]])
    qs: list[str] = []
    for r in flagged:
        val = f"{r['value']} {r['unit']}".strip()
        if r["status"] == "urgent":
            qs.append(f"My {r['test']} was {val}, which the lab marks as critical. What should I do today?")
        elif r["status"] in ("high", "low"):
            qs.append(f"My {r['test']} was {r['status']} ({val}). What could cause this, and do I need more tests?")
        elif r["status"] == "cannot_classify":
            qs.append(f"The lab could not classify my {r['test']} result ({val}). What does it mean for me?")
        else:
            qs.append(f"Which normal range applies to my {r['test']} result given my age and sex?")
    generic = [
        "Do any of these results need a repeat test or follow-up?",
        "Is there anything in my diet, medicines or lifestyle that could affect these results?",
        "When should I get these tests checked again?",
    ]
    for g in generic:
        if len(qs) >= 3:
            break
        qs.append(g)
    return qs[:5]


def clean_questions(qs: object, results: list[dict]) -> list[str]:
    if not isinstance(qs, list):
        return template_questions(results)
    out = [q.strip() for q in qs if isinstance(q, str) and q.strip() and not looks_like_diagnosis(q)]
    if len(out) < 3:
        for q in template_questions(results):
            if len(out) >= 3:
                break
            if q not in out:
                out.append(q)
    return out[:5]
