CREATE TABLE IF NOT EXISTS card_games (
  channel TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  game TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS card_games_expiry ON card_games(expires);
