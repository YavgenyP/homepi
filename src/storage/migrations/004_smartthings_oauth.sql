CREATE TABLE IF NOT EXISTS smartthings_oauth (
  id INTEGER PRIMARY KEY CHECK(id = 1),  -- singleton row
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,        -- unix timestamp
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
