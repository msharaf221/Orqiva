/**
 * Weighted Average Cost (WAC) — integration tests.
 *
 * Tests cover:
 *  1. Purchase updates WAC correctly.
 *  2. Second purchase with different price blends correctly.
 *  3. Sale snapshots WAC into document_lines.cost_price.
 *  4. Transfer ships at WAC and receiving branch inherits that cost.
 *  5. Cancel reversal restores WAC correctly.
 *  6. Adjustment uses reference cost_price as initial WAC.
 *  7. Stock value in reports uses WAC (not reference cost).
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { seedUsers, signIn, resetBusinessData, ledgerReconciles } from './helpers';
import { all, one } from '../server/db';
import { header } from './helpers';

beforeAll(seedUsers);
beforeEach(resetBusinessData);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getAdmin() {
  return signIn('admin@test.local');
}

/** Creates supplier, product, and purchase invoice; returns IDs. */
async function setupProduct(
  admin: ReturnType<typeof signIn> extends Promise<infer T> ? T : never,
  opts: { costPrice?: number; salePriceOverride?: number } = {},
) {
  const costPrice = opts.costPrice ?? 10000; // 100.00 EGP default

  const supplierRes = await admin.post('/api/parties').set(header).send({
    type: 'SUPPLIER',
    name: 'مورد اختبار',
    phone: '',
    email: '',
    address: '',
    tax_number: '',
    notes: '',
  });
  expect(supplierRes.status).toBe(201);
  const supplierId = supplierRes.body.id;

  const productRes = await admin
    .post('/api/products')
    .set(header)
    .send({
      sku: 'TEST-WAC-001',
      name: 'منتج اختبار WAC',
      category: 'اختبار',
      unit: 'قطعة',
      sale_price: opts.salePriceOverride ?? 15000,
      cost_price: costPrice,
      min_stock: 0,
    });
  expect(productRes.status).toBe(201);
  const productId = productRes.body.id;

  return { supplierId, productId, costPrice };
}

/** Posts a purchase invoice and returns the document. */
async function postPurchase(
  admin: ReturnType<typeof signIn> extends Promise<infer T> ? T : never,
  supplierId: string,
  productId: string,
  qty: number,
  unitPrice: number,
) {
  const today = new Date().toISOString().slice(0, 10);
  const draft = await admin
    .post('/api/documents')
    .set(header)
    .send({
      type: 'PURCHASE',
      branch_id: 'main',
      party_id: supplierId,
      date: today,
      due_date: today,
      tax_rate: 0,
      discount: 0,
      notes: '',
      lines: [{ product_id: productId, quantity: qty, unit_price: unitPrice }],
    });
  expect(draft.status).toBe(201);
  const docId = draft.body.id;
  const posted = await admin.post(`/api/documents/${docId}/post`).set(header).send({});
  expect(posted.status).toBe(200);
  return posted.body;
}

/** Posts a sale invoice and returns the document. */
async function postSale(
  admin: ReturnType<typeof signIn> extends Promise<infer T> ? T : never,
  customerId: string,
  productId: string,
  qty: number,
  unitPrice: number,
) {
  const today = new Date().toISOString().slice(0, 10);
  const draft = await admin
    .post('/api/documents')
    .set(header)
    .send({
      type: 'SALE',
      branch_id: 'main',
      party_id: customerId,
      date: today,
      due_date: today,
      tax_rate: 0,
      discount: 0,
      notes: '',
      lines: [{ product_id: productId, quantity: qty, unit_price: unitPrice }],
    });
  expect(draft.status).toBe(201);
  const docId = draft.body.id;
  const posted = await admin.post(`/api/documents/${docId}/post`).set(header).send({});
  expect(posted.status).toBe(200);
  return posted.body;
}

