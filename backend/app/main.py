"""FastAPI application: wiring, error handlers, request logging, static frontend."""
from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api.routes import router
from .config import settings
from .corpus import load_corpus
from .llm.client import LLMClient
from .pipeline import AppError, Pipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    corpus = load_corpus(settings.corpus_dir)
    llm = LLMClient(settings)
    app.state.pipeline = Pipeline(corpus, llm)
    log.info("startup patients=%d ranges=%d aliases=%d providers=%s",
             len(corpus.reports), len(corpus.ranges), len(corpus.aliases), llm.providers())
    yield
    await llm.aclose()


app = FastAPI(title="CityLab Report Explainer", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["*"], allow_headers=["*"])


def _err(code: str, message: str, status: int, request: Request) -> JSONResponse:
    rid = getattr(request.state, "request_id", None)
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "request_id": rid}})


@app.middleware("http")
async def log_requests(request: Request, call_next):
    request.state.request_id = uuid.uuid4().hex[:12]
    t0 = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:  # last-resort guard: never leak a stack trace to the client
        log.exception("unhandled error path=%s", request.url.path)
        response = _err("INTERNAL", "Something went wrong on our side. Please try again.", 500, request)
    ms = int((time.perf_counter() - t0) * 1000)
    if request.url.path.startswith("/api"):
        log.info("http %s %s status=%d latency_ms=%d", request.method, request.url.path, response.status_code, ms)
    else:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["X-Request-ID"] = request.state.request_id
    return response


@app.exception_handler(AppError)
async def app_error(request: Request, exc: AppError):
    return _err(exc.code, exc.message, exc.status, request)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    for e in exc.errors():  # AppError raised inside a pydantic validator arrives wrapped
        ctx_err = (e.get("ctx") or {}).get("error")
        if isinstance(ctx_err, AppError):
            return _err(ctx_err.code, ctx_err.message, ctx_err.status, request)
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(x) for x in first.get("loc", []) if x != "body")
    msg = f"Invalid input{f' for {field}' if field else ''}: {first.get('msg', 'malformed request')}."
    return _err("INVALID_INPUT", msg, 422, request)


app.include_router(router)

# Serve the built frontend (same origin) when it exists, e.g. inside Docker.
if settings.frontend_dist.is_dir():
    app.mount("/assets", StaticFiles(directory=settings.frontend_dist / "assets", check_dir=False), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        root = settings.frontend_dist.resolve()
        f = (root / path).resolve()
        if path and f.is_file() and f.is_relative_to(root):  # block ../ traversal
            return FileResponse(f)
        return FileResponse(root / "index.html")
else:
    @app.get("/", include_in_schema=False)
    async def root():
        return {"service": "CityLab Report Explainer API", "docs": "/docs", "health": "/api/health"}
