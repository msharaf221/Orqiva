import { all, one, run, transaction, id, now } from './db';
import { AppError } from './errors';
import { audit, type Actor } from './service';
import type { PermissionDef, RoleDef } from '../src/types';
import type { Request, Response, NextFunction } from 'express';

export const PERMISSIONS: PermissionDef[] = [
  // نقطة البيع POS
  { id: 'pos:access', name: 'دخول شاشة الكاشير ونقطة البيع (POS)', group: 'نقطة البيع (POS)' },
  { id: 'pos:shift_open', name: 'افتتاح وردية كاشير جديدة', group: 'نقطة البيع (POS)' },
  { id: 'pos:shift_close', name: 'إغلاق واعتماد وردية الكاشير وترحيل الفروقات', group: 'نقطة البيع (POS)' },
  { id: 'pos:cash_movement', name: 'تسجيل حركات السحب والإيداع النقدي بالوردية', group: 'نقطة البيع (POS)' },
  { id: 'pos:discount', name: 'تطبيق خصومات في نقطة البيع', group: 'نقطة البيع (POS)' },

  // المستندات والمبيعات والمشتريات
  { id: 'documents:view', name: 'عرض الفواتير والمستندات', group: 'المستندات' },
  { id: 'documents:create_sale', name: 'إنشاء فواتير ومرتجعات بيع', group: 'المستندات' },
  { id: 'documents:create_purchase', name: 'إنشاء فواتير ومرتجعات شراء', group: 'المستندات' },
  { id: 'documents:post', name: 'اعتماد وترحيل الفواتير', group: 'المستندات' },
  { id: 'documents:cancel', name: 'إلغاء الفواتير والمستندات', group: 'المستندات' },

  // المخزون والأصناف والتحويلات
  { id: 'inventory:view', name: 'عرض المخزون وحركاته وتكاليفه', group: 'المخزون' },
  { id: 'inventory:adjust', name: 'تسوية المخزون وتعديل التكاليف', group: 'المخزون' },
  { id: 'catalog:manage', name: 'إدارة المنتجات وقائمة الأصناف والتسعير', group: 'المخزون' },
  { id: 'transfers:manage', name: 'إدارة تحويلات البضائع بين الفروع', group: 'المخزون' },

  // العملاء والموردين
  { id: 'parties:view', name: 'عرض العملاء والموردين', group: 'جهات التعامل' },
  { id: 'parties:manage', name: 'إدارة بيانات العملاء والموردين', group: 'جهات التعامل' },

  // المالية والخزائن
  { id: 'finance:view', name: 'عرض الحسابات النقدية والمصروفات', group: 'المالية' },
  { id: 'finance:payments', name: 'تسجيل مقبوضات ومدفوعات الفواتير', group: 'المالية' },
  { id: 'finance:expenses', name: 'إدارة وتسجيل المصروفات', group: 'المالية' },
  { id: 'finance:accounts', name: 'إدارة الخزائن والتحويلات النقدية', group: 'المالية' },

  // التقارير والمؤشرات
  { id: 'reports:view', name: 'عرض التقارير ولوحة المؤشرات', group: 'التقارير' },
  { id: 'reports:group_overview', name: 'عرض تقرير المجموعة الشامل', group: 'التقارير' },

  // الشركاء والتوزيعات
  { id: 'distribution:manage', name: 'إدارة الشركاء وتوزيع الأرباح وحقوق الملكية', group: 'الشركاء' },

  // الإدارة والنظام
  { id: 'branches:manage', name: 'إدارة الفروع وبيانات الشركة', group: 'الإدارة' },
  { id: 'users:manage', name: 'إدارة المستخدمين والأدوار والصلاحيات', group: 'الإدارة' },
];

export const ALL_PERMISSION_IDS = PERMISSIONS.map((p) => p.id);
ALL_PERMISSION_IDS.push(
  'admin:all',
  'sales:view',
  'sales:create',
  'sales:post',
  'sales:cancel',
  'purchases:view',
  'purchases:create',
  'purchases:post',
  'purchases:cancel',
  'products:view',
  'products:manage',
  'customers:manage',
  'suppliers:manage',
  'expenses:manage',
  'payments:manage',
  'distributions:manage',
  'company:manage',
  'audit:view',
);

export function listPermissions(): PermissionDef[] {
  return PERMISSIONS;
}

export interface PermissionCatalogItem {
  key: string;
  category: string;
  label: string;
  description: string;
}

export function listPermissionsCatalog(): PermissionCatalogItem[] {
  return PERMISSIONS.map((p) => ({
    key: p.id,
    category: p.group,
    label: p.name,
    description: p.name,
  }));
}

