-- Weighted Average Cost (WAC) per (branch, product).
-- The average cost is recomputed on every purchase and transfer receipt.
-- Sales use the WAC at the moment of posting (snapshotted in document_lines.cost_price).
-- Existing rows in branch_stock get a cost of 0 until the first purchase or transfer updates them;
-- reports fall back to the product's reference cost_price when the WAC is 0.

CREATE TABLE branch_cost (
  branch_id   TEXT NOT NULL REFERENCES branches(id),
  product_id  TEXT NOT NULL REFERENCES products(id),
  -- Weighted average unit cost in piastres (integer). 0 means "no purchases yet".
  avg_cost    INTEGER NOT NULL DEFAULT 0 CHECK(avg_cost >= 0),
  -- Total value on hand = avg_cost * branch_stock.quantity (kept for WAC recalculation).
  total_value INTEGER NOT NULL DEFAULT 0 CHECK(total_value >= 0),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY(branch_id, product_id)
);

-- Seed from existing branch_stock using the product reference cost_price.
INSERT INTO branch_cost(branch_id, product_id, avg_cost, total_value, updated_at)
  SELECT bs.branch_id, bs.product_id,
         p.cost_price,
         bs.quantity * p.cost_price,
         strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM branch_stock bs
  JOIN products p ON p.id = bs.product_id
  WHERE bs.quantity > 0;

-- Cost movement log: records every WAC change with before/after values.
CREATE TABLE cost_movements (
  id          TEXT PRIMARY KEY,
  branch_id   TEXT NOT NULL REFERENCES branches(id),
  product_id  TEXT NOT NULL REFERENCES products(id),
  -- Positive = cost increased (purchase/transfer-in), negative direction encoded in reason
  delta_qty   INTEGER NOT NULL CHECK(delta_qty <> 0),
  unit_cost   INTEGER NOT NULL CHECK(unit_cost >= 0),   -- cost used in this movement
  avg_before  INTEGER NOT NULL CHECK(avg_before >= 0),
  avg_after   INTEGER NOT NULL CHECK(avg_after >= 0),
  reason      TEXT NOT NULL,
  document_id TEXT REFERENCES documents(id),
  transfer_id TEXT REFERENCES transfers(id),
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_cost_movements_branch ON cost_movements(branch_id, product_id, created_at);
