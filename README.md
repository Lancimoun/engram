# ENGRAM: Memory Reliability Ledger for AI Agents

![status](https://img.shields.io/badge/status-V1%20prototype-5ed7bd)
![runtime](https://img.shields.io/badge/runtime-Python%20%2B%20SQLite-85a8e6)
![interface](https://img.shields.io/badge/interface-Three.js%20topology-d9a856)

ENGRAM is an auditable memory layer for AI agents. It records what an agent
believed, when that belief changed, what evidence caused the change, and which
old value was superseded.

Most memory systems optimize recall. ENGRAM optimizes accountability.

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

```powershell
& 'C:\Users\Lance\AppData\Local\Programs\Python\Python312\python.exe' -m unittest discover .\tests
& 'C:\Users\Lance\AppData\Local\Programs\Python\Python312\python.exe' .\server.py
```

Open:

```text
http://127.0.0.1:8787
```

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
