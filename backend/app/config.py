"""Application settings loaded from environment variables (.env supported)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

try:  # python-dotenv is optional at import time so pure-logic tests run anywhere
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover
    pass

REPO_ROOT = Path(__file__).resolve().parents[2]


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    corpus_dir: Path = Path(os.getenv("CORPUS_DIR", REPO_ROOT / "lab_reports"))
    frontend_dist: Path = Path(os.getenv("FRONTEND_DIST", REPO_ROOT / "frontend" / "dist"))

    # LLM providers (tried in this order; providers without a key are skipped)
    provider_order: tuple[str, ...] = tuple(
        p.strip() for p in os.getenv("LLM_PROVIDER_ORDER", "gemini,groq,openrouter").split(",") if p.strip()
    )
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.5-pro")
    gemini_fallback_model: str = os.getenv("GEMINI_FALLBACK_MODEL", "gemini-2.5-flash")
    groq_api_key: str = os.getenv("GROQ_API_KEY", "")
    groq_model: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
    openrouter_api_key: str = os.getenv("OPENROUTER_API_KEY", "")
    openrouter_model: str = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free")

    llm_timeout_s: float = _float("LLM_TIMEOUT_S", 25.0)
    llm_max_retries: int = _int("LLM_MAX_RETRIES", 3)
    llm_backoff_base_s: float = _float("LLM_BACKOFF_BASE_S", 1.0)
    llm_max_concurrency: int = _int("LLM_MAX_CONCURRENCY", 4)
    llm_min_interval_s: float = _float("LLM_MIN_INTERVAL_S", 0.25)  # simple per-process throttle

    cache_ttl_s: int = _int("CACHE_TTL_S", 3600)
    cache_max_items: int = _int("CACHE_MAX_ITEMS", 512)

    max_report_chars: int = _int("MAX_REPORT_CHARS", 200_000)
    max_question_chars: int = _int("MAX_QUESTION_CHARS", 1_000)
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip())
    )


settings = Settings()
