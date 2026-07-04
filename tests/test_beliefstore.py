import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from engram.store import belief_at, decay_beliefs, get_state, ingest_statement, query_memory, reset_db


class BeliefStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "engram.sqlite3"
        reset_db(self.db_path)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_revision_integrity_for_known_contradictions(self) -> None:
        corpus = [
            ("The API rate limit is 100 req/min.", "s1"),
            ("The API rate limit is 60 req/min.", "s2"),
            ("Deployment uses Docker Compose.", "s3"),
            ("Deployment uses Kubernetes.", "s4"),
            ("The primary model is Compact model.", "s5"),
            ("The primary model is Frontier model.", "s6"),
            ("Budget is 2000 PHP monthly.", "s7"),
            ("Budget is 1500 PHP monthly.", "s8"),
        ]

        for index, (statement, source) in enumerate(corpus, start=1):
            ingest_statement(self.db_path, statement, source, f"2026-07-05T00:00:{index:02d}Z")

        state = get_state(self.db_path)
        contradictions = [row for row in state["revisions"] if row["trigger"] == "contradiction"]
        self.assertEqual(4, len(contradictions))
        self.assertEqual(1.0, state["metrics"]["provenance_completeness"])

    def test_decay_causes_dormant_then_restore(self) -> None:
        ingest_statement(self.db_path, "Deployment uses Docker Compose.", "ops", "2026-07-05T00:00:00Z")

        decay_beliefs(self.db_path, days=40, timestamp="2026-08-14T00:00:00Z")
        state = get_state(self.db_path)
        belief = state["beliefs"][0]
        self.assertEqual("dormant", belief["status"])

        result = query_memory(self.db_path, "how is it deployed?", "2026-08-14T00:01:00Z")
        self.assertIn("RESTORED", result["answer"])

        state = get_state(self.db_path)
        self.assertEqual("active", state["beliefs"][0]["status"])
        self.assertEqual(1, len([row for row in state["revisions"] if row["trigger"] == "restore"]))

    def test_belief_at_returns_historical_values(self) -> None:
        ingest_statement(self.db_path, "The API rate limit is 100 req/min.", "s1", "2026-07-05T00:00:01Z")
        ingest_statement(self.db_path, "The API rate limit is 60 req/min.", "s2", "2026-07-05T00:00:10Z")

        self.assertEqual("100 req/min", belief_at(self.db_path, "rate_limit", "2026-07-05T00:00:05Z"))
        self.assertEqual("60 req/min", belief_at(self.db_path, "rate_limit", "2026-07-05T00:00:11Z"))

    def test_changed_mind_query_reads_real_ledger(self) -> None:
        ingest_statement(self.db_path, "The API rate limit is 100 req/min.", "s1", "2026-07-05T00:00:01Z")
        ingest_statement(self.db_path, "The API rate limit is 60 req/min.", "s2", "2026-07-05T00:00:10Z")

        result = query_memory(self.db_path, "what changed your mind?", "2026-07-05T00:00:20Z")
        self.assertIn("API rate limit", result["answer"])
        self.assertIn("100 req/min -> 60 req/min", result["answer"])


if __name__ == "__main__":
    unittest.main()
