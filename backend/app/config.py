"""Application settings loaded from environment variables (.env supported)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPO_ROOT / ".env"


def _sync_dotenv() -> None:
    """Load REPO_ROOT/.env with override=True so .env values take precedence over stale OS variables."""
    try:
        from dotenv import dotenv_values, load_dotenv

        if ENV_FILE.exists():
            load_dotenv(ENV_FILE, override=True)
            for k, v in dotenv_values(ENV_FILE).items():
                if v is not None:
                    os.environ[k] = v
    except ImportError:  # pragma: no cover
        pass


_sync_dotenv()


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


def load_fresh_settings() -> Settings:
    """Re-read .env and construct a fresh Settings instance."""
    _sync_dotenv()
    return Settings(
        corpus_dir=Path(os.getenv("CORPUS_DIR", REPO_ROOT / "lab_reports")),
        frontend_dist=Path(os.getenv("FRONTEND_DIST", REPO_ROOT / "frontend" / "dist")),
        provider_order=tuple(
            p.strip() for p in os.getenv("LLM_PROVIDER_ORDER", "gemini,groq,openrouter").split(",") if p.strip()
        ),
        gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip(),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.5-pro").strip(),
        gemini_fallback_model=os.getenv("GEMINI_FALLBACK_MODEL", "gemini-2.5-flash").strip(),
        groq_api_key=os.getenv("GROQ_API_KEY", "").strip(),
        groq_model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile").strip(),
        openrouter_api_key=os.getenv("OPENROUTER_API_KEY", "").strip(),
        openrouter_model=os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free").strip(),
        llm_timeout_s=_float("LLM_TIMEOUT_S", 25.0),
        llm_max_retries=_int("LLM_MAX_RETRIES", 3),
        llm_backoff_base_s=_float("LLM_BACKOFF_BASE_S", 1.0),
        llm_max_concurrency=_int("LLM_MAX_CONCURRENCY", 4),
        llm_min_interval_s=_float("LLM_MIN_INTERVAL_S", 0.25),
        cache_ttl_s=_int("CACHE_TTL_S", 3600),
        cache_max_items=_int("CACHE_MAX_ITEMS", 512),
        max_report_chars=_int("MAX_REPORT_CHARS", 200_000),
        max_question_chars=_int("MAX_QUESTION_CHARS", 1_000),
    )


settings = load_fresh_settings()
