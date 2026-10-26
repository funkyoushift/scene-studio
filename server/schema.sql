CREATE TABLE IF NOT EXISTS images (
  channel TEXT NOT NULL,
  hash TEXT NOT NULL,
  data BLOB NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 200000),
  created INTEGER NOT NULL,
  PRIMARY KEY (channel, hash)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS party_events (
  channel TEXT NOT NULL,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY(channel,event_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS party_channel_time ON party_events(channel,created);

CREATE TABLE IF NOT EXISTS party_attempts (
  channel TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires INTEGER NOT NULL,
  PRIMARY KEY(channel,user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS party_attempt_expiry ON party_attempts(expires);

CREATE TABLE IF NOT EXISTS chat_oauth_states (
  channel TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  expires INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS chat_oauth_state_expiry ON chat_oauth_states(expires);
CREATE TABLE IF NOT EXISTS chat_oauth_grants (
  channel TEXT PRIMARY KEY,
  encrypted_tokens TEXT NOT NULL,
  revision TEXT NOT NULL,
  expires INTEGER NOT NULL,
  invalidated INTEGER NOT NULL DEFAULT 0,
  refresh_lock TEXT,
  refresh_until INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS chat_oauth_validation (
  channel TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  next_check INTEGER NOT NULL,
  checked_at INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS chat_oauth_validation_due ON chat_oauth_validation(next_check);

CREATE TABLE IF NOT EXISTS chat_oauth_intents (
  channel TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  trigger_access INTEGER NOT NULL,
  expires INTEGER NOT NULL
) WITHOUT ROWID;
