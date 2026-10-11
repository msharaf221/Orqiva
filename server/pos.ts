import { all, one, run, transaction, id, now } from './db';
import { AppError } from './errors';
import {
  audit,
  nextNumber,
  saveDocument,
  postDocument,
  addPayment,
  branchStock,
  requireRow,
} from './service';
import { resolveDefaultAccountId } from './accounts';
import { writableBranch, type Actor, type Scope, scopeSql } from './scope';
import {
  posShiftOpenSchema,
  posCashMovementSchema,
  posShiftSubmitSchema,
  posShiftApproveSchema,
  posShiftCloseSchema,
  posCheckoutSchema,
} from './validation';
import type { PosShift, PosCashMovement, PosShiftSummary, Document, DocLine } from '../src/types';

export function ensureWalkInCustomer() {
  const existing = one('SELECT id FROM parties WHERE id=?', 'walk-in-customer');
  if (!existing) {
    run(
      `INSERT INTO parties(id, type, name, email, phone, address, tax_number, notes, active, created_at)
       VALUES('walk-in-customer', 'CUSTOMER', 'عميل نقدي (طائر)', '', '', '', '', 'عميل نقاط البيع الافتراضي', 1, ?)`,
      now(),
    );
  }
}

export function getCurrentShift(userId: string, branchId: string): PosShift | null {
  const shift = one<PosShift>(
    `SELECT s.*, u.name user_name, b.name branch_name, rev.name reviewer_name
     FROM pos_shifts s
     JOIN users u ON u.id=s.user_id
     JOIN branches b ON b.id=s.branch_id
     LEFT JOIN users rev ON rev.id=s.reviewed_by
     WHERE s.branch_id=? AND s.user_id=? AND s.status IN ('OPEN', 'PENDING_REVIEW')
     ORDER BY s.opened_at DESC LIMIT 1`,
    branchId,
    userId,
  );
  return shift || null;
}

export function openShift(raw: unknown, actor: Actor): PosShift {
  const input = posShiftOpenSchema.parse(raw);
  const branch = writableBranch(actor, input.branch_id);

  return transaction(() => {
    const existing = getCurrentShift(actor.id, branch.id);
    if (existing) {
      if (existing.status === 'PENDING_REVIEW') {
        throw new AppError(
          409,
          `لديك وردية سابقة (${existing.number}) تم تسليمها وبانتظار اعتماد محاسب الخزنة وترحيل القيود. يرجى انتظار اعتمادها لافتتاح وردية جديدة.`,
        );
      }
      throw new AppError(
        409,
        `لديك وردية مفتوحة بالفعل في فرع «${branch.name}» برقم ${existing.number}`,
      );
    }

    const shiftId = id();
    const prefix = `SH-${branch.code}`;
    const shiftNumber = nextNumber(prefix, new Date().getFullYear().toString());

    run(
      `INSERT INTO pos_shifts(id, number, branch_id, user_id, status, opened_at, opening_cash, expected_cash, difference, notes, created_at)
       VALUES(?, ?, ?, ?, 'OPEN', ?, ?, ?, 0, ?, ?)`,
      shiftId,
      shiftNumber,
      branch.id,
      actor.id,
      now(),
      input.opening_cash,
      input.opening_cash,
      input.notes || '',
      now(),
    );

    audit(actor, 'افتتاح وردية كاشير', 'POS_SHIFT', shiftId, `${branch.name} - ${shiftNumber}`);

    return requireRow(
      one<PosShift>(
        `SELECT s.*, u.name user_name, b.name branch_name
         FROM pos_shifts s JOIN users u ON u.id=s.user_id JOIN branches b ON b.id=s.branch_id
         WHERE s.id=?`,
        shiftId,
      ),
    );
  });
}

