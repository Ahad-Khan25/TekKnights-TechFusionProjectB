# CityLab Diagnostics — AI Medical Lab Report Explainer (Challenge B)

**Tech Fusion ’26 AI Hackathon Submission**

An end-to-end, safety-locked medical lab report explainer that strips 95% legal/CLIA/HIPAA boilerplate from noisy clinical files, deterministically classifies lab values against age/sex reference ranges with exact file:line citations, converts units and aliases, enforces patient privacy, and explains every result at a Class-8 reading level in **English**, **Urdu (اردو)**, and **Roman Urdu**—without ever diagnosing.

---

## 1. Quick Start

### Option A: Docker Compose (Recommended for Judges)
```bash
cp .env.example .env
# Optional: add GEMINI_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY to .env
docker compose up --build
```
Open **http://localhost:8000** for the full web application, or **http://localhost:8000/docs** for interactive OpenAPI documentation.

### Option B: Local Python (Windows / macOS / Linux)
```bash
python -m venv .venv
# Windows: .\.venv\Scripts\activate   |   macOS/Linux: source .venv/bin/activate
pip install -r backend/requirements.txt -r backend/requirements-dev.txt

# Run automated test suite (25 tests covering all 14 corpus reports, LLM fallback, and bonus features)
cd backend && pytest -q

# Start the server (serves both API and Web UI on port 8000)
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

---

## 2. Multi-Step Pipeline Architecture (Beyond a Single Prompt)

Single-prompt LLMs frequently hallucinate unit conversions, misclassify boundary values (`45` vs `<= 45`), or get distracted by the ~15 KB of repeated CLIA/HIPAA boilerplate in every file. Our system separates **clinical math/rules** from **plain-language communication**:

1. **Step 1 — Boilerplate Stripper & Structural Parser (`backend/app/report_parser.py`)**:
   - Extracts patient demographics (`name`, `age`, `sex`, `MRN`) and isolates `SECTION III: ANALYTICAL RESULTS` while discarding `APPENDIX 1–4` compliance noise.
   - Parses all 5 report formats found in the corpus (`- Test: val unit`, `* **Test**: val unit`, `| Test | Val | Unit |`, `* Test -> val`, and two-line `Test: X / Result: Y`).
   - **Step 1b (LLM Extraction Fallback)**: If an unfamiliar free-text report yields no regex matches, the LLM extracts structured JSON, and a **verbatim ground-truth verifier** drops any value not literally present in the source text.
2. **Step 2 — Corpus-Driven Alias & Unit Normalizer (`backend/app/corpus.py`, `classifier.py`)**:
   - Parses `2_medical_glossary.md` at startup (`SGPT -> ALT`, `SGOT -> AST`, `FBS -> Fasting Blood Sugar`, `Hb -> Hemoglobin`, `PLT -> Platelet Count`, `WBC -> White Blood Cell Count`).
   - Converts non-standard units before comparison (`6.0 mmol/L × 18 = 108.0 mg/dL` for glucose; `10^3/mcL -> cells/mcL`) and records the exact formula in the output.
3. **Step 3 — Deterministic Range & Urgent Classifier (`backend/app/classifier.py`)**:
   - Parses `4_ranges_hematology.md`, `5_ranges_biochemistry.md`, `6_ranges_thyroid_urine.md`, and `3_dangerous_urgent_values.md` at startup with exact `file:line` provenance.
   - Applies the inclusive boundary rule (`4_ranges_hematology.md:2` — values sitting **exactly** on a lower or upper limit are `NORMAL`, e.g., `P002` Female ALT=45, `P010` Cholesterol=200).
   - Refuses to guess when required `age` or `sex` is missing (`P003`, `P012`) and returns a targeted `clarifying_question`.
   - Marks tests absent from the reference sheets (`P006` Serum Ferritin) as `cannot_classify`.
4. **Step 4 — Resilient Multi-Provider LLM Explainer (`backend/app/llm/client.py`, `prompts.py`)**:
   - Provider chain: **Gemini (`gemini-2.5-pro` → `gemini-2.5-flash`) → Groq (`llama-3.3-70b-versatile`) → OpenRouter (`llama-3.3-70b-instruct:free`) → Deterministic Safe Templates**.
   - Includes **semaphore request queueing**, **per-process throttling**, **exponential backoff with jitter** on `429`/`5xx`, **provider cooldown** on `429`/`401`/`403`, and an **in-memory TTL+LRU cache** (`backend/app/llm/cache.py`).
5. **Step 5 — Post-Generation Safety & Anti-Diagnosis Validator (`backend/app/safety.py`)**:
   - Scans LLM output for diagnostic phrasing (`"you have..."`, `"diagnosed with..."`, `"you are diabetic/anemic"`). Unsafe outputs are automatically replaced with verified non-diagnostic templates.
   - Enforces 3–5 prioritized doctor questions (urgent first) and attaches the mandatory licensed-doctor disclaimer.

---

## 3. How All 5 Hackathon Checkpoints Are Verified (`14/14` Corpus Score)

| Checkpoint | Corpus Files | System Behavior |
| :--- | :--- | :--- |
| **1. Match names & units** | `P002` (`SGPT`), `P005` (`6.0 mmol/L`), `P014` (`FBS`, `SGOT`) | Maps aliases via `2_medical_glossary.md`; converts `6.0 mmol/L × 18 = 108 mg/dL` → **HIGH** (`> 99 mg/dL`) and displays the formula. |
| **2. Boundary & missing demographics** | `P002` (`ALT=45` F), `P010` (`Chol=200`), `P003` (no age/sex), `P012` (no sex) | Marks `45` and `200` as **NORMAL** citing `4_ranges_hematology.md:2`. Marks `P003` and `P012` as `needs_demographics` and asks the user without guessing. |
| **3. Admit what cannot be classified** | `P006` (`Serum Ferritin: 25 ng/mL`) | Returns `cannot_classify` citing `1_lab_safety_rules.md:6`. Never hallucinates a range. |
| **4. Protect patient privacy** | `1_lab_safety_rules.md:3` | Context-locks `/api/chat` to the active report; mentioning any other patient name, ID (`P001`–`P014`), or relative/friend triggers an immediate refusal citing Rule 1. |
| **5. Urgent warnings & doctor questions** | `P004` (`Hb=6.5 < 7.0`), `P013` (`FBS=350 > 300`) | Flags status `urgent`, renders a pulsing red alert (`"see a doctor today"`), and prioritizes critical questions for the physician. |

---

## 4. Bonus Features Implemented

1. **Multilingual Toggle (`English` | `اردو Urdu Script` | `Roman Urdu`)**:
   - Full localization across both LLM prompts and deterministic fallback templates, including right-to-left (`RTL`) typography for Urdu script so patients across Pakistan can read their reports in their preferred language.
2. **Interactive "What-If" Value Simulator (`POST /api/simulate`)**:
   - Every numeric test card includes a simulator drawer where patients or clinicians can test hypothetical follow-up values (e.g., *"What if my Fasting Blood Sugar drops from 6.0 to 5.0 mmol/L?"*) and immediately see the converted value and updated status.
3. **Printable Doctor Visit Checklist & Markdown Exporter (`POST /api/export`)**:
   - Generates a clean, one-page summary table with flagged values, conversions, citations, and numbered doctor questions ready to copy as Markdown or print to PDF (`window.print()`).
4. **Web Speech API Read-Aloud (`🔊 Read Aloud`)**:
   - Reads the urgent alert, summary, test explanations, and disclaimer aloud for visually impaired or low-literacy patients.
5. **Live 14-Patient & 5-Checkpoint Self-Audit Modal (`GET /api/audit`)**:
   - One click in the top bar runs all 14 corpus reports and all 5 hackathon checkpoints live in `<15 ms` and displays a 100% verification scorecard.

---

## 5. Known Failure Cases & Limitations (Rubric Criterion: Problem Understanding)

In real clinical settings, even a hybrid deterministic + LLM system has failure boundaries that must be documented transparently:

1. **Pediatric, Neonatal, and Pregnancy Reference Intervals (`Age < 18` or Pregnancy)**:
   - *Cause*: CityLab's reference sheets (`4_ranges_hematology.md`, `5_ranges_biochemistry.md`, `6_ranges_thyroid_urine.md`) only define reference intervals for ages `18–100 yrs` and do not include trimester-specific pregnancy ranges (where hemoglobin and TSH norms shift significantly).
   - *Behavior*: For patients under 18 or over 100, our classifier safely returns `cannot_classify` (`"No range in the files covers a patient aged X"`) rather than applying adult ranges to a child. It cannot automatically detect pregnancy unless pregnancy ranges are added to the reference corpus.
2. **Analyte-Specific Molar Mass Required for `mmol/L ↔ mg/dL` Conversions**:
   - *Cause*: Converting `mmol/L` to `mg/dL` depends on the molecular weight of the specific molecule (e.g., Glucose `× 18.0`, Cholesterol `× 38.67`). The provided corpus files do not include a molecular-weight table.
   - *Behavior*: We support standard clinical conversion factors for the analytes in the corpus (`Fasting Blood Sugar`, `Cholesterol`, `Hemoglobin g/L -> g/dL`, `10^3/mcL -> cells/mcL`) and display the formula transparently. If a report presents an unmapped analyte in molar units (e.g., `Creatinine` in `µmol/L` or `Bilirubin` in `mmol/L`), the classifier refuses to guess and marks it `cannot_classify`.
3. **Qualitative Grading Variations (`Trace`, `1+`, `2+` vs `Negative`)**:
   - *Cause*: Urinalysis reports from different analyzers may report `Urine Protein` as `"Nil"`, `"Absent"`, `"Trace"`, `"+1"`, or `"30 mg/dL"`, whereas `6_ranges_thyroid_urine.md` specifies only `Negative`.
   - *Behavior*: Our parser normalizes `"Negative"`, `"Nil"`, and `"Absent"` as normal and flags `"Positive"`, `"Trace"`, or `"1+"..` as abnormal (`high`), but quantitative urine protein (`mg/dL`) is marked `cannot_classify` because no numeric threshold exists in the corpus.
4. **OCR / Handwritten or Multi-Column PDF Table Corruption**:
   - *Cause*: If a user pastes raw text copied from a multi-column PDF where test names are separated from their numbers by dozens of lines, regex line-window parsing may miss the pairing.
   - *Behavior*: Step 1b falls back to LLM JSON extraction with verbatim substring verification, which recovers most scrambled layouts, but if OCR corrupts a digit itself (e.g., `6.5` read as `16.5`), no downstream software can detect the scanner error without the original image.
5. **Same-First-Name Privacy Collision in Chat**:
   - *Cause*: Our deterministic privacy filter blocks questions mentioning any other corpus patient's ID (`P001`–`P014`), full name, or distinct token (`>2` chars not shared with the current patient).
   - *Behavior*: If a user asks a general medical question containing a word that happens to match a patient's name (e.g., `"grace"` or `"hunt"`), the strict rule-1 filter errs on the side of caution and refuses the query.

---

## 6. API Overview

Full request/response schemas are documented in [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md).

- `GET  /api/health` — Liveness, configured LLM provider chain, token usage, and cache hit stats.
- `GET  /api/patients` — List all 14 seeded corpus patients (`P001`–`P014`).
- `POST /api/analyze` — Analyze by `patient_id` or `report_text`, with optional `age`/`sex` overrides and `lang` (`"en" | "ur" | "ro-ur"`).
- `POST /api/chat` — Context-locked follow-up Q&A with deterministic cross-patient privacy refusal.
- `POST /api/simulate` — Interactive What-If value & unit simulator.
- `POST /api/export` — Generate printable Markdown Doctor Visit Sheet.
- `GET  /api/audit` — Execute live 14-patient & 5-checkpoint self-audit.
