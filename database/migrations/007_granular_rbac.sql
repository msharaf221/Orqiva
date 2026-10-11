-- Granular RBAC (الأدوار والصلاحيات المخصصة)

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_system INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE INDEX idx_role_permissions_perm ON role_permissions(permission);

-- Link users to roles via user_roles table (preserves users table schema and CHECK constraint)
CREATE TABLE user_roles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE
);
CREATE INDEX idx_user_roles_role_id ON user_roles(role_id);

-- Seed predefined system roles
INSERT INTO roles (id, name, code, description, is_system, created_at) VALUES
  ('role_admin', 'مدير النظام', 'ADMIN', 'صلاحيات كاملة وغير مقيدة على كافة أقسام وفروع النظام', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('role_branch_mgr', 'مدير فرع', 'BRANCH_MANAGER', 'إدارة العمليات اليومية والمبيعات والمشتريات والمخزون للفروع التابعة', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('role_accountant', 'محاسب', 'ACCOUNTANT', 'إدارة الحسابات النقدية والخزائن والمصروفات ومقبوضات ومدفوعات الفواتير والتقارير المالية', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('role_sales', 'مبيعات', 'SALES', 'إصدار فواتير المبيعات وعرض العملاء وتحصيل الدفعات', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('role_warehouse', 'مخزني', 'WAREHOUSE', 'إدارة المخزون والتحويلات بين الفروع واستلام بضائع المشتريات', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('role_viewer', 'مشاهد', 'VIEWER', 'صلاحية قراءة واستعراض البيانات والتقارير فقط دون تعديل', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Backfill user_roles for existing records
INSERT OR IGNORE INTO user_roles (user_id, role_id)
  SELECT id, CASE WHEN role = 'ADMIN' THEN 'role_admin' ELSE 'role_sales' END
  FROM users;

-- Seed system permissions
-- ADMIN
INSERT INTO role_permissions (role_id, permission) VALUES
  ('role_admin', 'admin:all'),
  ('role_admin', 'documents:view'),
  ('role_admin', 'documents:create_sale'),
  ('role_admin', 'documents:create_purchase'),
  ('role_admin', 'documents:post'),
  ('role_admin', 'documents:cancel'),
  ('role_admin', 'inventory:view'),
  ('role_admin', 'inventory:adjust'),
  ('role_admin', 'catalog:manage'),
  ('role_admin', 'transfers:manage'),
  ('role_admin', 'parties:view'),
  ('role_admin', 'parties:manage'),
  ('role_admin', 'finance:view'),
  ('role_admin', 'finance:payments'),
  ('role_admin', 'finance:expenses'),
  ('role_admin', 'finance:accounts'),
  ('role_admin', 'reports:view'),
  ('role_admin', 'reports:group_overview'),
  ('role_admin', 'distribution:manage'),
  ('role_admin', 'branches:manage'),
  ('role_admin', 'users:manage');

-- BRANCH_MANAGER
INSERT INTO role_permissions (role_id, permission) VALUES
  ('role_branch_mgr', 'documents:view'),
  ('role_branch_mgr', 'documents:create_sale'),
  ('role_branch_mgr', 'documents:create_purchase'),
  ('role_branch_mgr', 'documents:post'),
  ('role_branch_mgr', 'documents:cancel'),
  ('role_branch_mgr', 'inventory:view'),
  ('role_branch_mgr', 'inventory:adjust'),
  ('role_branch_mgr', 'transfers:manage'),
  ('role_branch_mgr', 'parties:view'),
  ('role_branch_mgr', 'parties:manage'),
  ('role_branch_mgr', 'finance:view'),
  ('role_branch_mgr', 'finance:payments'),
  ('role_branch_mgr', 'finance:expenses'),
  ('role_branch_mgr', 'reports:view');

-- ACCOUNTANT
INSERT INTO role_permissions (role_id, permission) VALUES
  ('role_accountant', 'documents:view'),
  ('role_accountant', 'parties:view'),
  ('role_accountant', 'parties:manage'),
  ('role_accountant', 'finance:view'),
  ('role_accountant', 'finance:payments'),
  ('role_accountant', 'finance:expenses'),
  ('role_accountant', 'finance:accounts'),
  ('role_accountant', 'reports:view'),
  ('role_accountant', 'reports:group_overview');

-- SALES
INSERT INTO role_permissions (role_id, permission) VALUES
  ('role_sales', 'documents:view'),
  ('role_sales', 'documents:create_sale'),
  ('role_sales', 'documents:post'),
  ('role_sales', 'parties:view'),
  ('role_sales', 'parties:manage'),
  ('role_sales', 'finance:view'),
  ('role_sales', 'finance:payments'),
  ('role_sales', 'inventory:view');

-- WAREHOUSE
INSERT INTO role_permissions (role_id, permission) VALUES
  ('role_warehouse', 'inventory:view'),
  ('role_warehouse', 'inventory:adjust'),
  ('role_warehouse', 'transfers:manage'),
  ('role_warehouse', 'documents:view'),
  ('role_warehouse', 'documents:post');

-- VIEWER
INSERT INTO role_permissions (role_id, permission) VALUES
  ('role_viewer', 'documents:view'),
  ('role_viewer', 'inventory:view'),
  ('role_viewer', 'parties:view'),
  ('role_viewer', 'finance:view'),
  ('role_viewer', 'reports:view');
