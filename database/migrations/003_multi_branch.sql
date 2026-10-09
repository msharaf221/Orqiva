-- orqiva:foreign_keys=off
-- Multi-branch operations under one owner. Existing data moves to the HQ branch ('main'),
-- so an installation that upgrades keeps every invoice, product and balance it already has.
-- Foreign keys are paused for this file; the runner verifies integrity before committing.

CREATE TABLE branches (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(code) BETWEEN 2 AND 8),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'STORE' CHECK(kind IN ('HQ','STORE','WAREHOUSE','ONLINE')),
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  opened_on TEXT NOT NULL DEFAULT '2000-01-01',
  closed_on TEXT,
  created_at TEXT NOT NULL,
  CHECK(closed_on IS NULL OR closed_on>=opened_on)
);
INSERT INTO branches(id,code,name,kind,phone,address,active,opened_on,created_at)
  SELECT 'main','HQ','المركز الرئيسي','HQ',phone,address,1,'2000-01-01',strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM company WHERE id=1;

CREATE TABLE user_branches (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  PRIMARY KEY(user_id,branch_id)
);
INSERT INTO user_branches(user_id,branch_id) SELECT id,'main' FROM users;

CREATE TABLE branch_stock (
  branch_id TEXT NOT NULL REFERENCES branches(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0),
  PRIMARY KEY(branch_id,product_id)
);
CREATE TABLE branch_products (
  branch_id TEXT NOT NULL REFERENCES branches(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sale_price INTEGER CHECK(sale_price IS NULL OR sale_price>=0),
  min_stock INTEGER CHECK(min_stock IS NULL OR min_stock>=0),
  PRIMARY KEY(branch_id,product_id)
);
CREATE INDEX idx_branch_products_product ON branch_products(product_id);
INSERT INTO branch_stock(branch_id,product_id,quantity) SELECT 'main',id,stock FROM products;
INSERT INTO branch_products(branch_id,product_id,active) SELECT 'main',id,1 FROM products;
ALTER TABLE products DROP COLUMN stock;

CREATE TABLE transfers (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  from_branch_id TEXT NOT NULL REFERENCES branches(id),
  to_branch_id TEXT NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','IN_TRANSIT','RECEIVED','CANCELLED')),
  date TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  shipped_by TEXT REFERENCES users(id),
  shipped_at TEXT,
  received_by TEXT REFERENCES users(id),
  received_at TEXT,
  cancelled_at TEXT,
  CHECK(from_branch_id<>to_branch_id)
);
CREATE INDEX idx_transfers_from ON transfers(from_branch_id,status);
CREATE INDEX idx_transfers_to ON transfers(to_branch_id,status);
CREATE TABLE transfer_lines (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  quantity_sent INTEGER NOT NULL CHECK(quantity_sent>0),
  quantity_received INTEGER CHECK(quantity_received IS NULL OR (quantity_received>=0 AND quantity_received<=quantity_sent)),
  unit_cost INTEGER NOT NULL DEFAULT 0 CHECK(unit_cost>=0),
  UNIQUE(transfer_id,product_id)
);

ALTER TABLE documents ADD COLUMN branch_id TEXT NOT NULL DEFAULT 'main' REFERENCES branches(id);
CREATE INDEX idx_documents_branch ON documents(branch_id,type,status,date);

ALTER TABLE stock_movements ADD COLUMN branch_id TEXT NOT NULL DEFAULT 'main' REFERENCES branches(id);
ALTER TABLE stock_movements ADD COLUMN transfer_id TEXT REFERENCES transfers(id);
CREATE INDEX idx_movements_branch ON stock_movements(branch_id,created_at);

-- Expenses: a branch-specific cost, or a shared cost split across branches by the chosen basis.
ALTER TABLE expenses ADD COLUMN branch_id TEXT REFERENCES branches(id);
ALTER TABLE expenses ADD COLUMN allocation TEXT NOT NULL DEFAULT 'BRANCH' CHECK(allocation IN ('BRANCH','EQUAL','REVENUE'));
UPDATE expenses SET branch_id='main';
CREATE INDEX idx_expenses_branch ON expenses(branch_id,date);

CREATE TABLE owners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  share_bps INTEGER NOT NULL CHECK(share_bps BETWEEN 0 AND 10000),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL
);
INSERT INTO owners(id,name,phone,email,share_bps,active,created_at)
  VALUES('owner-main','المالك الرئيسي','','',10000,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE equity_entries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id),
  kind TEXT NOT NULL CHECK(kind IN ('CONTRIBUTION','WITHDRAWAL')),
  amount INTEGER NOT NULL CHECK(amount>0),
  method TEXT NOT NULL CHECK(method IN ('CASH','BANK','CARD')),
  date TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_equity_owner ON equity_entries(owner_id,date);

CREATE TABLE distributions (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','PAID','CANCELLED')),
  reserve_bps INTEGER NOT NULL CHECK(reserve_bps BETWEEN 0 AND 5000),
  net_profit INTEGER NOT NULL,
  reserve_amount INTEGER NOT NULL CHECK(reserve_amount>=0),
  distributable INTEGER NOT NULL CHECK(distributable>=0),
  snapshot TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  paid_at TEXT,
  CHECK(period_to>=period_from)
);
CREATE INDEX idx_distributions_period ON distributions(period_from,period_to,status);
CREATE TABLE distribution_lines (
  id TEXT PRIMARY KEY,
  distribution_id TEXT NOT NULL REFERENCES distributions(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES owners(id),
  owner_name TEXT NOT NULL,
  share_bps INTEGER NOT NULL CHECK(share_bps BETWEEN 0 AND 10000),
  amount INTEGER NOT NULL CHECK(amount>=0),
  paid INTEGER NOT NULL DEFAULT 0 CHECK(paid>=0 AND paid<=amount),
  UNIQUE(distribution_id,owner_id)
);
CREATE TABLE distribution_payments (
  id TEXT PRIMARY KEY,
  line_id TEXT NOT NULL REFERENCES distribution_lines(id),
  amount INTEGER NOT NULL CHECK(amount>0),
  method TEXT NOT NULL CHECK(method IN ('CASH','BANK','CARD')),
  date TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  request_key TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_distribution_payment_key ON distribution_payments(request_key) WHERE request_key IS NOT NULL;
