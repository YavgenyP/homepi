-- Expand rules.trigger_type CHECK to include 'condition'
-- Add condition_onset_ts to track when a condition was first met
CREATE TABLE rules_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('time', 'arrival', 'condition')),
  trigger_json TEXT NOT NULL DEFAULT '{}',
  action_type TEXT NOT NULL CHECK(action_type IN ('notify', 'device_control')),
  action_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  condition_onset_ts INTEGER
);
INSERT INTO rules_new SELECT id, name, trigger_type, trigger_json, action_type, action_json, enabled, created_at, NULL FROM rules;

CREATE TABLE scheduled_jobs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL REFERENCES rules_new(id) ON DELETE CASCADE,
  next_run_ts INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'done', 'failed')),
  last_run_ts INTEGER,
  last_error TEXT
);
INSERT INTO scheduled_jobs_new SELECT * FROM scheduled_jobs;

DROP TABLE scheduled_jobs;
DROP TABLE rules;
ALTER TABLE rules_new RENAME TO rules;
ALTER TABLE scheduled_jobs_new RENAME TO scheduled_jobs;
