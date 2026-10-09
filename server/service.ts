import { all, one, run, transaction, id, now } from './db';
import { documentSchema, paymentSchema } from './validation';
import { z } from 'zod';
import type { User, Product, Document, Party, DocLine } from '../src/types';
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type Actor = Pick<User, 'id' | 'name'>;
export function audit(
  actor: Actor,
  action: string,
  entity: string,
  entityId: string,
  details = '',
) {
  run(
    'INSERT INTO audit_logs VALUES (?,?,?,?,?,?,?,?)',
    id(),
    actor.id,
    actor.name,
    action,
    entity,
    entityId,
    details,
    now(),
  );
}
export function requireRow<T>(row: T | undefined): T {
  if (!row) throw new AppError(404, 'العنصر غير موجود');
  return row;
}
export function documentDetail(documentId: string) {
  const doc = requireRow(
    one<Document>(
      `SELECT d.*,p.name party_name,p.phone party_phone,p.address party_address,p.tax_number party_tax_number FROM documents d JOIN parties p ON p.id=d.party_id WHERE d.id=?`,
      documentId,
    ),
  );
  return {
    ...doc,
    lines: all<DocLine>('SELECT * FROM document_lines WHERE document_id=?', documentId),
    payments: all(
      'SELECT * FROM payments WHERE document_id=? ORDER BY date DESC,created_at DESC',
      documentId,
    ),
  };
}
function prepareDocument(input: z.infer<typeof documentSchema>) {
  const party = requireRow(
    one<Party>('SELECT * FROM parties WHERE id=? AND active=1', input.party_id),
  );
  if (party.type !== (input.type === 'SALE' ? 'CUSTOMER' : 'SUPPLIER'))
    throw new AppError(400, 'نوع الحساب لا يتوافق مع الفاتورة');
  if (new Set(input.lines.map((l) => l.product_id)).size !== input.lines.length)
    throw new AppError(400, 'المنتج مكرر في الفاتورة؛ عدّل الكمية بدلاً من تكراره');
  const lines = input.lines.map((line) => {
    const product = requireRow(
      one<Product>('SELECT * FROM products WHERE id=? AND active=1', line.product_id),
    );
    return {
      ...line,
      name: product.name,
      sku: product.sku,
      cost_price: product.cost_price,
      total: line.quantity * line.unit_price,
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  if (input.discount > subtotal) throw new AppError(400, 'الخصم أكبر من قيمة الفاتورة');
  const tax = Math.round(((subtotal - input.discount) * input.tax_rate) / 10000);
  const total = subtotal - input.discount + tax;
  if (!Number.isSafeInteger(total) || total > 1_000_000_000)
    throw new AppError(400, 'قيمة الفاتورة تتجاوز الحد المسموح (١٠ مليون جنيه)');
  return { lines, subtotal, tax, total };
}
export function saveDocument(raw: unknown, actor: Actor, existingId?: string) {
  const input = documentSchema.parse(raw);
  return transaction(() => {
    const computed = prepareDocument(input);
    let documentId = existingId;
    if (documentId) {
      const existing = requireRow(one<Document>('SELECT * FROM documents WHERE id=?', documentId));
      if (existing.status !== 'DRAFT' || existing.type !== input.type)
        throw new AppError(409, 'لا يمكن تعديل فاتورة معتمدة أو تغيير نوعها');
      run(
        'UPDATE documents SET party_id=?,date=?,due_date=?,subtotal=?,discount=?,tax_rate=?,tax=?,total=?,notes=? WHERE id=?',
        input.party_id,
        input.date,
        input.due_date,
        computed.subtotal,
        input.discount,
        input.tax_rate,
        computed.tax,
        computed.total,
        input.notes,
        documentId,
      );
      run('DELETE FROM document_lines WHERE document_id=?', documentId);
    } else {
      documentId = id();
      const prefix = input.type === 'SALE' ? 'INV' : 'PO';
      const key = prefix + '-' + input.date.slice(0, 4);
      run(
        'INSERT INTO sequences(id,value) VALUES(?,1) ON CONFLICT(id) DO UPDATE SET value=value+1',
        key,
      );
      const sequence = requireRow(
        one<{ value: number }>('SELECT value FROM sequences WHERE id=?', key),
      );
      const number = key + '-' + String(sequence.value).padStart(4, '0');
      run(
        'INSERT INTO documents(id,number,type,party_id,date,due_date,subtotal,discount,tax_rate,tax,total,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        documentId,
        number,
        input.type,
        input.party_id,
        input.date,
        input.due_date,
        computed.subtotal,
        input.discount,
        input.tax_rate,
        computed.tax,
        computed.total,
        input.notes,
        actor.id,
        now(),
      );
    }
    for (const line of computed.lines)
      run(
        'INSERT INTO document_lines VALUES(?,?,?,?,?,?,?,?,?)',
        id(),
        documentId,
        line.product_id,
        line.name,
        line.sku,
        line.quantity,
        line.unit_price,
        line.cost_price,
        line.total,
      );
    audit(actor, existingId ? 'تعديل مسودة' : 'إنشاء فاتورة', input.type, documentId);
    return documentDetail(documentId);
  });
}
export function postDocument(documentId: string, actor: Actor) {
  return transaction(() => {
    const doc = documentDetail(documentId);
    if (doc.status !== 'DRAFT') throw new AppError(409, 'تم اعتماد أو إلغاء هذه الفاتورة بالفعل');
    const party = requireRow(one<Party>('SELECT * FROM parties WHERE id=?', doc.party_id));
    if (!party.active) throw new AppError(409, 'الحساب مؤرشف؛ أعد تفعيله قبل الاعتماد');
    for (const line of doc.lines) {
      const product = requireRow(
        one<Product>('SELECT * FROM products WHERE id=?', line.product_id),
      );
      if (!product.active) throw new AppError(409, `المنتج ${product.name} مؤرشف`);
      const delta = doc.type === 'SALE' ? -line.quantity : line.quantity;
      if (product.stock + delta < 0)
        throw new AppError(
          409,
          `المخزون غير كافٍ للمنتج «${product.name}»؛ المتاح ${product.stock}`,
        );
      if (product.stock + delta > 1_000_000) throw new AppError(400, 'تجاوز الحد الأقصى للمخزون');
      run('UPDATE products SET stock=stock+? WHERE id=?', delta, line.product_id);
      if (doc.type === 'SALE')
        run('UPDATE document_lines SET cost_price=? WHERE id=?', product.cost_price, line.id);
      run(
        'INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?)',
        id(),
        line.product_id,
        documentId,
        delta,
        doc.type === 'SALE' ? 'بيع' : 'شراء',
        actor.id,
        now(),
      );
    }
    run("UPDATE documents SET status='POSTED' WHERE id=?", documentId);
    audit(actor, 'اعتماد فاتورة', doc.type, documentId, doc.number);
    return documentDetail(documentId);
  });
}
export function cancelDocument(documentId: string, actor: Actor) {
  return transaction(() => {
    const doc = documentDetail(documentId);
    if (doc.status === 'CANCELLED') throw new AppError(409, 'الفاتورة ملغاة بالفعل');
    if (doc.paid > 0)
      throw new AppError(
        409,
        'لا يمكن إلغاء فاتورة لها دفعات مسجلة. رد المبالغ غير مدعوم في هذه النسخة.',
      );
    if (doc.status === 'POSTED')
      for (const line of doc.lines) {
        const product = requireRow(
          one<Product>('SELECT * FROM products WHERE id=?', line.product_id),
        );
        const delta = doc.type === 'SALE' ? line.quantity : -line.quantity;
        if (product.stock + delta < 0 || product.stock + delta > 1_000_000)
          throw new AppError(409, 'تعذر عكس المخزون؛ الكمية الحالية لا تسمح بالإلغاء');
        run('UPDATE products SET stock=stock+? WHERE id=?', delta, product.id);
        run(
          'INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?)',
          id(),
          product.id,
          doc.id,
          delta,
          'إلغاء ' + doc.number,
          actor.id,
          now(),
        );
      }
    run("UPDATE documents SET status='CANCELLED' WHERE id=?", documentId);
    audit(actor, 'إلغاء فاتورة', doc.type, documentId, doc.number);
    return documentDetail(documentId);
  });
}
export function addPayment(documentId: string, raw: unknown, actor: Actor, requestKey?: string) {
  const input = paymentSchema.parse(raw);
  const key = z.string().uuid().optional().parse(requestKey);
  return transaction(() => {
    if (key) {
      const previous = one<{
        document_id: string;
        amount: number;
        method: string;
        date: string;
        reference: string;
        created_by: string;
      }>('SELECT * FROM payments WHERE request_key=?', key);
      if (previous) {
        if (
          previous.document_id !== documentId ||
          previous.amount !== input.amount ||
          previous.method !== input.method ||
          previous.date !== input.date ||
          previous.reference !== input.reference ||
          previous.created_by !== actor.id
        )
          throw new AppError(409, 'مفتاح الطلب مستخدم لدفعة مختلفة');
        return documentDetail(documentId);
      }
    }

    const doc = requireRow(one<Document>('SELECT * FROM documents WHERE id=?', documentId));
    if (doc.status !== 'POSTED') throw new AppError(409, 'اعتمد الفاتورة أولاً لتسجيل دفعة');
    if (input.date < doc.date) throw new AppError(400, 'تاريخ الدفع لا يمكن أن يسبق الفاتورة');
    if (input.amount > doc.total - doc.paid)
      throw new AppError(400, 'المبلغ أكبر من الرصيد المستحق');
    run(
      'INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?)',
      id(),
      documentId,
      input.amount,
      input.method,
      input.date,
      input.reference,
      actor.id,
      now(),
      key || null,
    );
    run('UPDATE documents SET paid=paid+? WHERE id=?', input.amount, documentId);
    audit(actor, 'تسجيل دفعة', doc.type, documentId, doc.number);
    return documentDetail(documentId);
  });
}
