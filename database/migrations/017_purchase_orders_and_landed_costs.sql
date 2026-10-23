-- 017_purchase_orders_and_landed_costs.sql
-- Pack 2.4: Purchase Orders workflow and Landed Costs capitalization onto WAC

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  party_id TEXT NOT NULL REFERENCES parties(id),
  status TEXT NOT NULL CHECK(status IN ('DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')) DEFAULT 'DRAFT',
  date TEXT NOT NULL,
  expected_delivery_date TEXT,
  subtotal INTEGER NOT NULL DEFAULT 0,
  tax_rate INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_po_branch ON purchase_orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_po_party ON purchase_orders(party_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  received_quantity INTEGER NOT NULL DEFAULT 0 CHECK(received_quantity >= 0),
  unit_price INTEGER NOT NULL CHECK(unit_price >= 0),
  tax_rate INTEGER NOT NULL DEFAULT 0,
  line_total INTEGER NOT NULL CHECK(line_total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_po_lines_order ON purchase_order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_product ON purchase_order_lines(product_id);

CREATE TABLE IF NOT EXISTS landed_costs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  cost_type TEXT NOT NULL CHECK(cost_type IN ('SHIPPING', 'CUSTOMS', 'CLEARANCE', 'HANDLING', 'OTHER')),
  cost_name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  allocation_method TEXT NOT NULL CHECK(allocation_method IN ('BY_VALUE', 'BY_QUANTITY')) DEFAULT 'BY_VALUE',
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_landed_doc ON landed_costs(document_id);

CREATE TABLE IF NOT EXISTS landed_cost_allocations (
  id TEXT PRIMARY KEY,
  landed_cost_id TEXT NOT NULL REFERENCES landed_costs(id) ON DELETE CASCADE,
  document_line_id TEXT NOT NULL REFERENCES document_lines(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  allocated_amount INTEGER NOT NULL CHECK(allocated_amount >= 0),
  additional_unit_cost INTEGER NOT NULL CHECK(additional_unit_cost >= 0)
);

CREATE INDEX IF NOT EXISTS idx_landed_alloc_cost ON landed_cost_allocations(landed_cost_id);
CREATE INDEX IF NOT EXISTS idx_landed_alloc_line ON landed_cost_allocations(document_line_id);
