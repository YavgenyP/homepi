-- Item 27: LLM improvements — memory, device aliases/embeddings, proactive suggestions

-- 1. Device aliases and embeddings on ha_devices
ALTER TABLE ha_devices ADD COLUMN aliases TEXT NOT NULL DEFAULT '';
ALTER TABLE ha_devices ADD COLUMN embedding TEXT NOT NULL DEFAULT '';

-- 2. Persisted short-term conversation memory (per user, pruned to 2h)
CREATE TABLE IF NOT EXISTS conversation_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL DEFAULT (unixepoch()),
  user_id    TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  role       TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content    TEXT NOT NULL
);

-- 3. Task execution log for pattern detection (manual + scheduler)
CREATE TABLE IF NOT EXISTS task_executions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL DEFAULT (unixepoch()),
  user_id     TEXT,
  source      TEXT NOT NULL CHECK(source IN ('manual', 'scheduler')),
  device_name TEXT,
  command     TEXT,
  rule_id     INTEGER REFERENCES rules(id) ON DELETE SET NULL,
  hour_of_day INTEGER NOT NULL
);

-- 4. Tracks when a proactive suggestion was last sent per pattern key
CREATE TABLE IF NOT EXISTS proactive_suggestions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_key  TEXT NOT NULL,
  suggested_at INTEGER NOT NULL DEFAULT (unixepoch())
);
