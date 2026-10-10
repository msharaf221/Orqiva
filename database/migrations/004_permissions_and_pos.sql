-- orqiva:foreign_keys=off
-- Dynamic & granular permissions and Odoo-like POS interface

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'STAFF' CHECK(role IN ('ADMIN','STAFF','GENERAL_ACCOUNTANT','TREASURY_ACCOUNTANT','BRANCH_MANAGER','CASHIER')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL
);

INSERT INTO users_new(id, name, email, password_hash, role, active, created_at)
  SELECT id, name, email, password_hash, role, active, created_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE TABLE user_permission_overrides (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK(granted IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, permission)
);
CREATE INDEX idx_user_permission_user ON user_permission_overrides(user_id);

CREATE TABLE pos_shifts (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'PENDING_REVIEW', 'CLOSED')),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  opening_cash INTEGER NOT NULL CHECK(opening_cash >= 0),
  expected_cash INTEGER NOT NULL DEFAULT 0,
  closing_cash INTEGER CHECK(closing_cash IS NULL OR closing_cash >= 0),
  difference INTEGER NOT NULL DEFAULT 0,
  cashier_declared_cash INTEGER CHECK(cashier_declared_cash IS NULL OR cashier_declared_cash >= 0),
  reviewed_by TEXT REFERENCES users(id),
  review_notes TEXT NOT NULL DEFAULT '',
  discrepancy_expense_id TEXT REFERENCES expenses(id),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_pos_shifts_branch ON pos_shifts(branch_id, status);
CREATE INDEX idx_pos_shifts_user ON pos_shifts(user_id, status);

CREATE TABLE pos_cash_movements (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES pos_shifts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('IN', 'OUT')),
  amount INTEGER NOT NULL CHECK(amount > 0),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_pos_cash_movements_shift ON pos_cash_movements(shift_id, created_at);

ALTER TABLE documents ADD COLUMN pos_shift_id TEXT REFERENCES pos_shifts(id);
CREATE INDEX idx_documents_pos_shift ON documents(pos_shift_id);

INSERT OR IGNORE INTO parties(id, type, name, email, phone, address, tax_number, notes, active, created_at)
  VALUES('walk-in-customer', 'CUSTOMER', 'عميل نقدي (طائر)', '', '', '', '', 'عميل نقاط البيع الافتراضي', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
