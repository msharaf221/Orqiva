/**
 * Granular RBAC (الصلاحيات المخصصة وأدوار المستخدمين) — Integration Tests.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { seedUsers, signIn, resetBusinessData, header } from './helpers';

beforeAll(seedUsers);
beforeEach(resetBusinessData);

async function getAdmin() {
  return signIn('admin@test.local');
}

describe('Granular RBAC (الأدوار والصلاحيات المخصصة)', () => {
  it('exposes canonical permissions and seeded predefined roles', async () => {
    const admin = await getAdmin();

    const permRes = await admin.get('/api/permissions').set(header).expect(200);
    expect(Array.isArray(permRes.body)).toBe(true);
    expect(permRes.body.length).toBeGreaterThanOrEqual(15);
    const permIds = permRes.body.map((p: any) => p.id);
    expect(permIds).toContain('documents:create_sale');
    expect(permIds).toContain('documents:create_purchase');
    expect(permIds).toContain('documents:cancel');
    expect(permIds).toContain('finance:accounts');
    expect(permIds).toContain('inventory:adjust');

    const rolesRes = await admin.get('/api/roles').set(header).expect(200);
    expect(Array.isArray(rolesRes.body)).toBe(true);
    const roleCodes = rolesRes.body.map((r: any) => r.code);
    expect(roleCodes).toContain('ADMIN');
    expect(roleCodes).toContain('BRANCH_MANAGER');
    expect(roleCodes).toContain('ACCOUNTANT');
    expect(roleCodes).toContain('SALES');
    expect(roleCodes).toContain('WAREHOUSE');
    expect(roleCodes).toContain('VIEWER');
  });

  it('allows creating, updating, and deleting custom roles', async () => {
    const admin = await getAdmin();

    // Create custom role
    const createRes = await admin
      .post('/api/roles')
      .set(header)
      .send({
        name: 'مشرف مبيعات ممتاز',
        code: 'SALES_SUPERVISOR',
        description: 'صلاحيات مبيعات موسعة تشمل الإلغاء وعرض التقارير',
        permissions: ['documents:view', 'documents:create_sale', 'documents:post', 'documents:cancel', 'reports:view'],
      })
      .expect(201);

    expect(createRes.body.name).toBe('مشرف مبيعات ممتاز');
    expect(createRes.body.code).toBe('SALES_SUPERVISOR');
    expect(createRes.body.permissions).toEqual(
      expect.arrayContaining(['documents:create_sale', 'documents:cancel']),
    );
    const customRoleId = createRes.body.id;

    // Update custom role
    const updateRes = await admin
      .put(`/api/roles/${customRoleId}`)
      .set(header)
      .send({
        description: 'وصف محدث لدور مشرف المبيعات',
        permissions: ['documents:view', 'documents:create_sale', 'documents:post'],
      })
      .expect(200);

    expect(updateRes.body.description).toBe('وصف محدث لدور مشرف المبيعات');
    expect(updateRes.body.permissions).not.toContain('documents:cancel');

    // System role cannot be deleted
    await admin.delete('/api/roles/role_admin').set(header).expect(400);

    // Custom role can be deleted when no users are assigned
    await admin.delete(`/api/roles/${customRoleId}`).set(header).expect(200);

    // Verify deletion
    await admin.get(`/api/roles/${customRoleId}`).set(header).expect(404);
  });

  it('enforces that a role cannot be deleted while assigned to active users', async () => {
    const admin = await getAdmin();

    // Create role
    const roleRes = await admin
      .post('/api/roles')
      .set(header)
      .send({
        name: 'مساعد مخزن مؤقت',
        permissions: ['inventory:view'],
      })
      .expect(201);

    const roleId = roleRes.body.id;

    // Create user with this role
    await admin
      .post('/api/users')
      .set(header)
      .send({
        name: 'مساعد المخزن',
        email: 'assistant@test.local',
        password: 'TestingPassword2026!',
        role_id: roleId,
        branch_ids: ['main'],
      })
      .expect(201);

    // Trying to delete role should fail
    const delRes = await admin.delete(`/api/roles/${roleId}`).set(header).expect(400);
    expect(delRes.body.error).toContain('مستخدم مرتبط');
  });

  it('authenticates user with granular permissions and enforces authorization', async () => {
    const admin = await getAdmin();

    // Create accountant user with ACCOUNTANT role
    const accountantUserRes = await admin
      .post('/api/users')
      .set(header)
      .send({
        name: 'محاسب الشركة',
        email: 'accountant@test.local',
        password: 'TestingPassword2026!',
        role_id: 'role_accountant',
        branch_ids: ['main'],
      })
      .expect(201);

    expect(accountantUserRes.body.role).toBe('ACCOUNTANT');

    // Sign in as accountant
    const accountant = await signIn('accountant@test.local');

    // /api/auth/me returns permissions array
    const meRes = await accountant.get('/api/auth/me').set(header).expect(200);
    expect(meRes.body.email).toBe('accountant@test.local');
    expect(meRes.body.permissions).toContain('finance:expenses');
    expect(meRes.body.permissions).toContain('finance:accounts');
    expect(meRes.body.permissions).not.toContain('documents:create_sale');

    // Accountant CAN record expenses
    await accountant
      .post('/api/expenses')
      .set(header)
      .send({
        title: 'فاتورة إنترنت',
        category: 'مرافق',
        amount: 50000,
        date: '2026-03-01',
        method: 'CASH',
        allocation: 'BRANCH',
        branch_id: 'main',
        notes: '',
      })
      .expect(201);

    // Accountant CANNOT create sales invoice (lacks documents:create_sale)
    const saleBlockRes = await accountant
      .post('/api/documents')
      .set(header)
      .send({
        type: 'SALE',
        branch_id: 'main',
        party_id: 'any',
        date: '2026-03-01',
        due_date: '2026-03-15',
        discount: 0,
        tax_rate: 0,
        notes: '',
        lines: [],
      })
      .expect(403);
    expect(saleBlockRes.body.error).toContain('صلاحية');

    // Accountant CANNOT manage users
    await accountant.get('/api/users').set(header).expect(403);
  });

  it('restricts sales staff from cancelling invoices unless granted documents:cancel', async () => {
    const admin = await getAdmin();
    const staff = await signIn('staff@test.local');

    // Create a customer & product first
    const custRes = await admin
      .post('/api/parties')
      .set(header)
      .send({ type: 'CUSTOMER', name: 'عميل الصلاحيات', phone: '', email: '', address: '', tax_number: '', notes: '' })
      .expect(201);

    const prodRes = await admin
      .post('/api/products')
      .set(header)
      .send({ sku: 'RBAC-01', name: 'منتج رباك', category: 'عام', unit: 'قطعة', sale_price: 15000, cost_price: 10000, min_stock: 0 })
      .expect(201);

    // Stock up product
    await admin
      .post(`/api/products/${prodRes.body.id}/adjust`)
      .set(header)
      .send({ branch_id: 'main', quantity: 10, reason: 'رصيد أولي' })
      .expect(200);

    // Staff CAN create sales draft
    const docRes = await staff
      .post('/api/documents')
      .set(header)
      .send({
        type: 'SALE',
        branch_id: 'main',
        party_id: custRes.body.id,
        date: '2026-03-01',
        due_date: '2026-03-15',
        discount: 0,
        tax_rate: 0,
        notes: '',
        lines: [{ product_id: prodRes.body.id, quantity: 1, unit_price: 15000 }],
      })
      .expect(201);

    // Staff attempts to cancel document -> blocked with 403
    await staff.post(`/api/documents/${docRes.body.id}/cancel`).set(header).expect(403);

    // Admin CAN cancel document
    await admin.post(`/api/documents/${docRes.body.id}/cancel`).set(header).expect(200);
  });
});