function getBranchCost(branchId: string, productId: string) {
  return one<{ avg_cost: number; total_value: number }>(
    'SELECT avg_cost, total_value FROM branch_cost WHERE branch_id=? AND product_id=?',
    branchId,
    productId,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WAC — Purchase', () => {
  it('creates branch_cost row after first purchase', async () => {
    const admin = await getAdmin();
    const { supplierId, productId } = await setupProduct(admin, { costPrice: 10000 });

    await postPurchase(admin, supplierId, productId, 10, 10000); // 10 units @ 100.00

    const cost = getBranchCost('main', productId);
    expect(cost).not.toBeNull();
    expect(cost!.avg_cost).toBe(10000);
    expect(cost!.total_value).toBe(100000); // 10 * 10000
  });

  it('blends WAC correctly on second purchase at higher price', async () => {
    const admin = await getAdmin();
    const { supplierId, productId } = await setupProduct(admin, { costPrice: 10000 });

    // First purchase: 10 units @ 10000 piastres
    await postPurchase(admin, supplierId, productId, 10, 10000);
    // Second purchase: 10 units @ 12000 piastres
    await postPurchase(admin, supplierId, productId, 10, 12000);

    // Expected WAC = (10*10000 + 10*12000) / 20 = 220000 / 20 = 11000
    const cost = getBranchCost('main', productId);
    expect(cost!.avg_cost).toBe(11000);
    expect(cost!.total_value).toBe(220000); // 20 * 11000
    expect(ledgerReconciles()).toBe(true);
  });

  it('records cost_movements on each purchase', async () => {
    const admin = await getAdmin();
    const { supplierId, productId } = await setupProduct(admin, { costPrice: 10000 });

    await postPurchase(admin, supplierId, productId, 5, 10000);

    const movements = all<{ delta_qty: number; avg_after: number }>(
      'SELECT delta_qty, avg_after FROM cost_movements WHERE product_id=? AND branch_id=?',
      productId,
      'main',
    );
    // One from the migration seed + one from the purchase
    const purchaseMovements = movements.filter((m) => m.delta_qty > 0);
    expect(purchaseMovements.length).toBeGreaterThanOrEqual(1);
    expect(purchaseMovements[purchaseMovements.length - 1].avg_after).toBe(10000);
  });
});

describe('WAC — Sale snapshots correct COGS', () => {
  it('snapshots WAC into document_lines.cost_price at time of sale', async () => {
    const admin = await getAdmin();
    const { supplierId, productId } = await setupProduct(admin, { costPrice: 10000 });

    // Purchase at 12000 — WAC becomes 12000
    await postPurchase(admin, supplierId, productId, 10, 12000);

    const custRes = await admin.post('/api/parties').set(header).send({
      type: 'CUSTOMER',
      name: 'عميل اختبار',
      phone: '',
      email: '',
      address: '',
      tax_number: '',
      notes: '',
    });
    const customerId = custRes.body.id;

    const saleDOc = await postSale(admin, customerId, productId, 3, 20000);

    // The line's cost_price should be 12000 (WAC), not 10000 (reference)
    const line = saleDOc.lines[0];
    expect(line.cost_price).toBe(12000);
    expect(ledgerReconciles()).toBe(true);
  });

  it('WAC stays unchanged after sale (only total_value decreases)', async () => {
    const admin = await getAdmin();
    const { supplierId, productId } = await setupProduct(admin, { costPrice: 10000 });

    await postPurchase(admin, supplierId, productId, 10, 12000); // WAC = 12000

    const custRes = await admin.post('/api/parties').set(header).send({
      type: 'CUSTOMER',
      name: 'عميل اختبار',
      phone: '',
      email: '',
      address: '',
      tax_number: '',
      notes: '',
    });
    const customerId = custRes.body.id;

    await postSale(admin, customerId, productId, 4, 20000); // Sell 4 units

    const cost = getBranchCost('main', productId);
    expect(cost!.avg_cost).toBe(12000); // unchanged
    expect(cost!.total_value).toBe(6 * 12000); // 6 remaining * 12000
  });
});

describe('WAC — Transfer carries cost to receiving branch', () => {
  it('receiving branch gets the shipped WAC', async () => {
    const admin = await getAdmin();
    const today = new Date().toISOString().slice(0, 10);

    const { supplierId, productId } = await setupProduct(admin, { costPrice: 10000 });
    await postPurchase(admin, supplierId, productId, 20, 14000); // WAC in HQ = 14000

    // Create branch B
    const branchRes = await admin.post('/api/branches').set(header).send({
      code: 'BRB',
      name: 'فرع ب',
      kind: 'STORE',
      phone: '',
      address: '',
      opened_on: '2020-01-01',
    });
    expect(branchRes.status).toBe(201);
    const branchBId = branchRes.body.id;

    // List product in branch B
    await admin.put(`/api/branches/${branchBId}/assortment/${productId}`).set(header).send({
      active: true,
      sale_price: null,
      min_stock: null,
    });

    // Create and ship transfer from HQ to B
    const transferRes = await admin
      .post('/api/transfers')
      .set(header)
      .send({
        from_branch_id: 'main',
        to_branch_id: branchBId,
        date: today,
        notes: '',
        lines: [{ product_id: productId, quantity: 5 }],
      });
    expect(transferRes.status).toBe(201);
    const transferId = transferRes.body.id;

    await admin.post(`/api/transfers/${transferId}/ship`).set(header).send({});
    await admin
      .post(`/api/transfers/${transferId}/receive`)
      .set(header)
      .send({
        lines: [{ product_id: productId, quantity_received: 5 }],
      });

    // Branch B's WAC should be 14000 (inherited from HQ shipment)
    const costB = getBranchCost(branchBId, productId);
    expect(costB).not.toBeNull();
    expect(costB!.avg_cost).toBe(14000);
    expect(costB!.total_value).toBe(5 * 14000);

    // HQ's WAC is still 14000, value now reflects 15 units
    const costHQ = getBranchCost('main', productId);
    expect(costHQ!.avg_cost).toBe(14000);
    expect(costHQ!.total_value).toBe(15 * 14000);

    expect(ledgerReconciles()).toBe(true);
  });
});

