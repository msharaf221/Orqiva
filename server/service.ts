import { all, one, run, transaction, id, now } from './db';
import { documentSchema, paymentSchema } from './validation';
import { z } from 'zod';
import { AppError } from './errors';
import { writableBranch, type Actor } from './scope';
import { effectiveCost, recordCostIn, recordCostOut } from './cost';
import { validateReturnLines } from './returns';
import { resolveDefaultAccountId, assertAccountFunds, glAccountForCashAccount } from './accounts';
import { enqueueEtaSubmission, isEtaEligible } from './eta';
import { postDocumentLedger, reverseDocumentLedger, postPaymentLedger } from './posting';
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
  /** Unit cost for WAC recalculation. Required for inflows; ignored for outflows. */
  unitCost?: number;
  /** When true, skip WAC update (used by cancel reversal to avoid double-counting). */
  skipCost?: boolean;
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
  // Update WAC unless caller explicitly skips it
  if (!input.skipCost) {
    if (input.delta > 0) {
      // Inflow: recalculate WAC
      const unitCost = input.unitCost ?? effectiveCost(input.branchId, input.productId);
      recordCostIn({
        branchId: input.branchId,
        productId: input.productId,
        qty: input.delta,
        unitCost,
        currentQty: next,
        reason: input.reason,
        actor: input.actor,
        documentId: input.documentId,
        transferId: input.transferId,
      });
    } else {
      // Outflow: avg stays the same, only total_value shrinks
      recordCostOut({
        branchId: input.branchId,
        productId: input.productId,
        qty: -input.delta,
        currentQty: next,
        reason: input.reason,
        actor: input.actor,
        documentId: input.documentId,
        transferId: input.transferId,
      });
    }
  }
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
      `SELECT d.*,p.name party_name,p.phone party_phone,p.address party_address,p.tax_number party_tax_number,
        b.name branch_name,b.code branch_code,
        (SELECT number FROM documents WHERE id=d.original_document_id) original_document_number
       FROM documents d JOIN parties p ON p.id=d.party_id JOIN branches b ON b.id=d.branch_id WHERE d.id=?`,
      documentId,
    ),
  );
  return {
    ...doc,
    lines: all<DocLine>('SELECT * FROM document_lines WHERE document_id=?', documentId),
    payments: all<Payment>(
      `SELECT p.*, ca.name AS account_name
       FROM payments p
       LEFT JOIN cash_accounts ca ON ca.id = p.account_id
       WHERE p.document_id=? ORDER BY p.date DESC, p.created_at DESC`,
      documentId,
    ),
  };
}

