---
name: engram-verify
description: Verify ENGRAM actually works end-to-end — run the unittest suite (including the concurrency and public-surface guard tests), boot the real stdlib server, and probe the live API. Use this whenever ENGRAM's code changes (before any commit or push), after pulling, before or after a deploy, or whenever anyone asks "does engram work", "is the ledger healthy", or wants proof the observatory serves real state. A green suite with a dead server is still a broken product — always run all three levels.
---

# engram-verify

Prove ENGRAM works at three levels: unit (unittest), process (server boots), product (API answers with real ledger state).

## 1 · Test suite (~3s, stdlib only, no dependencies)

```
python -m unittest discover tests
```

Expect **all green** (13 tests as of 2026-07): belief-revision integrity, decay/restore, 24-thread concurrency (zero lost writes), and the public-surface guards (429 over rate limit, 403 on gated reset) proven over real HTTP. Any failure: stop and fix first.

## 2 · Boot the real server

```
set ENGRAM_PORT=8788 && python server.py     # Windows (POSIX: ENGRAM_PORT=8788 python server.py)
```

Run in the background; it prints `ENGRAM running at ...` and auto-seeds a demo ledger when the DB is empty, so a fresh boot is never blank. Use 8788 to avoid colliding with a dev instance on the default 8787.

## 3 · Probe the product surface

| Probe | Expect |
|---|---|
| `GET /api/state` | JSON with non-empty `beliefs` (auto-seeded), `revisions`, and `metrics` |
| `GET /` | the observatory HTML (or the plain-text API-online fallback if static files are absent) |
| `POST /api/query` with `{"text": "how is it deployed?"}` | an answer drawn from ledger state |
| `POST /api/demo/reset` | 200 by default; **403 when `ENGRAM_ALLOW_RESET=0`** — on public deploys the 403 is the correct result |

**Always kill the server when done** (find the PID by port, not by image name — a blanket `python.exe` kill takes out innocent processes). Report a pass/fail line per level with failing output verbatim.

## Gotchas (each earned from a real failure)

- **No venv, no pip** — ENGRAM is deliberately stdlib-only (3.11+). If you reach for `pip install`, you're breaking its core design constraint.
- **The server binds 0.0.0.0 only when `PORT` is set** (deploy mode); locally it stays on 127.0.0.1. A "can't reach it from another device" report locally is by design.
- **Rapid probing can 429** — the per-IP limiter (default 30/min) applies to every POST; that's the guard working, not a bug. Set `ENGRAM_RATE_LIMIT_PER_MIN=0` for load tests.
- **`main` once sat unpushed with no upstream** — after committing, confirm `git status -sb` shows `main...origin/main`, not bare `main`.
- **Windows kill discipline:** `Get-NetTCPConnection -LocalPort 8788` → `Stop-Process -Id <pid>`; never `taskkill /IM python.exe`.
