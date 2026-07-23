CREATE TABLE resource_storage_usage (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  used_bytes INTEGER NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO resource_storage_usage (id, used_bytes, reserved_bytes)
SELECT 1, COALESCE(SUM(byte_size), 0), 0
FROM resources;

CREATE TABLE resource_gc_queue (
  object_key TEXT PRIMARY KEY,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_resource_gc_queue_created
  ON resource_gc_queue(created_at, object_key);
