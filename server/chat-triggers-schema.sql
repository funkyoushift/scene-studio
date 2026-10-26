-- Additive migration. Existing moderation-only grants remain usable unchanged.
CREATE TABLE IF NOT EXISTS chat_oauth_intents (
  channel TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  trigger_access INTEGER NOT NULL,
  expires INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS chat_trigger_subscriptions (
  channel TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL DEFAULT '',
  grant_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  status TEXT NOT NULL,
  updated INTEGER NOT NULL,
  lock_until INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS chat_trigger_receipts (
  channel TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY(channel,message_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS chat_trigger_receipt_time ON chat_trigger_receipts(created);
