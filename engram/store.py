from __future__ import annotations

import json
import re
import sqlite3
import threading
import uuid
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DORMANT_THRESHOLD = 0.25
SCHEMA_PATH = Path(__file__).resolve().parents[1] / "beliefstore" / "schema.sql"

# Schema is idempotent (CREATE TABLE IF NOT EXISTS), but re-reading and
# re-executing it on every request wastes a file read per call. Initialize each
# database path exactly once, guarded so concurrent first-requests can't race.
_INIT_LOCK = threading.Lock()
_INITIALIZED: set[str] = set()


@dataclass(frozen=True)
class BeliefCandidate:
    subject: str
    label: str
    value: str


def connect(db_path: str | Path) -> sqlite3.Connection:
    # ENGRAM is a memory-reliability tool, so its own ledger must never drop a
    # write under concurrent load (the server is threaded — one thread per
    # request). WAL lets readers and a writer proceed together, and busy_timeout
    # makes a second writer wait for the lock instead of raising
    # "database is locked". Together they turn concurrent writes into a queue,
    # not a data-loss event.
    conn = sqlite3.connect(str(db_path), timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def init_db(db_path: str | Path, *, force: bool = False) -> None:
    key = str(Path(db_path).resolve())
    if not force and key in _INITIALIZED:
        return
    with _INIT_LOCK:
        if not force and key in _INITIALIZED:
            return
        path = Path(db_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(connect(path)) as conn:
            conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
            conn.commit()
        _INITIALIZED.add(key)


def reset_db(db_path: str | Path) -> None:
    path = Path(db_path)
    init_db(path, force=True)
    with closing(connect(path)) as conn:
        conn.execute("DELETE FROM events")
        conn.execute("DELETE FROM revisions")
        conn.execute("DELETE FROM beliefs")
        conn.commit()


def now_iso(value: str | datetime | None = None) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def parse_statement(text: str) -> BeliefCandidate:
    clean = " ".join(text.strip().strip(".").split())
    lower = clean.lower()

    if "rate limit" in lower:
        match = re.search(r"(\d+\s*(?:req/min|requests/minute|requests/min|rpm))", clean, re.I)
        value = match.group(1).replace("requests/minute", "req/min").replace("requests/min", "req/min") if match else _value_after_link(clean)
        return BeliefCandidate("rate_limit", "API rate limit", value)

    if "deploy" in lower or "deployment" in lower:
        value = _value_after_link(clean)
        return BeliefCandidate("deployment_method", "Deployment method", value)

    if "primary model" in lower or "model" in lower:
        value = _value_after_link(clean)
        return BeliefCandidate("primary_model", "Primary model", value)

    if "budget" in lower:
        value = _value_after_link(clean)
        return BeliefCandidate("budget", "Budget", value)

    subject, value = _generic_subject_value(clean)
    return BeliefCandidate(subject, subject.replace("_", " ").title(), value)


def _value_after_link(text: str) -> str:
    match = re.search(r"\b(?:is|are|uses|use|equals|=)\b\s+(.+)$", text, re.I)
    if match:
        return match.group(1).strip()
    return text


def _generic_subject_value(text: str) -> tuple[str, str]:
    match = re.search(r"^(.+?)\s+\b(?:is|are|uses|use|equals|=)\b\s+(.+)$", text, re.I)
    if match:
        label = match.group(1).strip()
        value = match.group(2).strip()
    else:
        words = text.split()
        label = " ".join(words[:3]) if words else "belief"
        value = " ".join(words[3:]) if len(words) > 3 else text
    subject = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_") or "belief"
    return subject, value


def _same_value(left: str, right: str) -> bool:
    return re.sub(r"\s+", " ", left.strip().lower()) == re.sub(r"\s+", " ", right.strip().lower())


def ingest_statement(
    db_path: str | Path,
    text: str,
    source_ref: str = "manual",
    timestamp: str | datetime | None = None,
) -> dict[str, Any]:
    init_db(db_path)
    candidate = parse_statement(text)
    ts = now_iso(timestamp)

    with closing(connect(db_path)) as conn:
        existing = conn.execute(
            "SELECT * FROM beliefs WHERE subject = ?",
            (candidate.subject,),
        ).fetchone()

        if existing is None:
            belief_id = _id("belief")
            conn.execute(
                """
                INSERT INTO beliefs (
                  id, subject, label, value, status, score, reinforcement_count,
                  contested, created_at, last_seen_at, source_ref
                ) VALUES (?, ?, ?, ?, 'active', 1.0, 1, 0, ?, ?, ?)
                """,
                (belief_id, candidate.subject, candidate.label, candidate.value, ts, ts, source_ref),
            )
            event = _event(conn, "INGEST", belief_id, candidate.subject, f"{candidate.label}: {candidate.value}", ts)
            conn.commit()
            return {"action": "ingest", "belief": _belief(conn, belief_id), "events": [event]}

        belief_id = existing["id"]
        if _same_value(existing["value"], candidate.value):
            score = min(1.0, float(existing["score"]) + 0.1)
            count = int(existing["reinforcement_count"]) + 1
            conn.execute(
                """
                UPDATE beliefs
                SET score = ?, reinforcement_count = ?, status = 'active',
                    last_seen_at = ?, source_ref = ?
                WHERE id = ?
                """,
                (score, count, ts, source_ref, belief_id),
            )
            event = _event(conn, "REINFORCE", belief_id, candidate.subject, f"{candidate.label}: {candidate.value}", ts)
            conn.commit()
            return {"action": "reinforce", "belief": _belief(conn, belief_id), "events": [event]}

        conn.execute(
            """
            UPDATE beliefs
            SET value = ?, status = 'active', score = 1.0, contested = 1,
                last_seen_at = ?, source_ref = ?
            WHERE id = ?
            """,
            (candidate.value, ts, source_ref, belief_id),
        )
        revision = _revision(
            conn,
            belief_id=belief_id,
            event_type="REVISE",
            from_value=existing["value"],
            to_value=candidate.value,
            trigger="contradiction",
            evidence_ref=source_ref,
            reason=f"New evidence changed {candidate.label} from {existing['value']} to {candidate.value}.",
            timestamp=ts,
        )
        contradict = _event(
            conn,
            "CONTRADICT",
            belief_id,
            candidate.subject,
            f"{existing['value']} -> {candidate.value}",
            ts,
        )
        revised = _event(conn, "REVISE", belief_id, candidate.subject, revision["reason"], ts)
        conn.commit()
        return {"action": "revise", "belief": _belief(conn, belief_id), "revision": revision, "events": [contradict, revised]}


def decay_beliefs(
    db_path: str | Path,
    days: int = 30,
    timestamp: str | datetime | None = None,
) -> dict[str, Any]:
    init_db(db_path)
    ts = now_iso(timestamp)
    events: list[dict[str, Any]] = []
    revisions: list[dict[str, Any]] = []

    with closing(connect(db_path)) as conn:
        beliefs = conn.execute("SELECT * FROM beliefs WHERE status = 'active'").fetchall()
        for belief in beliefs:
            # Revised beliefs carry audit value; keep them active longer than quiet facts.
            contested_bonus = 0.35 if belief["contested"] else 0.0
            decay_amount = min(0.95, max(0.0, days / 35.0))
            new_score = max(0.05, round(float(belief["score"]) - decay_amount + contested_bonus, 3))
            if new_score < DORMANT_THRESHOLD:
                conn.execute(
                    "UPDATE beliefs SET score = ?, status = 'dormant', last_seen_at = ? WHERE id = ?",
                    (new_score, ts, belief["id"]),
                )
                revision = _revision(
                    conn,
                    belief_id=belief["id"],
                    event_type="DECAY_DORMANT",
                    from_value=belief["value"],
                    to_value=belief["value"],
                    trigger="decay",
                    evidence_ref=None,
                    reason=f"{belief['label']} fell below retrieval threshold at score {new_score:.2f}.",
                    timestamp=ts,
                )
                event = _event(conn, "DECAY_DORMANT", belief["id"], belief["subject"], revision["reason"], ts)
                revisions.append(revision)
                events.append(event)
            else:
                conn.execute(
                    "UPDATE beliefs SET score = ?, last_seen_at = ? WHERE id = ?",
                    (new_score, ts, belief["id"]),
                )
        conn.commit()
        return {"action": "decay", "days": days, "revisions": revisions, "events": events, "state": get_state(db_path)}


def query_memory(
    db_path: str | Path,
    text: str,
    timestamp: str | datetime | None = None,
) -> dict[str, Any]:
    init_db(db_path)
    ts = now_iso(timestamp)
    lower = text.lower()

    with closing(connect(db_path)) as conn:
        if "changed" in lower or "mind" in lower or "contradict" in lower:
            revisions = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT r.*, b.subject, b.label
                    FROM revisions r
                    JOIN beliefs b ON b.id = r.belief_id
                    WHERE r.trigger = 'contradiction'
                    ORDER BY r.timestamp ASC
                    """
                ).fetchall()
            ]
            if revisions:
                answer = "; ".join(
                    f"{row['label']}: {row['from_value']} -> {row['to_value']} ({row['evidence_ref']})"
                    for row in revisions
                )
            else:
                answer = "No belief revisions recorded yet."
            return {"answer": answer, "revisions": revisions, "events": []}

        candidate = parse_statement(text)
        belief = conn.execute("SELECT * FROM beliefs WHERE subject = ?", (candidate.subject,)).fetchone()
        if belief is None:
            return {"answer": "No belief recorded for that subject.", "events": []}

        if belief["status"] == "dormant":
            conn.execute(
                "UPDATE beliefs SET status = 'active', score = ?, last_seen_at = ? WHERE id = ?",
                (0.55, ts, belief["id"]),
            )
            revision = _revision(
                conn,
                belief_id=belief["id"],
                event_type="RESTORE",
                from_value=belief["value"],
                to_value=belief["value"],
                trigger="restore",
                evidence_ref="query",
                reason=f"{belief['label']} was restored by query.",
                timestamp=ts,
            )
            event = _event(conn, "RESTORE", belief["id"], belief["subject"], revision["reason"], ts)
            conn.commit()
            return {
                "answer": f"RESTORED: {belief['value']} (was dormant).",
                "belief": _belief(conn, belief["id"]),
                "revision": revision,
                "events": [event],
            }

        latest_revision = conn.execute(
            """
            SELECT * FROM revisions
            WHERE belief_id = ? AND trigger = 'contradiction'
            ORDER BY timestamp DESC
            LIMIT 1
            """,
            (belief["id"],),
        ).fetchone()
        if latest_revision:
            answer = (
                f"{belief['value']} (revised from {latest_revision['from_value']} "
                f"on {latest_revision['timestamp']}; source: {belief['source_ref']})."
            )
        else:
            answer = f"{belief['value']} (source: {belief['source_ref']})."
        return {"answer": answer, "belief": dict(belief), "events": []}


def belief_at(db_path: str | Path, subject: str, timestamp: str | datetime) -> str | None:
    init_db(db_path)
    ts = now_iso(timestamp)
    with closing(connect(db_path)) as conn:
        belief = conn.execute("SELECT * FROM beliefs WHERE subject = ?", (subject,)).fetchone()
        if belief is None or ts < belief["created_at"]:
            return None
        revisions = conn.execute(
            "SELECT * FROM revisions WHERE belief_id = ? ORDER BY timestamp ASC",
            (belief["id"],),
        ).fetchall()
        value = revisions[0]["from_value"] if revisions and revisions[0]["from_value"] is not None else belief["value"]
        for revision in revisions:
            if ts < revision["timestamp"]:
                return value
            if revision["to_value"] is not None:
                value = revision["to_value"]
        return value


def get_state(db_path: str | Path) -> dict[str, Any]:
    init_db(db_path)
    with closing(connect(db_path)) as conn:
        beliefs = [dict(row) for row in conn.execute("SELECT * FROM beliefs ORDER BY created_at ASC").fetchall()]
        revisions = [dict(row) for row in conn.execute("SELECT * FROM revisions ORDER BY timestamp ASC").fetchall()]
        events = [dict(row) for row in conn.execute("SELECT * FROM events ORDER BY timestamp ASC").fetchall()]
        active_count = sum(1 for belief in beliefs if belief["status"] == "active")
        dormant_count = sum(1 for belief in beliefs if belief["status"] == "dormant")
        provenance = [belief for belief in beliefs if belief["source_ref"]]
        metrics = {
            "beliefs": len(beliefs),
            "active": active_count,
            "dormant": dormant_count,
            "revisions": len(revisions),
            "contradictions": sum(1 for revision in revisions if revision["trigger"] == "contradiction"),
            "provenance_completeness": 1.0 if not beliefs else round(len(provenance) / len(beliefs), 3),
        }
        return {"beliefs": beliefs, "revisions": revisions, "events": events, "metrics": metrics}


def _belief(conn: sqlite3.Connection, belief_id: str) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM beliefs WHERE id = ?", (belief_id,)).fetchone()
    return dict(row)


def _revision(
    conn: sqlite3.Connection,
    *,
    belief_id: str,
    event_type: str,
    from_value: str | None,
    to_value: str | None,
    trigger: str,
    evidence_ref: str | None,
    reason: str,
    timestamp: str,
) -> dict[str, Any]:
    revision_id = _id("rev")
    conn.execute(
        """
        INSERT INTO revisions (
          id, belief_id, event_type, from_value, to_value, trigger,
          evidence_ref, reason, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (revision_id, belief_id, event_type, from_value, to_value, trigger, evidence_ref, reason, timestamp),
    )
    return dict(
        conn.execute("SELECT * FROM revisions WHERE id = ?", (revision_id,)).fetchone()
    )


def _event(
    conn: sqlite3.Connection,
    event_type: str,
    belief_id: str | None,
    subject: str | None,
    detail: str,
    timestamp: str,
) -> dict[str, Any]:
    event_id = _id("evt")
    conn.execute(
        "INSERT INTO events (id, event_type, belief_id, subject, detail, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        (event_id, event_type, belief_id, subject, detail, timestamp),
    )
    return dict(conn.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone())


def state_json(db_path: str | Path) -> str:
    return json.dumps(get_state(db_path), indent=2)
