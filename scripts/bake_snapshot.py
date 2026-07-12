"""Bake a static offline snapshot of the demo ledger state.

The observatory frontend polls /api/state; when the backend is unreachable it
falls back to /static/state.snapshot.json so visitors still see a populated,
read-only scene instead of an empty "offline" stage. This script produces that
file: it seeds the standard demo into a throwaway SQLite database, reads the
resulting state, and writes it pretty-printed to static/state.snapshot.json.

Stdlib only, run from anywhere:

    python scripts/bake_snapshot.py
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from engram.demo import run_demo
from engram.store import get_state

SNAPSHOT_PATH = ROOT / "static" / "state.snapshot.json"


def bake(snapshot_path: Path = SNAPSHOT_PATH) -> dict[str, Any]:
    """Seed the demo into a temp database and write its state as JSON."""
    # ignore_cleanup_errors: on Windows, SQLite WAL sidecar files can linger a
    # beat after close; a failed temp-dir sweep must not fail the bake.
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        db_path = Path(tmp) / "snapshot.sqlite3"
        run_demo(db_path)
        state = get_state(db_path)

    snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    snapshot_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    return state


if __name__ == "__main__":
    baked = bake()
    print(
        f"Baked snapshot: {len(baked['beliefs'])} beliefs, "
        f"{len(baked['revisions'])} revisions, {len(baked['events'])} events "
        f"-> {SNAPSHOT_PATH}"
    )
