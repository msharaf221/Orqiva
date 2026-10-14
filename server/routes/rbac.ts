import { Router } from 'express';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { all, id, now, one, run, transaction } from '../db';
import { AppError, audit, requireRow } from '../service';
import { assignedBranches } from '../middleware';
import {
  listPermissions,
  listPermissionsCatalog,
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  getUserPermissions,
  getUserPermissionOverrides,
  setUserPermissionOverrides,
  requirePermission,
} from '../rbac';
import { createRoleSchema, updateRoleSchema, userSchema } from '../validation';
import type { User } from '../../src/types';

export const rbacRouter = Router();

// Permissions catalog
rbacRouter.get('/permissions', (_req, res) => res.json(listPermissions()));
rbacRouter.get('/permissions/catalog', (_req, res) => res.json(listPermissionsCatalog()));

// Role management
rbacRouter.get('/roles', requirePermission('users:manage'), (_req, res) => res.json(listRoles()));

rbacRouter.get('/roles/:id', requirePermission('users:manage'), (req, res) =>
  res.json(getRole(String(req.params.id))),
);

rbacRouter.post('/roles', requirePermission('users:manage'), (req, res) => {
  const p = createRoleSchema.parse(req.body);
  res.status(201).json(createRole(p, req.user));
});

rbacRouter.put('/roles/:id', requirePermission('users:manage'), (req, res) => {
  const p = updateRoleSchema.parse(req.body);
  res.json(updateRole(String(req.params.id), p, req.user));
});

rbacRouter.delete('/roles/:id', requirePermission('users:manage'), (req, res) => {
  res.json(deleteRole(String(req.params.id), req.user));
});

// Audit logs
rbacRouter.get('/audit', requirePermission('users:manage'), (_req, res) =>
  res.json(all('SELECT * FROM audit_logs ORDER BY created_at DESC,rowid DESC LIMIT 500')),
);

// User management
rbacRouter.get('/users', requirePermission('users:manage'), (_req, res) =>
  res.json(
    all<User & { role_name?: string }>(
      `SELECT u.id,u.name,u.email,
              COALESCE(u.role, r.code) as role,
              ur.role_id,u.active,u.created_at,
              COALESCE(r.name, CASE WHEN u.role = 'ADMIN' THEN 'مدير النظام' ELSE 'موظف مبيعات' END) as role_name
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       ORDER BY u.created_at`,
    ).map((u) => ({
      ...u,
      permissions: getUserPermissions(u),
      branch_ids: assignedBranches(u.id),
    })),
  ),
);

rbacRouter.post('/users', requirePermission('users:manage'), async (req, res) => {
  const p = userSchema.parse(req.body);
  const password = await hash(p.password, 12);
  const userId = id();
  let roleId = p.role_id;
  let roleCode = p.role;
  if (roleId) {
    const r = one<{ id: string; code: string }>('SELECT id, code FROM roles WHERE id=?', roleId);
    if (r) roleCode = r.code;
  } else if (p.role === 'ADMIN') {
    roleId = 'role_admin';
  } else if (p.role === 'STAFF' || p.role === 'SALES') {
    roleId = 'role_sales';
  } else {
    const r = one<{ id: string; code: string }>(
      'SELECT id, code FROM roles WHERE code=? OR id=?',
      p.role,
      p.role,
    );
    if (r) {
      roleId = r.id;
      roleCode = r.code;
    }
  }
  const dbUserRole = roleCode || 'STAFF';
  const finalRoleId = roleId || (roleCode === 'ADMIN' ? 'role_admin' : 'role_sales');

  transaction(() => {
    run(
      'INSERT INTO users(id,name,email,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,?)',
      userId,
      p.name,
      p.email,
      password,
      dbUserRole,
      1,
      now(),
    );
    run('INSERT OR REPLACE INTO user_roles(user_id, role_id) VALUES(?,?)', userId, finalRoleId);
    for (const branchId of dbUserRole === 'ADMIN' ? [] : p.branch_ids) {
      run(
        'INSERT OR IGNORE INTO user_branches(user_id,branch_id) VALUES(?,?)',
        userId,
        requireRow(one<{ id: string }>('SELECT id FROM branches WHERE id=?', branchId)).id,
      );
    }
    audit(req.user, 'إضافة مستخدم', 'USER', userId, p.name);
  });
  const created = one<User>(
    `SELECT u.id,u.name,u.email,
            COALESCE(u.role, r.code) as role,
            ur.role_id,u.active,u.created_at,
            COALESCE(r.name, CASE WHEN u.role = 'ADMIN' THEN 'مدير النظام' ELSE 'موظف مبيعات' END) as role_name
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.id=?`,
    userId,
  );
  res.status(201).json({
    ...created,
    permissions: created ? getUserPermissions(created) : [],
  });
});

