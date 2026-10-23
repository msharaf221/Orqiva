/**
 * Quotations & Proforma Invoices Engine (Phase 3.3).
 *
 * Non-posting commercial documents:
 *  - QUOTATION: Formal price offers with expiry date.
 *  - PROFORMA: Proforma invoices for customer financing or customs.
 *  - 1-Click conversion to full SALE document.
 */

import { all, one, run, transaction, id, now } from './db';
import { AppError } from './errors';
import { Quotation, QuotationLine, QuotationStatus, QuotationType } from '../src/types';

export function listQuotations(filter?: {
  branchId?: string;
  type?: QuotationType;
  status?: QuotationStatus;
}): Quotation[] {
  const clauses: string[] = [];
  const params: (string | number | null)[] = [];

  if (filter?.branchId) {
    clauses.push('q.branch_id=?');
    params.push(filter.branchId);
  }
  if (filter?.type) {
    clauses.push('q.type=?');
    params.push(filter.type);
  }
  if (filter?.status) {
    clauses.push('q.status=?');
    params.push(filter.status);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  return all<Quotation>(
    `SELECT q.*, 
            b.name AS branch_name,
            p.name AS party_name,
            p.phone AS party_phone,
            u.name AS created_by_name,
            d.number AS converted_document_number
     FROM quotations q
     JOIN branches b ON b.id = q.branch_id
     JOIN parties p ON p.id = q.party_id
     LEFT JOIN users u ON u.id = q.created_by
     LEFT JOIN documents d ON d.id = q.converted_document_id
     ${where}
     ORDER BY q.date DESC, q.created_at DESC`,
    ...params,
  );
}

export function getQuotation(id: string): Quotation | null {
  const q = one<Quotation>(
    `SELECT q.*, 
            b.name AS branch_name,
            p.name AS party_name,
            p.phone AS party_phone,
            u.name AS created_by_name,
            d.number AS converted_document_number
     FROM quotations q
     JOIN branches b ON b.id = q.branch_id
     JOIN parties p ON p.id = q.party_id
     LEFT JOIN users u ON u.id = q.created_by
     LEFT JOIN documents d ON d.id = q.converted_document_id
     WHERE q.id=?`,
    id,
  );
  if (!q) return null;

  const lines = all<QuotationLine>(
    `SELECT ql.*, prod.name AS product_name, prod.sku
     FROM quotation_lines ql
     JOIN products prod ON prod.id = ql.product_id
     WHERE ql.quotation_id=?`,
    id,
  );

  return { ...q, lines };
}

export function createQuotation(
  data: {
    type: QuotationType;
    branch_id: string;
    party_id: string;
    date: string;
    valid_until?: string | null;
    tax_rate?: number;
    discount?: number;
    notes?: string;
    lines: Array<{
      product_id: string;
      quantity: number;
      unit_price: number;
      notes?: string;
    }>;
  },
  actorId?: string,
): Quotation {
  if (!data.lines?.length) {
    throw new AppError(400, 'يجب أن يحتوي عرض السعر على بند واحد على الأقل');
  }

  const branch = one<{ id: string }>('SELECT id FROM branches WHERE id=?', data.branch_id);
  if (!branch) throw new AppError(404, 'الفرع غير موجود');

  const party = one<{ id: string }>('SELECT id FROM parties WHERE id=?', data.party_id);
  if (!party) throw new AppError(404, 'العميل غير موجود');

  const qId = id();
  const ts = now();
  const year = new Date(data.date).getFullYear() || 2026;
  const prefix = data.type === 'PROFORMA' ? `PRO-${year}` : `QUO-${year}`;

  let qNumber = '';

  transaction(() => {
    run(
      'INSERT INTO sequences(id, value) VALUES(?, 1) ON CONFLICT(id) DO UPDATE SET value=value+1',
      prefix,
    );
    const seq = one<{ value: number }>('SELECT value FROM sequences WHERE id=?', prefix)!;
    qNumber = `${prefix}-${String(seq.value).padStart(4, '0')}`;

    let subtotal = 0;
    const lineInserts: Array<{
      id: string;
      product_id: string;
      quantity: number;
      unit_price: number;
      total: number;
      notes?: string;
    }> = [];

    for (const l of data.lines) {
      if (l.quantity <= 0) throw new AppError(400, 'الكمية يجب أن تكون أكبر من صفر');
      if (l.unit_price < 0) throw new AppError(400, 'السعر لا يمكن أن يكون سالباً');

      const prod = one<{ id: string }>('SELECT id FROM products WHERE id=?', l.product_id);
      if (!prod) throw new AppError(404, `المنتج ${l.product_id} غير موجود`);

      const lineTotal = l.quantity * l.unit_price;
      subtotal += lineTotal;
      lineInserts.push({
        id: id(),
        product_id: l.product_id,
        quantity: l.quantity,
        unit_price: l.unit_price,
        total: lineTotal,
        notes: l.notes,
      });
    }

    const discount = data.discount || 0;
    const taxableBase = Math.max(0, subtotal - discount);
    const taxRate = data.tax_rate !== undefined ? data.tax_rate : 1400;
    const tax = Math.round((taxableBase * taxRate) / 10000);
    const total = taxableBase + tax;

    run(
      `INSERT INTO quotations(id, number, type, branch_id, party_id, date, valid_until, status,
                              subtotal, discount, tax_rate, tax, total, notes, created_by, created_at, updated_at)
       VALUES(?,?,?,?,?, ?,?,'DRAFT', ?,?,?,?,?, ?,?,?,?)`,
      qId,
      qNumber,
      data.type,
      data.branch_id,
      data.party_id,
      data.date,
      data.valid_until || null,
      subtotal,
      discount,
      taxRate,
      tax,
      total,
      data.notes || null,
      actorId || null,
      ts,
      ts,
    );

    for (const li of lineInserts) {
      run(
        `INSERT INTO quotation_lines(id, quotation_id, product_id, quantity, unit_price, total, notes)
         VALUES(?,?,?,?,?,?,?)`,
        li.id,
        qId,
        li.product_id,
        li.quantity,
        li.unit_price,
        li.total,
        li.notes || null,
      );
    }
  });

  return getQuotation(qId)!;
}

export function confirmQuotation(quotationId: string, _actorId?: string): Quotation {
  const q = one<Quotation>('SELECT * FROM quotations WHERE id=?', quotationId);
  if (!q) throw new AppError(404, 'عرض السعر غير موجود');
  if (q.status !== 'DRAFT') {
    throw new AppError(400, 'لا يمكن تأكيد عرض السعر إلا إذا كان مسودة');
  }

  run("UPDATE quotations SET status='CONFIRMED', updated_at=? WHERE id=?", now(), quotationId);
  return getQuotation(quotationId)!;
}

export function rejectQuotation(quotationId: string, _actorId?: string): Quotation {
  const q = one<Quotation>('SELECT * FROM quotations WHERE id=?', quotationId);
  if (!q) throw new AppError(404, 'عرض السعر غير موجود');
  if (q.status === 'CONVERTED') {
    throw new AppError(400, 'لا يمكن رفض عرض تم تحويله بالفعل إلى فاتورة');
  }

  run("UPDATE quotations SET status='REJECTED', updated_at=? WHERE id=?", now(), quotationId);
  return getQuotation(quotationId)!;
}

/**
 * Converts a Quotation or Proforma into an active SALE invoice in documents table.
 */
export function convertQuotationToSale(
  quotationId: string,
  actorId?: string,
): { documentId: string; quotation: Quotation } {
  const q = getQuotation(quotationId);
  if (!q) throw new AppError(404, 'عرض السعر غير موجود');
  if (q.status === 'CONVERTED') {
    throw new AppError(400, 'تم تحويل هذا العرض بالفعل مسبقاً');
  }
  if (q.status === 'REJECTED') {
    throw new AppError(400, 'لا يمكن تحويل عرض سعر مرفوض');
  }

  const docId = id();
  const ts = now();
  const year = new Date().getFullYear();
  const prefix = `INV-${year}`;

  transaction(() => {
    run(
      'INSERT INTO sequences(id, value) VALUES(?, 1) ON CONFLICT(id) DO UPDATE SET value=value+1',
      prefix,
    );
    const seq = one<{ value: number }>('SELECT value FROM sequences WHERE id=?', prefix)!;
    const docNumber = `${prefix}-${String(seq.value).padStart(4, '0')}`;

    run(
      `INSERT INTO documents(id, number, type, status, party_id, branch_id, date, due_date,
                             subtotal, discount, tax_rate, tax, total, paid, notes, internal_code, created_by, created_at)
       VALUES(?,?, 'SALE', 'DRAFT', ?,?, ?,?, ?,?,?,?,?, 0, ?, ?, ?,?)`,
      docId,
      docNumber,
      q.party_id,
      q.branch_id,
      now().slice(0, 10),
      now().slice(0, 10),
      q.subtotal,
      q.discount,
      q.tax_rate,
      q.tax,
      q.total,
      q.notes ? `${q.notes} (محول من ${q.number})` : `محول من ${q.number}`,
      id(), // unique UUID for ETA
      actorId || null,
      ts,
    );

    for (const l of q.lines || []) {
      const prod = one<{ name: string; sku: string; cost_price: number }>(
        'SELECT name, sku, cost_price FROM products WHERE id=?',
        l.product_id,
      );
      run(
        `INSERT INTO document_lines(id, document_id, product_id, name, sku, quantity, unit_price, cost_price, total)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        id(),
        docId,
        l.product_id,
        prod?.name || l.product_name || 'بند',
        prod?.sku || l.sku || '',
        l.quantity,
        l.unit_price,
        prod?.cost_price || 0,
        l.total,
      );
    }

    run(
      "UPDATE quotations SET status='CONVERTED', converted_document_id=?, updated_at=? WHERE id=?",
      docId,
      ts,
      quotationId,
    );
  });

  return { documentId: docId, quotation: getQuotation(quotationId)! };
}
