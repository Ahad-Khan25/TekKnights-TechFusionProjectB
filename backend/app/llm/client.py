"""LLM client with provider fallback, retries + exponential backoff, throttling, caching and usage logging.

Providers are called over plain REST with httpx (no vendor SDKs):
  gemini      -> Google Generative Language API (generateContent, JSON mode)
  groq        -> OpenAI-compatible chat completions
  openrouter  -> OpenAI-compatible chat completions (free models)
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import time
from dataclasses import dataclass, field

import httpx

from ..config import Settings, settings
from .cache import TTLCache

log = logging.getLogger("llm")

RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}


class LLMError(Exception):
    def __init__(self, message: str, code: str = "LLM_UNAVAILABLE", retryable: bool = False, status: int | None = None):
        super().__init__(message)
        self.code, self.retryable, self.status = code, retryable, status


@dataclass
class LLMResult:
    data: dict
    provider: str
    model: str
    latency_ms: int
    tokens: dict = field(default_factory=lambda: {"prompt": 0, "completion": 0})
    cached: bool = False
    fallback_used: bool = False

    def meta(self) -> dict:
        return {
            "provider": self.provider,
            "model": self.model,
            "latency_ms": self.latency_ms,
            "tokens": self.tokens,
            "cached": self.cached,
            "fallback_used": self.fallback_used,
            "llm_used": True,
        }


def extract_json(text: str) -> dict:
    """Parse a JSON object from model output, tolerating code fences and leading/trailing prose."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I)
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            raise LLMError("Model did not return JSON", code="BAD_OUTPUT", retryable=True)
        try:
            obj = json.loads(m.group(0))
        except json.JSONDecodeError as e:
            raise LLMError(f"Malformed JSON from model: {e}", code="BAD_OUTPUT", retryable=True) from e
    if not isinstance(obj, dict):
        raise LLMError("Model JSON is not an object", code="BAD_OUTPUT", retryable=True)
    return obj


