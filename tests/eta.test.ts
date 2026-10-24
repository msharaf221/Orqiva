/**
 * ETA e-invoicing foundation in tax-free mode.
 *
 * The tax authority integration depends on a tax identity and VAT amounts, so Orqiva keeps
 * the pipeline dormant while `TAX_FREE` is enabled. These tests pin that behaviour:
 *  - every document still receives a unique UBL 2.1 UUID (internal_code);
 *  - posting a sale does NOT enqueue an outbox row;
 *  - the UBL builder remains usable and reports zero tax;
 *  - the TLV QR helper still encodes tags 1..5 for future use;
 *  - retry/process endpoints refuse to run while ETA is disabled.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { seedUsers, signIn, resetBusinessData, header } from './helpers';
import { all, one, run } from '../server/db';
import {
  buildEtaQrData,
  buildEtaInvoice,
  etaDocTypeFor,
  isEtaEligible,
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

describe('ETA e-invoicing foundation (disabled in tax-free mode)', () => {
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

  it('does not enqueue a submission when posting a sale', async () => {
    const client = await admin();
    const { customerId, supplierId, productId } = await setup(client);
    await stockUp(client, supplierId, productId);

    const sale = await draftSale(client, customerId, productId, 2);
    await client.post(`/api/documents/${sale.body.id}/post`).set(header).send({});

    expect(
      all('SELECT id FROM e_invoice_submissions WHERE document_id=?', sale.body.id),
    ).toHaveLength(0);
    expect(
      one<{ eta_status: string }>('SELECT eta_status FROM documents WHERE id=?', sale.body.id)
        ?.eta_status,
    ).toBe('NOT_SUBMITTED');
    expect(processPendingSubmissions(10)).toEqual({ processed: 0, succeeded: 0 });
  });

  it('builds a UBL 2.1 payload with mandatory fields and zero tax', async () => {
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
    expect(payload.invoiceLines[0].taxableItems[0].rate).toBe(0);
    expect(payload.taxAmount).toBe(0);
    expect(payload.totalAmount).toBe(sale.body.total / 100);
  });

  it('produces an ETA TLV QR code carrying tags 1..5', () => {
    const encoded = buildEtaQrData({
      sellerName: 'شركة أوركيفا',
      taxNumber: '123456789',
      timestamp: '2026-03-01T00:00:00.000Z',
      total: 20000,
      tax: 0,
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
    expect(buf.subarray(offset + 2, offset + 2 + totalLen).toString('utf8')).toBe('200.00');
    offset += 2 + totalLen;
    expect(buf[offset]).toBe(5); // Tax
    const taxLen = buf[offset + 1];
    expect(buf.subarray(offset + 2, offset + 2 + taxLen).toString('utf8')).toBe('0.00');
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

  it('rejects retry while ETA is disabled', async () => {
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

    run(
      `INSERT INTO e_invoice_submissions(
         id, document_id, uuid, document_type, status, attempt, max_attempts,
         next_attempt_at, created_by, created_at, updated_at
       ) VALUES('eta-disabled', ?, ?, 'INVOICE', 'FAILED', 5, 5, ?, 'admin', ?, ?)`,
      sale.body.id,
      sale.body.internal_code,
      today,
      today,
      today,
    );

    expect(() => retrySubmission('eta-disabled')).toThrow('معطّلة');
  });

  it('exposes an empty submission log and refuses to process while disabled', async () => {
    const client = await admin();
    const { customerId, supplierId, productId } = await setup(client);
    await stockUp(client, supplierId, productId);

    const sale = await draftSale(client, customerId, productId, 1);
    await client.post(`/api/documents/${sale.body.id}/post`).set(header).send({});

    const list = await client.get('/api/eta/submissions');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(0);

    const status = await client.get('/api/eta/status');
    expect(status.status).toBe(200);
    expect(status.body.configured).toBe(false);
    expect(status.body.summary.PENDING ?? 0).toBe(0);

    const process = await client.post('/api/eta/process').set(header).send({});
    expect(process.body.processed).toBe(0);
    expect(process.body.succeeded).toBe(0);
  });
});
