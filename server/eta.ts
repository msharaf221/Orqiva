/**
 * Egyptian Tax Authority (ETA) E-Invoicing Engine.
 *
 * Scope of this module:
 *  - Build the UBL 2.1 JSON document for invoices and credit/debit notes.
 *  - Produce the ETA-spec TLV QR code payload (base64 of tag-length-value records).
 *  - Drive a durable submission outbox (`e_invoice_submissions`) with bounded retries.
 *
 * The transport is intentionally pluggable:
 *  - With no ETA credentials configured, `submit()` runs in `stub` mode: it validates the
 *    payload locally, marks it VALID, and records a synthetic long id. This keeps POS
 *    checkout fully offline-capable while the compliance paperwork with the authority is
 *    still pending.
 *  - When `ETA_CLIENT_ID` / `ETA_CLIENT_SECRET` are provided, `deliver()` starts talking to
 *    the real ETA endpoints. Only that function needs to change.
 */

import { all, one, run, transaction, id, now } from './db';
import { AppError } from './errors';

/** ETA default document type names inside UBL 2.1. */
export type EtaDocType = 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';

export interface EtaQrPayload {
  sellerName: string;
  taxNumber: string;
  timestamp: string;
  total: number; // minor units (piastres)
  tax: number; // minor units
}

export interface EtaInvoiceJson {
  issuer: {
    type: 'B';
    id: string;
    name: string;
    address: { country: string; governate: string; regionCity: string };
  };
  receiver: {
    type: 'B' | 'P';
    id: string;
    name: string;
    address: { country: string; governate: string; regionCity: string };
  };
  documentType: EtaDocType;
  documentTypeVersion: '1.0';
  dateTimeIssued: string;
  taxpayerActivityCode: string;
  internalID: string;
  uuid: string;
  invoiceLines: Array<{
    description: string;
    itemType: 'GS1' | 'EGS';
    itemCode: string;
    unitType: 'EA';
    quantity: number;
    unitValue: { currencySold: 'EGP'; amountEGP: number };
    salesTotal: number;
    total: number;
    valueDifference: number;
    totalTaxableFees: number;
    netTotal: number;
    itemsDiscount: number;
    discount: { rate: number; amount: number };
    taxableItems: Array<{
      taxType: 'T1';
      amount: number;
      rate: number;
      subType: 'V009';
    }>;
  }>;
  totalDiscountAmount: number;
  totalSalesAmount: number;
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
  /** Present for CREDIT_NOTE / DEBIT_NOTE: the UUID of the referenced invoice. */
  references?: Array<string>;
}

const ETA_CLIENT_ID = process.env.ETA_CLIENT_ID || '';
const ETA_CLIENT_SECRET = process.env.ETA_CLIENT_SECRET || '';

/** True when real ETA credentials exist; otherwise the pipeline runs in stub mode. */
export function etaConfigured(): boolean {
  return Boolean(ETA_CLIENT_ID && ETA_CLIENT_SECRET);
}

/** Builds the value for the ETA TLV QR code (base64 of tag/length/value bytes). */
export function buildEtaQrData(payload: EtaQrPayload): string {
  const records: Array<[number, string]> = [
    [1, payload.sellerName],
    [2, payload.taxNumber],
    [3, payload.timestamp],
    [4, (payload.total / 100).toFixed(2)],
    [5, (payload.tax / 100).toFixed(2)],
  ];
  const bytes: number[] = [];
  for (const [tag, value] of records) {
    const utf8 = Array.from(new TextEncoder().encode(value));
    bytes.push(tag, utf8.length, ...utf8);
  }
  return base64FromBytes(bytes);
}

function base64FromBytes(bytes: number[]): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  // eslint-disable-next-line no-undef
  return btoa(binary);
}

/** Maps the stored document type to an ETA document type. */
export function etaDocTypeFor(docType: string): EtaDocType {
  if (docType === 'SALE_RETURN') return 'CREDIT_NOTE';
  if (docType === 'PURCHASE_RETURN') return 'DEBIT_NOTE';
  return 'INVOICE';
}

/** Which document types are in scope for ETA submission. */
export function isEtaEligible(docType: string): boolean {
  return ['SALE', 'SALE_RETURN', 'PURCHASE_RETURN'].includes(docType);
}

interface CompanyRow {
  name: string;
  tax_number: string;
  tax_registration_number: string;
  address: string;
  activity_code: string;
}

interface PartyRow {
  name: string;
  tax_number: string;
  address: string;
}

interface DocRow {
  id: string;
  number: string;
  type: string;
  date: string;
  internal_code: string;
  reference_uuid: string;
  subtotal: number;
  discount: number;
  tax: number;
  tax_rate: number;
  total: number;
  party_id: string;
  branch_id: string;
}

