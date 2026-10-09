import { all, one, run, transaction, id, now } from './db';
import { documentSchema, paymentSchema } from './validation';
import { z } from 'zod';
import { AppError } from './errors';
import { writableBranch, type Actor } from './scope';
import type { Document, DocLine, Party, Payment, Branch } from '../src/types';

export { AppError } from './errors';
export type { Actor } from './scope';

export type ProductRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  sale_price: number;
  cost_price: number;
  min_stock: number;
  active: number;
  created_at: string;
};

export function audit(
  actor: Pick<Actor, 'id' | 'name'>,
  action: string,
  entity: string,
  entityId: string,
  details = '',
) {
  run(
    'INSERT INTO audit_logs(id,user_id,user_name,action,entity,entity_id,details,created_at) VALUES(?,?,?,?,?,?,?,?)',
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

/** Annual, gap-free sequence per prefix, e.g. `TR-2026-0001`. Must run inside a transaction. */
export function nextNumber(prefix: string, year: string): string {
  const key = `${prefix}-${year}`;
  run(
    'INSERT INTO sequences(id,value) VALUES(?,1) ON CONFLICT(id) DO UPDATE SET value=value+1',
    key,
  );
  const sequence = requireRow(
    one<{ value: number }>('SELECT value FROM sequences WHERE id=?', key),
  );
  return `${key}-${String(sequence.value).padStart(4, '0')}`;
}

export function branchStock(branchId: string, productId: string): number {
  return (
    one<{ quantity: number }>(
      'SELECT quantity FROM branch_stock WHERE branch_id=? AND product_id=?',
      branchId,
      productId,
    )?.quantity ?? 0
  );
}

/**
 * Every stock change goes through here: the balance and its movement row are written together,
 * so the movement log always reconciles with the balances. Must run inside a transaction.
 */
export function moveStock(input: {
  branchId: string;
  productId: string;
  delta: number;
  reason: string;
  actor: Pick<Actor, 'id'>;
  documentId?: string | null;
  transferId?: string | null;
}) {
  const product = requireRow(
    one<{ name: string }>('SELECT name FROM products WHERE id=?', input.productId),
  );
  const current = branchStock(input.branchId, input.productId);
  const next = current + input.delta;
  if (next < 0) {
    const branch = requireRow(
      one<{ name: string }>('SELECT name FROM branches WHERE id=?', input.branchId),
    );
    throw new AppError(
      409,
      `المخزون غير كافٍ للمنتج «${product.name}» في فرع «${branch.name}»؛ المتاح ${current}`,
    );
  }
  if (next > 1_000_000) throw new AppError(400, 'تجاوز الحد الأقصى للمخزون');
  run(
    'INSERT INTO branch_stock(branch_id,product_id,quantity) VALUES(?,?,?) ON CONFLICT(branch_id,product_id) DO UPDATE SET quantity=excluded.quantity',
    input.branchId,
    input.productId,
    next,
  );
  run(
    'INSERT INTO stock_movements(id,product_id,document_id,transfer_id,branch_id,quantity,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    id(),
    input.productId,
    input.documentId ?? null,
    input.transferId ?? null,
    input.branchId,
    input.delta,
    input.reason,
    input.actor.id,
    now(),
  );
}

/** A product can be sold or bought in a branch only when that branch's assortment lists it. */
export function assertAssortment(branchId: string, productId: string, productName: string) {
  const row = one<{ active: number }>(
    'SELECT active FROM branch_products WHERE branch_id=? AND product_id=?',
    branchId,
    productId,
  );
  if (!row?.active) throw new AppError(409, `المنتج «${productName}» غير متاح في هذا الفرع`);
}

export function documentDetail(documentId: string) {
  const doc = requireRow(
    one<Document>(
      `SELECT d.*,p.name party_name,p.phone party_phone,p.address party_address,p.tax_number party_tax_number,b.name branch_name,b.code branch_code FROM documents d JOIN parties p ON p.id=d.party_id JOIN branches b ON b.id=d.branch_id WHERE d.id=?`,
      documentId,
    ),
  );
  return {
    ...doc,
    lines: all<DocLine>('SELECT * FROM document_lines WHERE document_id=?', documentId),
    payments: all<Payment>(
      'SELECT * FROM payments WHERE document_id=? ORDER BY date DESC,created_at DESC',
      documentId,
    ),
  };
}

function prepareDocument(input: z.infer<typeof documentSchema>, branch: Branch) {
  const party = requireRow(
    one<Party>('SELECT * FROM parties WHERE id=? AND active=1', input.party_id),
  );
  if (party.type !== (input.type === 'SALE' ? 'CUSTOMER' : 'SUPPLIER'))
    throw new AppError(400, 'نوع الحساب لا يتوافق مع الفاتورة');
  if (new Set(input.lines.map((l) => l.product_id)).size !== input.lines.length)
    throw new AppError(400, 'المنتج مكرر في الفاتورة؛ عدّل الكمية بدلاً من تكراره');
  const lines = input.lines.map((line) => {
    const product = requireRow(
      one<ProductRow>('SELECT * FROM products WHERE id=? AND active=1', line.product_id),
    );
    assertAssortment(branch.id, product.id, product.name);
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
    const branch = writableBranch(actor, input.branch_id);
    const computed = prepareDocument(input, branch);
    let documentId = existingId;
    if (documentId) {
      const existing = requireRow(one<Document>('SELECT * FROM documents WHERE id=?', documentId));
      if (existing.status !== 'DRAFT' || existing.type !== input.type)
        throw new AppError(409, 'لا يمكن تعديل فاتورة معتمدة أو تغيير نوعها');
      // Moving a draft to another branch requires access to both branches.
      if (existing.branch_id !== branch.id) writableBranch(actor, existing.branch_id);
      run(
        'UPDATE documents SET branch_id=?,party_id=?,date=?,due_date=?,subtotal=?,discount=?,tax_rate=?,tax=?,total=?,notes=? WHERE id=?',
        branch.id,
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
      const prefix = (input.type === 'SALE' ? 'INV' : 'PO') + '-' + branch.code;
      const number = nextNumber(prefix, input.date.slice(0, 4));
      run(
        'INSERT INTO documents(id,number,type,status,branch_id,party_id,date,due_date,subtotal,discount,tax_rate,tax,total,paid,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)',
        documentId,
        number,
        input.type,
        'DRAFT',
        branch.id,
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
        'INSERT INTO document_lines(id,document_id,product_id,name,sku,quantity,unit_price,cost_price,total) VALUES(?,?,?,?,?,?,?,?,?)',
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
    audit(actor, existingId ? 'تعديل مسودة' : 'إنشاء فاتورة', input.type, documentId, branch.name);
    return documentDetail(documentId);
  });
}

export function postDocument(documentId: string, actor: Actor) {
  return transaction(() => {
    const doc = documentDetail(documentId);
    if (doc.status !== 'DRAFT') throw new AppError(409, 'تم اعتماد أو إلغاء هذه الفاتورة بالفعل');
    writableBranch(actor, doc.branch_id);
    const party = requireRow(one<Party>('SELECT * FROM parties WHERE id=?', doc.party_id));
    if (!party.active) throw new AppError(409, 'الحساب مؤرشف؛ أعد تفعيله قبل الاعتماد');
    for (const line of doc.lines) {
      const product = requireRow(
        one<ProductRow>('SELECT * FROM products WHERE id=?', line.product_id),
      );
      if (!product.active) throw new AppError(409, `المنتج ${product.name} مؤرشف`);
      assertAssortment(doc.branch_id, product.id, product.name);
      moveStock({
        branchId: doc.branch_id,
        productId: product.id,
        delta: doc.type === 'SALE' ? -line.quantity : line.quantity,
        reason: doc.type === 'SALE' ? 'بيع' : 'شراء',
        actor,
        documentId,
      });
      if (doc.type === 'SALE')
        run('UPDATE document_lines SET cost_price=? WHERE id=?', product.cost_price, line.id);
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
    writableBranch(actor, doc.branch_id);
    if (doc.status === 'POSTED')
      for (const line of doc.lines) {
        const product = requireRow(
          one<ProductRow>('SELECT * FROM products WHERE id=?', line.product_id),
        );
        const delta = doc.type === 'SALE' ? line.quantity : -line.quantity;
        const current = branchStock(doc.branch_id, product.id);
        if (current + delta < 0)
          throw new AppError(409, 'تعذر عكس المخزون؛ الكمية الحالية لا تسمح بالإلغاء');
        moveStock({
          branchId: doc.branch_id,
          productId: product.id,
          delta,
          reason: 'إلغاء ' + doc.number,
          actor,
          documentId: doc.id,
        });
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
    writableBranch(actor, doc.branch_id);
    if (doc.status !== 'POSTED') throw new AppError(409, 'اعتمد الفاتورة أولاً لتسجيل دفعة');
    if (input.date < doc.date) throw new AppError(400, 'تاريخ الدفع لا يمكن أن يسبق الفاتورة');
    if (input.amount > doc.total - doc.paid)
      throw new AppError(400, 'المبلغ أكبر من الرصيد المستحق');
    run(
      'INSERT INTO payments(id,document_id,amount,method,date,reference,created_by,created_at,request_key) VALUES(?,?,?,?,?,?,?,?,?)',
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
