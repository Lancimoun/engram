"""Public-surface guards: per-IP rate limiting and the demo-reset gate.

ENGRAM's demo is meant to run on the open internet. Before it does, we prove
two things end-to-end: a client hammering the write endpoints gets 429 instead
of unbounded writes, and a deployment with ENGRAM_ALLOW_RESET=0 refuses to let
a visitor wipe the shared ledger.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import server
from engram.store import reset_db
from server import EngramHandler, RateLimiter


class RateLimiterTests(unittest.TestCase):
    def test_allows_up_to_limit_then_blocks(self) -> None:
        limiter = RateLimiter(3)
        self.assertTrue(limiter.allow("ip", now=0.0))
        self.assertTrue(limiter.allow("ip", now=1.0))
        self.assertTrue(limiter.allow("ip", now=2.0))
        self.assertFalse(limiter.allow("ip", now=3.0))

    def test_window_slides_open_again(self) -> None:
        limiter = RateLimiter(2)
        self.assertTrue(limiter.allow("ip", now=0.0))
        self.assertTrue(limiter.allow("ip", now=1.0))
        self.assertFalse(limiter.allow("ip", now=59.0))
        self.assertTrue(limiter.allow("ip", now=61.0))  # first hit expired

    def test_clients_are_isolated(self) -> None:
        limiter = RateLimiter(1)
        self.assertTrue(limiter.allow("a", now=0.0))
        self.assertFalse(limiter.allow("a", now=0.5))
        self.assertTrue(limiter.allow("b", now=0.5))

    def test_zero_limit_disables(self) -> None:
        limiter = RateLimiter(0)
        for i in range(100):
            self.assertTrue(limiter.allow("ip", now=float(i)))


class ServerGuardTests(unittest.TestCase):
    """Real HTTP round-trips against the actual handler."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self._old_db = server.DB_PATH
        self._old_limiter = server._LIMITER
        server.DB_PATH = Path(self.tmp.name) / "engram.sqlite3"
        reset_db(server.DB_PATH)
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), EngramHandler)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        server.DB_PATH = self._old_db
        server._LIMITER = self._old_limiter
        os.environ.pop("ENGRAM_ALLOW_RESET", None)
        self.tmp.cleanup()

    def _post(self, path: str, body: dict[str, object]) -> tuple[int, dict[str, object]]:
        request = urllib.request.Request(
            self.base + path,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read().decode("utf-8"))

    def test_write_endpoints_return_429_over_limit(self) -> None:
        server._LIMITER = RateLimiter(3)
        for _ in range(3):
            status, _body = self._post("/api/ingest", {"text": "Budget is 2000 PHP monthly."})
            self.assertEqual(200, status)
        status, body = self._post("/api/ingest", {"text": "Budget is 1500 PHP monthly."})
        self.assertEqual(429, status)
        self.assertIn("rate limit", str(body["error"]))

    def test_reset_forbidden_when_disabled(self) -> None:
        server._LIMITER = RateLimiter(0)
        os.environ["ENGRAM_ALLOW_RESET"] = "0"
        status, body = self._post("/api/demo/reset", {})
        self.assertEqual(403, status)
        self.assertIn("disabled", str(body["error"]))

    def test_reset_allowed_by_default(self) -> None:
        server._LIMITER = RateLimiter(0)
        status, _body = self._post("/api/demo/reset", {})
        self.assertEqual(200, status)


if __name__ == "__main__":
    unittest.main()


class HealthEndpointTests(unittest.TestCase):
    """`/health` must reflect the ledger, not merely that the process answered.

    Added in iteration 242 after the loop's own fleet-maintenance job was found
    checking `https://engram-production-1a6b.up.railway.app/health` -- an
    endpoint that had never existed. Every run of that job would have reported
    this service broken while it was serving perfectly.
    """

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self._old_db = server.DB_PATH
        server.DB_PATH = Path(self.tmp.name) / "engram.sqlite3"
        reset_db(server.DB_PATH)
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), EngramHandler)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        server.DB_PATH = self._old_db
        self.tmp.cleanup()

    def test_health_is_reachable_and_reports_ok(self) -> None:
        with urllib.request.urlopen(f"{self.base}/health", timeout=10) as resp:
            self.assertEqual(resp.status, 200)
            body = json.loads(resp.read().decode("utf-8"))
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["service"], "engram")
        # It reports what it counted, so a reader can tell a live ledger from an
        # empty one rather than taking "ok" on faith.
        self.assertIn("beliefs", body)
        self.assertIn("events", body)

    def test_health_fails_closed_when_the_ledger_cannot_be_read(self) -> None:
        # The whole point: a constant `ok` would pass this test too, so the
        # datastore must be genuinely unopenable.
        #
        # A non-existent nested path does NOT work -- `init_db` creates parent
        # directories, so the first attempt at this test passed with status "ok"
        # and proved nothing. Pointing at an existing DIRECTORY does: sqlite
        # cannot open one as a database file.
        payload, status = server.health(Path(self.tmp.name))
        self.assertNotEqual(payload["status"], "ok")
        self.assertEqual(payload["status"], "unhealthy")
        self.assertEqual(status, HTTPStatus.SERVICE_UNAVAILABLE)
        self.assertIn("error", payload)

    def test_health_is_not_the_generic_not_found_route(self) -> None:
        # It used to be. `/health` fell through to the 404 branch and returned
        # {"error": "not found"} with a 404 -- indistinguishable from a dead app.
        with urllib.request.urlopen(f"{self.base}/health", timeout=10) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        self.assertNotIn("not found", json.dumps(body))