class LLMClient:
    def __init__(self, cfg: Settings = settings, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.cfg = cfg
        self.cache = TTLCache(cfg.cache_max_items, cfg.cache_ttl_s)
        self._sem = asyncio.Semaphore(cfg.llm_max_concurrency)  # request queue: at most N in flight
        self._throttle_lock = asyncio.Lock()
        self._last_call = 0.0
        self._cooldown: dict[str, float] = {}  # provider -> monotonic time until which it is skipped
        self._client = httpx.AsyncClient(timeout=cfg.llm_timeout_s, transport=transport)
        self.usage = {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "errors": 0, "fallbacks": 0}

    # ---- provider configuration -------------------------------------------------------------
    def providers(self) -> list[tuple[str, str]]:
        """Ordered (provider, model) chain, skipping providers without keys."""
        chain: list[tuple[str, str]] = []
        for p in self.cfg.provider_order:
            if p == "gemini" and self.cfg.gemini_api_key:
                chain.append(("gemini", self.cfg.gemini_model))
                if self.cfg.gemini_fallback_model and self.cfg.gemini_fallback_model != self.cfg.gemini_model:
                    chain.append(("gemini", self.cfg.gemini_fallback_model))
            elif p == "groq" and self.cfg.groq_api_key:
                chain.append(("groq", self.cfg.groq_model))
            elif p == "openrouter" and self.cfg.openrouter_api_key:
                chain.append(("openrouter", self.cfg.openrouter_model))
        return chain

    @property
    def enabled(self) -> bool:
        return bool(self.providers())

    # ---- public API ---------------------------------------------------------------------------
    async def complete_json(self, system: str, user: str, temperature: float = 0.2, max_tokens: int = 2048) -> LLMResult:
        key = TTLCache.make_key(system, user, temperature)
        hit = self.cache.get(key)
        if hit is not None:
            res = LLMResult(**{**hit, "cached": True, "latency_ms": 0})
            log.info("llm cache hit provider=%s model=%s", res.provider, res.model)
            return res

        chain = self.providers()
        if not chain:
            raise LLMError("No LLM provider configured (set GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY)")
        last_err: LLMError | None = None
        for idx, (provider, model) in enumerate(chain):
            if self._cooldown.get(f"{provider}:{model}", 0) > time.monotonic():
                continue
            try:
                res = await self._with_retries(provider, model, system, user, temperature, max_tokens)
                res.fallback_used = idx > 0
                if res.fallback_used:
                    self.usage["fallbacks"] += 1
                self.cache.set(key, {k: v for k, v in res.__dict__.items() if k != "cached"})
                return res
            except LLMError as e:
                last_err = e
                self.usage["errors"] += 1
                log.warning("llm provider failed provider=%s model=%s code=%s err=%s", provider, model, e.code, e)
                if e.status == 429:  # rate-limited even after retries: rest this provider for a while
                    self._cooldown[f"{provider}:{model}"] = time.monotonic() + 30
        raise last_err or LLMError("All LLM providers are cooling down after rate limits", code="RATE_LIMITED")

    async def aclose(self) -> None:
        await self._client.aclose()

    # ---- internals ------------------------------------------------------------------------------
    async def _with_retries(self, provider, model, system, user, temperature, max_tokens) -> LLMResult:
        attempts = max(1, self.cfg.llm_max_retries)
        for attempt in range(1, attempts + 1):
            try:
                async with self._sem:
                    await self._throttle()
                    return await self._call(provider, model, system, user, temperature, max_tokens)
            except LLMError as e:
                if not e.retryable or attempt == attempts:
                    raise
                delay = self.cfg.llm_backoff_base_s * (2 ** (attempt - 1)) + random.uniform(0, 0.5)
                log.info("llm retry provider=%s attempt=%d delay=%.2fs reason=%s", provider, attempt, delay, e.code)
                await asyncio.sleep(delay)
        raise LLMError("unreachable")

    async def _throttle(self) -> None:
        async with self._throttle_lock:
            wait = self.cfg.llm_min_interval_s - (time.monotonic() - self._last_call)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_call = time.monotonic()

    async def _call(self, provider, model, system, user, temperature, max_tokens) -> LLMResult:
        t0 = time.perf_counter()
        try:
            if provider == "gemini":
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
                body = {
                    "systemInstruction": {"parts": [{"text": system}]},
                    "contents": [{"role": "user", "parts": [{"text": user}]}],
                    "generationConfig": {
                        "temperature": temperature,
                        "maxOutputTokens": max_tokens,
                        "responseMimeType": "application/json",
                    },
                }
                r = await self._client.post(url, json=body, headers={"x-goog-api-key": self.cfg.gemini_api_key})
            else:
                url = (
                    "https://api.groq.com/openai/v1/chat/completions"
                    if provider == "groq"
                    else "https://openrouter.ai/api/v1/chat/completions"
                )
                key = self.cfg.groq_api_key if provider == "groq" else self.cfg.openrouter_api_key
                body = {
                    "model": model,
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "response_format": {"type": "json_object"},
                }
                headers = {"Authorization": f"Bearer {key}"}
                if provider == "openrouter":
                    headers["X-Title"] = "CityLab Report Explainer"
                r = await self._client.post(url, json=body, headers=headers)
        except httpx.TimeoutException as e:
            raise LLMError(f"{provider} timed out", code="TIMEOUT", retryable=True) from e
        except httpx.HTTPError as e:
            raise LLMError(f"{provider} network error: {e}", retryable=True) from e

        latency = int((time.perf_counter() - t0) * 1000)
        if r.status_code != 200:
            code = "RATE_LIMITED" if r.status_code == 429 else "LLM_UNAVAILABLE"
            raise LLMError(
                f"{provider} HTTP {r.status_code}: {r.text[:200]}",
                code=code,
                retryable=r.status_code in RETRYABLE_STATUS,
                status=r.status_code,
            )
        payload = r.json()
        if provider == "gemini":
            try:
                text = "".join(p.get("text", "") for p in payload["candidates"][0]["content"]["parts"])
            except (KeyError, IndexError) as e:
                raise LLMError(f"gemini returned no content: {str(payload)[:200]}", code="BAD_OUTPUT", retryable=True) from e
            um = payload.get("usageMetadata", {})
            tokens = {"prompt": um.get("promptTokenCount", 0), "completion": um.get("candidatesTokenCount", 0)}
        else:
            try:
                text = payload["choices"][0]["message"]["content"] or ""
            except (KeyError, IndexError) as e:
                raise LLMError(f"{provider} returned no content", code="BAD_OUTPUT", retryable=True) from e
            u = payload.get("usage", {}) or {}
            tokens = {"prompt": u.get("prompt_tokens", 0), "completion": u.get("completion_tokens", 0)}

        data = extract_json(text)
        self.usage["calls"] += 1
        self.usage["prompt_tokens"] += tokens["prompt"]
        self.usage["completion_tokens"] += tokens["completion"]
        log.info("llm ok provider=%s model=%s latency_ms=%d tokens=%s", provider, model, latency, tokens)
        return LLMResult(data=data, provider=provider, model=model, latency_ms=latency, tokens=tokens)
