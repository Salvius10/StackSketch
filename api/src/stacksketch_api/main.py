"""StackSketch API: graph service, reviewer and explainer.

Stateless: every request carries the graph it is about. The sync server and
the browser read the shared Yjs document and call this API; results are
written back into that document so every user sees the same thing.
"""

from __future__ import annotations

import logging
import os
import time

from dotenv import dotenv_values, find_dotenv
from fastapi import FastAPI, HTTPException, Request

from . import compose, explainer, rules
from .llm import LLM, LLMUnavailable
from .models import (
    ChatRequest,
    ChatResponse,
    ComposeRequest,
    EntriesRequest,
    EntriesResponse,
    ExplainRequest,
    ExplainResponse,
    GenerateRequest,
    GraphResponse,
    RefineRequest,
    RefineResponse,
    ReviewRequest,
    ReviewResponse,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("stacksketch.api")


def create_app(llm: LLM | None = None) -> FastAPI:
    app = FastAPI(title="StackSketch API", version="0.1.0")
    app.state.llm = llm or LLM()

    def get_llm(request: Request) -> LLM:
        return request.app.state.llm

    @app.get("/health")
    async def health(request: Request) -> dict:
        llm = get_llm(request)
        return {
            "ok": True,
            "llm": llm.enabled,
            "provider": llm.provider if llm.enabled else None,
            "model": llm.model if llm.enabled else None,
            "rules": list(rules.RULES),
        }

    @app.post("/review", response_model=ReviewResponse, response_model_by_alias=True)
    async def review(body: ReviewRequest) -> ReviewResponse:
        started = time.perf_counter()
        findings, questions = rules.run_rules(
            body.graph,
            dismissed=set(body.dismissed_questions),
            depth_limit=body.sync_depth_limit,
            max_questions=body.max_questions,
        )
        diff = rules.diff_graphs(body.previous, body.graph)
        log.info("review: %d nodes, %d findings, %d questions in %.1f ms", len(body.graph.nodes), len(findings), len(questions), (time.perf_counter() - started) * 1000)
        return ReviewResponse(findings=findings, questions=questions, diff=diff, rules_run=list(rules.RULES))

    @app.post("/review/refine", response_model=RefineResponse)
    async def refine(body: RefineRequest, request: Request) -> RefineResponse:
        llm = get_llm(request)
        if not llm.enabled:
            return RefineResponse(findings=body.findings, llm=False)
        try:
            findings = await llm.refine(body.graph, body.diff, body.findings, body.not_useful)
        except LLMUnavailable as e:
            raise HTTPException(503, str(e)) from e
        return RefineResponse(findings=findings, llm=True, model=llm.model)

    @app.post("/explain/entries", response_model=EntriesResponse)
    async def entries(body: EntriesRequest) -> EntriesResponse:
        try:
            return EntriesResponse(entries=explainer.entry_points(body.graph, body.node_id))
        except KeyError as e:
            raise HTTPException(404, f"unknown node {e}") from e

    @app.post("/explain", response_model=ExplainResponse, response_model_by_alias=True)
    async def explain(body: ExplainRequest, request: Request) -> ExplainResponse:
        try:
            steps, summary = explainer.explain(body.graph, body.node_id, body.entry_edge_id)
        except KeyError as e:
            raise HTTPException(404, f"unknown edge {e}") from e
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        llm = get_llm(request)
        used_llm = False
        if body.narrate_with_llm and llm.enabled and steps:
            try:
                steps, summary = await llm.narrate(body.graph, steps, summary)
                used_llm = True
            except LLMUnavailable as e:
                log.warning("narration fell back to templates: %s", e)
        return ExplainResponse(steps=steps, summary=summary, llm=used_llm)

    @app.post("/generate", response_model=GraphResponse, response_model_by_alias=True)
    async def generate(body: GenerateRequest, request: Request) -> GraphResponse:
        llm = get_llm(request)
        try:
            graph, notes = await llm.generate(body.prompt)
        except LLMUnavailable as e:
            raise HTTPException(503, str(e)) from e
        return GraphResponse(graph=graph, notes=notes)

    @app.post("/ingest/compose", response_model=GraphResponse, response_model_by_alias=True)
    async def ingest_compose(body: ComposeRequest) -> GraphResponse:
        try:
            graph, notes = compose.graph_from_compose(body.text)
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        except Exception as e:  # malformed YAML
            raise HTTPException(422, f"Could not parse the compose file: {e}") from e
        return GraphResponse(graph=graph, notes=notes)

    @app.post("/chat", response_model=ChatResponse)
    async def chat(body: ChatRequest, request: Request) -> ChatResponse:
        llm = get_llm(request)
        try:
            reply = await llm.chat(body.graph, body.findings, body.messages)
        except LLMUnavailable as e:
            raise HTTPException(503, str(e)) from e
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        return ChatResponse(reply=reply, llm=True)

    return app


def load_settings() -> None:
    """Read settings such as OPENROUTER_API_KEY from the nearest .env file.

    The search starts in the working directory and walks up, so `npm run dev`
    (which starts the API in api/) finds the repo root's .env. Variables already
    set in the environment win, and empty placeholders are skipped.
    """
    path = find_dotenv(usecwd=True)
    if not path:
        return
    for key, value in dotenv_values(path).items():
        if value and key not in os.environ:
            os.environ[key] = value
    log.info("settings: read %s", path)


def serve() -> FastAPI:
    """App factory for uvicorn (`stacksketch_api.main:serve --factory`)."""
    load_settings()
    app = create_app()
    llm = app.state.llm
    log.info("AI layer: %s", f"{llm.provider} / {llm.model}" if llm.enabled else "off (rules only)")
    return app
