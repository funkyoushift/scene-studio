CREATE TABLE IF NOT EXISTS automation_configs (
  channel TEXT PRIMARY KEY,
  design TEXT NOT NULL CHECK(length(CAST(design AS BLOB))<=16384),
  revision INTEGER NOT NULL,
  owned_merch INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL,
  engine_state TEXT NOT NULL,
  engine_revision INTEGER NOT NULL DEFAULT 0,
  last_event_at INTEGER NOT NULL DEFAULT -1,
  has_timers INTEGER NOT NULL DEFAULT 0,
  next_tick INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS automation_next_tick ON automation_configs(has_timers,next_tick);

CREATE TABLE IF NOT EXISTS automation_receipts (
  channel TEXT NOT NULL,
  input_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL,
  engine_state TEXT NOT NULL,
  event TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY(channel,input_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS automation_receipt_expiry ON automation_receipts(expires);

-- Admission and cooldown advancement are one atomic SQLite statement.
CREATE TRIGGER IF NOT EXISTS automation_admitted AFTER INSERT ON automation_receipts
BEGIN
  UPDATE automation_configs SET engine_state=NEW.engine_state,
    engine_revision=engine_revision+1,last_event_at=NEW.created
    WHERE channel=NEW.channel AND revision=NEW.revision;
END;
