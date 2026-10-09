import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { all } from '../server/db';
import { header, ledgerReconciles, resetBusinessData, seedUsers, signIn } from './helpers';

type Agent = Awaited<ReturnType<typeof signIn>>;
let admin: Agent, staff: Agent;

beforeAll(async () => {
  await seedUsers();
  admin = await signIn('admin@test.local');
  staff = await signIn('staff@test.local');
});
beforeEach(() => resetBusinessData());

/*
 * Reference case (piastres). Product: cost 6,000, price 10,000, 50 units in HQ.
 * Oct sales: 10 units → subtotal 100,000 (cost 60,000, gross 40,000), paid in cash.
 * Oct expenses: rent 10,000 for HQ; shared internet 5,000 (only HQ open) → net 25,000.
 * Reserve 5% = 1,250 → distributable 23,750. Owner capital 200,000 keeps the cash covered.
 */
async function product() {
  return (
    await admin
      .post('/api/products')
      .set(header)
      .send({
        sku: 'DST-1',
        name: 'منتج توزيع',
        category: 'عام',
        unit: 'قطعة',
        sale_price: 10000,
        cost_price: 6000,
        min_stock: 3,
        stock: 50,
        branch_id: 'main',
      })
      .expect(201)
  ).body as { id: string };
}
async function customer() {
  return (
    await admin
      .post('/api/parties')
      .set(header)
      .send({ type: 'CUSTOMER', name: 'عميل' })
      .expect(201)
  ).body.id as string;
}
async function sell(
  productId: string,
  partyId: string,
  quantity: number,
  date: string,
  paid: boolean,
) {
  const created = await admin
    .post('/api/documents')
    .set(header)
    .send({
      type: 'SALE',
      branch_id: 'main',
      party_id: partyId,
      date,
      due_date: date,
      discount: 0,
      tax_rate: 0,
      notes: '',
      lines: [{ product_id: productId, quantity, unit_price: 10000 }],
    })
    .expect(201);
  await admin.post(`/api/documents/${created.body.id}/post`).set(header).send({}).expect(200);
  if (paid)
    await admin
      .post(`/api/documents/${created.body.id}/payments`)
      .set(header)
      .send({ amount: created.body.total ?? quantity * 10000, method: 'CASH', date })
      .expect(201);
}
async function capital(amount: number, date = '2026-09-01') {
  await admin
    .post('/api/owners/owner-main/entries')
    .set(header)
    .send({ kind: 'CONTRIBUTION', amount, method: 'BANK', date, notes: 'رأس مال' })
    .expect(201);
}
async function expense(
  title: string,
  amount: number,
  allocation: 'BRANCH' | 'EQUAL' | 'REVENUE',
  date = '2026-10-05',
) {
  await admin
    .post('/api/expenses')
    .set(header)
    .send({
      title,
      category: 'عام',
      amount,
      date,
      method: 'BANK',
      allocation,
      branch_id: allocation === 'BRANCH' ? 'main' : undefined,
    })
    .expect(201);
}
async function preview(from = '2026-10-01', to = '2026-10-31', reserve = 500) {
  return (
    await admin
      .post('/api/distributions/preview')
      .set(header)
      .send({ period_from: from, period_to: to, reserve_bps: reserve })
      .expect(200)
  ).body;
}
const create = (from = '2026-10-01', to = '2026-10-31', reserve = 500) =>
  admin
    .post('/api/distributions')
    .set(header)
    .send({ period_from: from, period_to: to, reserve_bps: reserve, notes: '' });

