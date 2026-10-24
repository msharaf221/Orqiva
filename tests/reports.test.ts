import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { header, resetBusinessData, seedUsers, signIn } from './helpers';
import type { Dashboard, GroupOverview } from '../src/types';

describe('Reports & Financial Dashboard API', () => {
  let admin: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    await seedUsers();
    admin = await signIn('admin@test.local');
  });

  beforeEach(() => {
    resetBusinessData();
  });

  it('calculates dashboard metrics with sales, returns, and cash flows accurately', async () => {
    // 1. Create customer and supplier
    const custRes = await admin
      .post('/api/parties')
      .set(header)
      .send({ type: 'CUSTOMER', name: 'عميل التقارير' })
      .expect(201);
    const customerId = custRes.body.id;

    await admin
      .post('/api/parties')
      .set(header)
      .send({ type: 'SUPPLIER', name: 'مورد التقارير' })
      .expect(201);

    // 2. Create products with stock
    const p1 = await admin
      .post('/api/products')
      .set(header)
      .send({
        sku: 'REP-001',
        name: 'منتج تقرير أ',
        category: 'عام',
        unit: 'قطعة',
        sale_price: 20000, // 200 EGP
        cost_price: 10000, // 100 EGP
        min_stock: 5,
        stock: 50,
        branch_id: 'main',
      })
      .expect(201);

    // 3. Post a Sale Invoice: 10 items @ 200 EGP = 2000 EGP (tax-free)
    const saleDraft = await admin
      .post('/api/documents')
      .set(header)
      .send({
        type: 'SALE',
        branch_id: 'main',
        party_id: customerId,
        date: '2026-06-15',
        due_date: '2026-06-30',
        discount: 0,
        tax_rate: 1400,
        lines: [{ product_id: p1.body.id, quantity: 10, unit_price: 20000 }],
      })
      .expect(201);

    const salePosted = await admin
      .post(`/api/documents/${saleDraft.body.id}/post`)
      .set(header)
      .expect(200);

    // Record partial payment on sale: 1000 EGP
    await admin
      .post(`/api/documents/${salePosted.body.id}/payments`)
      .set(header)
      .send({ amount: 100000, method: 'CASH', date: '2026-06-16' })
      .expect(201);

    // 4. Issue a Sale Return (Credit Note): 2 items returned @ 200 EGP = 400 EGP (tax-free)
    const returnDraft = await admin
      .post('/api/documents')
      .set(header)
      .send({
        type: 'SALE_RETURN',
        original_document_id: salePosted.body.id,
        branch_id: 'main',
        party_id: customerId,
        date: '2026-06-17',
        due_date: '2026-06-17',
        discount: 0,
        tax_rate: 1400,
        lines: [{ product_id: p1.body.id, quantity: 2, unit_price: 20000 }],
      })
      .expect(201);

    const returnPosted = await admin
      .post(`/api/documents/${returnDraft.body.id}/post`)
      .set(header)
      .expect(200);

    // Record a refund payment to the customer for return: 200 EGP
    await admin
      .post(`/api/documents/${returnPosted.body.id}/payments`)
      .set(header)
      .send({ amount: 20000, method: 'CASH', date: '2026-06-18' })
      .expect(201);

    // 5. Add an operational expense: 300 EGP
    await admin
      .post('/api/expenses')
      .set(header)
      .send({
        title: 'فاتورة كهرباء المعرض',
        category: 'مرافق',
        amount: 30000,
        date: '2026-06-20',
        method: 'CASH',
        branch_id: 'main',
        allocation: 'BRANCH',
      })
      .expect(201);

    // 6. Fetch Dashboard for June 2026
    const res = await admin
      .get('/api/dashboard?from=2026-06-01&to=2026-06-30')
      .set(header)
      .expect(200);

    const data: Dashboard = res.body;

    // Net Sales before tax: 2,000 - 400 = 1,600 EGP (160,000 piastres)
    expect(data.sales).toBe(160000);

    // Cost of Goods Sold: (10 sold * 100) - (2 returned * 100) = 800 EGP (80,000 piastres)
    // Gross Profit: 1,600 - 800 = 800 EGP (80,000 piastres)
    expect(data.grossProfit).toBe(80000);

    // Expenses: 300 EGP (30,000 piastres)
    expect(data.expenses).toBe(30000);

    // Net Profit: Gross (800) - Expenses (300) = 500 EGP (50,000 piastres)
    expect(data.netProfit).toBe(50000);

    // Cash flow:
    // Collected: 1,000 EGP (100,000 piastres)
    // Disbursed: 200 EGP refund (20,000 piastres)
    // Expenses: 300 EGP (30,000 piastres)
    // Net Cash Flow: 1,000 - 200 - 300 = 500 EGP (50,000 piastres)
    expect(data.collected).toBe(100000);
    expect(data.disbursed).toBe(20000);
    expect(data.cashFlow).toBe(50000);

    // Net Receivables:
    // Original invoice remaining: 2,000 - 1,000 = 1,000 EGP
    // Credit note remaining: 400 - 200 = 200 EGP
    // Net Customer Receivables: 1,000 - 200 = 800 EGP (80,000 piastres)
    expect(data.receivables).toBe(80000);
  });

  it('fetches group overview with branch aggregated totals', async () => {
    const res = await admin
      .get('/api/group/overview?from=2026-01-01&to=2026-12-31')
      .set(header)
      .expect(200);

    const overview: GroupOverview = res.body;
    expect(overview.branches).toBeDefined();
    expect(Array.isArray(overview.branches)).toBe(true);
    expect(overview.totals).toBeDefined();
    expect(typeof overview.cashAvailable).toBe('number');
  });

  it('rejects invalid period queries (from > to or exceeding 366 days)', async () => {
    // from > to
    await admin.get('/api/dashboard?from=2026-12-31&to=2026-01-01').set(header).expect(400);

    // > 366 days
    await admin.get('/api/dashboard?from=2025-01-01&to=2026-12-31').set(header).expect(400);
  });
});
