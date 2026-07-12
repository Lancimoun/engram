"""Offline-snapshot fallback: the baked state file must always be a faithful,
parseable stand-in for a live /api/state payload, because the observatory
renders it verbatim when the backend is unreachable.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import bake_snapshot
from engram.store import get_state, reset_db
from engram.demo import run_demo

COMMITTED_SNAPSHOT = ROOT / "static" / "state.snapshot.json"


class SnapshotBakeTests(unittest.TestCase):
    def test_bake_produces_valid_populated_snapshot(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            target = Path(tmp) / "state.snapshot.json"
            baked = bake_snapshot.bake(target)

            self.assertTrue(target.exists())
            on_disk = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(sorted(on_disk), sorted(baked))
            self.assertGreater(len(on_disk["beliefs"]), 0)

    def test_committed_snapshot_matches_live_state_shape(self) -> None:
        committed = json.loads(COMMITTED_SNAPSHOT.read_text(encoding="utf-8"))

        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            db_path = Path(tmp) / "live.sqlite3"
            reset_db(db_path)
            run_demo(db_path)
            live = get_state(db_path)

        self.assertEqual(sorted(committed.keys()), sorted(live.keys()))
        self.assertGreater(len(committed["beliefs"]), 0)


if __name__ == "__main__":
    unittest.main()
