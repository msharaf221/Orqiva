/**
 * Phase 4.3 — Inventory: periodic stocktake with variance approval + reorder suggestions.
 *
 * Covers:
 *  - starting a stocktake freezes expected quantities per sellable product;
 *  - counts can be saved, but submission requires every line to be counted;
 *  - approval posts only variance lines as stock movements and stamps the approver;
 *  - no stock changes before approval, and none for zero-variance lines;
 *  - cancelling an unapproved session leaves stock untouched;
 *  - reorder suggestions list products at/below their reorder threshold.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { header, seedUsers, signIn, resetBusinessData } from './helpers';
import { all, one, run } from '../server/db';

beforeEach(async () => {
  resetBusinessData();
  run('DELETE FROM user_branches');
  run('DELETE FROM users');
  await seedUsers();

  run(
    `INSERT INTO products(id,sku,name,category,unit,sale_price,cost_price,min_stock,active,created_at)
     VALUES('inv-p1','INV-1','أرز','بقالة','كيس',5000,3500,10,1,?)`,
    new Date().toISOString(),
  );
  run(
    `INSERT INTO products(id,sku,name,category,unit,sale_price,cost_price,min_stock,active,created_at)
     VALUES('inv-p2','INV-2','زيت','بقالة','لتر',8000,6000,5,1,?)`,
    new Date().toISOString(),
  );
  for (const pid of ['inv-p1', 'inv-p2']) {
    run(`INSERT INTO branch_stock(branch_id,product_id,quantity) VALUES('main',?,20)`, pid);
    run(`INSERT INTO branch_products(branch_id,product_id,active) VALUES('main',?,1)`, pid);
    run(
      `INSERT INTO branch_cost(branch_id,product_id,avg_cost,total_value,updated_at) VALUES('main',?,3500,70000,?)`,
      pid,
      new Date().toISOString(),
    );
  }
});

async function admin() {
  return signIn('admin@test.local');
}

describe('Phase 4.3 — periodic stocktake', () => {
  it('freezes expected quantities when a session starts', async () => {
    const client = await admin();
    const res = await client
      .post('/api/stocktakes')
      .set(header)
      .send({ branch_id: 'main', notes: 'جرد نهاية الشهر' })
      .expect(201);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.number).toContain('INV-COUNT');

    const detail = await client.get(`/api/stocktakes/${res.body.id}`).set(header).expect(200);
    expect(detail.body.lines).toHaveLength(2);
    for (const line of detail.body.lines) {
      expect(line.expected_qty).toBe(20);
      expect(line.counted_qty).toBeNull();
    }
  });

  it('requires every line to be counted before submission', async () => {
    const client = await admin();
    const session = (await client.post('/api/stocktakes').set(header).send({ branch_id: 'main' }))
      .body;
    const lines = (await client.get(`/api/stocktakes/${session.id}`).set(header)).body.lines;

    // Save only one count → submit must fail.
    await client
      .put(`/api/stocktakes/${session.id}/counts`)
      .set(header)
      .send({ counts: [{ line_id: lines[0].id, counted_qty: 18 }] })
      .expect(200);
    await client.post(`/api/stocktakes/${session.id}/submit`).set(header).send({}).expect(409);

    // Count the rest → submit succeeds.
    await client
      .put(`/api/stocktakes/${session.id}/counts`)
      .set(header)
      .send({ counts: [{ line_id: lines[1].id, counted_qty: 20 }] })
      .expect(200);
    const submitted = await client
      .post(`/api/stocktakes/${session.id}/submit`)
      .set(header)
      .send({})
      .expect(200);
    expect(submitted.body.status).toBe('SUBMITTED');
  });

  it('posts only variance lines as stock movements on approval', async () => {
    const client = await admin();
    const session = (await client.post('/api/stocktakes').set(header).send({ branch_id: 'main' }))
      .body;
    const lines = (await client.get(`/api/stocktakes/${session.id}`).set(header)).body.lines;
    const rice = lines.find((l: { sku: string }) => l.sku === 'INV-1');
    const oil = lines.find((l: { sku: string }) => l.sku === 'INV-2');

    // Rice counted short by 2, oil counted exactly.
    await client
      .put(`/api/stocktakes/${session.id}/counts`)
      .set(header)
      .send({
        counts: [
          { line_id: rice.id, counted_qty: 18 },
          { line_id: oil.id, counted_qty: 20 },
        ],
      })
      .expect(200);

    // No movement yet.
    expect(all('SELECT id FROM stock_movements')).toHaveLength(0);

    await client.post(`/api/stocktakes/${session.id}/submit`).set(header).send({}).expect(200);
    const approved = await client
      .post(`/api/stocktakes/${session.id}/approve`)
      .set(header)
      .send({})
      .expect(200);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.approved_by_name).toBe('مدير اختبار');

    const movements = all<{ product_id: string; quantity: number; reason: string }>(
      'SELECT product_id, quantity, reason FROM stock_movements',
    );
    expect(movements).toHaveLength(1);
    expect(movements[0].product_id).toBe('inv-p1');
    expect(movements[0].quantity).toBe(-2);
    expect(movements[0].reason).toContain(session.number);

    // Branch stock reflects the approved variance.
    const riceStock = one<{ quantity: number }>(
      "SELECT quantity FROM branch_stock WHERE branch_id='main' AND product_id='inv-p1'",
    );
    expect(riceStock?.quantity).toBe(18);
    const oilStock = one<{ quantity: number }>(
      "SELECT quantity FROM branch_stock WHERE branch_id='main' AND product_id='inv-p2'",
    );
    expect(oilStock?.quantity).toBe(20);
  });

  it('invariants: stock unchanged before approval and after cancel', async () => {
    const client = await admin();
    const session = (await client.post('/api/stocktakes').set(header).send({ branch_id: 'main' }))
      .body;
    const lines = (await client.get(`/api/stocktakes/${session.id}`).set(header)).body.lines;
    await client
      .put(`/api/stocktakes/${session.id}/counts`)
      .set(header)
      .send({ counts: lines.map((l: { id: string }) => ({ line_id: l.id, counted_qty: 5 })) })
      .expect(200);

    // Still 20 before approval.
    expect(
      one<{ quantity: number }>("SELECT quantity FROM branch_stock WHERE product_id='inv-p1'")
        ?.quantity,
    ).toBe(20);

    await client.post(`/api/stocktakes/${session.id}/cancel`).set(header).send({}).expect(200);
    expect(
      one<{ quantity: number }>("SELECT quantity FROM branch_stock WHERE product_id='inv-p1'")
        ?.quantity,
    ).toBe(20);
    expect(all('SELECT id FROM stock_movements')).toHaveLength(0);
  });

  it('rejects approval before submission and cancel after approval', async () => {
    const client = await admin();
    const session = (await client.post('/api/stocktakes').set(header).send({ branch_id: 'main' }))
      .body;
    await client.post(`/api/stocktakes/${session.id}/approve`).set(header).send({}).expect(409);

    const lines = (await client.get(`/api/stocktakes/${session.id}`).set(header)).body.lines;
    await client
      .put(`/api/stocktakes/${session.id}/counts`)
      .set(header)
      .send({ counts: lines.map((l: { id: string }) => ({ line_id: l.id, counted_qty: 20 })) })
      .expect(200);
    await client.post(`/api/stocktakes/${session.id}/submit`).set(header).send({}).expect(200);
    await client.post(`/api/stocktakes/${session.id}/approve`).set(header).send({}).expect(200);
    await client.post(`/api/stocktakes/${session.id}/cancel`).set(header).send({}).expect(409);
  });

  it('suggests reorders for products at or below their threshold', async () => {
    const client = await admin();
    // Drop rice to 8 (min 10 → below) and oil stays at 20 (min 5 → fine).
    run("UPDATE branch_stock SET quantity=8 WHERE product_id='inv-p1'");

    const res = await client.get('/api/inventory/reorder?branch_id=main').set(header).expect(200);
    expect(res.body).toHaveLength(1);
    const suggestion = res.body[0];
    expect(suggestion.sku).toBe('INV-1');
    expect(suggestion.stock).toBe(8);
    expect(suggestion.min_stock).toBe(10);
    // Target = max(min*2, min+1) = 20 → suggested 12.
    expect(suggestion.suggested_qty).toBe(12);
    expect(suggestion.estimated_cost).toBe(12 * suggestion.avg_cost);
  });

  it('treats branch_id=all as the group scope, not a branch filter', async () => {
    const client = await admin();
    run("UPDATE branch_stock SET quantity=8 WHERE product_id='inv-p1'");

    const grouped = await client
      .get('/api/inventory/reorder?branch_id=all')
      .set(header)
      .expect(200);
    expect(grouped.body.map((s: { sku: string }) => s.sku)).toContain('INV-1');

    // Same for the stocktake list, which shares the query-parameter handling.
    const session = (await client.post('/api/stocktakes').set(header).send({ branch_id: 'main' }))
      .body;
    const list = await client.get('/api/stocktakes?branch_id=all').set(header).expect(200);
    expect(list.body.map((s: { id: string }) => s.id)).toContain(session.id);
  });
});