function prepareDocument(
  input: z.infer<typeof documentSchema>,
  branch: Branch,
  existingDocId?: string,
) {
  const isCustomerDoc = input.type === 'SALE' || input.type === 'SALE_RETURN';
  const expectedPartyType = isCustomerDoc ? 'CUSTOMER' : 'SUPPLIER';
  const party = requireRow(
    one<Party>('SELECT * FROM parties WHERE id=? AND active=1', input.party_id),
  );
  if (party.type !== expectedPartyType) throw new AppError(400, 'نوع الحساب لا يتوافق مع الفاتورة');
  if (new Set(input.lines.map((l) => l.product_id)).size !== input.lines.length)
    throw new AppError(400, 'المنتج مكرر في الفاتورة؛ عدّل الكمية بدلاً من تكراره');

  if (input.type === 'SALE_RETURN' || input.type === 'PURCHASE_RETURN') {
    if (!input.original_document_id) {
      throw new AppError(400, 'المرتجع يجب أن يرتبط بفاتورة أصلية');
    }
    const orig = requireRow(
      one<Document>('SELECT * FROM documents WHERE id=?', input.original_document_id),
    );
    if (orig.status !== 'POSTED') {
      throw new AppError(400, 'لا يمكن عمل مرتجع إلا لفاتورة معتمدة');
    }
    const expectedOrigType = input.type === 'SALE_RETURN' ? 'SALE' : 'PURCHASE';
    if (orig.type !== expectedOrigType) {
      throw new AppError(400, 'نوع الفاتورة الأصلية لا يطابق نوع المرتجع');
    }
    if (orig.party_id !== input.party_id) {
      throw new AppError(400, 'طرف التعامل لا يطابق طرف الفاتورة الأصلية');
    }
    validateReturnLines(input.original_document_id, input.lines, existingDocId ?? null);
  }

  const lines = input.lines.map((line) => {
    const product = requireRow(
      one<ProductRow>('SELECT * FROM products WHERE id=? AND active=1', line.product_id),
    );
    assertAssortment(branch.id, product.id, product.name);

    let costPrice = product.cost_price;
    if (input.original_document_id) {
      const origLine = one<{ cost_price: number; unit_price: number }>(
        'SELECT cost_price, unit_price FROM document_lines WHERE document_id=? AND product_id=?',
        input.original_document_id,
        line.product_id,
      );
      if (origLine) {
        costPrice = origLine.cost_price;
      }
    }

    return {
      ...line,
      name: product.name,
      sku: product.sku,
      cost_price: costPrice,
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
    const computed = prepareDocument(input, branch, existingId);
    let documentId = existingId;
    if (documentId) {
      const existing = requireRow(one<Document>('SELECT * FROM documents WHERE id=?', documentId));
      if (existing.status !== 'DRAFT' || existing.type !== input.type)
        throw new AppError(409, 'لا يمكن تعديل فاتورة معتمدة أو تغيير نوعها');
      // Moving a draft to another branch requires access to both branches.
      if (existing.branch_id !== branch.id) writableBranch(actor, existing.branch_id);
      run(
        'UPDATE documents SET branch_id=?,party_id=?,original_document_id=?,date=?,due_date=?,subtotal=?,discount=?,tax_rate=?,tax=?,total=?,notes=? WHERE id=?',
        branch.id,
        input.party_id,
        input.original_document_id ?? null,
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
      let prefixType = 'INV';
      if (input.type === 'SALE') prefixType = 'INV';
      else if (input.type === 'PURCHASE') prefixType = 'PO';
      else if (input.type === 'SALE_RETURN') prefixType = 'CN';
      else if (input.type === 'PURCHASE_RETURN') prefixType = 'DN';
      const prefix = prefixType + '-' + branch.code;
      const number = nextNumber(prefix, input.date.slice(0, 4));
      // UBL 2.1 document UUID + reference to the original invoice's UUID (for returns).
      const internalCode = id();
      const originalDoc = input.original_document_id
        ? one<{ internal_code: string | null; pos_shift_id: string | null }>(
            'SELECT internal_code, pos_shift_id FROM documents WHERE id=?',
            input.original_document_id,
          )
        : undefined;
      const referenceUuid = originalDoc?.internal_code ?? '';
      // A return inherits the POS shift of the original sale so refunds net against
      // the cashier's shift reconciliation.
      const inheritedShiftId = originalDoc?.pos_shift_id ?? null;
      run(
        'INSERT INTO documents(id,number,type,status,branch_id,party_id,original_document_id,date,due_date,subtotal,discount,tax_rate,tax,total,paid,notes,created_by,created_at,internal_code,reference_uuid,pos_shift_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)',
        documentId,
        number,
        input.type,
        'DRAFT',
        branch.id,
        input.party_id,
        input.original_document_id ?? null,
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
        internalCode,
        referenceUuid,
        inheritedShiftId,
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

    if (doc.type === 'SALE_RETURN' || doc.type === 'PURCHASE_RETURN') {
      validateReturnLines(doc.original_document_id!, doc.lines, doc.id);
    }

    for (const line of doc.lines) {
      const product = requireRow(
        one<ProductRow>('SELECT * FROM products WHERE id=?', line.product_id),
      );
      if (!product.active) throw new AppError(409, `المنتج ${product.name} مؤرشف`);
      assertAssortment(doc.branch_id, product.id, product.name);

      if (doc.type === 'SALE') {
        // Snapshot WAC as COGS before reducing stock
        const wac = effectiveCost(doc.branch_id, product.id);
        run('UPDATE document_lines SET cost_price=? WHERE id=?', wac, line.id);
        moveStock({
          branchId: doc.branch_id,
          productId: product.id,
          delta: -line.quantity,
          reason: 'بيع ' + doc.number,
          actor,
          documentId,
        });
      } else if (doc.type === 'PURCHASE') {
        // PURCHASE: inflow — use the line's unit_price as purchase cost
        moveStock({
          branchId: doc.branch_id,
          productId: product.id,
          delta: line.quantity,
          reason: 'شراء ' + doc.number,
          actor,
          documentId,
          unitCost: line.unit_price,
        });
      } else if (doc.type === 'SALE_RETURN') {
        // Customer returns goods to branch: stock increases
        // WAC restored at line's snapshotted COGS from original sale
        moveStock({
          branchId: doc.branch_id,
          productId: product.id,
          delta: line.quantity,
          reason: 'مرتجع بيع ' + doc.number,
          actor,
          documentId,
          unitCost: line.cost_price,
        });
      } else if (doc.type === 'PURCHASE_RETURN') {
        // Goods leave branch back to supplier: stock decreases
        const current = branchStock(doc.branch_id, product.id);
        if (current < line.quantity) {
          throw new AppError(
            409,
            `المخزون الحالي (${current}) لا يكفي لمرتجع المشتريات (${line.quantity})`,
          );
        }
        moveStock({
          branchId: doc.branch_id,
          productId: product.id,
          delta: -line.quantity,
          reason: 'مرتجع شراء ' + doc.number,
          actor,
          documentId,
        });
      }
    }
    run("UPDATE documents SET status='POSTED' WHERE id=?", documentId);
    // Post to the double-entry ledger in the same transaction, so the books never drift.
    const posted = documentDetail(documentId);
    postDocumentLedger(posted, actor);
    // Queue the Egyptian e-invoice submission (runs asynchronously in the outbox).
    enqueueEtaSubmission(documentId, actor.id);
    audit(
      actor,
      doc.type === 'SALE' || doc.type === 'PURCHASE' ? 'اعتماد فاتورة' : 'اعتماد مرتجع',
      doc.type,
      documentId,
      doc.number,
    );
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

    // Prevent cancelling an invoice that has active returns
    const activeReturns = all<Document>(
      "SELECT id, number FROM documents WHERE original_document_id=? AND status<>'CANCELLED'",
      documentId,
    );
    if (activeReturns.length > 0) {
      throw new AppError(
        409,
        `لا يمكن إلغاء الفاتورة؛ يوجد لها مرتجع (${activeReturns[0].number}) غير ملغى. ألغِ المرتجع أولاً.`,
      );
    }

    writableBranch(actor, doc.branch_id);
    if (doc.status === 'POSTED')
      for (const line of doc.lines) {
        const product = requireRow(
          one<ProductRow>('SELECT * FROM products WHERE id=?', line.product_id),
        );
        const current = branchStock(doc.branch_id, product.id);

        if (doc.type === 'SALE') {
          // Reversal of a sale: items return to branch (+delta)
          moveStock({
            branchId: doc.branch_id,
            productId: product.id,
            delta: line.quantity,
            reason: 'إلغاء ' + doc.number,
            actor,
            documentId: doc.id,
            unitCost: line.cost_price,
          });
        } else if (doc.type === 'PURCHASE') {
          // Reversal of a purchase: items leave branch (-delta)
          if (current - line.quantity < 0)
            throw new AppError(409, 'تعذر عكس المخزون؛ الكمية الحالية لا تسمح بالإلغاء');
          moveStock({
            branchId: doc.branch_id,
            productId: product.id,
            delta: -line.quantity,
            reason: 'إلغاء ' + doc.number,
            actor,
            documentId: doc.id,
          });
        } else if (doc.type === 'SALE_RETURN') {
          // Reversal of a sale return: items leave branch again (-delta)
          if (current - line.quantity < 0)
            throw new AppError(409, 'تعذر عكس المخزون؛ الكمية الحالية لا تسمح بإلغاء المرتجع');
          moveStock({
            branchId: doc.branch_id,
            productId: product.id,
            delta: -line.quantity,
            reason: 'إلغاء ' + doc.number,
            actor,
            documentId: doc.id,
          });
        } else if (doc.type === 'PURCHASE_RETURN') {
          // Reversal of a purchase return: items return to branch (+delta)
          moveStock({
            branchId: doc.branch_id,
            productId: product.id,
            delta: line.quantity,
            reason: 'إلغاء ' + doc.number,
            actor,
            documentId: doc.id,
            unitCost: line.cost_price,
          });
        }
      }
    run("UPDATE documents SET status='CANCELLED' WHERE id=?", documentId);
    // Reverse any ledger entry this document had posted.
    reverseDocumentLedger(doc, actor);
    // A cancelled invoice must not remain queued for submission.
    if (isEtaEligible(doc.type)) {
      run(
        "UPDATE e_invoice_submissions SET status='CANCELLED', updated_at=? WHERE document_id=? AND status IN ('PENDING','FAILED')",
        now(),
        documentId,
      );
      run(
        "UPDATE documents SET eta_status='CANCELLED' WHERE id=? AND eta_status<>'VALID'",
        documentId,
      );
    }
    audit(
      actor,
      doc.type === 'SALE' || doc.type === 'PURCHASE' ? 'إلغاء فاتورة' : 'إلغاء مرتجع',
      doc.type,
      documentId,
      doc.number,
    );
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
    const accountId = input.account_id || resolveDefaultAccountId(input.method, doc.branch_id);
    if (doc.type === 'PURCHASE' || doc.type === 'SALE_RETURN') {
      assertAccountFunds(accountId, input.amount, actor, input.override_overdraft);
    }
    const paymentId = id();
    run(
      'INSERT INTO payments(id,document_id,amount,method,date,reference,created_by,created_at,request_key,account_id) VALUES(?,?,?,?,?,?,?,?,?,?)',
      paymentId,
      documentId,
      input.amount,
      input.method,
      input.date,
      input.reference,
      actor.id,
      now(),
      key || null,
      accountId,
    );
    run('UPDATE documents SET paid=paid+? WHERE id=?', input.amount, documentId);
    // Ledger: cash/bank against the customer or supplier balance.
    postPaymentLedger(
      {
        id: paymentId,
        documentId,
        documentType: doc.type,
        documentNumber: doc.number,
        partyName: '',
        amount: input.amount,
        date: input.date,
        branchId: doc.branch_id,
        glAccountId: glAccountForCashAccount(accountId),
        reference: input.reference,
      },
      actor,
    );
    audit(actor, 'تسجيل دفعة', doc.type, documentId, doc.number);
    return documentDetail(documentId);
  });
}
