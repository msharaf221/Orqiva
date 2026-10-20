-- Migration 013: Periodic Stocktake (جرد دوري) with variance approval
--
-- A stocktake is a counted snapshot of one branch's stock. Lines capture the expected
-- system quantity at the time the session was frozen, the physically counted quantity,
-- and the variance between them. Nothing touches stock until an authorised approver
-- signs off: approval posts the variances as stock movements so the ledger keeps a full
-- audit trail (adjustments are never silent overwrites).
--
-- Lifecycle: DRAFT (counting) → SUBMITTED (awaiting approval) → APPROVED (variances posted)
--            or CANCELLED (abandoned before approval).

CREATE TABLE stocktake_sessions (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK(status IN ('DRAFT','SUBMITTED','APPROVED','CANCELLED')),
  notes TEXT NOT NULL DEFAULT '',
  counted_by TEXT NOT NULL REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  approved_at TEXT
);
CREATE INDEX idx_stocktake_branch ON stocktake_sessions(branch_id, status, created_at);
CREATE INDEX idx_stocktake_status ON stocktake_sessions(status, created_at);

CREATE TABLE stocktake_lines (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES stocktake_sessions(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  expected_qty INTEGER NOT NULL DEFAULT 0,
  counted_qty INTEGER,
  -- Snapshotted WAC used to value the variance (positive or negative) at approval time.
  unit_cost INTEGER NOT NULL DEFAULT 0,
  counted_at TEXT
);
CREATE INDEX idx_stocktake_lines_session ON stocktake_lines(session_id, product_id);

-- Stocktake approval permission: granted to the roles that may post count variances.
-- The warehouse role counts but does not approve; branch managers and accountants do.
INSERT OR IGNORE INTO role_permissions(role_id, permission) VALUES
  ('role_branch_mgr', 'inventory:stocktake_approve'),
  ('role_gen_acc', 'inventory:stocktake_approve');
