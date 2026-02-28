CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS person_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES people(id),
  kind TEXT NOT NULL CHECK(kind IN ('ping_ip', 'ble_mac')),
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(person_id, kind, value)
);

CREATE TABLE IF NOT EXISTS presence_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES people(id),
  state TEXT NOT NULL CHECK(state IN ('home', 'away')),
  ts INTEGER NOT NULL DEFAULT (unixepoch()),
  raw_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('time', 'arrival')),
  trigger_json TEXT NOT NULL DEFAULT '{}',
  action_type TEXT NOT NULL CHECK(action_type IN ('notify')),
  action_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  next_run_ts INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'done', 'failed')),
  last_run_ts INTEGER,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS llm_message_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL DEFAULT (unixepoch()),
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_text TEXT NOT NULL,
  intent_json TEXT,
  confidence REAL,
  was_clarified INTEGER NOT NULL DEFAULT 0,
  raw_response_json TEXT
);
