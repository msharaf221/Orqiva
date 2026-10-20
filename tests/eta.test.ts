/**
 * Phase 4.1 — Egyptian Tax Authority (ETA) e-invoicing foundation.
 *
 * Verifies the offline-capable building blocks:
 *  - every document receives a unique UBL 2.1 UUID (internal_code);
 *  - posting a sale enqueues an outbox row in PENDING state;
 *  - the stub pipeline validates the payload and moves it to VALID with a long id;
 *  - retry/backoff bookkeeping is bounded and monotonically increasing;
 *  - the TLV QR code carries the ETA tags (seller, VAT, timestamp, total, tax);
 *  - credit notes reference the UUID of the original invoice;
 *  - cancelling an invoice cancels its pending submission.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { seedUsers, signIn, resetBusinessData, header } from './helpers';
import { all, one, run } from '../server/db';
import {
  buildEtaQrData,
  buildEtaInvoice,
  etaDocTypeFor,
  isEtaEligible,
  backoffSeconds,
  processPendingSubmissions,
  retrySubmission,
} from '../server/eta';

beforeAll(seedUsers);
beforeEach(resetBusinessData);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function admin() {
  return signIn('admin@test.local');
}

async function setup(admin: Awaited<ReturnType<typeof signIn>>) {
  const customer = await admin.post('/api/parties').set(header).send({
    type: 'CUSTOMER',
    name: 'عميل ضريبي',
    email: '',
    phone: '',
    address: '',
    tax_number: '123456789',
    notes: '',
  });
  const supplier = await admin.post('/api/parties').set(header).send({
    type: 'SUPPLIER',
    name: 'مورد ضريبي',
    email: '',
    phone: '',
    address: '',
    tax_number: '',
    notes: '',
  });
  const product = await admin.post('/api/products').set(header).send({
    sku: 'ETA-PROD-01',
    name: 'منتج إلكتروني',
    category: 'عام',
    unit: 'قطعة',
    sale_price: 11400,
    cost_price: 6000,
    min_stock: 0,
  });
  return { customerId: customer.body.id, supplierId: supplier.body.id, productId: product.body.id };
}

/** Buys `quantity` units into HQ stock so sales can be posted. */
async function stockUp(
  adminClient: Awaited<ReturnType<typeof signIn>>,
  supplierId: string,
  productId: string,
  quantity = 10,
) {
  const today = new Date().toISOString().slice(0, 10);
  const po = await adminClient
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
      lines: [{ product_id: productId, quantity, unit_price: 6000 }],
    });
  await adminClient.post(`/api/documents/${po.body.id}/post`).set(header).send({});
}

/** Creates a DRAFT sale; caller posts it. */
async function draftSale(
  adminClient: Awaited<ReturnType<typeof signIn>>,
  customerId: string,
  productId: string,
  quantity = 1,
) {
  const today = new Date().toISOString().slice(0, 10);
  return adminClient
    .post('/api/documents')
    .set(header)
    .send({
      type: 'SALE',
      branch_id: 'main',
      party_id: customerId,
      date: today,
      due_date: today,
      tax_rate: 1400,
      discount: 0,
      notes: '',
      lines: [{ product_id: productId, quantity, unit_price: 10000 }],
    });
}

