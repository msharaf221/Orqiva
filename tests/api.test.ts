import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { hash } from 'bcryptjs';
import { app } from '../server/app';
import { db, one, all, run, migrate, now } from '../server/db';
import type { Document } from '../src/types';
const admin = request.agent(app),
  staff = request.agent(app);
const header = { 'X-Orqiva-Request': '1' };
const draft = (overrides: Record<string, unknown> = {}) => ({
  type: 'SALE',
  branch_id: 'main',
  party_id: 'customer',
  date: '2026-10-01',
  due_date: '2026-10-15',
  discount: 1000,
  tax_rate: 1400,
  notes: 'test',
  lines: [{ product_id: 'product', quantity: 2, unit_price: 10000 }],
  ...overrides,
});
async function createAndPost(body: Record<string, unknown> = draft()) {
  const created = await admin.post('/api/documents').set(header).send(body).expect(201);
  await admin.post(`/api/documents/${created.body.id}/post`).set(header).send({}).expect(200);
  return created.body as Document;
}
const stockOf = (productId: string, branchId = 'main') =>
  one<{ quantity: number }>(
    'SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=?',
    productId,
    branchId,
  )?.quantity ?? 0;
beforeAll(async () => {
  const password = await hash('TestingPassword2026!', 4);
  run(
    'INSERT INTO users VALUES(?,?,?,?,?,?,?)',
    'admin',
    'مدير اختبار',
    'admin@test.local',
    password,
    'ADMIN',
    1,
    now(),
  );
  run(
    'INSERT INTO users VALUES(?,?,?,?,?,?,?)',
    'staff',
    'موظف اختبار',
    'staff@test.local',
    password,
    'STAFF',
    1,
    now(),
  );
  run('INSERT INTO user_branches(user_id,branch_id) VALUES(?,?)', 'staff', 'main');
  await admin
    .post('/api/auth/login')
    .set(header)
    .send({ email: 'admin@test.local', password: 'TestingPassword2026!' })
    .expect(200);
  await staff
    .post('/api/auth/login')
    .set(header)
    .send({ email: 'staff@test.local', password: 'TestingPassword2026!' })
    .expect(200);
});
beforeEach(() => {
  db.exec(
    'DELETE FROM audit_logs; DELETE FROM distribution_payments; DELETE FROM distribution_lines; DELETE FROM distributions; DELETE FROM equity_entries; DELETE FROM cost_movements; DELETE FROM branch_cost; DELETE FROM stock_movements; DELETE FROM transfer_lines; DELETE FROM transfers; DELETE FROM payments; DELETE FROM e_invoice_submissions; DELETE FROM journal_entries; DELETE FROM document_lines; DELETE FROM documents; DELETE FROM sequences; DELETE FROM stocktake_lines; DELETE FROM stocktake_sessions; DELETE FROM branch_stock; DELETE FROM branch_products; DELETE FROM products; DELETE FROM parties; DELETE FROM expenses;',
  );
  run(
    'INSERT INTO parties VALUES(?,?,?,?,?,?,?,?,?,?)',
    'customer',
    'CUSTOMER',
    'عميل اختبار',
    '',
    '',
    '',
    '',
    '',
    1,
    now(),
  );
  run(
    'INSERT INTO parties VALUES(?,?,?,?,?,?,?,?,?,?)',
    'supplier',
    'SUPPLIER',
    'مورد اختبار',
    '',
    '',
    '',
    '',
    '',
    1,
    now(),
  );
  run(
    'INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?)',
    'product',
    'SKU-01',
    'منتج اختبار',
    'عام',
    'قطعة',
    10000,
    6000,
    3,
    1,
    now(),
  );
  run("INSERT INTO branch_products(branch_id,product_id,active) VALUES('main','product',1)");
  run("INSERT INTO branch_stock(branch_id,product_id,quantity) VALUES('main','product',10)");
});
describe('Real database migrations and security', () => {
  it('issues a partitioned preview cookie and clears it with matching attributes', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .set(header)
      .set('Host', '5173-preview.e2b.app')
      .send({ email: 'admin@test.local', password: 'TestingPassword2026!' })
      .expect(200);
    const cookies = login.headers['set-cookie'];
    const cookie = String(Array.isArray(cookies) ? cookies[0] : cookies);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Partitioned');
    await request(app)
      .get('/api/auth/me')
      .set('Host', '5173-preview.e2b.app')
      .set('Cookie', cookie.split(';')[0])
      .expect(200);
    const logout = await request(app)
      .post('/api/auth/logout')
      .set(header)
      .set('Host', '5173-preview.e2b.app')
      .set('Cookie', cookie.split(';')[0])
      .expect(200);
    const cleared = String(logout.headers['set-cookie']);
    expect(cleared).toContain('SameSite=None');
    expect(cleared).toContain('Partitioned');
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970');
    await request(app).get('/api/auth/me').set('Cookie', cookie.split(';')[0]).expect(401);
  });
  it('preserves CSRF checks even with partitioned preview cookies', async () => {
    await admin.post('/api/expenses').set('Host', '5173-preview.e2b.app').send({}).expect(403);
  });

  it('applies the SQL migration once and creates persistent relational tables', () => {
    migrate();
    expect(all('SELECT * FROM schema_migrations')).toHaveLength(15);
    expect(one<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys).toBe(1);
    expect(all("SELECT name FROM sqlite_master WHERE type='table'").length).toBeGreaterThanOrEqual(
      13,
    );
  });
  it('rejects unauthenticated reads and mutations without the CSRF header', async () => {
    await request(app).get('/api/products').expect(401);
    await admin.post('/api/expenses').send({}).expect(403);
  });
  it('does not expose password hashes or session tokens', async () => {
    const me = await admin.get('/api/auth/me').expect(200);
    expect(me.body.email).toBe('admin@test.local');
    expect(me.body).not.toHaveProperty('password_hash');
    const users = await admin.get('/api/users').expect(200);
    expect(users.body[0]).not.toHaveProperty('password_hash');
  });
  it('returns generic errors for bad credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set(header)
      .send({ email: 'unknown@test.local', password: 'wrong' })
      .expect(401);
    expect(res.body.error).toContain('غير صحيحة');
  });
  it('denies staff access to administrative mutations and audit', async () => {
    await staff.get('/api/users').expect(403);
    await staff.get('/api/audit').expect(403);
    await staff.put('/api/company').set(header).send({}).expect(403);
    await staff.post('/api/products').set(header).send({}).expect(403);
    await staff.post('/api/expenses').set(header).send({}).expect(403);
    await staff
      .post('/api/documents')
      .set(header)
      .send(draft({ type: 'PURCHASE', party_id: 'supplier' }))
      .expect(403);
  });
  it('allows staff to create customers and sales but not suppliers', async () => {
    await staff
      .post('/api/parties')
      .set(header)
      .send({ type: 'CUSTOMER', name: 'عميل جديد' })
      .expect(201);
    await staff
      .post('/api/parties')
      .set(header)
      .send({ type: 'SUPPLIER', name: 'مورد جديد' })
      .expect(403);
    await staff.post('/api/documents').set(header).send(draft()).expect(201);
  });
  it('prevents self-deactivation or self-demotion', async () => {
    await admin
      .patch('/api/users/admin')
      .set(header)
      .send({ active: false, role: 'STAFF' })
      .expect(400);
  });
  it('stores a hash of the session, not the bearer cookie', () => {
    const sessions = all<{ id: string }>('SELECT id FROM sessions');
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0].id).toMatch(/^[a-f0-9]{64}$/);
  });
  it('invalidates sessions on logout', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .set(header)
      .send({ email: 'admin@test.local', password: 'TestingPassword2026!' })
      .expect(200);
    await agent.post('/api/auth/logout').set(header).expect(200);
    await agent.get('/api/auth/me').expect(401);
  });
});
describe('Catalog and validation', () => {
  it('creates a product with a real opening stock movement', async () => {
    const res = await admin
      .post('/api/products')
      .set(header)
      .send({
        name: 'حاسب',
        sku: 'NEW-001',
        category: 'إلكترونيات',
        unit: 'قطعة',
        sale_price: 55000,
        cost_price: 30000,
        stock: 7,
        min_stock: 2,
        branch_id: 'main',
      })
      .expect(201);
    expect(res.body.stock).toBe(7);
    expect(stockOf(res.body.id)).toBe(7);
    expect(
      one<{ quantity: number }>(
        'SELECT quantity FROM stock_movements WHERE product_id=?',
        res.body.id,
      )?.quantity,
    ).toBe(7);
  });
  it('rejects duplicate SKUs without inserting a second product', async () => {
    await admin
      .post('/api/products')
      .set(header)
      .send({
        name: 'مكرر',
        sku: 'sku-01',
        category: 'عام',
        unit: 'قطعة',
        sale_price: 100,
        cost_price: 50,
        stock: 2,
        min_stock: 1,
        branch_id: 'main',
      })
      .expect(409);
    expect(all('SELECT * FROM products')).toHaveLength(1);
  });
  it('does not allow direct stock edits', async () => {
    await admin
      .put('/api/products/product')
      .set(header)
      .send({
        sku: 'SKU-01',
        name: 'Test',
        category: 'عام',
        unit: 'قطعة',
        sale_price: 10000,
        cost_price: 6000,
        min_stock: 3,
        stock: 999,
      })
      .expect(400);
    expect(stockOf('product')).toBe(10);
  });
  it('records adjustments, rejects zero and insufficient stock', async () => {
    await admin
      .post('/api/products/product/adjust')
      .set(header)
      .send({ branch_id: 'main', quantity: -3, reason: 'تسوية جرد' })
      .expect(200);
    expect(stockOf('product')).toBe(7);
    await admin
      .post('/api/products/product/adjust')
      .set(header)
      .send({ branch_id: 'main', quantity: -8, reason: 'خصم غير مسموح' })
      .expect(400);
    await admin
      .post('/api/products/product/adjust')
      .set(header)
      .send({ branch_id: 'main', quantity: 0, reason: 'حركة صفرية' })
      .expect(400);
    expect(all('SELECT * FROM stock_movements')).toHaveLength(1);
  });
  it('archives without deleting financial history and supports restoring', async () => {
    await createAndPost();
    await admin
      .patch('/api/parties/customer/active')
      .set(header)
      .send({ active: false })
      .expect(200);
    expect(all('SELECT * FROM documents')).toHaveLength(1);
    await admin.post('/api/documents').set(header).send(draft()).expect(404);
    await admin
      .patch('/api/parties/customer/active')
      .set(header)
      .send({ active: true })
      .expect(200);
    await admin.post('/api/documents').set(header).send(draft()).expect(201);
  });
  it('rejects fractions, non-integer cents and impossible dates', async () => {
    for (const body of [
      draft({ lines: [{ product_id: 'product', quantity: 1.5, unit_price: 100 }] }),
      draft({ lines: [{ product_id: 'product', quantity: 1, unit_price: 100.5 }] }),
      draft({ date: '2026-02-30' }),
      draft({ due_date: '2026-09-01' }),
    ])
      await admin.post('/api/documents').set(header).send(body).expect(400);
    expect(all('SELECT * FROM documents')).toHaveLength(0);
  });
  it('rejects a supplier on sales and a repeated product line', async () => {
    await admin
      .post('/api/documents')
      .set(header)
      .send(draft({ party_id: 'supplier' }))
      .expect(400);
    await admin
      .post('/api/documents')
      .set(header)
      .send(
        draft({
          lines: [
            { product_id: 'product', quantity: 1, unit_price: 10000 },
            { product_id: 'product', quantity: 1, unit_price: 10000 },
          ],
        }),
      )
      .expect(400);
  });
  it('rejects negative or excessive discounts and excessive totals', async () => {
    await admin
      .post('/api/documents')
      .set(header)
      .send(draft({ discount: -1 }))
      .expect(400);
    await admin
      .post('/api/documents')
      .set(header)
      .send(draft({ discount: 21000 }))
      .expect(400);
    await admin
      .post('/api/documents')
      .set(header)
      .send(
        draft({ lines: [{ product_id: 'product', quantity: 1000000, unit_price: 1000000000 }] }),
      )
      .expect(400);
  });
});
describe('Atomic invoice lifecycle', () => {
  it('calculates money using integer cents and discounts before tax', async () => {
    const res = await admin.post('/api/documents').set(header).send(draft()).expect(201);
    expect(res.body).toMatchObject({
      subtotal: 20000,
      discount: 1000,
      tax: 2660,
      total: 21660,
      paid: 0,
      status: 'DRAFT',
      number: 'INV-HQ-2026-0001',
    });
    expect(stockOf('product')).toBe(10);
    expect(all('SELECT * FROM stock_movements')).toHaveLength(0);
  });
  it('updates a draft atomically and keeps its number', async () => {
    const created = await admin.post('/api/documents').set(header).send(draft()).expect(201);
    const edited = await admin
      .put('/api/documents/' + created.body.id)
      .set(header)
      .send(draft({ lines: [{ product_id: 'product', quantity: 3, unit_price: 10000 }] }))
      .expect(200);
    expect(edited.body.number).toBe(created.body.number);
    expect(edited.body.subtotal).toBe(30000);
    expect(all('SELECT * FROM document_lines')).toHaveLength(1);
  });
  it('posting deducts stock exactly once and freezes cost at posting', async () => {
    const res = await admin.post('/api/documents').set(header).send(draft()).expect(201);
    run('UPDATE products SET cost_price=6500 WHERE id=?', 'product');
    const posted = await admin
      .post('/api/documents/' + res.body.id + '/post')
      .set(header)
      .expect(200);
    expect(posted.body.lines[0].cost_price).toBe(6500);
    expect(stockOf('product')).toBe(8);
    await admin
      .post('/api/documents/' + res.body.id + '/post')
      .set(header)
      .expect(409);
    expect(stockOf('product')).toBe(8);
    expect(all('SELECT * FROM stock_movements')).toHaveLength(1);
    await admin
      .put('/api/documents/' + res.body.id)
      .set(header)
      .send(draft())
      .expect(409);
  });
  it('rolls back all stock changes if a later line has insufficient stock', async () => {
    run(
      'INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?)',
      'second',
      'SKU-02',
      'غير متوفر',
      'عام',
      'قطعة',
      10000,
      6000,
      3,
      1,
      now(),
    );
    run("INSERT INTO branch_products(branch_id,product_id,active) VALUES('main','second',1)");
    run("INSERT INTO branch_stock(branch_id,product_id,quantity) VALUES('main','second',0)");
    const created = await admin
      .post('/api/documents')
      .set(header)
      .send(
        draft({
          lines: [
            { product_id: 'product', quantity: 2, unit_price: 10000 },
            { product_id: 'second', quantity: 1, unit_price: 10000 },
          ],
        }),
      )
      .expect(201);
    await admin.post(`/api/documents/${created.body.id}/post`).set(header).expect(409);
    expect(stockOf('product')).toBe(10);
    expect(all('SELECT * FROM stock_movements')).toHaveLength(0);
    expect(one<Document>('SELECT * FROM documents WHERE id=?', created.body.id)?.status).toBe(
      'DRAFT',
    );
  });
  it('a purchase receives stock and cancellation reverses it', async () => {
    const doc = await createAndPost(draft({ type: 'PURCHASE', party_id: 'supplier' }));
    expect(stockOf('product')).toBe(12);
    expect(doc.number).toBe('PO-HQ-2026-0001');
    await admin.post(`/api/documents/${doc.id}/cancel`).set(header).expect(200);
    expect(stockOf('product')).toBe(10);
    expect(all('SELECT * FROM stock_movements')).toHaveLength(2);
  });
  it('rejects cancelling a purchase if its stock has been consumed', async () => {
    const doc = await createAndPost(draft({ type: 'PURCHASE', party_id: 'supplier' }));
    await admin
      .post('/api/products/product/adjust')
      .set(header)
      .send({ branch_id: 'main', quantity: -12, reason: 'خصم المخزون' })
      .expect(200);
    await admin.post(`/api/documents/${doc.id}/cancel`).set(header).expect(409);
    expect(stockOf('product')).toBe(0);
    expect(one<Document>('SELECT * FROM documents WHERE id=?', doc.id)?.status).toBe('POSTED');
  });
  it('cancels a sale once and restores stock', async () => {
    const doc = await createAndPost();
    await admin.post(`/api/documents/${doc.id}/cancel`).set(header).expect(200);
    expect(stockOf('product')).toBe(10);
    await admin.post(`/api/documents/${doc.id}/cancel`).set(header).expect(409);
    expect(stockOf('product')).toBe(10);
  });
  it('cancels a draft without touching stock', async () => {
    const doc = await admin.post('/api/documents').set(header).send(draft()).expect(201);
    await admin.post(`/api/documents/${doc.body.id}/cancel`).set(header).expect(200);
    expect(stockOf('product')).toBe(10);
    expect(all('SELECT * FROM stock_movements')).toHaveLength(0);
  });
  it('refuses an archived product at posting time', async () => {
    const doc = await admin.post('/api/documents').set(header).send(draft()).expect(201);
    await admin
      .patch('/api/products/product/active')
      .set(header)
      .send({ active: false })
      .expect(200);
    await admin.post(`/api/documents/${doc.body.id}/post`).set(header).expect(409);
    expect(stockOf('product')).toBe(10);
  });
  it('handles competing requests without overselling', async () => {
    const body = draft({ lines: [{ product_id: 'product', quantity: 7, unit_price: 10000 }] });
    const a = await admin.post('/api/documents').set(header).send(body).expect(201);
    const b = await admin.post('/api/documents').set(header).send(body).expect(201);
    const results = await Promise.all([
      admin.post(`/api/documents/${a.body.id}/post`).set(header),
      admin.post(`/api/documents/${b.body.id}/post`).set(header),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(stockOf('product')).toBe(3);
  });
});
describe('Payments and financial reports', () => {
  it('safely replays payment retries with the same idempotency key', async () => {
    const doc = await createAndPost();
    const payment = { amount: 5000, method: 'CASH', date: '2026-10-02' };
    const key = '42b30568-e48d-48dd-98b4-027885d3ac35';
    for (let i = 0; i < 2; i++)
      await admin
        .post(`/api/documents/${doc.id}/payments`)
        .set(header)
        .set('Idempotency-Key', key)
        .send(payment)
        .expect(201);
    expect(one<Document>('SELECT * FROM documents WHERE id=?', doc.id)?.paid).toBe(5000);
    expect(all('SELECT * FROM payments')).toHaveLength(1);
    await admin
      .post(`/api/documents/${doc.id}/payments`)
      .set(header)
      .set('Idempotency-Key', key)
      .send({ ...payment, amount: 7000 })
      .expect(409);
  });

  it('records partial and full payments and prevents overpayment', async () => {
    const doc = await createAndPost();
    await admin
      .post(`/api/documents/${doc.id}/payments`)
      .set(header)
      .send({ amount: 10000, method: 'CASH', date: '2026-10-02' })
      .expect(201);
    await admin
      .post(`/api/documents/${doc.id}/payments`)
      .set(header)
      .send({ amount: 12000, method: 'BANK', date: '2026-10-02' })
      .expect(400);
    const final = await admin
      .post(`/api/documents/${doc.id}/payments`)
      .set(header)
      .send({ amount: 11660, method: 'BANK', date: '2026-10-02' })
      .expect(201);
    expect(final.body.paid).toBe(doc.total);
    expect(final.body.payments).toHaveLength(2);
    expect(stockOf('product')).toBe(8);
    await admin.post(`/api/documents/${doc.id}/cancel`).set(header).expect(409);
  });
  it('rejects payments on drafts, zero/negative payments and invalid payment dates', async () => {
    const created = await admin.post('/api/documents').set(header).send(draft()).expect(201);
    const url = `/api/documents/${created.body.id}/payments`;
    await admin
      .post(url)
      .set(header)
      .send({ amount: 100, method: 'CASH', date: '2026-10-02' })
      .expect(409);
    await admin.post(`/api/documents/${created.body.id}/post`).set(header).expect(200);
    for (const amount of [0, -100])
      await admin
        .post(url)
        .set(header)
        .send({ amount, method: 'CASH', date: '2026-10-02' })
        .expect(400);
    await admin
      .post(url)
      .set(header)
      .send({ amount: 100, method: 'CASH', date: '2026-09-30' })
      .expect(400);
  });
  it('computes balances, profit, cash flow and period totals from posted transactions only', async () => {
    const sale = await createAndPost();
    await createAndPost(
      draft({
        type: 'PURCHASE',
        party_id: 'supplier',
        discount: 0,
        lines: [{ product_id: 'product', quantity: 2, unit_price: 6000 }],
      }),
    );
    await admin.post('/api/documents').set(header).send(draft()).expect(201);
    await admin
      .post(`/api/documents/${sale.id}/payments`)
      .set(header)
      .send({ amount: 10000, method: 'CASH', date: '2026-10-02' })
      .expect(201);
    await admin
      .post('/api/expenses')
      .set(header)
      .send({
        title: 'نقل',
        category: 'شحن',
        amount: 2000,
        date: '2026-10-03',
        method: 'CASH',
        branch_id: 'main',
      })
      .expect(201);
    const response = await admin.get('/api/dashboard?from=2026-10-01&to=2026-10-31').expect(200);
    expect(response.body).toMatchObject({
      sales: 19000,
      purchases: 12000,
      expenses: 2000,
      grossProfit: 7000,
      netProfit: 5000,
      collected: 10000,
      disbursed: 0,
      cashFlow: 8000,
      receivables: 11660,
      payables: 13680,
      invoiceCount: 1,
    });
    expect(response.body.series).toHaveLength(31);
    const parties = await admin.get('/api/parties?type=CUSTOMER').expect(200);
    expect(parties.body[0].balance).toBe(11660);
  });
  it('excludes cancelled invoices from operational reports', async () => {
    const doc = await createAndPost();
    await admin.post(`/api/documents/${doc.id}/cancel`).set(header).expect(200);
    const response = await admin.get('/api/dashboard?from=2026-10-01&to=2026-10-31').expect(200);
    expect(response.body.sales).toBe(0);
    expect(response.body.receivables).toBe(0);
    expect(response.body.topProducts).toHaveLength(0);
  });
  it('rejects reversed or excessive report ranges', async () => {
    await admin.get('/api/dashboard?from=2026-10-10&to=2026-10-01').expect(400);
    await admin.get('/api/dashboard?from=2020-01-01&to=2026-10-01').expect(400);
  });
  it('retains immutable audit entries for key operations', async () => {
    const doc = await createAndPost();
    await admin
      .post(`/api/documents/${doc.id}/payments`)
      .set(header)
      .send({ amount: 100, method: 'CASH', date: '2026-10-02' })
      .expect(201);
    const audit = await admin.get('/api/audit').expect(200);
    expect(audit.body.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining(['إنشاء فاتورة', 'اعتماد فاتورة', 'تسجيل دفعة']),
    );
    expect(audit.body.every((a: { user_id: string }) => a.user_id === 'admin')).toBe(true);
  });
});