export function addCashMovement(shiftId: string, raw: unknown, actor: Actor): PosCashMovement {
  const input = posCashMovementSchema.parse(raw);

  return transaction(() => {
    const shift = requireRow(one<PosShift>('SELECT * FROM pos_shifts WHERE id=?', shiftId));
    if (shift.status !== 'OPEN') {
      throw new AppError(409, 'لا يمكن إضافة حركة نقدية لوردية مغلقة');
    }
    writableBranch(actor, shift.branch_id);

    const movementId = id();
    run(
      `INSERT INTO pos_cash_movements(id, shift_id, type, amount, reason, created_by, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
      movementId,
      shiftId,
      input.type,
      input.amount,
      input.reason,
      actor.id,
      now(),
    );

    audit(
      actor,
      input.type === 'IN' ? 'إيداع نقدي بالوردية' : 'سحب نقدي من الوردية',
      'POS_SHIFT',
      shiftId,
      `${input.amount / 100} ج.م - ${input.reason}`,
    );

    return requireRow(
      one<PosCashMovement>(
        `SELECT m.*, u.name user_name
         FROM pos_cash_movements m JOIN users u ON u.id=m.created_by
         WHERE m.id=?`,
        movementId,
      ),
    );
  });
}

export function getShiftSummary(shiftId: string, actor: Actor): PosShiftSummary {
  const shift = requireRow(
    one<PosShift>(
      `SELECT s.*, u.name user_name, b.name branch_name, rev.name reviewer_name
       FROM pos_shifts s
       JOIN users u ON u.id=s.user_id
       JOIN branches b ON b.id=s.branch_id
       LEFT JOIN users rev ON rev.id=s.reviewed_by
       WHERE s.id=?`,
      shiftId,
    ),
  );
  writableBranch(actor, shift.branch_id);

  // Sales totals by payment method
  const paymentsByMethod = all<{ method: string; total: number }>(
    `SELECT p.method, COALESCE(SUM(p.amount), 0) total
     FROM payments p
     JOIN documents d ON d.id=p.document_id
     WHERE d.pos_shift_id=?
     GROUP BY p.method`,
    shiftId,
  );

  let cashSales = 0;
  let cardSales = 0;
  let bankSales = 0;

  for (const pm of paymentsByMethod) {
    if (pm.method === 'CASH') cashSales = pm.total;
    else if (pm.method === 'CARD') cardSales = pm.total;
    else if (pm.method === 'BANK') bankSales = pm.total;
  }

  // Total sales from documents
  const docTotals = one<{ total: number; count: number; paid: number }>(
    `SELECT COALESCE(SUM(total), 0) total, COUNT(id) count, COALESCE(SUM(paid), 0) paid
     FROM documents WHERE pos_shift_id=? AND status='POSTED'`,
    shiftId,
  ) || { total: 0, count: 0, paid: 0 };

  const creditSales = Math.max(0, docTotals.total - docTotals.paid);

  // Cash movements (IN / OUT)
  const movementsTotals = one<{ cash_in: number; cash_out: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN type='IN' THEN amount ELSE 0 END), 0) cash_in,
       COALESCE(SUM(CASE WHEN type='OUT' THEN amount ELSE 0 END), 0) cash_out
     FROM pos_cash_movements WHERE shift_id=?`,
    shiftId,
  ) || { cash_in: 0, cash_out: 0 };

  const expectedCash =
    shift.opening_cash + cashSales + movementsTotals.cash_in - movementsTotals.cash_out;
  const effectiveCash =
    shift.closing_cash !== null
      ? shift.closing_cash
      : shift.cashier_declared_cash !== null && shift.cashier_declared_cash !== undefined
        ? shift.cashier_declared_cash
        : null;
  const difference = effectiveCash !== null ? effectiveCash - expectedCash : 0;

  const movements = all<PosCashMovement>(
    `SELECT m.*, u.name user_name
     FROM pos_cash_movements m JOIN users u ON u.id=m.created_by
     WHERE m.shift_id=? ORDER BY m.created_at ASC`,
    shiftId,
  );

  return {
    shift,
    cash_sales: cashSales,
    card_sales: cardSales,
    bank_sales: bankSales,
    credit_sales: creditSales,
    total_sales: docTotals.total,
    sales_count: docTotals.count,
    cash_in: movementsTotals.cash_in,
    cash_out: movementsTotals.cash_out,
    opening_cash: shift.opening_cash,
    expected_cash: expectedCash,
    closing_cash: shift.closing_cash,
    difference,
    cashier_declared_cash: shift.cashier_declared_cash,
    discrepancy_expense_id: shift.discrepancy_expense_id,
    movements,
  };
}

/**
 * 1. Cashier Handover: Declares physical cash in drawer, transitions to PENDING_REVIEW.
 */
export function submitShiftClosing(shiftId: string, raw: unknown, actor: Actor): PosShift {
  const input = posShiftSubmitSchema.parse(raw);

  return transaction(() => {
    const summary = getShiftSummary(shiftId, actor);
    if (summary.shift.status !== 'OPEN') {
      throw new AppError(
        409,
        summary.shift.status === 'PENDING_REVIEW'
          ? 'تم تسليم هذه الوردية بالفعل وهي بانتظار اعتماد محاسب الخزنة'
          : 'هذه الوردية مغلقة بالفعل',
      );
    }

    const difference = input.declared_cash - summary.expected_cash;

    run(
      `UPDATE pos_shifts
       SET status='PENDING_REVIEW', expected_cash=?, cashier_declared_cash=?, difference=?, notes=?
       WHERE id=?`,
      summary.expected_cash,
      input.declared_cash,
      difference,
      input.notes || '',
      shiftId,
    );

    audit(
      actor,
      'تسليم وردية كاشير للخزنة',
      'POS_SHIFT',
      shiftId,
      `المتوقع: ${summary.expected_cash / 100} ج.م | المسلّم من الكاشير: ${input.declared_cash / 100} ج.م | الفارق: ${difference / 100} ج.م`,
    );

    return requireRow(
      one<PosShift>(
        `SELECT s.*, u.name user_name, b.name branch_name, rev.name reviewer_name
         FROM pos_shifts s
         JOIN users u ON u.id=s.user_id
         JOIN branches b ON b.id=s.branch_id
         LEFT JOIN users rev ON rev.id=s.reviewed_by
         WHERE s.id=?`,
        shiftId,
      ),
    );
  });
}

/**
 * 2. Treasury Accountant Review & Approval:
 * Reconciles cash, verifies count, closes shift, and automatically creates
 * journal entries (e.g. POS cash shortage expense entry when difference < 0).
 */
export function approveShiftClosing(shiftId: string, raw: unknown, actor: Actor): PosShift {
  const input = posShiftApproveSchema.parse(raw);

  return transaction(() => {
    const summary = getShiftSummary(shiftId, actor);
    if (summary.shift.status === 'CLOSED') {
      throw new AppError(409, 'هذه الوردية مغلقة ومعتمدة بالفعل');
    }

    const difference = input.closing_cash - summary.expected_cash;
    let expenseId: string | null = null;

    // Automatic Accounting Journal Entries:
    // إذا وجد عجز نقدي في الوردية (difference < 0):
    // يتم إنشاء قيد مصروف تسوية عجز نقطة بيع تلقائياً وترحيله في مصروفات الفرع وحسابات الأرباح والخسائر
    if (difference < 0) {
      expenseId = id();
      const shiftCashier = one<{ name: string }>('SELECT name FROM users WHERE id=?', summary.shift.user_id);
      const cashierName = shiftCashier?.name || 'كاشير نقطة البيع';
      const shortageAmount = Math.abs(difference);
      const accountId = resolveDefaultAccountId('CASH', summary.shift.branch_id);

      run(
        `INSERT INTO expenses(id, branch_id, title, category, amount, date, method, notes, allocation, created_by, created_at, account_id)
         VALUES(?, ?, ?, 'عجز نقدية نقطة بيع', ?, ?, 'CASH', ?, 'BRANCH', ?, ?, ?)`,
        expenseId,
        summary.shift.branch_id,
        `عجز نقدية وردية ${summary.shift.number}`,
        shortageAmount,
        now().substring(0, 10),
        `قيد تسوية عجز نقدية مقفل بوردية ${summary.shift.number} - الكاشير: ${cashierName} - اعتماد الخزنة: ${actor.name}${input.review_notes ? ' | ملاحظات: ' + input.review_notes : ''}`,
        actor.id,
        now(),
        accountId,
      );
    }

    run(
      `UPDATE pos_shifts
       SET status='CLOSED', closed_at=?, expected_cash=?, closing_cash=?, difference=?,
           reviewed_by=?, review_notes=?, discrepancy_expense_id=?
       WHERE id=?`,
      now(),
      summary.expected_cash,
      input.closing_cash,
      difference,
      actor.id,
      input.review_notes || '',
      expenseId,
      shiftId,
    );

    audit(
      actor,
      'اعتماد محاسبي وإغلاق وردية كاشير وترحيل القيود',
      'POS_SHIFT',
      shiftId,
      `المتوقع: ${summary.expected_cash / 100} ج.م | الفعلي بالخزنة: ${input.closing_cash / 100} ج.م | الفارق: ${difference / 100} ج.م${expenseId ? ' (تم ترحيل قيد مصروف عجز بالخزنة)' : ''}`,
    );

    return requireRow(
      one<PosShift>(
        `SELECT s.*, u.name user_name, b.name branch_name, rev.name reviewer_name
         FROM pos_shifts s
         JOIN users u ON u.id=s.user_id
         JOIN branches b ON b.id=s.branch_id
         LEFT JOIN users rev ON rev.id=s.reviewed_by
         WHERE s.id=?`,
        shiftId,
      ),
    );
  });
}

/**
 * Direct close or fallback:
 * If actor is Treasury Accountant or Admin, directly approves and creates entries.
 */
export function closeShift(shiftId: string, raw: unknown, actor: Actor): PosShift {
  const input = posShiftCloseSchema.parse(raw);
  return approveShiftClosing(
    shiftId,
    {
      closing_cash: input.closing_cash,
      review_notes: input.review_notes || input.notes || '',
    },
    actor,
  );
}

export function listPendingReviewShifts(scope: Scope): PosShift[] {
  const f = scopeSql('s.branch_id', scope);
  return all<PosShift>(
    `SELECT s.*, u.name user_name, b.name branch_name
     FROM pos_shifts s
     JOIN users u ON u.id=s.user_id
     JOIN branches b ON b.id=s.branch_id
     WHERE ${f.sql} AND s.status='PENDING_REVIEW'
     ORDER BY s.opened_at DESC`,
    ...f.params,
  );
}

export function listShifts(scope: Scope, status?: string): PosShift[] {
  const f = scopeSql('s.branch_id', scope);
  const statusClause = status ? 'AND s.status=?' : '';
  const params = status ? [...f.params, status] : f.params;

  return all<PosShift>(
    `SELECT s.*, u.name user_name, b.name branch_name, rev.name reviewer_name
     FROM pos_shifts s
     JOIN users u ON u.id=s.user_id
     JOIN branches b ON b.id=s.branch_id
     LEFT JOIN users rev ON rev.id=s.reviewed_by
     WHERE ${f.sql} ${statusClause}
     ORDER BY s.opened_at DESC LIMIT 200`,
    ...params,
  );
}

/**
 * Executes a fast, atomic POS checkout:
 * 1. Checks and binds to active open shift.
 * 2. Checks product availability and prevents negative stock.
 * 3. Creates Document (SALE), posts it, and adds payment(s).
 * 4. Links Document with pos_shift_id.
 * 5. Returns receipt payload with change calculation.
 */
export function posCheckout(raw: unknown, actor: Actor) {
  const input = posCheckoutSchema.parse(raw);
  ensureWalkInCustomer();

  return transaction(() => {
    const branch = writableBranch(actor, input.branch_id);

    // Resolve shift: use provided shift or lookup active open shift
    let shiftId = input.shift_id;
    if (!shiftId) {
      const activeShift = getCurrentShift(actor.id, branch.id);
      if (!activeShift || activeShift.status !== 'OPEN') {
        throw new AppError(
          409,
          activeShift?.status === 'PENDING_REVIEW'
            ? 'تم تسليم هذه الوردية لمسؤول الخزنة بالفعل وبانتظار الاعتماد. لا يمكن تسجيل مبيعات عليها حتى يتم اعتمادها وافتتاح وردية جديدة.'
            : 'لا توجد وردية مفتوحة للكاشير في هذا الفرع. يرجى افتتاح وردية أولاً للبدء بالبيع.',
        );
      }
      shiftId = activeShift.id;
    } else {
      const shift = one<PosShift>("SELECT * FROM pos_shifts WHERE id=? AND status='OPEN'", shiftId);
      if (!shift) {
        throw new AppError(409, 'الوردية المحددة غير صالحة أو مغلقة بالفعل أو بانتظار اعتماد الخزنة');
      }
    }

    // Verify stock availability for all lines to prevent negative stock before saving
    for (const line of input.lines) {
      const available = branchStock(branch.id, line.product_id);
      if (available < line.quantity) {
        const prod = one<{ name: string }>('SELECT name FROM products WHERE id=?', line.product_id);
        throw new AppError(
          409,
          `المخزون غير كافٍ للمنتج «${prod?.name || line.product_id}»؛ المتاح: ${available}، والمطلوب: ${line.quantity}`,
        );
      }
    }

    // Company tax rate
    const company = requireRow(
      one<{ tax_rate: number }>('SELECT tax_rate FROM company WHERE id=1'),
    );

    // Create & Post Document
    const docData = saveDocument(
      {
        type: 'SALE',
        branch_id: branch.id,
        party_id: input.party_id,
        date: input.date,
        due_date: input.date,
        discount: input.discount,
        tax_rate: company.tax_rate,
        notes: input.notes || '',
        lines: input.lines,
      },
      actor,
    );

    // Link document with shift
    run('UPDATE documents SET pos_shift_id=? WHERE id=?', shiftId, docData.id);

    // Post document (draws stock, snapshots WAC cost, sets status to POSTED)
    const postedDoc = postDocument(docData.id, actor);

    // Record payment if not purely CREDIT
    let changeDue = 0;
    if (input.payment.method !== 'CREDIT' && input.payment.amount_paid > 0) {
      const paymentAmount = Math.min(input.payment.amount_paid, postedDoc.total);
      const paymentMethod = input.payment.method === 'CASH' ? 'CASH' : input.payment.method === 'CARD' ? 'CARD' : 'BANK';
      const accountId = input.payment.account_id || resolveDefaultAccountId(paymentMethod, branch.id);

      addPayment(
        postedDoc.id,
        {
          amount: paymentAmount,
          method: paymentMethod,
          date: input.date,
          reference: input.payment.reference || 'نقطة بيع سريعة (POS)',
          account_id: accountId,
        },
        actor,
      );

      if (input.payment.amount_tendered > paymentAmount) {
        changeDue = input.payment.amount_tendered - paymentAmount;
      }
    }

    audit(
      actor,
      'بيع نقطة بيع (POS)',
      'DOCUMENT',
      postedDoc.id,
      `${postedDoc.number} - ${branch.name}`,
    );

    // Return receipt-ready payload
    const finalDoc = one<Document>(
      `SELECT d.*, p.name party_name, p.phone party_phone, b.name branch_name, b.code branch_code, b.phone branch_phone
       FROM documents d
       JOIN parties p ON p.id=d.party_id
       JOIN branches b ON b.id=d.branch_id
       WHERE d.id=?`,
      postedDoc.id,
    )!;

    const lines = all<DocLine>('SELECT * FROM document_lines WHERE document_id=?', postedDoc.id);

    return {
      document: finalDoc,
      lines,
      shift_id: shiftId,
      payment: {
        method: input.payment.method,
        amount_tendered: input.payment.amount_tendered,
        amount_paid: input.payment.amount_paid,
        change_due: changeDue,
      },
    };
  });
}
