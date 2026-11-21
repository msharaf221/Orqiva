import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../server/app';
import { header, seedUsers, signIn, resetBusinessData } from './helpers';
import { all, one, run } from '../server/db';

describe('Audit trail + idempotency kernel', () => {
  let admin: Awaited<ReturnType<typeof signIn>>;

  beforeEach(async () => {
    resetBusinessData();
    run('DELETE FROM user_branches');
    run('DELETE FROM users');
    await seedUsers();
    run(
      `INSERT INTO products(id,sku,name,category,unit,sale_price,cost_price,min_stock,active,created_at)
       VALUES('ai-p1','AI-1','صنف','عام','قطعة',2500,1800,0,1,?)`,
      new Date().toISOString(),
    );
    run(`INSERT INTO branch_stock(branch_id,product_id,quantity) VALUES('main','ai-p1',10)`);
    run(`INSERT INTO branch_products(branch_id,product_id,active) VALUES('main','ai-p1',1)`);
    admin = await signIn('admin@test.local');
  });

  async function openShift() {
    const r = await admin
      .post('/api/pos/shifts/open')
      .set(header)
      .send({ branch_id: 'main', opening_cash: 1000 })
      .expect(201);
    return r.body.id as string;
  }

  function checkoutBody(shiftId: string, qty = 1) {
    return {
      branch_id: 'main',
      shift_id: shiftId,
      party_id: 'walk-in-customer',
      date: '2026-03-01',
      discount: 0,
      lines: [{ product_id: 'ai-p1', quantity: qty, unit_price: 2500 }],
      payment: { method: 'CASH', amount_tendered: 10000, amount_paid: 2500 * qty },
    };
  }

  it('replays the original response for the same key without a second sale', async () => {
    const shift = await openShift();
    const body = checkoutBody(shift);
    const a = await admin
      .post('/api/pos/checkout')
      .set(header)
      .set('Idempotency-Key', 'k-1')
      .send(body)
      .expect(201);
    const b = await admin
      .post('/api/pos/checkout')
      .set(header)
      .set('Idempotency-Key', 'k-1')
      .send(body)
      .expect(201);
    expect(b.body.document.id).toBe(a.body.document.id);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM documents WHERE type='SALE'")!.n).toBe(1);
    expect(
      one<{ quantity: number }>("SELECT quantity FROM branch_stock WHERE product_id='ai-p1'")!
        .quantity,
    ).toBe(9);
  });

  it('rejects the same key with a different body (409)', async () => {
    const shift = await openShift();
    await admin
      .post('/api/pos/checkout')
      .set(header)
      .set('Idempotency-Key', 'k-2')
      .send(checkoutBody(shift, 1))
      .expect(201);
    await admin
      .post('/api/pos/checkout')
      .set(header)
      .set('Idempotency-Key', 'k-2')
      .send(checkoutBody(shift, 2))
      .expect(409);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM documents WHERE type='SALE'")!.n).toBe(1);
  });

  it('without a key each request is processed independently', async () => {
    const shift = await openShift();
    await admin.post('/api/pos/checkout').set(header).send(checkoutBody(shift)).expect(201);
    await admin.post('/api/pos/checkout').set(header).send(checkoutBody(shift)).expect(201);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM documents WHERE type='SALE'")!.n).toBe(2);
  });

  it('echoes X-Request-Id, stamps audit rows, and includes it in error payloads', async () => {
    const res = await admin
      .post('/api/price-lists')
      .set(header)
      .set('X-Request-Id', 'req-abc-123')
      .send({ name: 'جملة', code: 'WS' })
      .expect(201);
    expect(res.headers['x-request-id']).toBe('req-abc-123');
    const rows = all<{ request_id: string; action: string }>(
      "SELECT request_id, action FROM audit_logs WHERE entity='PRICE_LIST'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].request_id).toBe('req-abc-123');

    const err = await admin
      .post('/api/price-lists')
      .set(header)
      .set('X-Request-Id', 'req-err-1')
      .send({ name: 'جملة', code: 'WS' })
      .expect(400);
    expect(err.body.request_id).toBe('req-err-1');
  });

  it('generates a request id when none (or an unsafe one) is supplied', async () => {
    const r = await request(app).get('/api/health').set('X-Request-Id', 'bad id!!');
    expect(r.headers['x-request-id']).toMatch(/^[\w-]{8,64}$/);
    expect(r.headers['x-request-id']).not.toBe('bad id!!');
  });

  it('audits quotation lifecycle transitions once each', async () => {
    const q = await admin
      .post('/api/quotations')
      .set(header)
      .send({
        branch_id: 'main',
        party_id: 'walk-in-customer',
        date: '2026-03-01',
        lines: [{ product_id: 'ai-p1', quantity: 1, unit_price: 2500 }],
      })
      .expect(201);
    const id = q.body.id as string;
    await admin.post(`/api/quotations/${id}/confirm`).set(header).expect(200);
    const rows = all<{ action: string }>(
      'SELECT action FROM audit_logs WHERE entity_id=? AND request_id IS NOT NULL',
      id,
    );
    expect(rows.length).toBe(2);
  });

  it('audits price list creation and item changes', async () => {
    const pl = await admin
      .post('/api/price-lists')
      .set(header)
      .send({ name: 'خاص', code: 'VIP' })
      .expect(201);
    await admin
      .post(`/api/price-lists/${pl.body.id}/items`)
      .set(header)
      .send({ product_id: 'ai-p1', min_quantity: 1, price: 2000 })
      .expect(201);
    const n = one<{ n: number }>(
      "SELECT COUNT(*) n FROM audit_logs WHERE entity='PRICE_LIST' AND entity_id=?",
      pl.body.id,
    )!.n;
    expect(n).toBe(2);
  });
});
