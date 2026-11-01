-- Apply once before enabling EXPERIENCE_MEDIA hosting. Does not alter existing services.
CREATE TABLE IF NOT EXISTS experience_files (
  key TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes > 0),
  ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN (0,1)),
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS experience_files_channel ON experience_files(channel);