describe('ETA e-invoicing foundation', () => {
  it('assigns a unique UBL 2.1 UUID to every document', async () => {
    const client = await admin();
    const { customerId, productId } = await setup(client);
    const today = new Date().toISOString().slice(0, 10);

    const a = await client
      .post('/api/documents')
      .set(header)
      .send({
        type: 'SALE',
        branch_id: 'main',
        party_id: customerId,
        date: today,
        due_date: today,
        tax_rate: 1400,
        discount: 0,
        notes: '',
        lines: [{ product_id: productId, quantity: 1, unit_price: 10000 }],
      });
    const b = await client
      .post('/api/documents')
      .set(header)
      .send({
        type: 'SALE',
        branch_id: 'main',
        party_id: customerId,
        date: today,
        due_date: today,
        tax_rate: 1400,
        discount: 0,
        notes: '',
        lines: [{ product_id: productId, quantity: 1, unit_price: 10000 }],
      });

    expect(a.body.internal_code).toMatch(UUID_RE);
    expect(b.body.internal_code).toMatch(UUID_RE);
    expect(a.body.internal_code).not.toBe(b.body.internal_code);
  });

  it('enqueues a PENDING submission on post and completes it via the stub pipeline', async () => {
    const client = await admin();
    const { customerId, supplierId, productId } = await setup(client);
    await stockUp(client, supplierId, productId);

    const sale = await draftSale(client, customerId, productId, 2);
    await client.post(`/api/documents/${sale.body.id}/post`).set(header).send({});

    const pending = one<{ status: string; uuid: string; document_type: string }>(
      'SELECT status, uuid, document_type FROM e_invoice_submissions WHERE document_id=?',
      sale.body.id,
    );
    expect(pending?.status).toBe('PENDING');
    expect(pending?.uuid).toBe(sale.body.internal_code);
    expect(pending?.document_type).toBe('INVOICE');

    const result = processPendingSubmissions(10);
    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);

    const done = one<{ status: string; eta_long_id: string; attempt: number }>(
      'SELECT status, eta_long_id, attempt FROM e_invoice_submissions WHERE document_id=?',
      sale.body.id,
    );
    expect(done?.status).toBe('VALID');
    expect(done?.eta_long_id).toContain(sale.body.internal_code);
    expect(done?.attempt).toBe(1);

    const doc = one<{ eta_status: string; eta_long_id: string }>(
      'SELECT eta_status, eta_long_id FROM documents WHERE id=?',
      sale.body.id,
    );
    expect(doc?.eta_status).toBe('VALID');
    expect(doc?.eta_long_id).toBe(done?.eta_long_id);
  });

  it('builds a UBL 2.1 payload with the mandatory fields and 14% VAT', async () => {
    const client = await admin();
    const { customerId, productId } = await setup(client);
    const today = new Date().toISOString().slice(0, 10);

    const sale = await client
      .post('/api/documents')
      .set(header)
      .send({
        type: 'SALE',
        branch_id: 'main',
        party_id: customerId,
        date: today,
        due_date: today,
        tax_rate: 1400,
        discount: 0,
        notes: '',
        lines: [{ product_id: productId, quantity: 1, unit_price: 10000 }],
      });

    const payload = buildEtaInvoice(sale.body.id);
    expect(payload.uuid).toBe(sale.body.internal_code);
    expect(payload.internalID).toBe(sale.body.number);
    expect(payload.documentType).toBe('INVOICE');
    expect(payload.receiver.id).toBe('123456789');
    expect(payload.invoiceLines).toHaveLength(1);
    expect(payload.invoiceLines[0].taxableItems[0].rate).toBe(14);
    expect(payload.totalAmount).toBe(sale.body.total / 100);
  });

  it('produces an ETA TLV QR code carrying tags 1..5', () => {
    const encoded = buildEtaQrData({
      sellerName: 'شركة أوركيفا',
      taxNumber: '123456789',
      timestamp: '2026-03-01T00:00:00.000Z',
      total: 22800,
      tax: 2800,
    });
    const buf = Buffer.from(encoded, 'base64');
    // Tag 1 (seller) must be the first record, tag 2 the second, etc.
    expect(buf[0]).toBe(1);
    const sellerLen = buf[1];
    const seller = buf.subarray(2, 2 + sellerLen).toString('utf8');
    expect(seller).toBe('شركة أوركيفا');

    let offset = 2 + sellerLen;
    expect(buf[offset]).toBe(2); // VAT
    offset += 2 + buf[offset + 1];
    expect(buf[offset]).toBe(3); // Timestamp
    offset += 2 + buf[offset + 1];
    expect(buf[offset]).toBe(4); // Total
    const totalLen = buf[offset + 1];
    expect(buf.subarray(offset + 2, offset + 2 + totalLen).toString('utf8')).toBe('228.00');
    offset += 2 + totalLen;
    expect(buf[offset]).toBe(5); // Tax
    const taxLen = buf[offset + 1];
    expect(buf.subarray(offset + 2, offset + 2 + taxLen).toString('utf8')).toBe('28.00');
  });

  it('references the original invoice UUID for credit notes', async () => {
    const client = await admin();
    const { customerId, supplierId, productId } = await setup(client);
    const today = new Date().toISOString().slice(0, 10);

    const po = await client
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
        lines: [{ product_id: productId, quantity: 5, unit_price: 6000 }],
      });
    await client.post(`/api/documents/${po.body.id}/post`).set(header).send({});

    const sale = await client
      .post('/api/documents')
      .set(header)
      .send({
        type: 'SALE',
        branch_id: 'main',
        party_id: customerId,
        date: today,
        due_date: today,
        tax_rate: 1400,
        discount: 0,
        notes: '',
        lines: [{ product_id: productId, quantity: 3, unit_price: 10000 }],
      });
    await client.post(`/api/documents/${sale.body.id}/post`).set(header).send({});

    const ret = await client
      .post('/api/documents')
      .set(header)
      .send({
        type: 'SALE_RETURN',
        branch_id: 'main',
        party_id: customerId,
        original_document_id: sale.body.id,
        date: today,
        due_date: today,
        tax_rate: 1400,
        discount: 0,
        notes: '',
        lines: [{ product_id: productId, quantity: 1, unit_price: 10000 }],
      });
    await client.post(`/api/documents/${ret.body.id}/post`).set(header).send({});

    const sub = one<{ document_type: string }>(
      'SELECT document_type FROM e_invoice_submissions WHERE document_id=?',
      ret.body.id,
    );
    expect(sub?.document_type).toBe('CREDIT_NOTE');

    const payload = buildEtaInvoice(ret.body.id);
    expect(payload.references).toEqual([sale.body.internal_code]);
  });

  it('does not enqueue submissions for purchase invoices', async () => {
    const client = await admin();
    const { supplierId, productId } = await setup(client);
    const today = new Date().toISOString().slice(0, 10);

    const po = await client
      .post('/api/documents')
      .set(header)
      .send({
        type: 'PURCHASE',
        branch_id: 'main',
        party_id: supplierId,
        date: today,
        due_date: today,
        tax_rate: 1400,
        discount: 0,
        notes: '',
        lines: [{ product_id: productId, quantity: 1, unit_price: 6000 }],
      });
    await client.post(`/api/documents/${po.body.id}/post`).set(header).send({});

    expect(
      all('SELECT id FROM e_invoice_submissions WHERE document_id=?', po.body.id),
    ).toHaveLength(0);
    expect(isEtaEligible('PURCHASE')).toBe(false);
    expect(etaDocTypeFor('PURCHASE')).toBe('INVOICE');
  });

  it('cancels a queued submission when its invoice is cancelled', async () => {
    const client = await admin();
    const { customerId, supplierId, productId } = await setup(client);
    await stockUp(client, supplierId, productId);

    const sale = await draftSale(client, customerId, productId, 1);
    await client.post(`/api/documents/${sale.body.id}/post`).set(header).send({});
    await client.post(`/api/documents/${sale.body.id}/cancel`).set(header).send({});

    const sub = one<{ status: string }>(
      'SELECT status FROM e_invoice_submissions WHERE document_id=?',
      sale.body.id,
    );
    expect(sub?.status).toBe('CANCELLED');
    expect(processPendingSubmissions(10).processed).toBe(0);
  });

  it('applies bounded exponential backoff and exposes retry', async () => {
    // Pure backoff growth, capped at 30 minutes.
    expect(backoffSeconds(1)).toBe(30);
    expect(backoffSeconds(2)).toBe(60);
    expect(backoffSeconds(3)).toBe(120);
    expect(backoffSeconds(4)).toBe(240);
    expect(backoffSeconds(20)).toBe(1800);

    const client = await admin();
    const { customerId, supplierId, productId } = await setup(client);
    await stockUp(client, supplierId, productId);

    const sale = await draftSale(client, customerId, productId, 1);
    await client.post(`/api/documents/${sale.body.id}/post`).set(header).send({});

    const subId = one<{ id: string }>(
      'SELECT id FROM e_invoice_submissions WHERE document_id=?',
      sale.body.id,
    )!.id;
    // Simulate a permanent failure.
    run(
      "UPDATE e_invoice_submissions SET status='FAILED', attempt=5, last_error='خطأ' WHERE id=?",
      subId,
    );
    const retried = retrySubmission(subId);
    expect(retried.status).toBe('PENDING');
    expect(retried.last_error).toBe('');

    expect(processPendingSubmissions(10).succeeded).toBe(1);
  });

  it('exposes the submission log over the API with eta:view', async () => {
    const client = await admin();
    const { customerId, supplierId, productId } = await setup(client);
    await stockUp(client, supplierId, productId);

    const sale = await draftSale(client, customerId, productId, 1);
    await client.post(`/api/documents/${sale.body.id}/post`).set(header).send({});

    const list = await client.get('/api/eta/submissions');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].document_id).toBe(sale.body.id);

    const status = await client.get('/api/eta/status');
    expect(status.status).toBe(200);
    expect(status.body.summary.PENDING).toBe(1);

    const process = await client.post('/api/eta/process').set(header).send({});
    expect(process.body.succeeded).toBe(1);
  });
});
