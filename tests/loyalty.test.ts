import { describe, expect, it, beforeEach } from 'vitest';
import { hash } from 'bcryptjs';
import { header, seedUsers, signIn, resetBusinessData } from './helpers';
import { one, run, now } from '../server/db';
import { pointsBalance } from '../server/modules/loyalty/service';

describe('Loyalty points add-on', () => {
  let cashier: Awaited<ReturnType<typeof signIn>>;
  let admin: Awaited<ReturnType<typeof signIn>>;
  let shiftId: string;

  beforeEach(async () => {
    resetBusinessData();
    run('DELETE FROM user_branches');
    run('DELETE FROM users');
    await seedUsers();
    const password = await hash('TestingPassword2026!', 4);
    run(
      'INSERT INTO users(id,name,email,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,?)',
      'cashier-1',
      'كاشير',
      'cashier1@test.local',
      password,
      'CASHIER',
      1,
      now(),
    );
    run("INSERT INTO user_branches(user_id,branch_id) VALUES('cashier-1','main')");
    run(
      `INSERT INTO products(id,sku,name,category,unit,sale_price,cost_price,min_stock,active,created_at)
       VALUES('lp1','LP-1','منتج','عام','قطعة',20000,10000,1,1,?)`,
      now(),
    );
    run("INSERT INTO branch_stock(branch_id,product_id,quantity) VALUES('main','lp1',50)");
    run("INSERT INTO branch_products(branch_id,product_id,active) VALUES('main','lp1',1)");
    run(
      'INSERT OR REPLACE INTO parties VALUES(?,?,?,?,?,?,?,?,?,?)',
      'cust-1',
      'CUSTOMER',
      'عميل مميز',
      '',
      '',
      '',
      '',
      '',
      1,
      now(),
    );
    cashier = await signIn('cashier1@test.local');
    admin = await signIn('admin@test.local');
    const shift = await cashier
      .post('/api/pos/shifts/open')
      .set(header)
      .send({ branch_id: 'main', opening_cash: 0 })
      .expect(201);
    shiftId = shift.body.id;
  });

  const enable = () =>
    admin
      .put('/api/loyalty/settings')
      .set(header)
      .send({ enabled: true, earn_per: 10000, point_value: 100 })
      .expect(200);

  const sell = (partyId: string, extra: object = {}) =>
    cashier
      .post('/api/pos/checkout')
      .set(header)
      .send({
        branch_id: 'main',
        shift_id: shiftId,
        party_id: partyId,
        date: '2026-03-01',
        discount: 0,
        lines: [{ product_id: 'lp1', quantity: 3, unit_price: 20000 }],
        payment: { method: 'CASH', amount_tendered: 100000, amount_paid: 60000 },
        ...extra,
      });

  it('earns nothing while the program is off', async () => {
    const res = await sell('cust-1').expect(201);
    expect(res.body.loyalty.earned).toBe(0);
    expect(pointsBalance('cust-1')).toBe(0);
  });

  it('earns 1 point per 100.00 of net sale and shows it in the response', async () => {
    await enable();
    const res = await sell('cust-1').expect(201);
    expect(res.body.loyalty).toMatchObject({ earned: 6, redeemed: 0, balance: 6 });
  });

  it('walk-in customers earn nothing', async () => {
    await enable();
    const res = await sell('walk-in-customer').expect(201);
    expect(res.body.loyalty.earned).toBe(0);
  });

  it('redeems points as a discount and earns on the reduced total', async () => {
    await enable();
    await sell('cust-1').expect(201); // +6
    const res = await sell('cust-1', {
      loyalty_redeem_points: 5,
      payment: { method: 'CASH', amount_tendered: 100000, amount_paid: 59500 },
    }).expect(201);
    // 5 points x 1.00 = 5.00 off: 600.00 - 5.00 = 595.00
    expect(res.body.document.total).toBe(59500);
    expect(res.body.loyalty).toMatchObject({ redeemed: 5, earned: 5 });
    expect(pointsBalance('cust-1')).toBe(6 - 5 + 5);
  });

  it('rejects redeeming more than the balance, and redeeming for walk-in', async () => {
    await enable();
    await sell('cust-1', { loyalty_redeem_points: 1 }).expect(409);
    await sell('walk-in-customer', { loyalty_redeem_points: 1 }).expect(400);
    expect(one<{ n: number }>('SELECT COUNT(*) n FROM loyalty_ledger')!.n).toBe(0);
  });

  it('only admins change settings, and the add-on can be switched off', async () => {
    await cashier
      .put('/api/loyalty/settings')
      .set(header)
      .send({ enabled: true, earn_per: 10000, point_value: 100 })
      .expect(403);
    await enable();
    process.env.ORQIVA_ADDONS = 'crm';
    try {
      const res = await sell('cust-1').expect(201);
      expect(res.body.loyalty.earned).toBe(0);
    } finally {
      delete process.env.ORQIVA_ADDONS;
    }
  });

  it('reverses earned points when a sale is refunded', async () => {
    await enable();
    const sale = await sell('cust-1').expect(201);
    expect(pointsBalance('cust-1')).toBe(6);
    await cashier
      .post('/api/pos/return')
      .set(header)
      .send({
        document_id: sale.body.document.id,
        lines: [{ product_id: 'lp1', quantity: 3 }],
        notes: 'مرتجع',
      })
      .expect(201);
    expect(pointsBalance('cust-1')).toBe(0);
  });
});