/** Returns saved individual user overrides from user_permission_overrides table */
export function getUserPermissionOverrides(userId: string): Record<string, boolean> {
  try {
    const rows = all<{ permission: string; granted: number }>(
      'SELECT permission, granted FROM user_permission_overrides WHERE user_id=?',
      userId,
    );
    const result: Record<string, boolean> = {};
    for (const r of rows) {
      result[r.permission] = r.granted === 1;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Resolves full effective permissions for a user:
 * 1. Admin gets ALL permissions unconditionally.
 * 2. Predefined roles get default permissions.
 * 3. Custom roles get role_permissions entries.
 * 4. User-specific overrides (user_permission_overrides) are applied.
 * 5. Canonical aliases are expanded for bidirectional compatibility.
 */
export function getUserPermissions(user: { id: string; role: string; role_id?: string | null }): string[] {
  if (user.role === 'ADMIN') {
    return Array.from(new Set(ALL_PERMISSION_IDS));
  }

  const permsSet = new Set<string>();

  // Resolve role permissions
  let roleId = user.role_id;
  if (!roleId) {
    const ur = one<{ role_id: string }>('SELECT role_id FROM user_roles WHERE user_id=?', user.id);
    if (ur) {
      roleId = ur.role_id;
    } else if (user.role === 'STAFF') {
      roleId = 'role_sales';
    } else if (user.role === 'CASHIER') {
      roleId = 'role_cashier';
    } else if (user.role === 'TREASURY_ACCOUNTANT') {
      roleId = 'role_treasury';
    } else if (user.role === 'GENERAL_ACCOUNTANT' || user.role === 'ACCOUNTANT') {
      roleId = 'role_accountant';
    } else if (user.role === 'BRANCH_MANAGER') {
      roleId = 'role_branch_mgr';
    } else {
      const match = one<{ id: string }>('SELECT id FROM roles WHERE code=? OR id=?', user.role, user.role);
      roleId = match?.id;
    }
  }

  if (roleId) {
    const rows = all<{ permission: string }>(
      'SELECT permission FROM role_permissions WHERE role_id=?',
      roleId,
    );
    for (const r of rows) {
      permsSet.add(r.permission);
    }
  }

  // Predefined role fallbacks if not yet migrated into role_permissions
  if (user.role === 'CASHIER') {
    ['pos:access', 'pos:shift_open', 'pos:shift_close', 'pos:cash_movement', 'pos:discount', 'documents:create_sale', 'documents:view', 'parties:view', 'inventory:view'].forEach(p => permsSet.add(p));
  } else if (user.role === 'TREASURY_ACCOUNTANT') {
    ['pos:access', 'pos:shift_close', 'pos:cash_movement', 'finance:expenses', 'finance:payments', 'finance:view', 'reports:view'].forEach(p => permsSet.add(p));
  } else if (user.role === 'STAFF') {
    ['documents:view', 'documents:create_sale', 'documents:post', 'parties:view', 'parties:manage', 'finance:view', 'finance:payments', 'inventory:view'].forEach(p => permsSet.add(p));
  }

  // Bidirectional alias helper
  const expandAliases = (key: string, add: boolean) => {
    const map: Record<string, string[]> = {
      'sales:view': ['documents:view'],
      'documents:view': ['sales:view', 'purchases:view'],
      'sales:create': ['documents:create_sale'],
      'documents:create_sale': ['sales:create'],
      'sales:post': ['documents:post'],
      'sales:cancel': ['documents:cancel'],
      'documents:cancel': ['sales:cancel', 'purchases:cancel'],
      'purchases:view': ['documents:view'],
      'purchases:create': ['documents:create_purchase'],
      'documents:create_purchase': ['purchases:create'],
      'purchases:post': ['documents:post'],
      'documents:post': ['sales:post', 'purchases:post'],
      'products:view': ['inventory:view'],
      'inventory:view': ['products:view'],
      'products:manage': ['catalog:manage'],
      'catalog:manage': ['products:manage'],
      'customers:manage': ['parties:manage'],
      'suppliers:manage': ['parties:manage'],
      'parties:manage': ['customers:manage', 'suppliers:manage'],
      'expenses:manage': ['finance:expenses'],
      'finance:expenses': ['expenses:manage'],
      'payments:manage': ['finance:payments'],
      'finance:payments': ['payments:manage'],
      'distributions:manage': ['distribution:manage'],
      'distribution:manage': ['distributions:manage'],
    };

    if (add) {
      permsSet.add(key);
      const aliases = map[key] || [];
      aliases.forEach(a => permsSet.add(a));
    } else {
      permsSet.delete(key);
      const aliases = map[key] || [];
      aliases.forEach(a => permsSet.delete(a));
    }
  };

  // Expand base role aliases
  const currentPerms = Array.from(permsSet);
  for (const p of currentPerms) {
    expandAliases(p, true);
  }

  // Apply individual overrides
  const overrides = getUserPermissionOverrides(user.id);
  for (const [permKey, isGranted] of Object.entries(overrides)) {
    expandAliases(permKey, isGranted);
  }

  return Array.from(permsSet);
}

export function getEffectivePermissions(user: { id: string; role: string; role_id?: string | null }): string[] {
  return getUserPermissions(user);
}

/**
 * Checks whether user has a specific permission or any in an array of required permissions.
 */
export function hasPermission(
  user: { role: string; permissions?: string[] } | null | undefined,
  permission: string | string[],
): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  if (user.permissions?.includes('admin:all')) return true;

  const perms = new Set(user.permissions || []);

  const checkSingle = (p: string) => {
    if (perms.has(p)) return true;
    if (p === 'sales:view' && perms.has('documents:view')) return true;
    if (p === 'sales:create' && perms.has('documents:create_sale')) return true;
    if (p === 'sales:post' && perms.has('documents:post')) return true;
    if (p === 'sales:cancel' && perms.has('documents:cancel')) return true;
    if (p === 'purchases:view' && perms.has('documents:view')) return true;
    if (p === 'purchases:create' && perms.has('documents:create_purchase')) return true;
    if (p === 'purchases:post' && perms.has('documents:post')) return true;
    if (p === 'purchases:cancel' && perms.has('documents:cancel')) return true;
    if (p === 'products:view' && perms.has('inventory:view')) return true;
    if (p === 'products:manage' && perms.has('catalog:manage')) return true;
    if ((p === 'customers:manage' || p === 'suppliers:manage') && perms.has('parties:manage')) return true;
    if (p === 'expenses:manage' && perms.has('finance:expenses')) return true;
    if (p === 'payments:manage' && perms.has('finance:payments')) return true;
    if (p === 'distributions:manage' && perms.has('distribution:manage')) return true;
    return false;
  };

  if (Array.isArray(permission)) {
    return permission.some(checkSingle);
  }
  return checkSingle(permission);
}

/**
 * Express middleware to enforce granular permissions on API routes.
 */
export function requirePermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new AppError(401, 'يرجى تسجيل الدخول للمتابعة');
    }
    if (hasPermission(req.user, permissions)) {
      return next();
    }
    const permDef = PERMISSIONS.find((p) => permissions.includes(p.id));
    const permName = permDef ? ` (${permDef.name})` : ` (${permissions.join(' أو ')})`;
    throw new AppError(403, `ليس لديك الصلاحية لتنفيذ هذه العملية${permName}`);
  };
}

