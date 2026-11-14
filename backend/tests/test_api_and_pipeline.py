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

    asyncio.run(_run())
