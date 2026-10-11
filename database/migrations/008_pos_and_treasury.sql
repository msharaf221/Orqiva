-- orqiva:foreign_keys=off
-- Migration 008: High-Speed POS & Odoo-like Treasury Shift Workflow

-- 1. Expand users table role CHECK constraint to support all roles seamlessly
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'STAFF' CHECK(length(role) > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL
);

INSERT INTO users_new(id, name, email, password_hash, role, active, created_at)
  SELECT id, name, email, password_hash, role, active, created_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- 2. User individual permission overrides (fine-grained grant/revoke per user)
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK(granted IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, permission)
);
CREATE INDEX IF NOT EXISTS idx_user_permission_user ON user_permission_overrides(user_id);

-- 3. POS Shifts (Odoo-like Cashier Handover, Variance & Treasury Review)
CREATE TABLE IF NOT EXISTS pos_shifts (
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
CREATE INDEX IF NOT EXISTS idx_pos_shifts_branch ON pos_shifts(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_user ON pos_shifts(user_id, status);

-- 4. POS Cash Movements (Drawer In / Out during shift)
CREATE TABLE IF NOT EXISTS pos_cash_movements (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES pos_shifts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('IN', 'OUT')),
  amount INTEGER NOT NULL CHECK(amount > 0),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pos_cash_movements_shift ON pos_cash_movements(shift_id, created_at);

-- 5. Link documents to pos_shift_id
ALTER TABLE documents ADD COLUMN pos_shift_id TEXT REFERENCES pos_shifts(id);
CREATE INDEX IF NOT EXISTS idx_documents_pos_shift ON documents(pos_shift_id);

-- 6. Seed default walk-in customer
INSERT OR IGNORE INTO parties(id, type, name, email, phone, address, tax_number, notes, active, created_at)
  VALUES('walk-in-customer', 'CUSTOMER', 'عميل نقدي (طائر)', '', '', '', '', 'عميل نقاط البيع الافتراضي', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- 7. Seed predefined POS & Treasury roles into roles table
INSERT OR IGNORE INTO roles (id, name, code, description, is_system, created_at) VALUES
  ('role_cashier', 'كاشير نقطة بيع', 'CASHIER', 'إدارة شاشة نقاط البيع السريعة والورديات وحركات الدرج النقدي', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('role_treasury', 'محاسب خزنة', 'TREASURY_ACCOUNTANT', 'استلام ومراجعة ورديات الكاشير واعتماد فروقات النقدية وترحيل قيود العجز والزيادة', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('role_gen_acc', 'محاسب عام', 'GENERAL_ACCOUNTANT', 'إدارة الحسابات العامة والقيود المزدوجة والمشتريات والمبيعات والتقارير الشاملة', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- 8. Seed permissions for CASHIER
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES
  ('role_cashier', 'pos:access'),
  ('role_cashier', 'pos:shift_open'),
  ('role_cashier', 'pos:shift_close'),
  ('role_cashier', 'pos:cash_movement'),
  ('role_cashier', 'pos:discount'),
  ('role_cashier', 'sales:view'),
  ('role_cashier', 'sales:create'),
  ('role_cashier', 'sales:post'),
  ('role_cashier', 'documents:view'),
  ('role_cashier', 'documents:create_sale'),
  ('role_cashier', 'documents:post'),
  ('role_cashier', 'customers:manage'),
  ('role_cashier', 'parties:view'),
  ('role_cashier', 'products:view'),
  ('role_cashier', 'inventory:view');

-- 9. Seed permissions for TREASURY_ACCOUNTANT
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES
  ('role_treasury', 'pos:access'),
  ('role_treasury', 'pos:shift_close'),
  ('role_treasury', 'pos:cash_movement'),
  ('role_treasury', 'sales:view'),
  ('role_treasury', 'expenses:manage'),
  ('role_treasury', 'payments:manage'),
  ('role_treasury', 'finance:view'),
  ('role_treasury', 'finance:payments'),
  ('role_treasury', 'finance:expenses'),
  ('role_treasury', 'finance:accounts'),
  ('role_treasury', 'reports:view');

-- 10. Seed POS permissions for ADMIN and BRANCH_MANAGER
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES
  ('role_admin', 'pos:access'),
  ('role_admin', 'pos:shift_open'),
  ('role_admin', 'pos:shift_close'),
  ('role_admin', 'pos:cash_movement'),
  ('role_admin', 'pos:discount'),
  ('role_branch_mgr', 'pos:access'),
  ('role_branch_mgr', 'pos:shift_open'),
  ('role_branch_mgr', 'pos:shift_close'),
  ('role_branch_mgr', 'pos:cash_movement'),
  ('role_branch_mgr', 'pos:discount');
