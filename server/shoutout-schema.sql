-- Additive first-message admission for Creator shoutouts. No raw chat text.
CREATE TABLE IF NOT EXISTS shoutout_first_messages (
  channel TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  PRIMARY KEY (channel, stream_id, user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS shoutout_first_messages_expiry ON shoutout_first_messages(expires);

-- Atomic per-channel provider lookup budget, including concurrent webhook runs.
CREATE TABLE IF NOT EXISTS shoutout_lookup_windows (
  channel TEXT NOT NULL,
  minute INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  PRIMARY KEY (channel, minute)
) WITHOUT ROWID;
