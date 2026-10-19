import { describe, expect, it, beforeEach } from 'vitest';
import { header, seedUsers, signIn, resetBusinessData, PASSWORD } from './helpers';
import { run } from '../server/db';

describe('Dynamic & Granular Permissions Management', () => {
  let admin: Awaited<ReturnType<typeof signIn>>;
  let staff: Awaited<ReturnType<typeof signIn>>;

  beforeEach(async () => {
    resetBusinessData();
    run('DELETE FROM user_branches');
    run('DELETE FROM users');
    await seedUsers();
    admin = await signIn('admin@test.local');
    staff = await signIn('staff@test.local');
  });

  it('exposes permissions catalog with arabic titles and categories', async () => {
    const res = await admin.get('/api/permissions/catalog').set(header).expect(200);
    expect(res.body.length).toBeGreaterThan(15);
    const posAccess = res.body.find((p: any) => p.key === 'pos:access');
    expect(posAccess).toBeDefined();
    expect(posAccess.category).toBe('نقطة البيع (POS)');
    expect(posAccess.label).toContain('دخول شاشة الكاشير');
  });

  it('loads effective permissions on auth/me and auth/login', async () => {
    const adminMe = await admin.get('/api/auth/me').set(header).expect(200);
    expect(adminMe.body.role).toBe('ADMIN');
    expect(adminMe.body.permissions).toContain('documents:view');
    expect(adminMe.body.permissions).toContain('pos:access');
    expect(adminMe.body.permissions).toContain('users:manage');

    const staffMe = await staff.get('/api/auth/me').set(header).expect(200);
    expect(staffMe.body.role).toBe('STAFF');
    expect(staffMe.body.permissions).toContain('documents:view');
    expect(staffMe.body.permissions).not.toContain('users:manage');
    expect(staffMe.body.permissions).not.toContain('documents:create_purchase');
  });

  it('allows creating users with diverse roles (CASHIER, BRANCH_MANAGER, GENERAL_ACCOUNTANT)', async () => {
    const res = await admin
      .post('/api/users')
      .set(header)
      .send({
        name: 'كاشير الفرع',
        email: 'cashier@test.local',
        password: PASSWORD,
        role: 'CASHIER',
        branch_ids: ['main'],
      })
      .expect(201);

    expect(res.body.role).toBe('CASHIER');
    expect(res.body.permissions).toContain('pos:access');
    expect(res.body.permissions).toContain('pos:shift_open');
    expect(res.body.permissions).not.toContain('documents:create_purchase');

    const cashierAgent = await signIn('cashier@test.local');
    const me = await cashierAgent.get('/api/auth/me').set(header).expect(200);
    expect(me.body.permissions).toContain('pos:access');
  });

  it('allows admin to customize granular permission overrides per user', async () => {
    // 1. Staff initially cannot manage expenses
    await staff
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
      .expect(403);

    // 2. Admin explicitly grants the canonical 'finance:expenses' override to this staff member
    await admin
      .put('/api/users/staff/permissions')
      .set(header)
      .send({
        'finance:expenses': true,
      })
      .expect(200);

    // Re-login staff to pick up new session/permissions
    staff = await signIn('staff@test.local');
    const me = await staff.get('/api/auth/me').set(header).expect(200);
    expect(me.body.permissions).toContain('finance:expenses');

    // 3. Staff can now create an expense!
    const expenseRes = await staff
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

    expect(expenseRes.body.title).toBe('مصروف نظافة');

    // 4. Admin explicitly revokes 'finance:expenses' and 'documents:create_sale'
    await admin
      .put('/api/users/staff/permissions')
      .set(header)
      .send({
        'finance:expenses': false,
        'documents:create_sale': false,
      })
      .expect(200);

    staff = await signIn('staff@test.local');
    const meAfterRevoke = await staff.get('/api/auth/me').set(header).expect(200);
    expect(meAfterRevoke.body.permissions).not.toContain('finance:expenses');
    expect(meAfterRevoke.body.permissions).not.toContain('documents:create_sale');

    // Attempting expense now returns 403
    await staff
      .post('/api/expenses')
      .set(header)
      .send({
        title: 'مصروف آخر',
        category: 'نظافة',
        amount: 3000,
        date: '2026-03-01',
        method: 'CASH',
        branch_id: 'main',
        allocation: 'BRANCH',
      })
      .expect(403);
  });
});