/**
 * Saves customized permission overrides for a specific user.
 */
export function setUserPermissionOverrides(
  userId: string,
  overrides: Record<string, boolean | null>,
  actor: Pick<Actor, 'id' | 'name'>,
) {
  const targetUser = one<{ id: string; name: string; role: string }>(
    'SELECT id, name, role FROM users WHERE id=?',
    userId,
  );
  if (!targetUser) throw new AppError(404, 'المستخدم غير موجود');

  transaction(() => {
    run('DELETE FROM user_permission_overrides WHERE user_id=?', userId);
    for (const [permKey, val] of Object.entries(overrides)) {
      if (val !== null && typeof val === 'boolean') {
        run(
          'INSERT INTO user_permission_overrides(user_id, permission, granted, created_at) VALUES(?,?,?,?)',
          userId,
          permKey,
          val ? 1 : 0,
          now(),
        );
      }
    }
    audit(actor, 'تخصيص صلاحيات المستخدم', 'USER', userId, targetUser.name);
  });

  return {
    overrides: getUserPermissionOverrides(userId),
    effective: getUserPermissions(targetUser),
  };
}

export function listRoles(): RoleDef[] {
  const roles = all<{
    id: string;
    name: string;
    code: string;
    description: string;
    is_system: number;
    created_at: string;
    user_count: number;
  }>(`
    SELECT r.id, r.name, r.code, r.description, r.is_system, r.created_at,
           (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) as user_count
    FROM roles r
    ORDER BY r.is_system DESC, r.created_at ASC
  `);

  const permissionsMap = new Map<string, string[]>();
  const allRolePerms = all<{ role_id: string; permission: string }>(
    'SELECT role_id, permission FROM role_permissions',
  );
  for (const { role_id, permission } of allRolePerms) {
    const list = permissionsMap.get(role_id) || [];
    list.push(permission);
    permissionsMap.set(role_id, list);
  }

  return roles.map((r) => ({
    ...r,
    permissions: r.code === 'ADMIN' ? [...ALL_PERMISSION_IDS] : permissionsMap.get(r.id) || [],
  }));
}

