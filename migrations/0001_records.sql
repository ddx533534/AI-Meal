CREATE TABLE records (
  id TEXT PRIMARY KEY,
  input TEXT NOT NULL,
  output TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL
);

CREATE INDEX records_created_at ON records(created_at DESC, id DESC);