describe('Profit distribution to owners', () => {
  it('computes the reserve, the distributable amount and each owner share exactly', async () => {
    const p = await product();
    const c = await customer();
    await capital(200000);
    await sell(p.id, c, 10, '2026-10-05', true);
    await expense('إيجار', 10000, 'BRANCH');
    await expense('إنترنت مشترك', 5000, 'EQUAL');
    const result = await preview();
    expect(result).toMatchObject({
      netProfit: 25000,
      reserve: 1250,
      distributable: 23750,
      shareTotal: 10000,
      cashAvailable: 285000,
      uncovered: 0,
    });
    expect(result.lines).toEqual([
      expect.objectContaining({ owner_name: 'المالك الرئيسي', share_bps: 10000, amount: 23750 }),
    ]);
    // The preview writes nothing.
    expect(all('SELECT * FROM distributions')).toHaveLength(0);
  });

  it('the preview names an overlapping live distribution before anyone tries to create one', async () => {
    const p = await product();
    const c = await customer();
    await capital(200000);
    await sell(p.id, c, 10, '2026-10-05', true);
    await expense('إيجار', 10000, 'BRANCH');
    const draft = (await create()).body;
    const overlapping = (
      await admin
        .post('/api/distributions/preview')
        .set(header)
        .send({ period_from: '2026-10-15', period_to: '2026-11-15', reserve_bps: 500 })
        .expect(200)
    ).body;
    expect(overlapping.overlap).toEqual({ number: draft.number });
    const clear = (
      await admin
        .post('/api/distributions/preview')
        .set(header)
        .send({ period_from: '2026-11-01', period_to: '2026-11-30', reserve_bps: 500 })
        .expect(200)
    ).body;
    expect(clear.overlap).toBeNull();
    await admin.post(`/api/distributions/${draft.id}/cancel`).set(header).send({}).expect(200);
    const freed = (
      await admin
        .post('/api/distributions/preview')
        .set(header)
        .send({ period_from: '2026-10-15', period_to: '2026-11-15', reserve_bps: 500 })
        .expect(200)
    ).body;
    expect(freed.overlap).toBeNull();
  });
  it('a draft freezes the calculation, overlapping periods are refused, and approval locks it', async () => {
    const p = await product();
    const c = await customer();
    await capital(200000);
    await sell(p.id, c, 10, '2026-10-05', true);
    await expense('إيجار', 10000, 'BRANCH');
    await expense('إنترنت مشترك', 5000, 'EQUAL');
    const draft = await create();
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({
      status: 'DRAFT',
      number: 'DIST-2026-0001',
      distributable: 23750,
    });
    const overlap = await create('2026-10-15', '2026-11-15');
    expect(overlap.status).toBe(409);
    expect(overlap.body.error).toContain('تتداخل');
    const approved = await admin
      .post(`/api/distributions/${draft.body.id}/approve`)
      .set(header)
      .send({})
      .expect(200);
    expect(approved.body.status).toBe('APPROVED');
    await admin
      .post(`/api/distributions/${draft.body.id}/approve`)
      .set(header)
      .send({})
      .expect(409);
    const ledger = (await admin.get('/api/owners').expect(200)).body[0];
    expect(ledger).toMatchObject({ declared: 23750, paid: 0, due: 23750 });
  });

  it('pays partners in parts with idempotent retries and closes the distribution when fully paid', async () => {
    const p = await product();
    const c = await customer();
    await capital(200000);
    await sell(p.id, c, 10, '2026-10-05', true);
    await expense('إيجار', 10000, 'BRANCH');
    await expense('إنترنت مشترك', 5000, 'EQUAL');
    const draft = (await create()).body;
    await admin.post(`/api/distributions/${draft.id}/approve`).set(header).send({}).expect(200);
    const lineId = draft.lines[0].id as string;
    const key = '6f1c2a8e-3b4d-4e5f-9a6b-7c8d9e0f1a2b';
    const pay = (body: Record<string, unknown>, requestKey = key) =>
      admin
        .post(`/api/distributions/${draft.id}/payments`)
        .set(header)
        .set('Idempotency-Key', requestKey)
        .send(body);
    await pay(
      { line_id: lineId, amount: 30000, method: 'BANK', date: '2026-10-20' },
      'a4a4a4a4-0000-4000-8000-000000000001',
    ).expect(400);
    const first = await pay({
      line_id: lineId,
      amount: 10000,
      method: 'BANK',
      date: '2026-10-20',
    }).expect(201);
    expect(first.body.lines[0]).toMatchObject({ amount: 23750, paid: 10000 });
    expect(first.body.status).toBe('APPROVED');
    const replay = await pay({
      line_id: lineId,
      amount: 10000,
      method: 'BANK',
      date: '2026-10-20',
    }).expect(201);
    expect(replay.body.payments).toHaveLength(1);
    // Only 13,750 is still owed, so a larger payment is refused even under a fresh key.
    await pay(
      { line_id: lineId, amount: 20000, method: 'BANK', date: '2026-10-20' },
      'b0b0b0b0-0000-4000-8000-000000000004',
    ).expect(400);
    const final = await pay(
      {
        line_id: lineId,
        amount: 13750,
        method: 'CASH',
        date: '2026-10-21',
        reference: 'الدفعة الأخيرة',
      },
      '7b7b7b7b-0000-4000-8000-000000000002',
    ).expect(201);
    expect(final.body.status).toBe('PAID');
    expect(final.body.paid_at).toBeTruthy();
    await pay(
      { line_id: lineId, amount: 1, method: 'CASH', date: '2026-10-22' },
      '8c8c8c8c-0000-4000-8000-000000000003',
    ).expect(409);
    await admin.post(`/api/distributions/${draft.id}/cancel`).set(header).send({}).expect(409);
    expect(ledgerReconciles()).toBe(true);
    const owner = (await admin.get('/api/owners').expect(200)).body[0];
    expect(owner).toMatchObject({ declared: 23750, paid: 23750, due: 0 });
  });

  it('a partner cannot be paid more than the cash the group holds', async () => {
    const p = await product();
    const c = await customer();
    // Sale on credit: profit is recognised, but no cash has come in.
    await sell(p.id, c, 10, '2026-10-05', false);
    const draft = (await create()).body;
    expect(draft.distributable).toBe(38000);
    await admin.post(`/api/distributions/${draft.id}/approve`).set(header).send({}).expect(200);
    const lineId = draft.lines[0].id as string;
    const rejected = await admin
      .post(`/api/distributions/${draft.id}/payments`)
      .set(header)
      .send({ line_id: lineId, amount: 10000, method: 'BANK', date: '2026-10-20' })
      .expect(409);
    expect(rejected.body.error).toContain('الرصيد النقدي المتاح');
    await capital(5000);
    await admin
      .post(`/api/distributions/${draft.id}/payments`)
      .set(header)
      .send({ line_id: lineId, amount: 10000, method: 'BANK', date: '2026-10-20' })
      .expect(409);
    await admin
      .post(`/api/distributions/${draft.id}/payments`)
      .set(header)
      .send({ line_id: lineId, amount: 5000, method: 'BANK', date: '2026-10-20' })
      .expect(201);
  });

  it('a stale draft cannot be approved after the period changes; it can be replaced', async () => {
    const p = await product();
    const c = await customer();
    await sell(p.id, c, 10, '2026-11-05', true);
    await capital(200000);
    const draft = (await create('2026-11-01', '2026-11-30')).body;
    expect(draft.distributable).toBe(38000);
    await sell(p.id, c, 1, '2026-11-10', true);
    const stale = await admin
      .post(`/api/distributions/${draft.id}/approve`)
      .set(header)
      .send({})
      .expect(409);
    expect(stale.body.error).toContain('تغيّرت');
    await admin.post(`/api/distributions/${draft.id}/cancel`).set(header).send({}).expect(200);
    const replacement = (await create('2026-11-01', '2026-11-30')).body;
    // November now nets 44,000; the reserve is 2,200, leaving 41,800.
    expect(replacement.distributable).toBe(41800);
    await admin
      .post(`/api/distributions/${replacement.id}/approve`)
      .set(header)
      .send({})
      .expect(200);
  });

  it('shares must add up to exactly 100% before a distribution is possible', async () => {
    const p = await product();
    const c = await customer();
    await capital(200000);
    await sell(p.id, c, 10, '2026-10-05', true);
    const partner = await admin
      .post('/api/owners')
      .set(header)
      .send({ name: 'شريك', share_bps: 2000 })
      .expect(409);
    expect(partner.body.error).toContain('يتجاوز');
    await admin
      .put('/api/owners/owner-main')
      .set(header)
      .send({ name: 'المالك الرئيسي', share_bps: 8000 })
      .expect(200);
    const second = await admin
      .post('/api/owners')
      .set(header)
      .send({ name: 'شريك', share_bps: 2000 })
      .expect(201);
    const result = await preview();
    // Net 40,000 (no expenses) → reserve 2,000 → 38,000 split 80/20.
    expect(result.distributable).toBe(38000);
    expect(result.shareTotal).toBe(10000);
    expect(result.lines.map((l: { amount: number }) => l.amount)).toEqual([30400, 7600]);
    expect(result.lines.reduce((s: number, l: { amount: number }) => s + l.amount, 0)).toBe(
      result.distributable,
    );
    // Archiving a partner drops the total below 100%, which blocks new distributions.
    await admin
      .patch(`/api/owners/${second.body.id}/active`)
      .set(header)
      .send({ active: false })
      .expect(200);
    const blocked = await create().expect(409);
    expect(blocked.body.error).toContain('١٠٠٪');
    await admin
      .patch('/api/owners/owner-main/active')
      .set(header)
      .send({ active: false })
      .expect(409);
  });

  it('rounds shares so that partners receive exactly the distributable amount', async () => {
    const p = await product();
    const c = await customer();
    await capital(200000);
    await sell(p.id, c, 10, '2026-10-05', true);
    await expense('مصروف للتقريب', 16249, 'BRANCH');
    await admin
      .put('/api/owners/owner-main')
      .set(header)
      .send({ name: 'المالك الرئيسي', share_bps: 8000 })
      .expect(200);
    await admin.post('/api/owners').set(header).send({ name: 'شريك', share_bps: 2000 }).expect(201);
    const result = await preview('2026-10-01', '2026-10-31', 0);
    expect(result.distributable).toBe(23751);
    expect(result.lines.map((l: { amount: number }) => l.amount)).toEqual([19001, 4750]);
  });

  it('withdrawals and distributions never take the cash below zero', async () => {
    await capital(10000);
    await admin
      .post('/api/owners/owner-main/entries')
      .set(header)
      .send({ kind: 'WITHDRAWAL', amount: 20000, method: 'CASH', date: '2026-10-02', notes: '' })
      .expect(409);
    await admin
      .post('/api/owners/owner-main/entries')
      .set(header)
      .send({ kind: 'WITHDRAWAL', amount: 10000, method: 'CASH', date: '2026-10-02', notes: '' })
      .expect(201);
    const ledger = (await admin.get('/api/owners/owner-main/ledger').expect(200)).body;
    expect(ledger.owner).toMatchObject({ contributed: 10000, withdrawn: 10000 });
    expect(ledger.entries).toHaveLength(2);
  });

  it('keeps staff away from owner data and distributions', async () => {
    await staff.get('/api/owners').expect(403);
    await staff.get('/api/owners/owner-main/ledger').expect(403);
    await staff.get('/api/distributions').expect(403);
    await staff
      .post('/api/distributions/preview')
      .set(header)
      .send({ period_from: '2026-10-01', period_to: '2026-10-31', reserve_bps: 500 })
      .expect(403);
    await staff.get('/api/group/overview?from=2026-10-01&to=2026-10-31').expect(403);
  });

  it('the group overview agrees with the distribution preview on profit and cash', async () => {
    const p = await product();
    const c = await customer();
    await capital(200000);
    await sell(p.id, c, 10, '2026-10-05', true);
    await expense('إيجار', 10000, 'BRANCH');
    await expense('إنترنت مشترك', 5000, 'EQUAL');
    const group = (await admin.get('/api/group/overview?from=2026-10-01&to=2026-10-31').expect(200))
      .body;
    const result = await preview();
    expect(group.totals.net).toBe(result.netProfit);
    expect(group.cashAvailable).toBe(result.cashAvailable);
    expect(group.owners[0]).toMatchObject({ share_bps: 10000 });
  });
});

describe('Owners and equity', () => {
  it('owner statements show capital, withdrawals, declared profit and what is still due', async () => {
    const p = await product();
    const c = await customer();
    await capital(200000);
    await sell(p.id, c, 10, '2026-10-05', true);
    const draft = (await create()).body;
    await admin.post(`/api/distributions/${draft.id}/approve`).set(header).send({}).expect(200);
    const ownerRow = (await admin.get('/api/owners').expect(200)).body[0];
    // No expenses in this case: net 40,000, reserve 2,000, declared 38,000.
    expect(ownerRow).toMatchObject({ contributed: 200000, declared: 38000, paid: 0, due: 38000 });
  });
});