describe('WAC — Cancel reversal', () => {
  it('cancelling a posted sale restores WAC total_value', async () => {
    const admin = await getAdmin();
    const { supplierId, productId } = await setupProduct(admin, { costPrice: 10000 });

    await postPurchase(admin, supplierId, productId, 10, 12000); // WAC = 12000, value = 120000

    const custRes = await admin.post('/api/parties').set(header).send({
      type: 'CUSTOMER',
      name: 'عميل اختبار',
      phone: '',
      email: '',
      address: '',
      tax_number: '',
      notes: '',
    });
    const customerId = custRes.body.id;

    const saleDoc = await postSale(admin, customerId, productId, 3, 20000); // sell 3, value = 84000

    const costAfterSale = getBranchCost('main', productId);
    expect(costAfterSale!.total_value).toBe(7 * 12000); // 7 remaining

    // Cancel the sale
    await admin.post(`/api/documents/${saleDoc.id}/cancel`).set(header).send({});

    // Stock returns; cost_price in the line was 12000 so WAC should re-blend at 12000
    const costAfterCancel = getBranchCost('main', productId);
    expect(costAfterCancel!.avg_cost).toBe(12000);
    expect(costAfterCancel!.total_value).toBe(10 * 12000); // back to 10 units
    expect(ledgerReconciles()).toBe(true);
  });
});

describe('WAC — Stock adjustment', () => {
  it('positive adjustment initialises WAC at reference cost_price', async () => {
    const admin = await getAdmin();

    const productRes = await admin.post('/api/products').set(header).send({
      sku: 'ADJ-WAC-001',
      name: 'منتج تسوية',
      category: 'اختبار',
      unit: 'قطعة',
      sale_price: 20000,
      cost_price: 8000,
      min_stock: 0,
    });
    const productId = productRes.body.id;

    await admin.post(`/api/products/${productId}/adjust`).set(header).send({
      branch_id: 'main',
      quantity: 15,
      reason: 'جرد افتتاحي',
    });

    const cost = getBranchCost('main', productId);
    expect(cost!.avg_cost).toBe(8000); // seeded from cost_price
    expect(cost!.total_value).toBe(15 * 8000);
  });
});

describe('WAC — Dashboard stock value', () => {
  it('dashboard stockValue reflects WAC rather than reference cost', async () => {
    const admin = await getAdmin();
    const { supplierId, productId } = await setupProduct(admin, { costPrice: 5000 });

    // Purchase at higher price — WAC = 9000
    await postPurchase(admin, supplierId, productId, 10, 9000);

    const today = new Date().toISOString().slice(0, 10);
    const dashRes = await admin.get(`/api/dashboard?from=${today}&to=${today}`);
    expect(dashRes.status).toBe(200);

    // Stock value should use WAC (9000) not reference (5000)
    // 10 units * 9000 = 90000 piastres
    expect(dashRes.body.stockValue).toBe(90000);
  });
});

