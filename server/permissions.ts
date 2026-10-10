import type { Request, Response, NextFunction } from 'express';
import { all, one, run, transaction, now } from './db';
import { AppError } from './errors';
import { audit } from './service';
import type { Role, PermissionKey, User } from '../src/types';

export interface PermissionDefinition {
  key: PermissionKey;
  label: string;
  category: string;
  description: string;
}

export const ALL_PERMISSIONS: PermissionDefinition[] = [
  // المبيعات
  {
    key: 'sales:view',
    category: 'المبيعات',
    label: 'استعراض فواتير المبيعات',
    description: 'الاطلاع على قائمة وتفاصيل فواتير البيع ومسوداتها',
  },
  {
    key: 'sales:create',
    category: 'المبيعات',
    label: 'إنشاء وتعديل فواتير المبيعات',
    description: 'تسجيل مسودات مبيعات جديدة وتعديل المسودات غير المعتمدة',
  },
  {
    key: 'sales:post',
    category: 'المبيعات',
    label: 'اعتماد فواتير المبيعات',
    description: 'اعتماد الفاتورة وتأثيرها على المخزون وحساب العميل',
  },
  {
    key: 'sales:cancel',
    category: 'المبيعات',
    label: 'إلغاء فواتير المبيعات',
    description: 'إلغاء فواتير المبيعات المعتمدة وعكس حركات المخزون',
  },

  // نقطة البيع POS
  {
    key: 'pos:access',
    category: 'نقطة البيع (POS)',
    label: 'دخول شاشة الكاشير (POS)',
    description: 'فتح واجهة نقطة البيع السريعة وبيع المنتجات',
  },
  {
    key: 'pos:shift_open',
    category: 'نقطة البيع (POS)',
    label: 'افتتاح وردية كاشير',
    description: 'بدء وردية جديدة برصيد نقدي افتتاحي في الدرج',
  },
  {
    key: 'pos:shift_close',
    category: 'نقطة البيع (POS)',
    label: 'إغلاق ومطابقة الوردية',
    description: 'إنهاء الوردية وجرد النقدية الفعلية ومطابقتها مع المبيعات',
  },
  {
    key: 'pos:cash_movement',
    category: 'نقطة البيع (POS)',
    label: 'تسجيل إيداع / سحب بالوردية',
    description: 'إدخال أو إخراج سيولة نقدية من درج الكاشير أثناء الوردية',
  },
  {
    key: 'pos:discount',
    category: 'نقطة البيع (POS)',
    label: 'تطبيق خصم في نقطة البيع',
    description: 'تطبيق خصومات فورية على سلة البيع في نقطة البيع',
  },

  // المشتريات
  {
    key: 'purchases:view',
    category: 'المشتريات',
    label: 'استعراض فواتير المشتريات',
    description: 'عرض فواتير الشراء من الموردين ومسوداتها',
  },
  {
    key: 'purchases:create',
    category: 'المشتريات',
    label: 'إنشاء وتعديل فواتير الشراء',
    description: 'تسجيل مسودات أوامر الشراء وتعديلها',
  },
  {
    key: 'purchases:post',
    category: 'المشتريات',
    label: 'اعتماد فواتير المشتريات',
    description: 'اعتماد فاتورة الشراء وزيادة المخزون وتأكيد حساب المورد',
  },
  {
    key: 'purchases:cancel',
    category: 'المشتريات',
    label: 'إلغاء فواتير المشتريات',
    description: 'إلغاء فواتير المشتريات غير المدفوعة',
  },

  // المنتجات والمخزون
  {
    key: 'products:view',
    category: 'المنتجات والمخزون',
    label: 'عرض كتالوج المنتجات',
    description: 'استعراض الكتالوج والأسعار وتوفر المنتجات بالفروع',
  },
  {
    key: 'products:manage',
    category: 'المنتجات والمخزون',
    label: 'إدارة المنتجات والأسعار',
    description: 'إضافة منتجات وتعديل أسعارها وتكاليفها وأرشفتها',
  },
  {
    key: 'inventory:adjust',
    category: 'المنتجات والمخزون',
    label: 'تسوية الجرد والمخزون',
    description: 'تعديل أرصدة المخزون بالزيادة أو النقصان عند الجرد',
  },
  {
    key: 'transfers:manage',
    category: 'المنتجات والمخزون',
    label: 'إدارة التحويلات بين الفروع',
    description: 'إنشاء وشحن واستلام أو إلغاء بضاعة منقولة بين الفروع',
  },

  // العملاء والموردون
  {
    key: 'customers:manage',
    category: 'العملاء والموردون',
    label: 'إدارة حسابات العملاء',
    description: 'إضافة وتعديل بيانات العملاء وكشوف الحساب',
  },
  {
    key: 'suppliers:manage',
    category: 'العملاء والموردون',
    label: 'إدارة حسابات الموردين',
    description: 'إضافة وتعديل حسابات الموردين وبياناتهم',
  },

  // المالية والخزينة
  {
    key: 'expenses:manage',
    category: 'المالية والخزينة',
    label: 'تسجيل وإدارة المصروفات',
    description: 'تسجيل بنود المصروفات التشغيلية والفرعية والمشتركة',
  },
  {
    key: 'payments:manage',
    category: 'المالية والخزينة',
    label: 'تسجيل التحصيلات والمدفوعات',
    description: 'تسجيل دفعات الفواتير النقدية والبنكية والإلكترونية',
  },
  {
    key: 'reports:view',
    category: 'المالية والخزينة',
    label: 'عرض التقارير والتحليلات',
    description: 'الاطلاع على تقارير الأرباح والمبيعات والمصروفات والتدفقات',
  },
  {
    key: 'distributions:manage',
    category: 'المالية والخزينة',
    label: 'إدارة أرباح الشركاء والتوزيعات',
    description: 'حساب واعتماد وصرف توزيعات أرباح الملاك',
  },

  // النظام والإدارة
  {
    key: 'branches:manage',
    category: 'النظام والإدارة',
    label: 'إدارة الفروع وتشكيلة المنتجات',
    description: 'إنشاء وتعديل الفروع وتعيين الموظفين وتخصيص أسعار الفروع',
  },
  {
    key: 'users:manage',
    category: 'النظام والإدارة',
    label: 'إدارة المستخدمين والصلاحيات',
    description: 'إضافة موظفين، وتحديد أدوارهم وتخصيص صلاحياتهم الفردية',
  },
  {
    key: 'company:manage',
    category: 'النظام والإدارة',
    label: 'إعدادات الشركة والضرائب',
    description: 'تعديل اسم الشركة، عنوانها، نسب الضريبة وبيانات الفاتورة',
  },
  {
    key: 'audit:view',
    category: 'النظام والإدارة',
    label: 'استعراض سجل النشاط والرقابة',
    description: 'استعراض الحركات وسجلات العمليات المنفذة في النظام',
  },
];

