<div align="center">

# 🧬 ENGRAM

### A memory-reliability ledger for AI agents

Audit **what an agent believed, when it changed, what evidence triggered the revision, what decayed, and what was later restored** — rendered as a live 3D memory observatory.

**▶ Live observatory:** https://engram-production-1a6b.up.railway.app

![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-zero%20(stdlib)-5ed7bd?style=flat-square)
[![CI](https://github.com/Lancimoun/engram/actions/workflows/ci.yml/badge.svg)](https://github.com/Lancimoun/engram/actions/workflows/ci.yml)
![Tests](https://img.shields.io/badge/tests-20%20verified-5ed7bd?style=flat-square)
![Interface](https://img.shields.io/badge/interface-Three.js%20observatory-d9a856?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-85a8e6?style=flat-square)

</div>

> Most memory systems optimize recall. **ENGRAM optimizes accountability.**

ENGRAM records what an agent believed, when that belief changed, what evidence
caused the change, and which old value was superseded — turning hidden memory
mutations into an inspectable audit trail.

## Why It Exists

Agents do not only fail because they lack knowledge. They also fail because
they use stale facts, contradict themselves, silently rewrite state, or restore
old assumptions without an audit trail.

ENGRAM turns those hidden memory changes into inspectable ledger events:

- belief creation
- contradiction detection
- revision history
- provenance coverage
- decay into dormancy
- restoration from query pressure
- "what changed your mind?" explanations

## What It Proves

ENGRAM is not a document chatbot and not a generic dashboard. The core artifact
is a belief-revision ledger that reliability tooling can inspect.

It answers:

- What did the agent believe before?
- Why did the belief change?
- Which source triggered the revision?
- What went dormant?
- What was restored later?
- Where is the agent carrying stale or contradictory memory?

## Product Surface

The browser UI is a memory reliability console:

- evidence flow telemetry
- belief inventory filtering
- memory health scoring
- provenance coverage
- revision and ledger stream panels
- animated Three.js evidence topology

The 3D view is intentionally tied to real ledger state. Nodes, trace packets,
filters, and readouts are driven by API data rather than decorative animation.

## ENGRAM vs Agent Reliability Arena

Agent Reliability Arena tests whether an agent survives stress, tool failures,
stale memory, and changing conditions.

ENGRAM records the belief state behind that behavior.

Arena shows whether an agent failed. ENGRAM helps explain what the agent
believed when it failed.

## Architecture

```text
Browser UI
  -> /api/state
  -> /api/ingest
  -> /api/query
  -> /api/decay
  -> /api/demo/run
  -> /api/demo/reset

Python server
  -> SQLite belief ledger
  -> revision events
  -> provenance records
  -> decay and restore logic
```

## Run Locally

No dependencies — ENGRAM V1 uses the Python standard library only (3.11+).

```bash
python -m unittest discover tests     # run all 20 tests
python server.py                      # start the server
```

Then open http://127.0.0.1:8787 and click **Run ledger demo**.

### Public-deploy configuration

| Env var | Default | Purpose |
|---|---|---|
| `ENGRAM_RATE_LIMIT_PER_MIN` | `30` | Per-IP sliding-window cap on all `POST` endpoints (429 over limit; `0` disables) |
| `ENGRAM_ALLOW_RESET` | `1` | Set `0` on shared/public deployments so visitors can't wipe the ledger via `/api/demo/reset` (403) |

## Reliability

ENGRAM is a memory-accountability tool, so the one thing it must never do is
silently lose its own writes. The server is threaded (one request per thread),
so belief writes can land concurrently. The ledger defends against that:

- SQLite runs in **WAL mode** with a **5s busy-timeout**, so concurrent writers
  queue for the lock instead of failing with "database is locked".
- `tests/test_concurrency.py` proves it: 24 threads writing distinct beliefs at
  once lose **zero** records, and 16 racing revisions to one belief leave a
  consistent, audit-complete ledger.
- `tests/test_server_guards.py` proves the public surface holds: real HTTP
  round-trips show write endpoints returning **429** past the per-IP limit and
  `/api/demo/reset` returning **403** when disabled for shared deployments.
- **Offline never means empty:** if the backend is unreachable, the observatory
  falls back to a baked read-only snapshot (`static/state.snapshot.json`,
  regenerated via `scripts/bake_snapshot.py`) and says so in the status line —
  proven by `tests/test_snapshot.py`.

A memory system that drops writes under load can't be trusted to explain what an
agent believed — so that guarantee is tested, not assumed.

## API Contract

- `GET /api/state`
- `POST /api/ingest`
- `POST /api/decay`
- `POST /api/query`
- `POST /api/demo/reset`
- `POST /api/demo/run`

The UI must only animate real ledger events returned by these endpoints. Idle
camera motion is allowed, but belief nodes, revision packets, filters, and
readouts must remain tied to API state.

## Demo Corpus

The bundled demo records simple belief changes:

- `API rate limit: 100 req/min -> 60 req/min`
- `Primary model: Compact model -> Frontier model`
- `Deployment method` decays and can be restored by query

The sample data is not the point. The point is the audit trail: every revision
has a trigger, evidence reference, timestamp, and previous value.

## Roadmap

- Connect ENGRAM to Project Maxima long-horizon memory
- Add memory half-life and contradiction-rate charts
- Export machine-readable reliability reports
- Add agent SDK adapters
- Add public replay links for memory incidents
