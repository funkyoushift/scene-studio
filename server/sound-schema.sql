-- Apply to the existing IMAGES D1 database before enabling sound uploads.
CREATE TABLE IF NOT EXISTS sounds (
  channel TEXT NOT NULL,
  hash TEXT NOT NULL,
  data BLOB NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes BETWEEN 45 AND 500000),
  created INTEGER NOT NULL,
  PRIMARY KEY (channel, hash)
) WITHOUT ROWID;

-- Additive MP3 storage. Keep the original WAV table and its 500 KB CHECK so
-- existing published WAV URLs and rows remain untouched during migration.
CREATE TABLE IF NOT EXISTS sound_music (
  channel TEXT NOT NULL,
  hash TEXT NOT NULL,
  data BLOB NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes BETWEEN 4 AND 1500000),
  created INTEGER NOT NULL,
  PRIMARY KEY (channel, hash)
) WITHOUT ROWID;
