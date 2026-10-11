/**
 * Returns, Credit Notes & Debit Notes — Integration Tests.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { seedUsers, signIn, resetBusinessData, header } from './helpers';
import { one } from '../server/db';

beforeAll(seedUsers);
beforeEach(resetBusinessData);

async function getAdmin() {
  return signIn('admin@test.local');
}

async function setupPartyAndProduct(admin: any) {
  const customerRes = await admin
    .post('/api/parties')
    .set(header)
    .send({ type: 'CUSTOMER', name: 'عميل مرتجع', phone: '', email: '', address: '', tax_number: '', notes: '' });
  expect(customerRes.status).toBe(201);
  const customerId = customerRes.body.id;

  const supplierRes = await admin
    .post('/api/parties')
    .set(header)
    .send({ type: 'SUPPLIER', name: 'مورد مرتجع', phone: '', email: '', address: '', tax_number: '', notes: '' });
  expect(supplierRes.status).toBe(201);
  const supplierId = supplierRes.body.id;

  const prodRes = await admin
    .post('/api/products')
    .set(header)
    .send({
      sku: 'RET-PROD-01',
      name: 'منتج للمرتجعات',
      category: 'عام',
      unit: 'قطعة',
      sale_price: 20000, // 200 EGP
      cost_price: 10000, // 100 EGP
      min_stock: 0,
    });
  expect(prodRes.status).toBe(201);
  const productId = prodRes.body.id;

  return { customerId, supplierId, productId };
}

describe('Phase 2 — Returns & Credit/Debit Notes', () => {
  it('creates and posts a Sales Return (Credit Note), restoring stock and reducing customer balance', async () => {
    const admin = await getAdmin();
    const { customerId, supplierId, productId } = await setupPartyAndProduct(admin);
    const today = new Date().toISOString().slice(0, 10);

    // 1. Purchase 10 units at 100 EGP to have stock
    const poDraft = await admin.post('/api/documents').set(header).send({
      type: 'PURCHASE',
      branch_id: 'main',
      party_id: supplierId,
      date: today,
      due_date: today,
      tax_rate: 0,
      discount: 0,
      notes: '',
      lines: [{ product_id: productId, quantity: 10, unit_price: 10000 }],
    });
    await admin.post(`/api/documents/${poDraft.body.id}/post`).set(header).send({});

    // 2. Sell 5 units at 200 EGP
    const saleDraft = await admin.post('/api/documents').set(header).send({
      type: 'SALE',
      branch_id: 'main',
      party_id: customerId,
      date: today,
      due_date: today,
      tax_rate: 0,
      discount: 0,
      notes: '',
      lines: [{ product_id: productId, quantity: 5, unit_price: 20000 }],
    });
    const salePost = await admin.post(`/api/documents/${saleDraft.body.id}/post`).set(header).send({});
    expect(salePost.status).toBe(200);
    const saleId = saleDraft.body.id;

    // Check stock: 10 - 5 = 5
    const stockAfterSale = one<{ quantity: number }>(
      "SELECT quantity FROM branch_stock WHERE branch_id='main' AND product_id=?",
      productId,
    );
    expect(stockAfterSale?.quantity).toBe(5);

    // Customer balance: owes 5 * 200 = 1000 EGP (100000 cents)
    const partyBefore = one<{ balance: number }>(
      `SELECT COALESCE(SUM(CASE
        WHEN d.status='POSTED' AND d.type IN ('SALE','PURCHASE') THEN (d.total-d.paid)
        WHEN d.status='POSTED' AND d.type IN ('SALE_RETURN','PURCHASE_RETURN') THEN -(d.total-d.paid)
        ELSE 0 END),0) balance FROM documents d WHERE d.party_id=?`,
      customerId,
    );
    expect(partyBefore?.balance).toBe(100000);

    // Check returnable endpoint
    const returnableRes = await admin.get(`/api/documents/${saleId}/returnable`);
    expect(returnableRes.status).toBe(200);
    expect(returnableRes.body).toHaveLength(1);
    expect(returnableRes.body[0].returnable).toBe(5);
    expect(returnableRes.body[0].already_returned).toBe(0);

    // 3. Issue partial return for 2 units (Credit Note)
    const retDraft = await admin.post('/api/documents').set(header).send({
      type: 'SALE_RETURN',
      branch_id: 'main',
      party_id: customerId,
      original_document_id: saleId,
      date: today,
      due_date: today,
      tax_rate: 0,
      discount: 0,
      notes: 'مرتجع جزئي - عيب مصنعي',
      lines: [{ product_id: productId, quantity: 2, unit_price: 20000 }],
    });
    expect(retDraft.status).toBe(201);
    expect(retDraft.body.number).toMatch(/^CN-HQ-\d{4}-\d{4}$/);
    expect(retDraft.body.original_document_id).toBe(saleId);
    expect(retDraft.body.original_document_number).toBe(saleDraft.body.number);

    // Post the return
    const retPost = await admin.post(`/api/documents/${retDraft.body.id}/post`).set(header).send({});
    expect(retPost.status).toBe(200);
    expect(retPost.body.status).toBe('POSTED');

    // 4. Verify stock increased by 2: 5 + 2 = 7
    const stockAfterReturn = one<{ quantity: number }>(
      "SELECT quantity FROM branch_stock WHERE branch_id='main' AND product_id=?",
      productId,
    );
    expect(stockAfterReturn?.quantity).toBe(7);

    // Verify stock movement
    const move = one<{ quantity: number; reason: string }>(
      'SELECT quantity, reason FROM stock_movements WHERE document_id=? AND product_id=?',
      retDraft.body.id,
      productId,
    );
    expect(move?.quantity).toBe(2);
    expect(move?.reason).toContain('مرتجع بيع');

    // 5. Verify customer balance decreased by 400 EGP (40000 cents): 100000 - 40000 = 60000 cents
    const partiesList = await admin.get('/api/parties?type=CUSTOMER');
    const customer = partiesList.body.find((p: any) => p.id === customerId);
    expect(customer.balance).toBe(60000);

    // 6. Verify remaining returnable is now 3
    const returnableAfter = await admin.get(`/api/documents/${saleId}/returnable`);
    expect(returnableAfter.body[0].already_returned).toBe(2);
    expect(returnableAfter.body[0].returnable).toBe(3);
  });

  it('rejects returning more than the remaining returnable quantity', async () => {
    const admin = await getAdmin();
    const { customerId, supplierId, productId } = await setupPartyAndProduct(admin);
    const today = new Date().toISOString().slice(0, 10);

    // Setup stock and sale
    const po = await admin.post('/api/documents').set(header).send({
      type: 'PURCHASE',
      branch_id: 'main',
      party_id: supplierId,
      date: today,
      due_date: today,
      tax_rate: 0,
      discount: 0,
      notes: '',
      lines: [{ product_id: productId, quantity: 5, unit_price: 10000 }],
    });
    await admin.post(`/api/documents/${po.body.id}/post`).set(header).send({});

    const sale = await admin.post('/api/documents').set(header).send({
      type: 'SALE',
      branch_id: 'main',
      party_id: customerId,
      date: today,
      due_date: today,
      tax_rate: 0,
      discount: 0,
      notes: '',
      lines: [{ product_id: productId, quantity: 3, unit_price: 20000 }],
    });
    await admin.post(`/api/documents/${sale.body.id}/post`).set(header).send({});

    // Try to return 4 units when only 3 were sold
    const badReturn = await admin.post('/api/documents').set(header).send({
      type: 'SALE_RETURN',
      branch_id: 'main',
      party_id: customerId,
      original_document_id: sale.body.id,
      date: today,
      due_date: today,
      tax_rate: 0,
      discount: 0,
      notes: '',
      lines: [{ product_id: productId, quantity: 4, unit_price: 20000 }],
    });
    expect(badReturn.status).toBe(400);
    expect(badReturn.body.error).toContain('المتبقي القابل للإرجاع');
  });

  it('creates and posts a Purchase Return (Debit Note), reducing stock and payables', async () => {
    const admin = await getAdmin();
    const { supplierId, productId } = await setupPartyAndProduct(admin);
    const today = new Date().toISOString().slice(0, 10);

    // 1. Purchase 10 units at 120 EGP (12000 cents)
    const po = await admin.post('/api/documents').set(header).send({
      type: 'PURCHASE',
      branch_id: 'main',
      party_id: supplierId,
      date: today,
      due_date: today,
      tax_rate: 0,
      discount: 0,
      notes: '',
      lines: [{ product_id: productId, quantity: 10, unit_price: 12000 }],
    });
    await admin.post(`/api/documents/${po.body.id}/post`).set(header).send({});

    // Stock = 10, Supplier balance = 1200 EGP (120000 cents)
    const partiesList1 = await admin.get('/api/parties?type=SUPPLIER');
    const sup1 = partiesList1.body.find((p: any) => p.id === supplierId);
    expect(sup1.balance).toBe(120000);

    // 2. Return 4 units back to supplier (Debit Note)
    const debDraft = await admin.post('/api/documents').set(header).send({
      type: 'PURCHASE_RETURN',
      branch_id: 'main',
      party_id: supplierId,
      original_document_id: po.body.id,
      date: today,
      due_date: today,
      tax_rate: 0,
      discount: 0,
      notes: 'إرجاع للمورد لعدم مطابقة المواصفات',
      lines: [{ product_id: productId, quantity: 4, unit_price: 12000 }],
    });
    expect(debDraft.status).toBe(201);
    expect(debDraft.body.number).toMatch(/^DN-HQ-\d{4}-\d{4}$/);

    const debPost = await admin.post(`/api/documents/${debDraft.body.id}/post`).set(header).send({});
    expect(debPost.status).toBe(200);

    // 3. Stock reduced to 6: 10 - 4 = 6
    const stockAfter = one<{ quantity: number }>(
      "SELECT quantity FROM branch_stock WHERE branch_id='main' AND product_id=?",
      productId,
    );
    expect(stockAfter?.quantity).toBe(6);

    // 4. Supplier balance reduced: 120000 - (4 * 12000) = 72000 cents
    const partiesList2 = await admin.get('/api/parties?type=SUPPLIER');
    const sup2 = partiesList2.body.find((p: any) => p.id === supplierId);
    expect(sup2.balance).toBe(72000);
  });

  it('prevents cancelling an original invoice that has an active return', async () => {
    const admin = await getAdmin();
    const { customerId, supplierId, productId } = await setupPartyAndProduct(admin);
    const today = new Date().toISOString().slice(0, 10);

    // Setup purchase and sale
    const po = await admin.post('/api/documents').set(header).send({
      type: 'PURCHASE',
      branch_id: 'main',
      party_id: supplierId,
      date: today,
      due_date: today,
      tax_rate: 0,
      discount: 0,
      notes: '',
      lines: [{ product_id: productId, quantity: 10, unit_price: 10000 }],
    });
    await admin.post(`/api/documents/${po.body.id}/post`).set(header).send({});

    const sale = await admin.post('/api/documents').set(header).send({
      type: 'SALE',
      branch_id: 'main',
      party_id: customerId,
      date: today,
      due_date: today,
      tax_rate: 0,
      discount: 0,
      notes: '',
      lines: [{ product_id: productId, quantity: 5, unit_price: 20000 }],
    });
    await admin.post(`/api/documents/${sale.body.id}/post`).set(header).send({});

    // Create return
    const ret = await admin.post('/api/documents').set(header).send({
      type: 'SALE_RETURN',
      branch_id: 'main',
      party_id: customerId,
      original_document_id: sale.body.id,
      date: today,
      due_date: today,
      tax_rate: 0,
      discount: 0,
      notes: '',
      lines: [{ product_id: productId, quantity: 1, unit_price: 20000 }],
    });

    // Attempt to cancel original sale
    const cancelRes = await admin.post(`/api/documents/${sale.body.id}/cancel`).set(header).send({});
    expect(cancelRes.status).toBe(409);
    expect(cancelRes.body.error).toContain('يوجد لها مرتجع');

    // Cancel return first
    const cancelReturnRes = await admin.post(`/api/documents/${ret.body.id}/cancel`).set(header).send({});
    expect(cancelReturnRes.status).toBe(200);

    // Now original sale can be cancelled
    const cancelSaleRes = await admin.post(`/api/documents/${sale.body.id}/cancel`).set(header).send({});
    expect(cancelSaleRes.status).toBe(200);
  });
});
