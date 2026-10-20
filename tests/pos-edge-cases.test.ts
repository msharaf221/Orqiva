/**
 * Phase 4.4 — Uncovered operational edge cases.
 *
 * Covers:
 *  - Parked (held) sales: park a cart, list it, resume it, discard it.
 *  - POS product search/category/pagination filters.
 *  - Sales returns inherit the POS shift of the original sale and net against it.
 *  - Deactivating a user invalidates their live session on the next request.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { header, seedUsers, signIn, resetBusinessData } from './helpers';
import { one, run } from '../server/db';
import { hash } from 'bcryptjs';

describe('Phase 4.4 — POS edge cases', () => {
  let cashier: Awaited<ReturnType<typeof signIn>>;
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
      'كاشير وردية',
      'cashier1@test.local',
      password,
      'CASHIER',
      1,
      new Date().toISOString(),
    );
    run("INSERT INTO user_branches(user_id,branch_id) VALUES('cashier-1','main')");

    run(
      `INSERT INTO products(id,sku,name,category,unit,sale_price,cost_price,min_stock,active,created_at)
       VALUES('edge-p1','EDGE-1','شاي','مشروبات','علبة',2500,1800,2,1,?)`,
      new Date().toISOString(),
    );
    run(
      `INSERT INTO products(id,sku,name,category,unit,sale_price,cost_price,min_stock,active,created_at)
         VALUES('edge-p2','EDGE-2','قهوة','مشروبات','علبة',4000,2500,2,1,?)`,
      new Date().toISOString(),
    );
    run(
      `INSERT INTO products(id,sku,name,category,unit,sale_price,cost_price,min_stock,active,created_at)
         VALUES('edge-p3','EDGE-3','سكر','بقالة','كيس',1500,900,2,1,?)`,
      new Date().toISOString(),
    );
    for (const pid of ['edge-p1', 'edge-p2', 'edge-p3']) {
      run(`INSERT INTO branch_stock(branch_id,product_id,quantity) VALUES('main',?,10)`, pid);
      run(`INSERT INTO branch_products(branch_id,product_id,active) VALUES('main',?,1)`, pid);
    }

    cashier = await signIn('cashier1@test.local');
    shiftId = (
      await cashier
        .post('/api/pos/shifts/open')
        .set(header)
        .send({ branch_id: 'main', opening_cash: 10000 })
    ).body.id;
  });

  it('parks, lists, resumes and discards a held sale', async () => {
    const parked = await cashier
      .post('/api/pos/parked')
      .set(header)
      .send({
        branch_id: 'main',
        shift_id: shiftId,
        label: 'عميل ينتظر زميله',
        customer_id: 'walk-in-customer',
        discount: 0,
        cart: [
          { product_id: 'edge-p1', name: 'شاي', sku: 'EDGE-1', quantity: 3, unit_price: 2500 },
        ],
      })
      .expect(201);
    expect(parked.body.id).toBeTruthy();
    expect(parked.body.total).toBe(7500);
    expect(parked.body.user_name).toBe('كاشير وردية');

    const list = await cashier.get('/api/pos/parked?branch_id=main').set(header).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].label).toBe('عميل ينتظر زميله');

    // Resume removes it from the list and returns the cart (client restores it).
    const resumed = await cashier
      .post(`/api/pos/parked/${parked.body.id}/resume`)
      .set(header)
      .send({})
      .expect(200);
    expect(resumed.body.id).toBe(parked.body.id);
    expect(await cashier.get('/api/pos/parked?branch_id=main').set(header)).toHaveProperty(
      'body.length',
      0,
    );

    // Park a second one then discard it.
    const second = await cashier
      .post('/api/pos/parked')
      .set(header)
      .send({
        branch_id: 'main',
        label: 'يسأل عن السعر',
        cart: [{ product_id: 'edge-p2', name: 'قهوة', quantity: 1, unit_price: 4000 }],
      })
      .expect(201);
    await cashier.delete(`/api/pos/parked/${second.body.id}`).set(header).expect(200);
    expect(await cashier.get('/api/pos/parked?branch_id=main').set(header)).toHaveProperty(
      'body.length',
      0,
    );
  });

  it('rejects parking an empty cart', async () => {
    const res = await cashier
      .post('/api/pos/parked')
      .set(header)
      .send({ branch_id: 'main', cart: [] });
    expect(res.status).toBe(400);
  });

  it('filters POS products by search, category and pagination', async () => {
    const bySearch = await cashier
      .get('/api/pos/products?branch_id=main&search=EDGE-2')
      .set(header)
      .expect(200);
    expect(bySearch.body).toHaveLength(1);
    expect(bySearch.body[0].sku).toBe('EDGE-2');

    const byCategory = await cashier
      .get('/api/pos/products?branch_id=main&category=مشروبات')
      .set(header)
      .expect(200);
    expect(byCategory.body.map((p: { sku: string }) => p.sku).sort()).toEqual(['EDGE-1', 'EDGE-2']);

    const page1 = await cashier
      .get('/api/pos/products?branch_id=main&limit=2&offset=0')
      .set(header)
      .expect(200);
    expect(page1.body).toHaveLength(2);
    const page2 = await cashier
      .get('/api/pos/products?branch_id=main&limit=2&offset=2')
      .set(header)
      .expect(200);
    // The two pages must not overlap.
    const ids = new Set([
      ...page1.body.map((p: { id: string }) => p.id),
      ...page2.body.map((p: { id: string }) => p.id),
    ]);
    expect(ids.size).toBe(page1.body.length + page2.body.length);

    const nameSearch = await cashier
      .get('/api/pos/products?branch_id=main&search=سكر')
      .set(header)
      .expect(200);
    expect(nameSearch.body).toHaveLength(1);
    expect(nameSearch.body[0].sku).toBe('EDGE-3');
  });

  it('links a POS sale return to the original shift and nets refunds', async () => {
    // Sell 4 units in the shift.
    const sale = await cashier
      .post('/api/pos/checkout')
      .set(header)
      .send({
        branch_id: 'main',
        shift_id: shiftId,
        party_id: 'walk-in-customer',
        date: '2026-03-01',
        discount: 0,
        lines: [{ product_id: 'edge-p1', quantity: 4, unit_price: 2500 }],
        payment: { method: 'CASH', amount_tendered: 11400, amount_paid: 11400 },
      })
      .expect(201);

    // Return 2 units (credit note) referencing the original POS sale.
    const ret = await cashier
      .post('/api/documents')
      .set(header)
      .send({
        type: 'SALE_RETURN',
        branch_id: 'main',
        party_id: 'walk-in-customer',
        original_document_id: sale.body.document.id,
        date: '2026-03-01',
        due_date: '2026-03-01',
        tax_rate: 1400,
        discount: 0,
        notes: '',
        lines: [{ product_id: 'edge-p1', quantity: 2, unit_price: 2500 }],
      })
      .expect(201);
    await cashier.post(`/api/documents/${ret.body.id}/post`).set(header).send({}).expect(200);

    // The return inherited the shift.
    const retRow = one<{ pos_shift_id: string }>(
      'SELECT pos_shift_id FROM documents WHERE id=?',
      ret.body.id,
    );
    expect(retRow?.pos_shift_id).toBe(shiftId);

    // The shift summary reflects the refund and reduces expected cash.
    const summary = await cashier.get(`/api/pos/shifts/${shiftId}/summary`).set(header).expect(200);
    expect(summary.body.refunds_count).toBe(1);
    expect(summary.body.refunds_total).toBe(ret.body.total);
    expect(summary.body.expected_cash).toBe(10000 + 11400 - ret.body.total);
  });

  it('refunds a POS sale through the cashier endpoint and nets it against the shift', async () => {
    // Sell 5 units.
    const sale = await cashier
      .post('/api/pos/checkout')
      .set(header)
      .send({
        branch_id: 'main',
        shift_id: shiftId,
        party_id: 'walk-in-customer',
        date: '2026-03-02',
        discount: 0,
        lines: [{ product_id: 'edge-p2', quantity: 5, unit_price: 4000 }],
        payment: { method: 'CASH', amount_tendered: 22800, amount_paid: 22800 },
      })
      .expect(201);

    // Look up the sale by its invoice number, exactly as the till does.
    const lookup = await cashier
      .get(`/api/pos/sales/lookup?branch_id=main&q=${sale.body.document.number}`)
      .set(header)
      .expect(200);
    expect(lookup.body).toHaveLength(1);
    expect(lookup.body[0].id).toBe(sale.body.document.id);

    // The returnable endpoint reports the full quantity as still returnable.
    const returnable = await cashier
      .get(`/api/pos/sales/${sale.body.document.id}/returnable`)
      .set(header)
      .expect(200);
    expect(returnable.body[0].returnable).toBe(5);

    // Refund 2 units from the till.
    const refund = await cashier
      .post('/api/pos/return')
      .set(header)
      .send({
        document_id: sale.body.document.id,
        method: 'CASH',
        lines: [{ product_id: 'edge-p2', quantity: 2 }],
      })
      .expect(201);
    expect(refund.body.refund_total).toBeGreaterThan(0);
    expect(refund.body.shift_id).toBe(shiftId);

    // Stock was restored (10 + 2 returned − 5 sold + ... = net -3 from the sale).
    expect(
      one<{ quantity: number }>(
        "SELECT quantity FROM branch_stock WHERE branch_id='main' AND product_id='edge-p2'",
      )?.quantity,
    ).toBe(7);

    // Refunding more than remains is rejected.
    const over = await cashier
      .post('/api/pos/return')
      .set(header)
      .send({
        document_id: sale.body.document.id,
        method: 'CASH',
        lines: [{ product_id: 'edge-p2', quantity: 5 }],
      });
    expect(over.status).toBe(400);

    // The shift summary nets the refund against expected cash.
    const summary = await cashier.get(`/api/pos/shifts/${shiftId}/summary`).set(header).expect(200);
    expect(summary.body.refunds_count).toBe(1);
    expect(summary.body.refunds_total).toBe(refund.body.refund_total);
  });

  it('orders POS products by top sellers when asked', async () => {
    const recent = new Date().toISOString().slice(0, 10);
    // Sell 6 sugar and 1 coffee so their popularity differs.
    await cashier
      .post('/api/pos/checkout')
      .set(header)
      .send({
        branch_id: 'main',
        shift_id: shiftId,
        party_id: 'walk-in-customer',
        date: recent,
        discount: 0,
        lines: [
          { product_id: 'edge-p3', quantity: 6, unit_price: 1500 },
          { product_id: 'edge-p2', quantity: 1, unit_price: 4000 },
        ],
        payment: { method: 'CASH', amount_tendered: 15000, amount_paid: 15000 },
      })
      .expect(201);

    const top = await cashier.get('/api/pos/products?branch_id=main&top=3').set(header).expect(200);
    expect(top.body[0].sku).toBe('EDGE-3');
    expect(top.body[0].units_sold).toBe(6);
    expect(top.body[1].sku).toBe('EDGE-2');

    // Every product still carries the units_sold column, even the unsold one.
    const all = await cashier.get('/api/pos/products?branch_id=main').set(header).expect(200);
    const tea = all.body.find((p: { sku: string }) => p.sku === 'EDGE-1');
    expect(tea.units_sold).toBe(0);
  });

  it('invalidates the session of a user who is deactivated mid-session', async () => {
    await cashier.get('/api/pos/shifts/current?branch_id=main').set(header).expect(200);
    run("UPDATE users SET active=0 WHERE id='cashier-1'");
    const res = await cashier.get('/api/pos/shifts/current?branch_id=main').set(header);
    expect(res.status).toBe(401);
  });
});
