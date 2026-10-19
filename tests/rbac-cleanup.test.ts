import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { all, run } from '../server/db';
import { header, seedUsers, signIn, resetBusinessData, PASSWORD } from './helpers';

type Agent = Awaited<ReturnType<typeof signIn>>;

/**
 * Guards the RBAC cleanup (migration 010 + server/rbac.ts simplification):
 * - the seeded GENERAL_ACCOUNTANT role now carries a real permission set,
 * - every page gated in the UI has an equivalent server-side check,
 * - legacy alias vocabulary is gone from role_permissions.
 */
describe('RBAC cleanup & server-side permission enforcement', () => {
  let admin: Agent;

  beforeAll(async () => {
    await seedUsers();
    admin = await signIn('admin@test.local');
  });
  beforeEach(() => resetBusinessData());

  async function createUser(email: string, roleCode: string): Promise<Agent> {
    await admin
      .post('/api/users')
      .set(header)
      .send({ name: roleCode, email, password: PASSWORD, role: roleCode, branch_ids: ['main'] })
      .expect(201);
    return signIn(email);
  }

  it('seeds GENERAL_ACCOUNTANT with real permissions (was powerless in 008)', async () => {
    const res = await admin
      .post('/api/users')
      .set(header)
      .send({
        name: 'محاسب عام',
        email: 'genacc@test.local',
        password: PASSWORD,
        role: 'GENERAL_ACCOUNTANT',
        branch_ids: ['main'],
      })
      .expect(201);

    expect(res.body.permissions).toContain('finance:expenses');
    expect(res.body.permissions).toContain('finance:accounts');
    expect(res.body.permissions).toContain('documents:create_purchase');
    expect(res.body.permissions).toContain('reports:group_overview');
    expect(res.body.permissions).not.toContain('users:manage');

    const genAcc = await signIn('genacc@test.local');
    const me = await genAcc.get('/api/auth/me').set(header).expect(200);
    expect(me.body.permissions).toContain('finance:expenses');

    // The seeded permission is actually enforced by the API now.
    await genAcc
      .post('/api/expenses')
      .set(header)
      .send({
        title: 'مصروف نظافة',
        category: 'نظافة',
        amount: 5000,
        date: '2026-03-01',
        method: 'CASH',
        branch_id: 'main',
        allocation: 'BRANCH',
      })
      .expect(201);

    // Group overview opens for the seeded accountant (was blocked by the admin-only middleware).
    await genAcc.get('/api/group/overview?from=2026-03-01&to=2026-03-31').set(header).expect(200);

    // …but user administration stays admin-only.
    await genAcc.get('/api/users').set(header).expect(403);
  });

  it('normalizes every legacy permission id out of role_permissions', async () => {
    const legacy = [
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
    ];
    const rows = all<{ permission: string }>(
      `SELECT DISTINCT permission FROM role_permissions WHERE permission IN (${legacy
        .map(() => '?')
        .join(',')})`,
      ...legacy,
    );
    expect(rows).toEqual([]);

    // Cashier kept its effective access through normalization (customers:manage → parties:manage).
    const cashier = all<{ permission: string }>(
      "SELECT permission FROM role_permissions WHERE role_id='role_cashier'",
    ).map((r) => r.permission);
    expect(cashier).toContain('parties:manage');
    expect(cashier).toContain('documents:create_sale');

    // Sales kept the transfer capability it always had at the API level.
    const sales = all<{ permission: string }>(
      "SELECT permission FROM role_permissions WHERE role_id='role_sales'",
    ).map((r) => r.permission);
    expect(sales).toContain('transfers:manage');
  });

  it('enforces transfers:manage on the transfers API', async () => {
    const viewer = await createUser('viewer@test.local', 'VIEWER');
    await viewer.get('/api/transfers').set(header).expect(403);
    await viewer.post('/api/transfers').set(header).send({}).expect(403);

    // Sales keeps the capability the tests already lock in (stock moves within assigned branches).
    const staff = await signIn('staff@test.local');
    await staff.get('/api/transfers').set(header).expect(200);
  });

  it('requires parties:manage to open customer accounts', async () => {
    const viewer = await createUser('viewer2@test.local', 'VIEWER');
    await viewer
      .post('/api/parties')
      .set(header)
      .send({ type: 'CUSTOMER', name: 'عميل غير مصرح' })
      .expect(403);

    const staff = await signIn('staff@test.local');
    await staff
      .post('/api/parties')
      .set(header)
      .send({ type: 'CUSTOMER', name: 'عميل مصرح' })
      .expect(201);

    // Suppliers remain administrator-only on top of the permission.
    await staff
      .post('/api/parties')
      .set(header)
      .send({ type: 'SUPPLIER', name: 'مورد مرفوض' })
      .expect(403);
  });

  it('enforces catalog:manage / inventory:adjust on catalog writes', async () => {
    const viewer = await createUser('viewer3@test.local', 'VIEWER');
    const product = {
      sku: 'SKU-HARDEN-1',
      name: 'منتج اختبار',
      category: 'عام',
      unit: 'قطعة',
      sale_price: 10000,
      cost_price: 6000,
      min_stock: 1,
      stock: 0,
    };
    await viewer.post('/api/products').set(header).send(product).expect(403);

    await admin.post('/api/products').set(header).send(product).expect(201);

    // Warehouse can adjust stock (seeded inventory:adjust) but cannot create products.
    const warehouse = await createUser('warehouse@test.local', 'WAREHOUSE');
    await warehouse
      .post('/api/products')
      .set(header)
      .send({ ...product, sku: 'SKU-HARDEN-2' })
      .expect(403);

    const created = all<{ id: string }>("SELECT id FROM products WHERE sku='SKU-HARDEN-1'")[0];
    await warehouse
      .post(`/api/products/${created.id}/adjust`)
      .set(header)
      .send({ branch_id: 'main', quantity: 5, reason: 'جرد دوري' })
      .expect(200);
  });

  it('keeps branch, company and equity administration admin-level', async () => {
    await run("DELETE FROM user_roles WHERE user_id='staff'");
    await run("INSERT INTO user_roles(user_id,role_id) VALUES('staff','role_branch_mgr')");
    const branchManager = await signIn('staff@test.local');

    // BRANCH_MANAGER has no branches:manage → branch administration refused.
    await branchManager
      .post('/api/branches')
      .set(header)
      .send({ code: 'BR9', name: 'فرع 9', kind: 'STORE', phone: '', address: '' })
      .expect(403);
    await branchManager.get('/api/owners').set(header).expect(403);
    await branchManager
      .put('/api/company')
      .set(header)
      .send({
        name: 'شركة',
        email: '',
        phone: '',
        address: '',
        tax_number: '',
        tax_rate: 14,
        invoice_note: '',
      })
      .expect(403);

    await admin.get('/api/owners').set(header).expect(200);
  });
});
