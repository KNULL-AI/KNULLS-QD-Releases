CREATE TABLE IF NOT EXISTS activation_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  key_type TEXT NOT NULL CHECK (key_type IN ('user','admin')),
  owner_ref TEXT,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  max_devices INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  created_by TEXT,
  revoked_at TEXT,
  revoked_by TEXT
);

CREATE TABLE IF NOT EXISTS activations (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  app_version TEXT,
  activated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE(key_id, device_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','admin')),
  device_id TEXT NOT NULL,
  access_token_hash TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL,
  access_expires_at TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_access_hash ON sessions(access_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_refresh_hash ON sessions(refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_activations_key_device ON activations(key_id, device_id);
