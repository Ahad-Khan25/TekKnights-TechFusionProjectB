# CityLab Explainer — API Contract (v1)

Single source of truth shared by backend and frontend. Base URL: `http://localhost:8000` (dev).
All responses are JSON. All errors use the error shape at the bottom.

## Enums

- `status` of a result: `"normal" | "low" | "high" | "urgent" | "cannot_classify" | "needs_demographics"`
- `sex`: `"male" | "female"`
- report `state`: `"ok" | "needs_demographics"`

## GET /api/health

```json
{ "status": "ok", "version": "1.0.0", "providers": ["gemini", "groq", "openrouter"], "llm_enabled": true }
```

## GET /api/patients

Seeded automatically from the corpus files in `lab_reports/report_*.md`.

```json
[
  { "patient_id": "P001", "name": "Alice Smith", "age": 28, "sex": "female", "test_count": 2, "file": "report_P001_Alice_Smith_CBC.md" },
  { "patient_id": "P003", "name": "Charlie Brown", "age": null, "sex": null, "test_count": 1, "file": "report_P003_Charlie_Brown_Sugar_NoDemo.md" }
]
```

## POST /api/analyze

Request — send **either** `patient_id` **or** `report_text` (max 200 000 chars). `age`/`sex` are optional
overrides used when the report is missing them (answer to a clarifying question).

```json
{ "patient_id": "P012", "report_text": null, "age": null, "sex": "female" }
```

Response:

```json
{
  "request_id": "a1b2c3",
  "state": "ok",
  "patient": { "patient_id": "P005", "name": "Ethan Hunt", "age": 50, "sex": "male", "missing": [] },
  "clarifying_question": null,
  "results": [
    {
      "test_raw": "Fasting Blood Sugar",
      "test": "Fasting Blood Sugar",
      "alias_note": null,
      "value_raw": "6.0",
      "unit_raw": "mmol/L",
      "value": 108.0,
      "unit": "mg/dL",
      "conversion": { "from": "6.0 mmol/L", "to": "108.0 mg/dL", "factor": 18.0, "formula": "6.0 × 18.0 = 108.0" },
      "reference": { "low": 70, "high": 99, "unit": "mg/dL", "text": "70 - 99 mg/dL (All, 18-100 yrs)" },
      "status": "high",
      "reason": "108.0 mg/dL is above the normal upper limit of 99 mg/dL.",
      "explanation": "This test measures the sugar in your blood after not eating ...",
      "sources": [
        { "file": "5_ranges_biochemistry.md", "line": 4, "quote": "| **Fasting Blood Sugar** | All | 18 | 100 | 70 | 99 | mg/dL |" },
        { "file": "report_P005_Ethan_Hunt_Sugar_UnitConv.md", "line": 12, "quote": "- **Fasting Blood Sugar**: 6.0 mmol/L" }
      ]
    }
  ],
  "urgent_warning": null,
  "doctor_questions": ["My fasting blood sugar was 108 mg/dL, above the normal range. What could cause this?"],
  "summary": "One of your results is outside the normal range ...",
  "disclaimer": "This is not a diagnosis. Only a licensed doctor can diagnose conditions. Please discuss these results with your doctor.",
  "meta": { "provider": "gemini", "model": "gemini-2.5-pro", "latency_ms": 2140, "tokens": { "prompt": 900, "completion": 400 }, "cached": false, "fallback_used": false, "llm_used": true }
}
```

When `state == "needs_demographics"`: `clarifying_question` is a string such as
`"The report does not list the patient's sex. Please tell me the sex so I can choose the right normal range."`,
`patient.missing` lists `"age"`/`"sex"`, and the affected results have `status: "needs_demographics"`.
The UI should show the question with an age input / sex selector and re-POST with `age`/`sex`.

When `urgent_warning` is non-null, show it as a red banner at the top (e.g. "URGENT: ... see a doctor today.").

## POST /api/chat

Follow-up question about **one** patient (context-locked).

```json
{ "patient_id": "P001", "report_text": null, "question": "What does WBC mean?", "age": null, "sex": null }
```

```json
{
  "answer": "WBC stands for White Blood Cell Count ...",
  "refused": false,
  "sources": [{ "file": "2_medical_glossary.md", "line": 9, "quote": "* **WBC** maps to **White Blood Cell Count**." }],
  "disclaimer": "This is not a diagnosis. ...",
  "meta": { "provider": "gemini", "model": "gemini-2.5-pro", "latency_ms": 900, "tokens": { "prompt": 500, "completion": 120 }, "cached": true, "fallback_used": false, "llm_used": true }
}
```

Asking about another patient returns `refused: true` with an explanation citing `1_lab_safety_rules.md`.

## Errors

HTTP 400 / 404 / 413 / 422 / 429 / 503 / 504 with:

```json
{ "error": { "code": "REPORT_TOO_LARGE", "message": "Report is larger than 200000 characters.", "request_id": "a1b2c3" } }
```

Codes: `EMPTY_INPUT`, `INVALID_INPUT`, `REPORT_TOO_LARGE`, `PATIENT_NOT_FOUND`, `NO_RESULTS_FOUND`,
`RATE_LIMITED`, `LLM_UNAVAILABLE`, `TIMEOUT`, `INTERNAL`.
If all LLM providers fail, `/api/analyze` still returns 200 with deterministic classifications,
template explanations, and `meta.llm_used: false` (graceful degradation).
