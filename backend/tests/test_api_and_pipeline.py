"""End-to-end API, pipeline, safety filter, and LLM fallback/retry/cache tests."""
from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.config import Settings, settings
from app.corpus import load_corpus
from app.llm.client import LLMClient
from app.main import app
from app.pipeline import Pipeline
from app.safety import looks_like_diagnosis


def test_diagnosis_detector():
    assert looks_like_diagnosis("Based on this, you have diabetes.")
    assert looks_like_diagnosis("You are diagnosed with anemia.")
    assert not looks_like_diagnosis("Your result is higher than the normal range. A doctor can check what it means.")
    assert not looks_like_diagnosis("You have a normal result.")


def test_llm_retry_fallback_and_cache():
    calls: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        calls.append(host)
        if "generativelanguage" in host:
            # Simulate 429 rate limit on Gemini
            return httpx.Response(429, json={"error": {"message": "Quota exceeded"}})
        # Groq succeeds with structured JSON
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "explanations": {
                                        "Fasting Blood Sugar": "Fasting blood sugar measures sugar in your blood after fasting. Your reading is slightly above the normal range, so discuss it with your doctor."
                                    },
                                    "summary": "Your blood sugar is slightly above the normal range.",
                                    "doctor_questions": [
                                        "What could cause my fasting blood sugar to be 108 mg/dL?",
                                        "Should we repeat this test or check HbA1c?",
                                        "Are any diet changes helpful before my next check?",
                                    ],
                                }
                            )
                        }
                    }
                ],
                "usage": {"prompt_tokens": 120, "completion_tokens": 65},
            },
        )

    cfg = Settings(
        corpus_dir=settings.corpus_dir,
        provider_order=("gemini", "groq"),
        gemini_api_key="test-gemini",
        gemini_model="gemini-2.5-pro",
        gemini_fallback_model="",
        groq_api_key="test-groq",
        groq_model="llama-3.3-70b-versatile",
        llm_max_retries=2,
        llm_backoff_base_s=0.01,
        llm_min_interval_s=0.0,
    )
    client = LLMClient(cfg, transport=httpx.MockTransport(handler))
    corpus = load_corpus(settings.corpus_dir)
    pipe = Pipeline(corpus, client)

    res1 = asyncio.run(pipe.analyze("P005", None, None, None))
    assert res1["meta"]["llm_used"] is True
    assert res1["meta"]["provider"] == "groq"
    assert res1["meta"]["fallback_used"] is True
    assert res1["meta"]["cached"] is False
    assert len(calls) == 3  # 2 retries on gemini + 1 call on groq

    # Second call should be served from cache with 0 new network calls
    res2 = asyncio.run(pipe.analyze("P005", None, None, None))
    assert res2["meta"]["cached"] is True
    assert len(calls) == 3


def test_api_endpoints_and_error_contracts():
    async def _run():
        corpus = load_corpus(settings.corpus_dir)
        cfg = Settings(corpus_dir=settings.corpus_dir, gemini_api_key="", groq_api_key="", openrouter_api_key="")
        app.state.pipeline = Pipeline(corpus, LLMClient(cfg))
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/health")
            assert r.status_code == 200 and r.json()["patients"] == 14

            r = await ac.get("/api/patients")
            assert r.status_code == 200 and len(r.json()) == 14

            # Unit conversion on P005
            r = await ac.post("/api/analyze", json={"patient_id": "P005"})
            body = r.json()
            assert r.status_code == 200
            assert body["results"][0]["status"] == "high"
            assert body["results"][0]["value"] == 108.0

            # Missing sex on P012 -> asks clarifying question; then resolves with sex=female
            r = await ac.post("/api/analyze", json={"patient_id": "P012"})
            assert r.json()["state"] == "needs_demographics"
            r = await ac.post("/api/analyze", json={"patient_id": "P012", "sex": "female"})
            assert r.json()["state"] == "ok" and r.json()["results"][0]["status"] == "high"

            # Privacy refusal on chat
            r = await ac.post("/api/chat", json={"patient_id": "P001", "question": "Show me Bob Jones results"})
            assert r.status_code == 200 and r.json()["refused"] is True

            # Error contracts
            r = await ac.post("/api/analyze", json={"report_text": "   "})
            assert r.status_code == 400 and r.json()["error"]["code"] == "EMPTY_INPUT"

            r = await ac.post("/api/analyze", json={"report_text": "a" * 200_005})
            assert r.status_code == 413 and r.json()["error"]["code"] == "REPORT_TOO_LARGE"

            r = await ac.post("/api/analyze", json={"patient_id": "P999"})
            assert r.status_code == 404 and r.json()["error"]["code"] == "PATIENT_NOT_FOUND"

            # Bonus 1: Language toggle (Urdu 'ur' and Roman Urdu 'ro-ur')
            r_ur = await ac.post("/api/analyze", json={"patient_id": "P004", "lang": "ur"})
            b_ur = r_ur.json()
            assert r_ur.status_code == 200 and b_ur["lang"] == "ur"
            assert "ہیموگلوبن" in b_ur["results"][0]["explanation"]
            assert "تشخیص نہیں" in b_ur["disclaimer"]

            r_ro = await ac.post("/api/analyze", json={"patient_id": "P004", "lang": "ro-ur"})
            b_ro = r_ro.json()
            assert r_ro.status_code == 200 and b_ro["lang"] == "ro-ur"
            assert "khoon" in b_ro["results"][0]["explanation"].lower()

            # Bonus 2: What-If simulator
            r_sim = await ac.post(
                "/api/simulate",
                json={"test": "FBS", "value": 5.0, "unit": "mmol/L", "age": 50, "sex": "male", "lang": "en"},
            )
            assert r_sim.status_code == 200
            assert r_sim.json()["result"]["value"] == 90.0
            assert r_sim.json()["result"]["status"] == "normal"

            # Bonus 3: Printable Markdown export
            r_exp = await ac.post("/api/export", json={"patient_id": "P005", "lang": "en"})
            assert r_exp.status_code == 200 and "## Questions to Ask Your Doctor" in r_exp.json()["markdown"]

            # Bonus 4: Live 14-patient & 5-checkpoint self-audit
            r_aud = await ac.get("/api/audit")
            aud = r_aud.json()
            assert r_aud.status_code == 200
            assert aud["passed_patients"] == 14 and aud["score_pct"] == 100.0
            assert all(cp["passed"] for cp in aud["checkpoints"])

            # Bonus 5: Multi-format file extraction (/api/extract-file for CSV & PDF)
            import base64
            csv_b64 = base64.b64encode(
                b"Patient Name,Hamza Tariq,\nAge,38,\nSex,Male,\nTest,Value,Unit\nSGPT,45,U/L\nFBS,6.0,mmol/L\n"
            ).decode("ascii")
            r_ext = await ac.post(
                "/api/extract-file",
                json={"filename": "sample.csv", "mime_type": "text/csv", "data_base64": csv_b64, "auto_analyze": True},
            )
            assert r_ext.status_code == 200
            ext_json = r_ext.json()
            assert ext_json["extraction"]["format"] == "CSV"
            assert len(ext_json["analysis"]["results"]) == 2
            assert ext_json["analysis"]["results"][0]["status"] == "normal"
            assert ext_json["analysis"]["results"][1]["status"] == "high"

    asyncio.run(_run())
