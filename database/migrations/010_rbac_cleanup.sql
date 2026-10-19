-- Migration 010: RBAC cleanup — جدول role_permissions هو مصدر الحقيقة الوحيد للمصطلحات

-- 1) دور GENERAL_ACCOUNTANT أُنشئ في 008 بصفر صلاحيات (كل من يحمل هذا الدور كان معطلاً).
--    يُصبح مرآة لدور ACCOUNTANT إضافةً إلى إنشاء وإلغاء وثائق المشتريات (كما في وصف الدور).
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES
  ('role_gen_acc', 'documents:view'),
  ('role_gen_acc', 'documents:create_sale'),
  ('role_gen_acc', 'documents:create_purchase'),
  ('role_gen_acc', 'documents:post'),
  ('role_gen_acc', 'documents:cancel'),
  ('role_gen_acc', 'parties:view'),
  ('role_gen_acc', 'parties:manage'),
  ('role_gen_acc', 'inventory:view'),
  ('role_gen_acc', 'finance:view'),
  ('role_gen_acc', 'finance:payments'),
  ('role_gen_acc', 'finance:expenses'),
  ('role_gen_acc', 'finance:accounts'),
  ('role_gen_acc', 'reports:view'),
  ('role_gen_acc', 'reports:group_overview');

-- 2) الحفاظ على الوصول الفعلي القديم لموظفي المبيعات: الـAPI سمح لهم دائماً بحركة المخزون
--    بين الفروع المسندة إليهم (tests/transfers.test.ts)، فتصبح الصلاحية صريحة بدل غير مفحوصة.
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES
  ('role_sales', 'transfers:manage');

-- 3) توحيد المفردات: استبدال معرفات الصلاحيات القديمة بمكافئاتها الحديثة في الكتالوج.
INSERT OR IGNORE INTO role_permissions (role_id, permission)
SELECT role_id, CASE permission
  WHEN 'sales:view' THEN 'documents:view'
  WHEN 'sales:create' THEN 'documents:create_sale'
  WHEN 'sales:post' THEN 'documents:post'
  WHEN 'sales:cancel' THEN 'documents:cancel'
  WHEN 'purchases:view' THEN 'documents:view'
  WHEN 'purchases:create' THEN 'documents:create_purchase'
  WHEN 'purchases:post' THEN 'documents:post'
  WHEN 'purchases:cancel' THEN 'documents:cancel'
  WHEN 'products:view' THEN 'inventory:view'
  WHEN 'products:manage' THEN 'catalog:manage'
  WHEN 'customers:manage' THEN 'parties:manage'
  WHEN 'suppliers:manage' THEN 'parties:manage'
  WHEN 'expenses:manage' THEN 'finance:expenses'
  WHEN 'payments:manage' THEN 'finance:payments'
  WHEN 'distributions:manage' THEN 'distribution:manage'
  ELSE permission
END
FROM role_permissions
WHERE permission IN (
  'sales:view','sales:create','sales:post','sales:cancel',
  'purchases:view','purchases:create','purchases:post','purchases:cancel',
  'products:view','products:manage','customers:manage','suppliers:manage',
  'expenses:manage','payments:manage','distributions:manage'
);

-- حذف المعرفات القديمة (company:manage وaudit:view لم يكونا جزءاً من الكتالوج قط).
DELETE FROM role_permissions
WHERE permission IN (
  'sales:view','sales:create','sales:post','sales:cancel',
  'purchases:view','purchases:create','purchases:post','purchases:cancel',
  'products:view','products:manage','customers:manage','suppliers:manage',
  'expenses:manage','payments:manage','distributions:manage',
  'company:manage','audit:view'
);

-- 4) توحيد مفاتيح الاستثناءات الفردية للمستخدمين (نفس التطبيع للكتالوج).
UPDATE OR IGNORE user_permission_overrides SET permission = CASE permission
  WHEN 'sales:view' THEN 'documents:view'
  WHEN 'sales:create' THEN 'documents:create_sale'
  WHEN 'sales:post' THEN 'documents:post'
  WHEN 'sales:cancel' THEN 'documents:cancel'
  WHEN 'purchases:view' THEN 'documents:view'
  WHEN 'purchases:create' THEN 'documents:create_purchase'
  WHEN 'purchases:post' THEN 'documents:post'
  WHEN 'purchases:cancel' THEN 'documents:cancel'
  WHEN 'products:view' THEN 'inventory:view'
  WHEN 'products:manage' THEN 'catalog:manage'
  WHEN 'customers:manage' THEN 'parties:manage'
  WHEN 'suppliers:manage' THEN 'parties:manage'
  WHEN 'expenses:manage' THEN 'finance:expenses'
  WHEN 'payments:manage' THEN 'finance:payments'
  WHEN 'distributions:manage' THEN 'distribution:manage'
  ELSE permission
END
WHERE permission IN (
  'sales:view','sales:create','sales:post','sales:cancel',
  'purchases:view','purchases:create','purchases:post','purchases:cancel',
  'products:view','products:manage','customers:manage','suppliers:manage',
  'expenses:manage','payments:manage','distributions:manage'
);

DELETE FROM user_permission_overrides
WHERE permission IN (
  'sales:view','sales:create','sales:post','sales:cancel',
  'purchases:view','purchases:create','purchases:post','purchases:cancel',
  'products:view','products:manage','customers:manage','suppliers:manage',
  'expenses:manage','payments:manage','distributions:manage',
  'company:manage','audit:view'
);

-- 5) ربط أي مستخدم بلا صف في user_roles (كما في 007).
INSERT OR IGNORE INTO user_roles (user_id, role_id)
  SELECT id, CASE WHEN role = 'ADMIN' THEN 'role_admin' ELSE 'role_sales' END FROM users;
