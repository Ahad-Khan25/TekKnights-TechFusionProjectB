"""HTTP routes. Thin layer: validate input, call the pipeline, map errors to the contract shape."""
from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, field_validator, model_validator

from ..extractor import extract_report_from_file
from ..pipeline import AppError

router = APIRouter(prefix="/api")
REQUEST_TIMEOUT_S = 60
LangType = Literal["en", "ur", "ro-ur"]


class ExtractFileRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)
    mime_type: str | None = Field(default=None, max_length=120)
    data_base64: str = Field(..., min_length=1)
    client_extracted_text: str | None = None
    auto_analyze: bool = True
    age: float | None = Field(default=None, ge=0, le=130)
    sex: Literal["male", "female"] | None = None
    lang: LangType = "en"


class AnalyzeRequest(BaseModel):
    patient_id: str | None = Field(default=None, max_length=20)
    report_text: str | None = None  # size checked in pipeline to return REPORT_TOO_LARGE (413)
    age: float | None = Field(default=None, ge=0, le=130)
    sex: Literal["male", "female"] | None = None
    lang: LangType = "en"

    @field_validator("sex", mode="before")
    @classmethod
    def _norm_sex(cls, v):
        if isinstance(v, str):
            v = v.strip().lower()
            return {"m": "male", "f": "female", "": None}.get(v, v)
        return v

    @field_validator("lang", mode="before")
    @classmethod
    def _norm_lang(cls, v):
        if v is None or v == "":
            return "en"
        if isinstance(v, str):
            return v.strip().lower()
        return v

    @model_validator(mode="after")
    def _one_source(self):
        if not (self.patient_id and self.patient_id.strip()) and not (self.report_text and self.report_text.strip()):
            raise AppError("EMPTY_INPUT", "Please choose a patient or paste a lab report.", 400)
        return self


class ChatRequest(AnalyzeRequest):
    question: str = ""


class SimulateRequest(BaseModel):
    test: str = Field(..., min_length=1, max_length=80)
    value: str | float | int
    unit: str = Field(default="", max_length=30)
    age: float | None = Field(default=35, ge=0, le=130)
    sex: Literal["male", "female"] | None = "female"
    lang: LangType = "en"


async def _run(coro):
    try:
        return await asyncio.wait_for(coro, timeout=REQUEST_TIMEOUT_S)
    except asyncio.TimeoutError as e:
        raise AppError("TIMEOUT", "The request took too long. Please try again.", 504) from e


@router.get("/health")
async def health(request: Request):
    p = request.app.state.pipeline
    return {
        "status": "ok",
        "version": "1.2.0",
        "providers": [f"{prov}:{model}" for prov, model in p.llm.providers()],
        "llm_enabled": p.llm.enabled,
        "patients": len(p.patients),
        "supported_languages": ["en", "ur", "ro-ur"],
        "supported_formats": ["pdf", "png", "jpg", "jpeg", "webp", "bmp", "docx", "csv", "json", "md", "txt"],
        "usage": p.llm.usage,
        "cache": p.llm.cache.stats(),
    }


@router.post("/extract-file")
async def extract_file(body: ExtractFileRequest, request: Request):
    p = request.app.state.pipeline
    extraction = await _run(
        extract_report_from_file(
            body.filename,
            body.mime_type,
            body.data_base64,
            p.llm,
            body.client_extracted_text,
        )
    )
    analysis = None
    if body.auto_analyze and extraction.get("extracted_text"):
        analysis = await _run(
            p.analyze(None, extraction["extracted_text"], body.age, body.sex, body.lang)
        )
    return {"extraction": extraction, "analysis": analysis}


@router.get("/patients")
async def patients(request: Request):
    return request.app.state.pipeline.list_patients()


@router.post("/analyze")
async def analyze(body: AnalyzeRequest, request: Request):
    p = request.app.state.pipeline
    return await _run(p.analyze(body.patient_id, body.report_text, body.age, body.sex, body.lang))


@router.post("/chat")
async def chat(body: ChatRequest, request: Request):
    p = request.app.state.pipeline
    return await _run(p.chat(body.patient_id, body.report_text, body.question, body.age, body.sex, body.lang))


@router.post("/simulate")
async def simulate(body: SimulateRequest, request: Request):
    p = request.app.state.pipeline
    return p.simulate(body.test, str(body.value), body.unit, body.age, body.sex, body.lang)


@router.post("/export")
async def export_report(body: AnalyzeRequest, request: Request):
    p = request.app.state.pipeline
    return await _run(p.export_markdown(body.patient_id, body.report_text, body.age, body.sex, body.lang))


@router.get("/audit")
async def audit(request: Request):
    p = request.app.state.pipeline
    return p.run_audit()
