# CityLab Explainer — API Contract (v1.1)

Single source of truth shared by backend and frontend. Base URL: `http://localhost:8000` (dev).
All responses are JSON. All errors use the error shape at the bottom.

## Enums

- `status` of a result: `"normal" | "low" | "high" | "urgent" | "cannot_classify" | "needs_demographics"`
- `sex`: `"male" | "female"`
- `lang` (Bonus Multilingual Toggle): `"en"` (English, default) | `"ur"` (Urdu script اردو) | `"ro-ur"` (Roman Urdu)
- report `state`: `"ok" | "needs_demographics"`

## GET /api/health

```json
{
  "status": "ok",
  "version": "1.1.0",
  "providers": ["gemini:gemini-2.5-pro", "groq:llama-3.3-70b-versatile"],
  "llm_enabled": true,
  "patients": 14,
  "supported_languages": ["en", "ur", "ro-ur"],
  "usage": { "calls": 2, "prompt_tokens": 900, "completion_tokens": 350, "errors": 0, "fallbacks": 0 },
  "cache": { "items": 2, "hits": 1, "misses": 2 }
}
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
overrides used when the report is missing them (answer to a clarifying question). `lang` selects output language (`"en"`, `"ur"`, or `"ro-ur"`).

```json
{ "patient_id": "P012", "report_text": null, "age": null, "sex": "female", "lang": "en" }
```

Response:

```json
{
  "request_id": "a1b2c3",
  "lang": "en",
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
      "conversion": { "from": "6 mmol/L", "to": "108 mg/dL", "factor": 18.0, "formula": "6 × 18 = 108" },
      "reference": { "low": 70, "high": 99, "unit": "mg/dL", "text": "70 - 99 mg/dL (All, 18-100 yrs)" },
      "status": "high",
      "reason": "108 mg/dL is above the normal upper limit of 99 mg/dL.",
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
  "meta": { "provider": "gemini", "model": "gemini-2.5-pro", "latency_ms": 2140, "tokens": { "prompt": 900, "completion": 400 }, "cached": false, "fallback_used": false, "llm_used": true, "lang": "en" }
}
```

## POST /api/chat

Follow-up question about **one** patient (context-locked). Supports `lang`: `"en" | "ur" | "ro-ur"`.

```json
{ "patient_id": "P001", "report_text": null, "question": "What does WBC mean?", "age": null, "sex": null, "lang": "en" }
```

## POST /api/simulate (Bonus: Interactive What-If Simulator)

Lets the user test a hypothetical value (e.g. moving a slider or testing a unit conversion) and returns the converted value, range, status, and plain-language explanation in `lang`.

```json
{ "test": "Fasting Blood Sugar", "value": 5.2, "unit": "mmol/L", "age": 50, "sex": "male", "lang": "en" }
```

## POST /api/export (Bonus: Doctor Visit Sheet / Printable Markdown)

Accepts the same body as `/api/analyze` and returns `{ "markdown": "# CityLab ...", "analysis": { ... } }`.

## GET /api/audit (Bonus: Live 14-Patient & 5-Checkpoint Verification)

Runs all 14 corpus reports and all 5 hackathon checkpoints in ~10 ms and returns `{ "total_patients": 14, "passed_patients": 14, "score_pct": 100.0, "checkpoints": [...], "cases": [...] }`.

## Errors

HTTP 400 / 404 / 413 / 422 / 429 / 503 / 504 with:

```json
{ "error": { "code": "REPORT_TOO_LARGE", "message": "Report is larger than 200000 characters.", "request_id": "a1b2c3" } }
```

Codes: `EMPTY_INPUT`, `INVALID_INPUT`, `REPORT_TOO_LARGE`, `PATIENT_NOT_FOUND`, `NO_RESULTS_FOUND`,
`RATE_LIMITED`, `LLM_UNAVAILABLE`, `TIMEOUT`, `INTERNAL`.
