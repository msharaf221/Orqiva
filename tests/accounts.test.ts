/**
 * Cash & Bank Accounts (الخزائن والحسابات البنكية) — Integration Tests.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { seedUsers, signIn, resetBusinessData, header } from './helpers';

beforeAll(seedUsers);
beforeEach(resetBusinessData);

async function getAdmin() {
  return signIn('admin@test.local');
}

async function setupPartyAndProduct(admin: any) {
  const customerRes = await admin
    .post('/api/parties')
    .set(header)
    .send({ type: 'CUSTOMER', name: 'عميل خزينة', phone: '', email: '', address: '', tax_number: '', notes: '' });
  const supplierRes = await admin
    .post('/api/parties')
    .set(header)
    .send({ type: 'SUPPLIER', name: 'مورد خزينة', phone: '', email: '', address: '', tax_number: '', notes: '' });
  const productRes = await admin
    .post('/api/products')
    .set(header)
    .send({
      sku: 'SKU-ACC-1',
      name: 'منتج حسابات',
      category: 'عام',
      unit: 'قطعة',
      sale_price: 50000, // 500 EGP
      cost_price: 30000, // 300 EGP
      min_stock: 5,
      stock: 100,
      branch_id: 'main',
    });

  return {
    customerId: customerRes.body.id,
    supplierId: supplierRes.body.id,
    productId: productRes.body.id,
  };
}

describe('Cash & Bank Accounts', () => {
  it('lists default cash and bank accounts after migration', async () => {
    const admin = await getAdmin();
    const res = await admin.get('/api/cash-accounts').set(header);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    const names = res.body.map((a: any) => a.name);
    expect(names).toContain('الخزينة العامة');
    expect(names).toContain('الحساب البنكي الرئيسي');
  });

  it('creates a custom cash drawer with initial balance and overdraft prevention', async () => {
    const admin = await getAdmin();
    const res = await admin
      .post('/api/cash-accounts')
      .set(header)
      .send({
        name: 'خزينة فرع المعادي',
        type: 'CASH',
        branch_id: 'main',
        currency: 'EGP',
        initial_balance: 100000, // 1,000 EGP
        allow_negative: 0,
        notes: 'خزينة الكاش اليومية',
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.balance).toBe(100000);
    expect(res.body.allow_negative).toBe(0);

    const getRes = await admin.get(`/api/cash-accounts/${res.body.id}`).set(header);
    expect(getRes.status).toBe(200);
    expect(getRes.body.balance).toBe(100000);
  });

  it('routes customer collections into chosen account and enforces overdraft protection on expenses', async () => {
    const admin = await getAdmin();
    const { customerId, productId } = await setupPartyAndProduct(admin);

    // Create a new cash drawer with 0 initial balance and allow_negative = 0
    const accRes = await admin
      .post('/api/cash-accounts')
      .set(header)
      .send({
        name: 'خزينة مبيعات حصرية',
        type: 'CASH',
        branch_id: 'main',
        initial_balance: 0,
        allow_negative: 0,
      });
    const accountId = accRes.body.id;
    expect(accRes.body.balance).toBe(0);

    // 1. Try to record an expense of 200 EGP from this empty account -> must fail with 409
    const failedExpRes = await admin
      .post('/api/expenses')
      .set(header)
      .send({
        title: 'شراء أدوات نظافة',
        category: 'نظافة',
        amount: 20000, // 200 EGP
        method: 'CASH',
        account_id: accountId,
        date: '2026-03-01',
        allocation: 'BRANCH',
        branch_id: 'main',
      });
    expect(failedExpRes.status).toBe(409);
    expect(failedExpRes.body.error).toContain('لا يكفي');

    // 2. Post a sale invoice and collect 500 EGP into this account
    const saleRes = await admin
      .post('/api/documents')
      .set(header)
      .send({
        type: 'SALE',
        branch_id: 'main',
        party_id: customerId,
        date: '2026-03-01',
        due_date: '2026-03-15',
        discount: 0,
        tax_rate: 0,
        notes: '',
        lines: [{ product_id: productId, quantity: 1, unit_price: 50000 }],
      });
    expect(saleRes.status).toBe(201);
    await admin.post(`/api/documents/${saleRes.body.id}/post`).set(header).expect(200);

    const payRes = await admin
      .post(`/api/documents/${saleRes.body.id}/payments`)
      .set(header)
      .send({
        amount: 50000,
        method: 'CASH',
        account_id: accountId,
        date: '2026-03-01',
      });
    expect(payRes.status).toBe(201);

    // Account balance should now be 500 EGP
    const checkAcc = await admin.get(`/api/cash-accounts/${accountId}`).set(header);
    expect(checkAcc.body.balance).toBe(50000);

    // 3. Now the 200 EGP expense should succeed!
    const okExpRes = await admin
      .post('/api/expenses')
      .set(header)
      .send({
        title: 'شراء أدوات نظافة',
        category: 'نظافة',
        amount: 20000,
        method: 'CASH',
        account_id: accountId,
        date: '2026-03-02',
        allocation: 'BRANCH',
        branch_id: 'main',
      });
    expect(okExpRes.status).toBe(201);

    // Account balance should now be 300 EGP (500 - 200)
    const afterExpAcc = await admin.get(`/api/cash-accounts/${accountId}`).set(header);
    expect(afterExpAcc.body.balance).toBe(30000);
  });

  it('performs inter-account transfers and generates complete chronological statement', async () => {
    const admin = await getAdmin();

    // Create Bank account with 10,000 EGP
    const bankRes = await admin
      .post('/api/cash-accounts')
      .set(header)
      .send({
        name: 'بنك مصر',
        type: 'BANK',
        initial_balance: 1000000, // 10,000 EGP
        allow_negative: 0,
      });
    const bankId = bankRes.body.id;

    // Create Cash drawer with 1,000 EGP
    const cashRes = await admin
      .post('/api/cash-accounts')
      .set(header)
      .send({
        name: 'خزينة نقدية أ',
        type: 'CASH',
        initial_balance: 100000, // 1,000 EGP
        allow_negative: 0,
      });
    const cashId = cashRes.body.id;

    // Transfer 3,000 EGP from Bank to Cash drawer
    const transferRes = await admin
      .post('/api/cash-accounts/transfers')
      .set(header)
      .send({
        from_account_id: bankId,
        to_account_id: cashId,
        amount: 300000, // 3,000 EGP
        date: '2026-03-05',
        notes: 'تغذية خزينة الفرع نقدياً من البنك',
      });
    expect(transferRes.status).toBe(201);
    expect(transferRes.body.number).toMatch(/^TR-/);

    // Check balances
    const bankAfter = await admin.get(`/api/cash-accounts/${bankId}`).set(header);
    const cashAfter = await admin.get(`/api/cash-accounts/${cashId}`).set(header);
    expect(bankAfter.body.balance).toBe(700000); // 10,000 - 3,000 = 7,000 EGP
    expect(cashAfter.body.balance).toBe(400000); // 1,000 + 3,000 = 4,000 EGP

    // Check account statement on Cash drawer
    const stmtRes = await admin.get(`/api/cash-accounts/${cashId}/statement`).set(header);
    expect(stmtRes.status).toBe(200);
    expect(stmtRes.body.entries.length).toBe(2);
    expect(stmtRes.body.entries[0].type).toBe('INITIAL');
    expect(stmtRes.body.entries[0].balance).toBe(100000);
    expect(stmtRes.body.entries[1].type).toBe('TRANSFER_IN');
    expect(stmtRes.body.entries[1].in_amount).toBe(300000);
    expect(stmtRes.body.entries[1].balance).toBe(400000);

    // Check transfers list
    const transfersList = await admin.get('/api/cash-accounts/transfers').set(header);
    expect(transfersList.status).toBe(200);
    expect(transfersList.body.some((t: any) => t.id === transferRes.body.id)).toBe(true);
  });
});
