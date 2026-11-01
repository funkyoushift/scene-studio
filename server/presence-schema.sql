-- One bounded snapshot per connected channel; no chat text or arrival history.
CREATE TABLE IF NOT EXISTS shoutout_presence (
  channel TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL DEFAULT '',
  grant_id TEXT NOT NULL DEFAULT '',
  members TEXT NOT NULL DEFAULT '[]' CHECK(length(members)<=50000),
  pending TEXT NOT NULL DEFAULT '[]' CHECK(length(pending)<=10000),
  checked_at INTEGER NOT NULL DEFAULT 0,
  next_check INTEGER NOT NULL DEFAULT 0,
  lease TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'waiting'
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS shoutout_presence_due ON shoutout_presence(next_check);