export const ALL_PERMISSION_KEYS: PermissionKey[] = ALL_PERMISSIONS.map((p) => p.key);

export const ROLE_DEFAULT_PERMISSIONS: Record<Role, PermissionKey[]> = {
  ADMIN: ALL_PERMISSION_KEYS,

  BRANCH_MANAGER: [
    'sales:view',
    'sales:create',
    'sales:post',
    'sales:cancel',
    'pos:access',
    'pos:shift_open',
    'pos:shift_close',
    'pos:cash_movement',
    'pos:discount',
    'purchases:view',
    'purchases:create',
    'purchases:post',
    'products:view',
    'products:manage',
    'inventory:adjust',
    'transfers:manage',
    'customers:manage',
    'suppliers:manage',
    'expenses:manage',
    'payments:manage',
    'reports:view',
  ],

  GENERAL_ACCOUNTANT: [
    'sales:view',
    'sales:post',
    'purchases:view',
    'purchases:create',
    'purchases:post',
    'purchases:cancel',
    'products:view',
    'customers:manage',
    'suppliers:manage',
    'expenses:manage',
    'payments:manage',
    'reports:view',
    'distributions:manage',
  ],

  TREASURY_ACCOUNTANT: [
    'sales:view',
    'pos:access',
    'pos:shift_close',
    'pos:cash_movement',
    'expenses:manage',
    'payments:manage',
    'reports:view',
  ],

  CASHIER: [
    'sales:view',
    'sales:create',
    'sales:post',
    'pos:access',
    'pos:shift_open',
    'pos:shift_close',
    'pos:cash_movement',
    'pos:discount',
    'customers:manage',
    'products:view',
  ],

  STAFF: ['sales:view', 'sales:create', 'sales:post', 'customers:manage', 'products:view'],
};

