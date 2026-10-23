/**
 * Pack 2.2 — Batch & Expiry Date Tracking (أرقام التشغيلات وتواريخ الصلاحية).
 *
 * Covers:
 *  - Product batch tracking setting toggle (track_batches: 0 / 1).
 *  - Purchase invoice creates batch with batch_number, expiry_date, quantity.
 *  - FEFO (First-Expired, First-Out) automated stock deduction on sales.
 *  - Explicit batch selection on sales.
 *  - Isolation of expired batches: prevents selling expired items.
 *  - Expiry alert reporting (/inventory/expiry-alerts) with summary (critical, warning, expired).
 *  - Restoring batch stock on document cancellation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { header, seedUsers, signIn, resetBusinessData } from './helpers';
import { all, one, run, now } from '../server/db';

beforeEach(async () => {
  resetBusinessData();
  run('DELETE FROM user_branches');
  run('DELETE FROM users');
  await seedUsers();

  // Create test product with track_batches = 1
  run(
    `INSERT INTO products(id,sku,name,category,unit,sale_price,cost_price,min_stock,active,created_at)
     VALUES('med-1','MED-001','أوجمنتين 1 جم','أدوية','علبة',9500,7000,5,1,?)`,
    now(),
  );
  run(`INSERT INTO product_batch_settings(product_id,track_batches) VALUES('med-1', 1)`);
  run(`INSERT INTO branch_products(branch_id,product_id,active) VALUES('main','med-1',1)`);
  run(`INSERT INTO branch_stock(branch_id,product_id,quantity) VALUES('main','med-1',0)`);
  run(
    `INSERT INTO branch_cost(branch_id,product_id,avg_cost,total_value,updated_at) VALUES('main','med-1',7000,0,?)`,
    now(),
  );

  // Ensure test supplier exists
  run(
    `INSERT OR IGNORE INTO parties(id,type,name,phone,email,address,tax_number,notes,active,created_at)
     VALUES('sup-test','SUPPLIER','شركة الأدوية الحديثة','01000000000','','','','',1,?)`,
    now(),
  );
});

async function admin() {
  return signIn('admin@test.local');
}

describe('Pack 2.2 — Batch & Expiry Date Tracking (FEFO)', () => {
  it('supports creating and updating product batch tracking settings', async () => {
    const client = await admin();

    // 1. Create a product with track_batches = 1
    const createRes = await client
      .post('/api/products')
      .set(header)
      .send({
        sku: 'PAN-01',
        name: 'بنادول إكسترا',
        category: 'أدوية',
        unit: 'علبة',
        sale_price: 4500,
        cost_price: 3000,
        min_stock: 10,
        track_batches: 1,
      })
      .expect(201);

    expect(createRes.body.track_batches).toBe(1);

    // 2. Read products list
    const listRes = await client.get('/api/products').set(header).expect(200);
    const panadol = listRes.body.find((p: any) => p.id === createRes.body.id);
    expect(panadol.track_batches).toBe(1);

    // 3. Update track_batches to 0
    const updateRes = await client
      .put(`/api/products/${createRes.body.id}`)
      .set(header)
      .send({
        sku: 'PAN-01',
        name: 'بنادول إكسترا',
        category: 'أدوية',
        unit: 'علبة',
        sale_price: 4500,
        cost_price: 3000,
        min_stock: 10,
        track_batches: 0,
      })
      .expect(200);

    expect(updateRes.body.track_batches).toBe(0);
  });

  it('creates stock batch upon posting a purchase invoice with batch info', async () => {
    const client = await admin();

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 180);
    const expiryStr = futureDate.toISOString().slice(0, 10);

    // Create Purchase Invoice
    const docRes = await client
      .post('/api/documents')
      .set(header)
      .send({
        type: 'PURCHASE',
        branch_id: 'main',
        party_id: 'sup-test',
        date: new Date().toISOString().slice(0, 10),
        due_date: new Date().toISOString().slice(0, 10),
        discount: 0,
        tax_rate: 0,
        notes: 'شراء دفعة أدوية',
        lines: [
          {
            product_id: 'med-1',
            quantity: 50,
            unit_price: 7000,
            batch_number: 'BATCH-2026-001',
            production_date: '2026-01-01',
            expiry_date: expiryStr,
          },
        ],
      })
      .expect(201);

    // Post Document
    await client.post(`/api/documents/${docRes.body.id}/post`).set(header).expect(200);

    // Verify batch was created in stock_batches
    const batches = all<{
      batch_number: string;
      quantity: number;
      expiry_date: string;
    }>("SELECT batch_number, quantity, expiry_date FROM stock_batches WHERE product_id='med-1'");

    expect(batches).toHaveLength(1);
    expect(batches[0].batch_number).toBe('BATCH-2026-001');
    expect(batches[0].quantity).toBe(50);
    expect(batches[0].expiry_date).toBe(expiryStr);
  });

  it('allocates stock using FEFO (First-Expired, First-Out) automatically on sales', async () => {
    const client = await admin();

    const today = new Date();
    // Batch 1 expires in 20 days (CRITICAL)
    const expiry1 = new Date(today);
    expiry1.setDate(today.getDate() + 20);
    const exp1Str = expiry1.toISOString().slice(0, 10);

    // Batch 2 expires in 120 days (HEALTHY)
    const expiry2 = new Date(today);
    expiry2.setDate(today.getDate() + 120);
    const exp2Str = expiry2.toISOString().slice(0, 10);

    // Seed 2 batches directly
    run(
      `INSERT INTO stock_batches(id, product_id, branch_id, batch_number, expiry_date, quantity, cost_price, created_at)
       VALUES('b-1', 'med-1', 'main', 'BN-EARLY', ?, 15, 7000, ?)`,
      exp1Str,
      now(),
    );
    run(
      `INSERT INTO stock_batches(id, product_id, branch_id, batch_number, expiry_date, quantity, cost_price, created_at)
       VALUES('b-2', 'med-1', 'main', 'BN-LATER', ?, 25, 7000, ?)`,
      exp2Str,
      now(),
    );
    run("UPDATE branch_stock SET quantity = 40 WHERE product_id='med-1' AND branch_id='main'");

    // Sell 10 units without specifying batch — FEFO should take 10 from BN-EARLY
    const saleRes = await client
      .post('/api/documents')
      .set(header)
      .send({
        type: 'SALE',
        branch_id: 'main',
        party_id: 'walk-in-customer',
        date: today.toISOString().slice(0, 10),
        due_date: today.toISOString().slice(0, 10),
        discount: 0,
        tax_rate: 0,
        lines: [
          {
            product_id: 'med-1',
            quantity: 10,
            unit_price: 9500,
          },
        ],
      })
      .expect(201);

    await client.post(`/api/documents/${saleRes.body.id}/post`).set(header).expect(200);

    // Check batch quantities: b-1 should be 5 (15 - 10), b-2 still 25
    const b1 = one<{ quantity: number }>("SELECT quantity FROM stock_batches WHERE id='b-1'");
    const b2 = one<{ quantity: number }>("SELECT quantity FROM stock_batches WHERE id='b-2'");
    expect(b1?.quantity).toBe(5);
    expect(b2?.quantity).toBe(25);

    // Next sale: 10 units. It should consume remaining 5 from b-1 and 5 from b-2!
    const sale2Res = await client
      .post('/api/documents')
      .set(header)
      .send({
        type: 'SALE',
        branch_id: 'main',
        party_id: 'walk-in-customer',
        date: today.toISOString().slice(0, 10),
        due_date: today.toISOString().slice(0, 10),
        discount: 0,
        tax_rate: 0,
        lines: [
          {
            product_id: 'med-1',
            quantity: 10,
            unit_price: 9500,
          },
        ],
      })
      .expect(201);

    await client.post(`/api/documents/${sale2Res.body.id}/post`).set(header).expect(200);

    const b1After = one<{ quantity: number }>("SELECT quantity FROM stock_batches WHERE id='b-1'");
    const b2After = one<{ quantity: number }>("SELECT quantity FROM stock_batches WHERE id='b-2'");
    expect(b1After?.quantity).toBe(0);
    expect(b2After?.quantity).toBe(20);
  });

  it('strictly isolates expired batches and prevents selling them', async () => {
    const client = await admin();

    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);
    const expiredStr = pastDate.toISOString().slice(0, 10);

    // Insert an expired batch
    run(
      `INSERT INTO stock_batches(id, product_id, branch_id, batch_number, expiry_date, quantity, cost_price, created_at)
       VALUES('b-expired', 'med-1', 'main', 'BN-EXPIRED', ?, 20, 7000, ?)`,
      expiredStr,
      now(),
    );
    run("UPDATE branch_stock SET quantity = 20 WHERE product_id='med-1' AND branch_id='main'");

    // 1. Trying to sell without batch (FEFO should reject since no valid batches exist)
    const sale1 = await client
      .post('/api/documents')
      .set(header)
      .send({
        type: 'SALE',
        branch_id: 'main',
        party_id: 'walk-in-customer',
        date: new Date().toISOString().slice(0, 10),
        due_date: new Date().toISOString().slice(0, 10),
        discount: 0,
        tax_rate: 0,
        lines: [{ product_id: 'med-1', quantity: 5, unit_price: 9500 }],
      })
      .expect(201);

    const postRes = await client
      .post(`/api/documents/${sale1.body.id}/post`)
      .set(header)
      .expect(409);

    expect(postRes.body.error).toContain('غير كافية');

    // 2. Trying to explicitly select the expired batch should be rejected with 400
    const sale2 = await client
      .post('/api/documents')
      .set(header)
      .send({
        type: 'SALE',
        branch_id: 'main',
        party_id: 'walk-in-customer',
        date: new Date().toISOString().slice(0, 10),
        due_date: new Date().toISOString().slice(0, 10),
        discount: 0,
        tax_rate: 0,
        lines: [{ product_id: 'med-1', quantity: 5, unit_price: 9500, batch_id: 'b-expired' }],
      })
      .expect(201);

    const postExpiredRes = await client
      .post(`/api/documents/${sale2.body.id}/post`)
      .set(header)
      .expect(400);

    expect(postExpiredRes.body.error).toContain('منتهية الصلاحية');
  });

  it('returns expiry alerts summary and lists batches correctly', async () => {
    const client = await admin();

    const today = new Date();

    // 1 expired
    const expDate = new Date(today);
    expDate.setDate(today.getDate() - 5);
    run(
      `INSERT INTO stock_batches(id, product_id, branch_id, batch_number, expiry_date, quantity, cost_price, created_at)
       VALUES('b-exp', 'med-1', 'main', 'EXP-01', ?, 5, 7000, ?)`,
      expDate.toISOString().slice(0, 10),
      now(),
    );

    // 1 critical (< 30 days)
    const critDate = new Date(today);
    critDate.setDate(today.getDate() + 15);
    run(
      `INSERT INTO stock_batches(id, product_id, branch_id, batch_number, expiry_date, quantity, cost_price, created_at)
       VALUES('b-crit', 'med-1', 'main', 'CRIT-01', ?, 10, 7000, ?)`,
      critDate.toISOString().slice(0, 10),
      now(),
    );

    // 1 warning (30-90 days)
    const warnDate = new Date(today);
    warnDate.setDate(today.getDate() + 45);
    run(
      `INSERT INTO stock_batches(id, product_id, branch_id, batch_number, expiry_date, quantity, cost_price, created_at)
       VALUES('b-warn', 'med-1', 'main', 'WARN-01', ?, 20, 7000, ?)`,
      warnDate.toISOString().slice(0, 10),
      now(),
    );

    // 1 healthy (> 90 days)
    const safeDate = new Date(today);
    safeDate.setDate(today.getDate() + 180);
    run(
      `INSERT INTO stock_batches(id, product_id, branch_id, batch_number, expiry_date, quantity, cost_price, created_at)
       VALUES('b-safe', 'med-1', 'main', 'SAFE-01', ?, 30, 7000, ?)`,
      safeDate.toISOString().slice(0, 10),
      now(),
    );

    // Test GET /api/inventory/expiry-alerts
    const res = await client.get('/api/inventory/expiry-alerts').set(header).expect(200);

    expect(res.body.summary.total_batches).toBe(4);
    expect(res.body.summary.expired_count).toBe(1);
    expect(res.body.summary.critical_count).toBe(1);
    expect(res.body.summary.warning_count).toBe(1);
    expect(res.body.summary.healthy_count).toBe(1);

    // Test GET /api/products/med-1/batches
    const batchesRes = await client
      .get('/api/products/med-1/batches?branch_id=main')
      .set(header)
      .expect(200);
    expect(batchesRes.body).toHaveLength(4);
    expect(batchesRes.body[0].status).toBe('EXPIRED');
    expect(batchesRes.body[1].status).toBe('CRITICAL');
  });

  it('restores batch quantities when a sale document is cancelled', async () => {
    const client = await admin();

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 60);
    const expStr = futureDate.toISOString().slice(0, 10);

    run(
      `INSERT INTO stock_batches(id, product_id, branch_id, batch_number, expiry_date, quantity, cost_price, created_at)
       VALUES('b-restore', 'med-1', 'main', 'BN-RESTORE', ?, 25, 7000, ?)`,
      expStr,
      now(),
    );
    run("UPDATE branch_stock SET quantity = 25 WHERE product_id='med-1' AND branch_id='main'");

    const sale = await client
      .post('/api/documents')
      .set(header)
      .send({
        type: 'SALE',
        branch_id: 'main',
        party_id: 'walk-in-customer',
        date: new Date().toISOString().slice(0, 10),
        due_date: new Date().toISOString().slice(0, 10),
        discount: 0,
        tax_rate: 0,
        lines: [{ product_id: 'med-1', quantity: 10, unit_price: 9500, batch_id: 'b-restore' }],
      })
      .expect(201);

    await client.post(`/api/documents/${sale.body.id}/post`).set(header).expect(200);

    // Batch quantity after sale: 15
    const bAfterSale = one<{ quantity: number }>(
      "SELECT quantity FROM stock_batches WHERE id='b-restore'",
    );
    expect(bAfterSale?.quantity).toBe(15);

    // Cancel sale
    await client.post(`/api/documents/${sale.body.id}/cancel`).set(header).expect(200);

    // Batch quantity restored to 25
    const bAfterCancel = one<{ quantity: number }>(
      "SELECT quantity FROM stock_batches WHERE id='b-restore'",
    );
    expect(bAfterCancel?.quantity).toBe(25);
  });
});
