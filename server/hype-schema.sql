-- One public, nonpersonal train snapshot per channel. Ended rows remain as
-- tombstones so a delayed begin or progress notification cannot reopen them.
CREATE TABLE IF NOT EXISTS hype_sessions (
  channel TEXT PRIMARY KEY,
  train_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  source_at INTEGER NOT NULL,
  source_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  level INTEGER NOT NULL,
  total INTEGER NOT NULL,
  progress INTEGER NOT NULL,
  goal INTEGER NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('active','ended')),
  event TEXT NOT NULL CHECK(length(CAST(event AS BLOB))<=4096),
  expires INTEGER NOT NULL,
  broadcast_at INTEGER NOT NULL DEFAULT -1
) WITHOUT ROWID;
