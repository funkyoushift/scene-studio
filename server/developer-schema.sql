-- Source-only developer API foundation. Separate from the submitted extension.
CREATE TABLE IF NOT EXISTS developer_keys (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS developer_key_channel ON developer_keys(channel);
CREATE INDEX IF NOT EXISTS developer_key_expiry ON developer_keys(expires);

CREATE TABLE IF NOT EXISTS developer_events (
  channel TEXT NOT NULL,
  event_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL CHECK (length(CAST(data AS BLOB)) <= 8192),
  occurred INTEGER NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  PRIMARY KEY(channel,event_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS developer_event_expiry ON developer_events(expires);

CREATE TABLE IF NOT EXISTS developer_state (
  channel TEXT PRIMARY KEY,
  data TEXT NOT NULL CHECK (length(CAST(data AS BLOB)) <= 8192),
  revision INTEGER NOT NULL,
  updated INTEGER NOT NULL
) WITHOUT ROWID;

-- Only trusted future server code may write actions. No public write route exists.
CREATE TABLE IF NOT EXISTS developer_actions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  action_id TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL CHECK (length(CAST(data AS BLOB)) <= 8192),
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  UNIQUE(channel,action_id)
);
CREATE INDEX IF NOT EXISTS developer_action_channel ON developer_actions(channel,sequence);
CREATE INDEX IF NOT EXISTS developer_action_expiry ON developer_actions(expires);
