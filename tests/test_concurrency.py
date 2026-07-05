"""Reliability guarantee: ENGRAM must not drop its own writes under load.

The server is threaded (one thread per request), so several belief writes can
land at the same instant. A memory-accountability tool that silently loses a
write is self-defeating — so we prove, with real threads against a real SQLite
ledger, that concurrent ingests all survive and none corrupts the audit trail.
"""

from __future__ import annotations

import sys
import tempfile
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from engram.store import get_state, ingest_statement, reset_db


class ConcurrencyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "engram.sqlite3"
        reset_db(self.db_path)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_concurrent_distinct_ingests_never_drop_a_belief(self) -> None:
        writers = 24
        errors: list[Exception] = []
        barrier = threading.Barrier(writers)

        def worker(i: int) -> None:
            try:
                barrier.wait()  # release all threads at once to maximize contention
                ingest_statement(
                    self.db_path,
                    f"metric_{i:02d} is value_{i:02d}",
                    source_ref=f"src-{i:02d}",
                    timestamp=f"2026-07-05T00:00:{i:02d}Z",
                )
            except Exception as exc:  # noqa: BLE001 - collected and asserted below
                errors.append(exc)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(writers)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual([], errors, f"writes raised under load: {errors}")
        state = get_state(self.db_path)
        self.assertEqual(writers, state["metrics"]["beliefs"])
        subjects = {belief["subject"] for belief in state["beliefs"]}
        self.assertEqual(writers, len(subjects), "a concurrent write was lost or merged")

    def test_concurrent_revisions_to_one_belief_keep_a_consistent_ledger(self) -> None:
        # Seed one belief, then race many contradicting updates at it. Whatever
        # value wins, the ledger must stay internally consistent: every revision
        # references the same belief and the final value matches a real revision.
        ingest_statement(self.db_path, "primary model is model_v0", "seed", "2026-07-05T00:00:00Z")
        writers = 16
        errors: list[Exception] = []
        barrier = threading.Barrier(writers)

        def worker(i: int) -> None:
            try:
                barrier.wait()
                ingest_statement(
                    self.db_path,
                    f"primary model is model_v{i + 1}",
                    source_ref=f"rev-{i:02d}",
                    timestamp=f"2026-07-05T00:01:{i:02d}Z",
                )
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(writers)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual([], errors, f"revisions raised under load: {errors}")
        state = get_state(self.db_path)
        self.assertEqual(1, state["metrics"]["beliefs"], "revisions must not fork the belief")

        belief = state["beliefs"][0]
        revisions = [r for r in state["revisions"] if r["belief_id"] == belief["id"]]
        self.assertTrue(revisions, "a contradicted belief must record revisions")
        # Final stored value must be one that was actually written through a revision.
        recorded_targets = {r["to_value"] for r in revisions}
        self.assertIn(belief["value"], recorded_targets)


if __name__ == "__main__":
    unittest.main()