rbacRouter.patch('/users/:id', requirePermission('users:manage'), (req, res) => {
  const userId = String(req.params.id);
  const input = z
    .object({
      active: z.boolean().optional(),
      role: z.string().min(1).optional(),
      role_id: z.string().optional(),
      branch_ids: z.array(z.string()).optional(),
    })
    .strict()
    .parse(req.body);

  if (userId === req.user.id) {
    throw new AppError(400, 'لا يمكنك تغيير صلاحيات أو تعطيل حسابك الحالي');
  }

  const user = requireRow(
    one<{ id: string; role: string; role_id: string | null; active: number }>(
      `SELECT u.id, u.role, ur.role_id, u.active
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       WHERE u.id=?`,
      userId,
    ),
  );

  let newRole = input.role !== undefined ? input.role : user.role;
  let newRoleId = input.role_id !== undefined ? input.role_id : user.role_id;
  if (input.role_id && !input.role) {
    const r = one<{ code: string }>('SELECT code FROM roles WHERE id=?', input.role_id);
    if (r) newRole = r.code;
  } else if (input.role && !input.role_id) {
    if (input.role === 'ADMIN') newRoleId = 'role_admin';
    else if (input.role === 'STAFF') newRoleId = 'role_sales';
    else {
      const r = one<{ id: string }>('SELECT id FROM roles WHERE code=?', input.role);
      if (r) newRoleId = r.id;
    }
  }
  const dbUserRole = newRole || 'STAFF';
  const finalRoleId = newRoleId || (newRole === 'ADMIN' ? 'role_admin' : 'role_sales');
  const newActive = input.active !== undefined ? (input.active ? 1 : 0) : user.active;

  transaction(() => {
    run('UPDATE users SET active=?,role=? WHERE id=?', newActive, dbUserRole, userId);
    run('INSERT OR REPLACE INTO user_roles(user_id, role_id) VALUES(?,?)', userId, finalRoleId);
    if (input.branch_ids !== undefined) {
      run('DELETE FROM user_branches WHERE user_id=?', userId);
      if (dbUserRole !== 'ADMIN') {
        for (const bId of input.branch_ids) {
          run('INSERT OR IGNORE INTO user_branches(user_id,branch_id) VALUES(?,?)', userId, bId);
        }
      }
    }
    run('DELETE FROM sessions WHERE user_id=?', userId);
    audit(req.user, 'تعديل صلاحيات مستخدم', 'USER', userId);
  });
  res.json({ ok: true });
});

rbacRouter.get('/users/:id/permissions', requirePermission('users:manage'), (req, res) => {
  const u = requireRow(
    one<{ id: string; role: string; role_id: string | null }>(
      'SELECT id, role FROM users WHERE id=?',
      String(req.params.id),
    ),
  );
  res.json({
    role: u.role,
    effective: getUserPermissions(u),
    overrides: getUserPermissionOverrides(u.id),
  });
});

rbacRouter.put('/users/:id/permissions', requirePermission('users:manage'), (req, res) => {
  res.json(setUserPermissionOverrides(String(req.params.id), req.body, req.user));
});