/**
 * Returns raw individual overrides saved for a user.
 * { "expenses:manage": true, "sales:post": false }
 */
export function getUserPermissionOverrides(userId: string): Record<string, boolean> {
  const rows = all<{ permission: string; granted: number }>(
    'SELECT permission, granted FROM user_permission_overrides WHERE user_id=?',
    userId,
  );
  const result: Record<string, boolean> = {};
  for (const r of rows) {
    result[r.permission] = r.granted === 1;
  }
  return result;
}

/**
 * Resolves the effective list of granted permissions for a user:
 * 1. Admin always has ALL permissions.
 * 2. Other roles start from ROLE_DEFAULT_PERMISSIONS[role].
 * 3. Individual overrides are applied (granting or revoking).
 */
export function getEffectivePermissions(user: Pick<User, 'id' | 'role'>): PermissionKey[] {
  if (user.role === 'ADMIN') {
    return [...ALL_PERMISSION_KEYS];
  }

  const basePermissions = new Set<PermissionKey>(ROLE_DEFAULT_PERMISSIONS[user.role] || []);
  const overrides = getUserPermissionOverrides(user.id);

  for (const [permKey, isGranted] of Object.entries(overrides)) {
    const key = permKey as PermissionKey;
    if (ALL_PERMISSION_KEYS.includes(key)) {
      if (isGranted) {
        basePermissions.add(key);
      } else {
        basePermissions.delete(key);
      }
    }
  }

  return Array.from(basePermissions);
}

/**
 * Checks whether user has a specific permission or any of the given permissions.
 */
export function hasPermission(
  user: Pick<User, 'id' | 'role'>,
  required: PermissionKey | PermissionKey[],
): boolean {
  if (user.role === 'ADMIN') return true;
  const effective = getEffectivePermissions(user);
  if (Array.isArray(required)) {
    return required.some((perm) => effective.includes(perm));
  }
  return effective.includes(required);
}

/**
 * Express middleware to enforce granular permissions on API requests.
 */
export function requirePermission(...required: PermissionKey[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new AppError(401, 'يرجى تسجيل الدخول للمتابعة');
    }
    if (req.user.role === 'ADMIN') {
      return next();
    }
    if (!hasPermission(req.user, required)) {
      const missingLabels = required
        .map((k) => ALL_PERMISSIONS.find((p) => p.key === k)?.label || k)
        .join(' أو ');
      throw new AppError(403, `ليس لديك صلاحية لتنفيذ هذه العملية (${missingLabels})`);
    }
    next();
  };
}

/**
 * Admin action to save customized permission overrides for a user.
 */
export function setUserPermissionOverrides(
  userId: string,
  overrides: Record<string, boolean | null>,
  actor: Pick<User, 'id' | 'name'>,
) {
  const targetUser = one<{ id: string; name: string; role: Role }>(
    'SELECT id, name, role FROM users WHERE id=?',
    userId,
  );
  if (!targetUser) throw new AppError(404, 'المستخدم غير موجود');

  transaction(() => {
    run('DELETE FROM user_permission_overrides WHERE user_id=?', userId);
    for (const [permKey, val] of Object.entries(overrides)) {
      if (
        val !== null &&
        typeof val === 'boolean' &&
        ALL_PERMISSION_KEYS.includes(permKey as PermissionKey)
      ) {
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
    effective: getEffectivePermissions({ id: userId, role: targetUser.role }),
  };
}
