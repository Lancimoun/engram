from __future__ import annotations

from pathlib import Path
from typing import Any

from .store import decay_beliefs, get_state, ingest_statement, query_memory, reset_db

DEMO_STATEMENTS = [
    ("The API rate limit is 100 req/min.", "demo:api-v1"),
    ("Deployment uses Docker Compose.", "demo:ops-note"),
    ("The primary model is Compact model.", "demo:model-note"),
    ("The monthly budget is 2000 PHP.", "demo:finance-q1"),
    ("The vector database is Qdrant.", "demo:infra-note"),
    ("The auth method is API keys.", "demo:security-v1"),
    ("The region is us-east.", "demo:infra-region"),
    # --- new evidence arrives; beliefs revise, reinforce, and contradict ---
    ("The API rate limit is 60 req/min per the new config.", "demo:config-note"),
    ("The primary model is Frontier model.", "demo:model-change"),
    ("The monthly budget is 1500 PHP.", "demo:finance-q2"),
    ("The auth method is OAuth tokens.", "demo:security-v2"),
    ("The vector database is Qdrant.", "demo:infra-recheck"),
]


def reset_demo(db_path: str | Path) -> dict[str, Any]:
    reset_db(db_path)
    return get_state(db_path)


def run_demo(db_path: str | Path) -> dict[str, Any]:
    reset_db(db_path)
    events: list[dict[str, Any]] = []

    for index, (statement, source) in enumerate(DEMO_STATEMENTS, start=1):
        result = ingest_statement(
            db_path,
            statement,
            source,
            timestamp=f"2026-07-05T00:00:{index:02d}Z",
        )
        events.extend(result.get("events", []))

    decay_result = decay_beliefs(db_path, days=40, timestamp="2026-08-14T00:00:00Z")
    events.extend(decay_result.get("events", []))

    rate_result = query_memory(db_path, "what is the rate limit?", timestamp="2026-08-14T00:00:10Z")
    deploy_result = query_memory(db_path, "how is it deployed?", timestamp="2026-08-14T00:00:20Z")
    changed_result = query_memory(db_path, "what changed your mind?", timestamp="2026-08-14T00:00:30Z")

    return {
        "events": events,
        "queries": {
            "rate_limit": rate_result,
            "deployment": deploy_result,
            "changed_mind": changed_result,
        },
        "state": get_state(db_path),
    }