/** Assembles the UBL 2.1 JSON payload for a document from persisted rows. */
export function buildEtaInvoice(documentId: string): EtaInvoiceJson {
  const doc = one<DocRow>('SELECT * FROM documents WHERE id=?', documentId);
  if (!doc) throw new AppError(404, 'الفاتورة غير موجودة');
  const company = one<CompanyRow>('SELECT * FROM company WHERE id=1');
  const party = one<PartyRow>(
    'SELECT name,tax_number,address FROM parties WHERE id=?',
    doc.party_id,
  );
  const lines = all<{
    name: string;
    sku: string;
    quantity: number;
    unit_price: number;
    total: number;
  }>(
    'SELECT name, sku, quantity, unit_price, total FROM document_lines WHERE document_id=?',
    doc.id,
  );

  const docType = etaDocTypeFor(doc.type);
  const taxRatePct = doc.tax_rate / 100; // 1400 -> 14
  const totalDiscountAmount = doc.discount / 100;

  return {
    issuer: {
      type: 'B',
      id: company?.tax_registration_number || company?.tax_number || '',
      name: company?.name || '',
      address: { country: 'EG', governate: '', regionCity: company?.address || '' },
    },
    receiver: {
      type: 'B',
      id: party?.tax_number || '',
      name: party?.name || '',
      address: { country: 'EG', governate: '', regionCity: party?.address || '' },
    },
    documentType: docType,
    documentTypeVersion: '1.0',
    dateTimeIssued: new Date(doc.date).toISOString(),
    taxpayerActivityCode: company?.activity_code || '',
    internalID: doc.number,
    uuid: doc.internal_code,
    invoiceLines: lines.map((l) => ({
      description: l.name,
      itemType: 'EGS',
      itemCode: l.sku,
      unitType: 'EA',
      quantity: l.quantity,
      unitValue: { currencySold: 'EGP', amountEGP: l.unit_price / 100 },
      salesTotal: (l.unit_price / 100) * l.quantity,
      total: l.total / 100,
      valueDifference: 0,
      totalTaxableFees: 0,
      netTotal: l.total / 100,
      itemsDiscount: 0,
      discount: { rate: 0, amount: 0 },
      taxableItems: [
        {
          taxType: 'T1',
          amount: (l.total * doc.tax_rate) / 1000000,
          rate: taxRatePct,
          subType: 'V009',
        },
      ],
    })),
    totalDiscountAmount,
    totalSalesAmount: doc.subtotal / 100,
    netAmount: (doc.subtotal - doc.discount) / 100,
    taxAmount: doc.tax / 100,
    totalAmount: doc.total / 100,
    ...(docType === 'INVOICE' ? {} : { references: [resolveReferenceUuid(doc)] }),
  };
}

function resolveReferenceUuid(doc: DocRow): string {
  if (doc.reference_uuid) return doc.reference_uuid;
  const original = one<{ internal_code: string }>(
    'SELECT internal_code FROM documents WHERE id=(SELECT original_document_id FROM documents WHERE id=?)',
    doc.id,
  );
  return original?.internal_code || '';
}

/** Records the ETA-spec QR payload for a posted document (read by the receipt renderer). */
export function etaQrPayload(documentId: string): string {
  const doc = one<DocRow>('SELECT * FROM documents WHERE id=?', documentId);
  if (!doc) throw new AppError(404, 'الفاتورة غير موجودة');
  const company = one<{ name: string; tax_number: string; tax_registration_number: string }>(
    'SELECT name, tax_number, tax_registration_number FROM company WHERE id=1',
  );
  return buildEtaQrData({
    sellerName: company?.name || '',
    taxNumber: company?.tax_registration_number || company?.tax_number || '',
    timestamp: new Date(doc.date).toISOString(),
    total: doc.total,
    tax: doc.tax,
  });
}

/** Creates the outbox row for a document, if one does not already exist. */
export function enqueueEtaSubmission(documentId: string, actorId?: string): void {
  const doc = one<DocRow>('SELECT * FROM documents WHERE id=?', documentId);
  if (!doc) throw new AppError(404, 'الفاتورة غير موجودة');
  if (!isEtaEligible(doc.type)) return;
  const existing = one<{ id: string }>(
    "SELECT id FROM e_invoice_submissions WHERE document_id=? AND status IN ('PENDING','SUBMITTED','VALID')",
    documentId,
  );
  if (existing) return;
  const submissionId = id();
  const ts = now();
  run(
    `INSERT INTO e_invoice_submissions(id,document_id,uuid,document_type,status,attempt,max_attempts,next_attempt_at,created_by,created_at,updated_at)
     VALUES(?,?,?,?, 'PENDING', 0, 5, ?, ?, ?, ?)`,
    submissionId,
    documentId,
    doc.internal_code,
    etaDocTypeFor(doc.type),
    ts,
    actorId ?? null,
    ts,
    ts,
  );
  run("UPDATE documents SET eta_status='PENDING' WHERE id=?", documentId);
}