export function getRole(roleId: string): RoleDef {
  const role = one<{
    id: string;
    name: string;
    code: string;
    description: string;
    is_system: number;
    created_at: string;
    user_count: number;
  }>(
    `SELECT r.id, r.name, r.code, r.description, r.is_system, r.created_at,
            (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) as user_count
     FROM roles r WHERE r.id=? OR r.code=?`,
    roleId,
    roleId,
  );
  if (!role) throw new AppError(404, 'الدور غير موجود');

  const permissions =
    role.code === 'ADMIN'
      ? [...ALL_PERMISSION_IDS]
      : all<{ permission: string }>(
          'SELECT permission FROM role_permissions WHERE role_id=?',
          role.id,
        ).map((p) => p.permission);

  return { ...role, permissions };
}

export function createRole(
  input: { name: string; code?: string; description?: string; permissions: string[] },
  actor: Actor,
): RoleDef {
  const existingName = one('SELECT id FROM roles WHERE name=?', input.name.trim());
  if (existingName) throw new AppError(400, 'يوجد دور مسجل بنفس هذا الاسم مسبقاً');

  const roleId = id();
  const code = (
    input.code?.trim().toUpperCase() ||
    `ROLE_${Date.now().toString(36).toUpperCase()}`
  );

  const existingCode = one('SELECT id FROM roles WHERE code=?', code);
  if (existingCode) throw new AppError(400, 'رمز الدور مستخدم لدور آخر');

  transaction(() => {
    run(
      'INSERT INTO roles(id, name, code, description, is_system, created_at) VALUES(?,?,?,?,?,?)',
      roleId,
      input.name.trim(),
      code,
      input.description?.trim() || '',
      0,
      now(),
    );

    for (const perm of input.permissions) {
      run('INSERT INTO role_permissions(role_id, permission) VALUES(?, ?)', roleId, perm);
    }

    audit(actor, 'إنشاء دور جديد', 'ROLE', roleId, input.name.trim());
  });

  return getRole(roleId);
}

export function updateRole(
  roleId: string,
  input: { name?: string; description?: string; permissions?: string[] },
  actor: Actor,
): RoleDef {
  const role = one<{ id: string; name: string; code: string; is_system: number }>(
    'SELECT id, name, code, is_system FROM roles WHERE id=?',
    roleId,
  );
  if (!role) throw new AppError(404, 'الدور غير موجود');

  if (role.code === 'ADMIN' && input.permissions && !input.permissions.includes('admin:all')) {
    input.permissions.push('admin:all');
  }

  if (input.name && input.name.trim() !== role.name) {
    const existing = one('SELECT id FROM roles WHERE name=? AND id<>?', input.name.trim(), roleId);
    if (existing) throw new AppError(400, 'اسم الدور مستخدم لدور آخر');
  }

  transaction(() => {
    if (input.name !== undefined || input.description !== undefined) {
      run(
        'UPDATE roles SET name=COALESCE(?, name), description=COALESCE(?, description) WHERE id=?',
        input.name !== undefined ? input.name.trim() : null,
        input.description !== undefined ? input.description.trim() : null,
        roleId,
      );
    }

    if (input.permissions !== undefined && role.code !== 'ADMIN') {
      run('DELETE FROM role_permissions WHERE role_id=?', roleId);
      for (const perm of input.permissions) {
        run('INSERT INTO role_permissions(role_id, permission) VALUES(?, ?)', roleId, perm);
      }
    }

    audit(actor, 'تعديل دور', 'ROLE', roleId, input.name || role.name);
  });

  return getRole(roleId);
}

export function deleteRole(roleId: string, actor: Actor): { ok: true } {
  const role = one<{ id: string; name: string; is_system: number }>(
    'SELECT id, name, is_system FROM roles WHERE id=?',
    roleId,
  );
  if (!role) throw new AppError(404, 'الدور غير موجود');
  if (role.is_system) throw new AppError(400, 'لا يمكن حذف الأدوار القياسية للنظام');

  const countRow = one<{ count: number }>(
    'SELECT COUNT(*) as count FROM user_roles WHERE role_id=?',
    roleId,
  );
  if (countRow && countRow.count > 0) {
    throw new AppError(400, `لا يمكن حذف هذا الدور لوجود ${countRow.count} مستخدم مرتبط به`);
  }

  transaction(() => {
    run('DELETE FROM role_permissions WHERE role_id=?', roleId);
    run('DELETE FROM roles WHERE id=?', roleId);
    audit(actor, 'حذف دور', 'ROLE', roleId, role.name);
  });

  return { ok: true };
}
