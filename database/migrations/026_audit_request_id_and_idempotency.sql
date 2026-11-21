-- Phase 4 kernel: request correlation on the audit trail + shared idempotency keys.

-- Every audit row can carry the request that produced it, so a support case can be
-- traced from an error response back to the exact state transitions it caused.
ALTER TABLE audit_logs ADD COLUMN request_id TEXT;

-- Shared retry-safety store for unsafe POSTs. One row per (actor, endpoint, key):
-- the first execution stores its response, a replay with the same body returns it,
-- and a replay with a different body is a conflict.
CREATE TABLE idempotency_keys (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(actor_id, endpoint, key)
);
CREATE INDEX idx_idempotency_created ON idempotency_keys(created_at);
