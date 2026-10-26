-- Additive D1 migration for optional subscription and Hype Train EventSub.
-- Apply after server/schema.sql; OAuth activity intent is separate so existing
-- moderation and chat trigger grants are not changed by this migration.
CREATE TABLE IF NOT EXISTS twitch_activity_oauth_intents (
  channel TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  activity_access INTEGER NOT NULL,
  expires INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS twitch_activity_subscriptions (
  channel TEXT NOT NULL,
  event TEXT NOT NULL,
  subscription_id TEXT NOT NULL DEFAULT '',
  grant_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  status TEXT NOT NULL,
  updated INTEGER NOT NULL,
  lock_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(channel,event)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS twitch_activity_receipts (
  channel TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY(channel,message_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS twitch_activity_receipt_time ON twitch_activity_receipts(created);