describe('Pack 2.1 — Stock Valuation Report & GL Reconciliation', () => {
  it('computes stock valuation based on WAC and reconciles 100% with acc_inventory', async () => {
    const admin = await getAdmin();
    const supplierRes = await admin.post('/api/parties').set(header).send({
      type: 'SUPPLIER',
      name: 'مورد تقييم مخزون',
      phone: '',
      email: '',
      address: '',
      tax_number: '',
      notes: '',
    });
    const supplierId = supplierRes.body.id;

    // Create Product A
    const pARes = await admin.post('/api/products').set(header).send({
      sku: 'VAL-A-001',
      name: 'منتج أ تقييم',
      category: 'إلكترونيات',
      unit: 'قطعة',
      sale_price: 15000, // 150 EGP
      cost_price: 10000,
      min_stock: 2,
    });
    const pAId = pARes.body.id;

    // Create Product B
    const pBRes = await admin.post('/api/products').set(header).send({
      sku: 'VAL-B-002',
      name: 'منتج ب تقييم',
      category: 'قطع غيار',
      unit: 'قطعة',
      sale_price: 30000, // 300 EGP
      cost_price: 20000,
      min_stock: 1,
    });
    const pBId = pBRes.body.id;

    // Purchase 10 of A at 120.00 EGP (12000 piasters) => Total cost: 120,000 piasters
    await postPurchase(admin, supplierId, pAId, 10, 12000);

    // Purchase 5 of B at 220.00 EGP (22000 piasters) => Total cost: 110,000 piasters
    await postPurchase(admin, supplierId, pBId, 5, 22000);

    // Total expected inventory cost = 120,000 + 110,000 = 230,000 piasters (2,300.00 EGP)
    // Total retail = (10 * 15000) + (5 * 30000) = 150,000 + 150,000 = 300,000 piasters (3,000.00 EGP)
    // Potential profit = 300,000 - 230,000 = 70,000 piasters (700.00 EGP)
    const valRes = await admin.get('/api/inventory/valuation');
    expect(valRes.status).toBe(200);
    expect(valRes.body.summary).toBeDefined();
    expect(valRes.body.summary.total_inventory_cost).toBe(230000);
    expect(valRes.body.summary.total_inventory_retail).toBe(300000);
    expect(valRes.body.summary.total_potential_profit).toBe(70000);
    expect(valRes.body.summary.total_quantity).toBe(15);

    // GL Reconciliation check
    expect(valRes.body.gl_check).toBeDefined();
    expect(valRes.body.gl_check.gl_inventory_balance).toBe(230000);
    expect(valRes.body.gl_check.stock_valuation_total).toBe(230000);
    expect(valRes.body.gl_check.variance).toBe(0);
    expect(valRes.body.gl_check.reconciled).toBe(true);

    // Now sell 2 units of A at 150.00 EGP
    const custRes = await admin.post('/api/parties').set(header).send({
      type: 'CUSTOMER',
      name: 'عميل تقييم',
      phone: '',
      email: '',
      address: '',
      tax_number: '',
      notes: '',
    });
    const customerId = custRes.body.id;

    // Post sale of 2 units of A
    await postSale(admin, customerId, pAId, 2, 15000);

    // Remaining of A: 8 units @ 12000 = 96,000
    // Remaining of B: 5 units @ 22000 = 110,000
    // New total inventory: 206,000 piasters
    const valAfterSale = await admin.get('/api/inventory/valuation');
    expect(valAfterSale.status).toBe(200);
    expect(valAfterSale.body.summary.total_inventory_cost).toBe(206000);
    expect(valAfterSale.body.gl_check.gl_inventory_balance).toBe(206000);
    expect(valAfterSale.body.gl_check.stock_valuation_total).toBe(206000);
    expect(valAfterSale.body.gl_check.variance).toBe(0);
    expect(valAfterSale.body.gl_check.reconciled).toBe(true);
  });

  it('filters valuation report by branch, category, and stock status', async () => {
    const admin = await getAdmin();
    const { supplierId, productId } = await setupProduct(admin, { costPrice: 7000 });
    await postPurchase(admin, supplierId, productId, 6, 7000);

    // Filter by branch main
    const branchRes = await admin.get('/api/inventory/valuation?branch_id=main');
    expect(branchRes.status).toBe(200);
    const foundMain = branchRes.body.rows.find((r: any) => r.product_id === productId);
    expect(foundMain).toBeDefined();
    expect(foundMain.quantity).toBe(6);
    expect(foundMain.total_cost).toBe(42000);

    // Filter by category
    const catRes = await admin.get('/api/inventory/valuation?category=اختبار');
    expect(catRes.status).toBe(200);
    expect(catRes.body.rows.every((r: any) => r.category === 'اختبار')).toBe(true);

    // Filter by stock: in_stock vs out_of_stock
    const inStockRes = await admin.get('/api/inventory/valuation?stock=in_stock');
    expect(inStockRes.status).toBe(200);
    expect(inStockRes.body.rows.every((r: any) => r.quantity > 0)).toBe(true);
  });

  it('provides chronological WAC cost history per product', async () => {
    const admin = await getAdmin();
    const { supplierId, productId } = await setupProduct(admin, { costPrice: 10000 });

    // Purchase 1: 5 units @ 10000
    await postPurchase(admin, supplierId, productId, 5, 10000);
    // Purchase 2: 5 units @ 14000
    await postPurchase(admin, supplierId, productId, 5, 14000);

    const historyRes = await admin.get(`/api/inventory/cost-history/${productId}`);
    expect(historyRes.status).toBe(200);
    expect(Array.isArray(historyRes.body)).toBe(true);
    expect(historyRes.body.length).toBeGreaterThanOrEqual(2);

    const latest = historyRes.body[0];
    expect(latest.product_id).toBe(productId);
    expect(latest.delta_qty).toBe(5);
    expect(latest.unit_cost).toBe(14000);
    expect(latest.avg_after).toBe(12000); // (5*10000 + 5*14000) / 10 = 12000
    expect(latest.branch_name).toBeDefined();
  });
});