export interface EtaSubmission {
  id: string;
  document_id: string;
  uuid: string;
  document_type: EtaDocType;
  status: 'PENDING' | 'SUBMITTED' | 'VALID' | 'INVALID' | 'FAILED' | 'CANCELLED';
  attempt: number;
  max_attempts: number;
  next_attempt_at: string;
  submitted_at: string | null;
  completed_at: string | null;
  eta_long_id: string;
  eta_response: string;
  last_error: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Computes exponential backoff (seconds): 30, 60, 120, 240, 480 — capped at 30 minutes. */
export function backoffSeconds(attempt: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempt - 1), 1800);
}

/** Delivers a submission to ETA. Stub mode validates locally and returns a synthetic id. */
function deliver(submission: EtaSubmission): { longId: string; response: string } {
  if (!etaConfigured()) {
    const payload = buildEtaInvoice(submission.document_id);
    if (!payload.uuid || !payload.internalID) {
      throw new AppError(400, 'حمولة الفاتورة الإلكترونية غير مكتملة');
    }
    return {
      longId: `STUB-${submission.uuid}`,
      response: JSON.stringify({ mode: 'stub', accepted: true, uuid: submission.uuid }),
    };
  }
  // Real integration point: exchange a token and POST the UBL JSON to the ETA endpoints.
  // Left unimplemented on purpose until sandbox credentials are supplied.
  throw new AppError(503, 'لم يتم إعداد مفاتيح هيئة الضرائب (ETA) بعد');
}

/** Processes due PENDING submissions, applying retry/backoff on failure. */
export function processPendingSubmissions(limit = 20): { processed: number; succeeded: number } {
  const due = all<EtaSubmission>(
    `SELECT * FROM e_invoice_submissions
     WHERE status='PENDING' AND next_attempt_at<=?
     ORDER BY created_at ASC LIMIT ?`,
    now(),
    limit,
  );
  let succeeded = 0;
  for (const submission of due) {
    try {
      const result = transaction(() => {
        const attempt = submission.attempt + 1;
        const { longId, response } = deliver(submission);
        const ts = now();
        run(
          `UPDATE e_invoice_submissions
           SET status='VALID', attempt=?, submitted_at=?, completed_at=?,
               eta_long_id=?, eta_response=?, last_error='', updated_at=?
           WHERE id=?`,
          attempt,
          ts,
          ts,
          longId,
          response,
          ts,
          submission.id,
        );
        run(
          "UPDATE documents SET eta_status='VALID', eta_long_id=? WHERE id=?",
          longId,
          submission.document_id,
        );
        return true;
      });
      if (result) succeeded++;
    } catch (error) {
      const attempt = submission.attempt + 1;
      const message = error instanceof Error ? error.message : 'خطأ غير معروف';
      const exhausted = attempt >= submission.max_attempts;
      const nextAt = new Date(Date.now() + backoffSeconds(attempt) * 1000).toISOString();
      run(
        `UPDATE e_invoice_submissions
         SET status=?, attempt=?, last_error=?, next_attempt_at=?, updated_at=?
         WHERE id=?`,
        exhausted ? 'FAILED' : 'PENDING',
        attempt,
        message,
        exhausted ? now() : nextAt,
        now(),
        submission.id,
      );
      run(
        'UPDATE documents SET eta_status=? WHERE id=?',
        exhausted ? 'FAILED' : 'PENDING',
        submission.document_id,
      );
    }
  }
  return { processed: due.length, succeeded };
}

export interface EtaSubmissionView extends EtaSubmission {
  document_number: string;
  document_total: number;
  party_name: string;
}

export function listSubmissions(limit = 100): EtaSubmissionView[] {
  return all<EtaSubmissionView>(
    `SELECT s.*, d.number document_number, d.total document_total, p.name party_name
     FROM e_invoice_submissions s
     JOIN documents d ON d.id=s.document_id
     JOIN parties p ON p.id=d.party_id
     ORDER BY s.created_at DESC LIMIT ?`,
    limit,
  );
}

export function getSubmissionByDocument(documentId: string): EtaSubmission | undefined {
  return one<EtaSubmission>(
    'SELECT * FROM e_invoice_submissions WHERE document_id=? ORDER BY created_at DESC LIMIT 1',
    documentId,
  );
}

/** Retries a FAILED submission immediately (clears backoff). */
export function retrySubmission(submissionId: string): EtaSubmission {
  const submission = one<EtaSubmission>(
    'SELECT * FROM e_invoice_submissions WHERE id=?',
    submissionId,
  );
  if (!submission) throw new AppError(404, 'طلب الإرسال غير موجود');
  if (submission.status === 'VALID') throw new AppError(409, 'تم قبول هذه الفاتورة بالفعل');
  run(
    `UPDATE e_invoice_submissions
     SET status='PENDING', next_attempt_at=?, last_error='', updated_at=?
     WHERE id=?`,
    now(),
    now(),
    submissionId,
  );
  return one<EtaSubmission>('SELECT * FROM e_invoice_submissions WHERE id=?', submissionId)!;
}
