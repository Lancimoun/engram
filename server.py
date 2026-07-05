from __future__ import annotations

import json
import mimetypes
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from engram.demo import reset_demo, run_demo
from engram.store import decay_beliefs, get_state, ingest_statement, init_db, query_memory

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DB_PATH = Path(os.getenv("ENGRAM_DB_PATH", str(ROOT / "data" / "engram.sqlite3")))
HOST = os.getenv("ENGRAM_HOST", "0.0.0.0" if os.getenv("PORT") else "127.0.0.1")
PORT = int(os.getenv("PORT", os.getenv("ENGRAM_PORT", "8787")))
MAX_BODY_BYTES = 64 * 1024  # reject oversized POST bodies (public-demo abuse guard)


class EngramHandler(BaseHTTPRequestHandler):
    server_version = "Engram/0.1"

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/state":
            self._json(get_state(DB_PATH))
            return
        if path == "/":
            self._static("index.html")
            return
        if path.startswith("/static/"):
            self._static(path.removeprefix("/static/"))
            return
        self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        payload = self._payload()

        if path == "/api/ingest":
            text = str(payload.get("text", "")).strip()
            if not text:
                self._json({"error": "text is required"}, HTTPStatus.BAD_REQUEST)
                return
            source = str(payload.get("source", "manual"))
            self._json(ingest_statement(DB_PATH, text, source))
            return

        if path == "/api/decay":
            days = int(payload.get("days", 30))
            self._json(decay_beliefs(DB_PATH, days=days))
            return

        if path == "/api/query":
            text = str(payload.get("text", "")).strip()
            if not text:
                self._json({"error": "text is required"}, HTTPStatus.BAD_REQUEST)
                return
            self._json(query_memory(DB_PATH, text))
            return

        if path == "/api/demo/reset":
            self._json(reset_demo(DB_PATH))
            return

        if path == "/api/demo/run":
            self._json(run_demo(DB_PATH))
            return

        self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args: object) -> None:
        return

    def _payload(self) -> dict[str, object]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > MAX_BODY_BYTES:
            return {}
        raw = self.rfile.read(length)
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}

    def _json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(int(status))
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _static(self, name: str) -> None:
        target = (STATIC_DIR / name).resolve()
        if not str(target).startswith(str(STATIC_DIR.resolve())):
            self._json({"error": "invalid path"}, HTTPStatus.BAD_REQUEST)
            return
        if not target.exists() or not target.is_file():
            if name == "index.html":
                self._fallback_index()
                return
            self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)
            return
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _fallback_index(self) -> None:
        body = b"ENGRAM API online. Frontend static files are not installed yet."
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    init_db(DB_PATH)
    server = ThreadingHTTPServer((HOST, PORT), EngramHandler)
    print(f"ENGRAM running at http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
