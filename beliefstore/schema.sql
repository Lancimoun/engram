PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS beliefs (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'dormant')),
  score REAL NOT NULL DEFAULT 1.0,
  reinforcement_count INTEGER NOT NULL DEFAULT 1,
  contested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  source_ref TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  belief_id TEXT NOT NULL REFERENCES beliefs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  trigger TEXT NOT NULL,
  evidence_ref TEXT,
  reason TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  belief_id TEXT REFERENCES beliefs(id) ON DELETE CASCADE,
  subject TEXT,
  detail TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_beliefs_subject ON beliefs(subject);
CREATE INDEX IF NOT EXISTS idx_revisions_belief_time ON revisions(belief_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(timestamp);
