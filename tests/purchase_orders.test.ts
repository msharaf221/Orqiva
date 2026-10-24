/**
 * Tests for Pack 2.4: Purchase Orders workflow and Landed Costs capitalization onto WAC.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { header, seedUsers, signIn, resetBusinessData } from './helpers';
import { one, run, now } from '../server/db';

beforeEach(async () => {
  resetBusinessData();
  run('DELETE FROM user_branches');
  run('DELETE FROM users');
  await seedUsers();

  // Create test supplier
  run(
    `INSERT INTO parties(id, type, name, email, phone, address, tax_number, notes, active, created_at)
     VALUES('sup-1', 'SUPPLIER', 'شركة التوريدات المصرية', 'supplier@test.local', '01011223344', 'القاهرة', '123456789', '', 1, ?)`,
    now(),
  );

  // Create test products
  run(
    `INSERT INTO products(id, sku, name, category, unit, sale_price, cost_price, min_stock, active, created_at)
     VALUES('po-p1', 'SKU-PO-1', 'ماكينة قهوة احترافية', 'أجهزة', 'قطعة', 1500000, 1000000, 5, 1, ?)`,
    now(),
  );
  run(`INSERT INTO branch_products(branch_id, product_id, active) VALUES('main', 'po-p1', 1)`);
  run(`INSERT INTO branch_stock(branch_id, product_id, quantity) VALUES('main', 'po-p1', 0)`);

  run(
    `INSERT INTO products(id, sku, name, category, unit, sale_price, cost_price, min_stock, active, created_at)
     VALUES('po-p2', 'SKU-PO-2', 'طاحونة بن إيطالية', 'أجهزة', 'قطعة', 800000, 500000, 5, 1, ?)`,
    now(),
  );
  run(`INSERT INTO branch_products(branch_id, product_id, active) VALUES('main', 'po-p2', 1)`);
  run(`INSERT INTO branch_stock(branch_id, product_id, quantity) VALUES('main', 'po-p2', 0)`);
});

describe('Pack 2.4 — Purchase Orders & Landed Costs', () => {
  it('creates, updates, and confirms a purchase order', async () => {
    const admin = await signIn('admin@test.local');

    // Create PO
    const res = await admin
      .post('/api/purchase-orders')
      .set(header)
      .send({
        branch_id: 'main',
        party_id: 'sup-1',
        date: '2026-10-23',
        expected_delivery_date: '2026-10-30',
        tax_rate: 1400, // 14%
        notes: 'طلب توريد أجهزة كافيه',
        lines: [
          { product_id: 'po-p1', quantity: 10, unit_price: 1000000 }, // 10 * 10,000 = 100,000 EGP
          { product_id: 'po-p2', quantity: 5, unit_price: 500000 }, // 5 * 5,000 = 25,000 EGP
        ],
      })
      .expect(201);

    const po = res.body;
    expect(po.number).toContain('PO-ORD-HQ-2026-');
    expect(po.status).toBe('DRAFT');
    expect(po.subtotal).toBe(12500000); // 125,000 EGP
    expect(po.tax).toBe(0); // tax-free mode
    expect(po.total).toBe(12500000); // 125,000 EGP
    expect(po.lines).toHaveLength(2);

    // Update PO while still draft
    const updateRes = await admin
      .put(`/api/purchase-orders/${po.id}`)
      .set(header)
      .send({
        branch_id: 'main',
        party_id: 'sup-1',
        date: '2026-10-23',
        expected_delivery_date: '2026-11-05',
        tax_rate: 1400,
        notes: 'طلب توريد معدل',
        lines: [
          { product_id: 'po-p1', quantity: 12, unit_price: 1000000 }, // 12 * 10,000 = 120,000 EGP
        ],
      })
      .expect(200);

    expect(updateRes.body.subtotal).toBe(12000000);
    expect(updateRes.body.lines).toHaveLength(1);

    // Confirm PO
    const confirmRes = await admin
      .post(`/api/purchase-orders/${po.id}/confirm`)
      .set(header)
      .send({})
      .expect(200);

    expect(confirmRes.body.status).toBe('CONFIRMED');

    // Cannot modify confirmed PO
    await admin
      .put(`/api/purchase-orders/${po.id}`)
      .set(header)
      .send({
        branch_id: 'main',
        party_id: 'sup-1',
        date: '2026-10-23',
        lines: [{ product_id: 'po-p1', quantity: 1, unit_price: 1000000 }],
      })
      .expect(400);
  });

  it('receives goods against a confirmed PO in partial stages', async () => {
    const admin = await signIn('admin@test.local');

    // Create & confirm PO with 2 products
    const poRes = await admin
      .post('/api/purchase-orders')
      .set(header)
      .send({
        branch_id: 'main',
        party_id: 'sup-1',
        date: '2026-10-23',
        tax_rate: 1400,
        lines: [
          { product_id: 'po-p1', quantity: 10, unit_price: 1000000 },
          { product_id: 'po-p2', quantity: 4, unit_price: 500000 },
        ],
      })
      .expect(201);

    const poId = poRes.body.id;
    await admin.post(`/api/purchase-orders/${poId}/confirm`).set(header).send({}).expect(200);

    // First partial receiving: 5 of po-p1 and 2 of po-p2
    const recv1 = await admin
      .post(`/api/purchase-orders/${poId}/receive`)
      .set(header)
      .send({
        received_lines: [
          { product_id: 'po-p1', quantity: 5 },
          { product_id: 'po-p2', quantity: 2 },
        ],
        notes: 'الدفعة الأولى',
      })
      .expect(200);

    expect(recv1.body.purchase_order.status).toBe('PARTIALLY_RECEIVED');
    expect(recv1.body.document).toBeDefined();
    expect(recv1.body.document.type).toBe('PURCHASE');
    expect(recv1.body.document.lines).toHaveLength(2);

    // Post the generated purchase bill
    await admin
      .post(`/api/documents/${recv1.body.document.id}/post`)
      .set(header)
      .send({})
      .expect(200);

    // Second receiving: remaining items
    const recv2 = await admin
      .post(`/api/purchase-orders/${poId}/receive`)
      .set(header)
      .send({
        received_lines: [
          { product_id: 'po-p1', quantity: 5 },
          { product_id: 'po-p2', quantity: 2 },
        ],
        notes: 'الدفعة الثانية والأخيرة',
      })
      .expect(200);

    expect(recv2.body.purchase_order.status).toBe('RECEIVED');
  });

  it('capitalizes landed costs (shipping/customs) onto WAC and posts to General Ledger', async () => {
    const admin = await signIn('admin@test.local');

    // 1. Create and post a purchase invoice directly
    const docRes = await admin
      .post('/api/documents')
      .set(header)
      .send({
        type: 'PURCHASE',
        branch_id: 'main',
        party_id: 'sup-1',
        date: '2026-10-23',
        due_date: '2026-10-30',
        discount: 0,
        tax_rate: 0,
        lines: [
          { product_id: 'po-p1', quantity: 10, unit_price: 1000000 }, // 10 units @ 10,000 EGP = 100,000 EGP
          { product_id: 'po-p2', quantity: 10, unit_price: 500000 }, // 10 units @ 5,000 EGP = 50,000 EGP
        ],
      })
      .expect(201);

    const docId = docRes.body.id;
    await admin.post(`/api/documents/${docId}/post`).set(header).send({}).expect(200);

    // Initial WAC:
    // po-p1: avg_cost = 1,000,000 piasters (10,000 EGP)
    // po-p2: avg_cost = 500,000 piasters (5,000 EGP)
    const cost1Before = one<{ avg_cost: number }>(
      "SELECT avg_cost FROM branch_cost WHERE branch_id = 'main' AND product_id = 'po-p1'",
    );
    expect(cost1Before?.avg_cost).toBe(1000000);

    // 2. Add Landed Cost of 15,000 EGP (1,500,000 piasters) allocated BY_VALUE
    // Total value = 150,000 EGP
    // po-p1 share = 100,000 / 150,000 * 15,000 = 10,000 EGP (1,000,000 piasters)
    // Additional cost per unit for po-p1 = 1,000,000 / 10 = 100,000 piasters (+1,000 EGP per unit)
    // New WAC for po-p1 should be 1,000,000 + 100,000 = 1,100,000 piasters (11,000 EGP)!
    const landedRes = await admin
      .post(`/api/documents/${docId}/landed-costs`)
      .set(header)
      .send({
        cost_type: 'CUSTOMS',
        cost_name: 'جمارك وارد وشحن بحري',
        amount: 1500000,
        allocation_method: 'BY_VALUE',
        notes: 'بوليصة شحن رقم 987654',
      })
      .expect(201);

    expect(landedRes.body.cost_type).toBe('CUSTOMS');
    expect(landedRes.body.amount).toBe(1500000);
    expect(landedRes.body.allocations).toHaveLength(2);

    // 3. Verify updated WAC
    const cost1After = one<{ avg_cost: number; total_value: number }>(
      "SELECT avg_cost, total_value FROM branch_cost WHERE branch_id = 'main' AND product_id = 'po-p1'",
    );
    expect(cost1After?.avg_cost).toBe(1100000); // 11,000 EGP per unit

    const cost2After = one<{ avg_cost: number; total_value: number }>(
      "SELECT avg_cost, total_value FROM branch_cost WHERE branch_id = 'main' AND product_id = 'po-p2'",
    );
    expect(cost2After?.avg_cost).toBe(550000); // 5,500 EGP per unit (+500 EGP)

    // 4. Verify cost_movements log
    const cm = one<{ reason: string; avg_after: number }>(
      "SELECT reason, avg_after FROM cost_movements WHERE product_id = 'po-p1' ORDER BY created_at DESC LIMIT 1",
    );
    expect(cm?.reason).toContain('جمارك وارد وشحن بحري');
    expect(cm?.avg_after).toBe(1100000);

    // 5. Verify General Ledger entry
    const entry = one<{ id: string; status: string }>(
      `SELECT id, status FROM journal_entries WHERE source_id = ? AND source_type = 'PURCHASE'`,
      landedRes.body.id,
    );
    expect(entry).toBeDefined();
    expect(entry?.status).toBe('POSTED');

    // Check balanced lines (Debit Inventory 15,000 EGP, Credit AP 15,000 EGP)
    const glLines = one<{ debits: number; credits: number }>(
      `SELECT SUM(debit) as debits, SUM(credit) as credits FROM journal_lines WHERE entry_id = ?`,
      entry!.id,
    );
    expect(glLines?.debits).toBe(1500000);
    expect(glLines?.credits).toBe(1500000);
  });
});
