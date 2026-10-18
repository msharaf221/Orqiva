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
import type {
  PosShift,
  PosCashMovement,
  PosShiftSummary,
  PosShiftPaymentDetail,
  Document,
  DocLine,
} from '../src/types';

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
  const expectedCard = cardSales;
  const expectedBank = bankSales;

  const effectiveCash =
    shift.closing_cash !== null && shift.closing_cash !== undefined
      ? shift.closing_cash
      : shift.cashier_declared_cash !== null && shift.cashier_declared_cash !== undefined
        ? shift.cashier_declared_cash
        : null;
  const difference = effectiveCash !== null ? effectiveCash - expectedCash : 0;

  const effectiveCard =
    shift.closing_card !== null && shift.closing_card !== undefined
      ? shift.closing_card
      : shift.cashier_declared_card !== null && shift.cashier_declared_card !== undefined
        ? shift.cashier_declared_card
        : null;
  const cardDifference = effectiveCard !== null ? effectiveCard - expectedCard : 0;

  const effectiveBank =
    shift.closing_bank !== null && shift.closing_bank !== undefined
      ? shift.closing_bank
      : shift.cashier_declared_bank !== null && shift.cashier_declared_bank !== undefined
        ? shift.cashier_declared_bank
        : null;
  const bankDifference = effectiveBank !== null ? effectiveBank - expectedBank : 0;

  const movements = all<PosCashMovement>(
    `SELECT m.*, u.name user_name
     FROM pos_cash_movements m JOIN users u ON u.id=m.created_by
     WHERE m.shift_id=? ORDER BY m.created_at ASC`,
    shiftId,
  );

  const payments = all<PosShiftPaymentDetail>(
    `SELECT p.id, p.document_id, d.number document_number, pt.name party_name,
            p.amount, p.method, p.date, p.reference
     FROM payments p
     JOIN documents d ON d.id=p.document_id
     JOIN parties pt ON pt.id=d.party_id
     WHERE d.pos_shift_id=?
     ORDER BY p.date ASC, p.id ASC`,
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
    expected_card: expectedCard,
    expected_bank: expectedBank,
    closing_cash: shift.closing_cash ?? null,
    closing_card: shift.closing_card ?? null,
    closing_bank: shift.closing_bank ?? null,
    difference,
    card_difference: cardDifference,
    bank_difference: bankDifference,
    cashier_declared_cash: shift.cashier_declared_cash,
    cashier_declared_card: shift.cashier_declared_card,
    cashier_declared_bank: shift.cashier_declared_bank,
    terminal_batch_number: shift.terminal_batch_number,
    card_slips_count: shift.card_slips_count,
    bank_transfers_count: shift.bank_transfers_count,
    safe_envelope_number: shift.safe_envelope_number,
    proof_documents: shift.proof_documents,
    verification_checklist: shift.verification_checklist,
    discrepancy_expense_id: shift.discrepancy_expense_id,
    movements,
    payments,
  };
}

/**
 * 1. Cashier Handover: Declares physical cash, card terminal settlement, InstaPay totals,
 * attachments/slips, and transitions to PENDING_REVIEW.
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

    const declaredCash = input.declared_cash;
    const declaredCard = input.declared_card ?? summary.expected_card;
    const declaredBank = input.declared_bank ?? summary.expected_bank;

    const diffCash = declaredCash - summary.expected_cash;
    const diffCard = declaredCard - summary.expected_card;
    const diffBank = declaredBank - summary.expected_bank;

    run(
      `UPDATE pos_shifts
       SET status='PENDING_REVIEW',
           expected_cash=?, expected_card=?, expected_bank=?,
           cashier_declared_cash=?, cashier_declared_card=?, cashier_declared_bank=?,
           difference=?, card_difference=?, bank_difference=?,
           terminal_batch_number=?, card_slips_count=?, bank_transfers_count=?,
           safe_envelope_number=?, proof_documents=?, notes=?
       WHERE id=?`,
      summary.expected_cash,
      summary.expected_card,
      summary.expected_bank,
      declaredCash,
      declaredCard,
      declaredBank,
      diffCash,
      diffCard,
      diffBank,
      input.terminal_batch_number || '',
      input.card_slips_count || 0,
      input.bank_transfers_count || 0,
      input.safe_envelope_number || '',
      input.proof_documents || '',
      input.notes || '',
      shiftId,
    );

    audit(
      actor,
      'تسليم وردية كاشير للخزنة بجميع الإثباتات والورقيات',
      'POS_SHIFT',
      shiftId,
      `المتوقع: كاش=${summary.expected_cash / 100}، فيزا=${summary.expected_card / 100}، إنستاباي=${summary.expected_bank / 100} | المسلّم: كاش=${declaredCash / 100}، فيزا=${declaredCard / 100} (دفعة #${input.terminal_batch_number || '—'})، إنستاباي=${declaredBank / 100} | مظروف #${input.safe_envelope_number || '—'}`,
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
 * Reconciles cash, card slips, and InstaPay transfers, checks physical proofs, closes shift,
 * and automatically creates journal entries (e.g. POS cash shortage expense entry when difference < 0).
 */
export function approveShiftClosing(shiftId: string, raw: unknown, actor: Actor): PosShift {
  const input = posShiftApproveSchema.parse(raw);

  return transaction(() => {
    const summary = getShiftSummary(shiftId, actor);
    if (summary.shift.status === 'CLOSED') {
      throw new AppError(409, 'هذه الوردية مغلقة ومعتمدة بالفعل');
    }

    const closingCash = input.closing_cash;
    const closingCard =
      input.closing_card ?? summary.shift.cashier_declared_card ?? summary.expected_card;
    const closingBank =
      input.closing_bank ?? summary.shift.cashier_declared_bank ?? summary.expected_bank;

    const diffCash = closingCash - summary.expected_cash;
    const diffCard = closingCard - summary.expected_card;
    const diffBank = closingBank - summary.expected_bank;

    let expenseId: string | null = null;
    if (diffCash < 0) {
      expenseId = id();
      const shiftCashier = one<{ name: string }>(
        'SELECT name FROM users WHERE id=?',
        summary.shift.user_id,
      );
      const cashierName = shiftCashier?.name || 'كاشير نقطة البيع';
      const shortageAmount = Math.abs(diffCash);
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

    const checklistStr = input.verification_checklist || summary.shift.verification_checklist || '';

    run(
      `UPDATE pos_shifts
       SET status='CLOSED', closed_at=?,
           expected_cash=?, expected_card=?, expected_bank=?,
           closing_cash=?, closing_card=?, closing_bank=?,
           difference=?, card_difference=?, bank_difference=?,
           reviewed_by=?, review_notes=?, discrepancy_expense_id=?,
           verification_checklist=?
       WHERE id=?`,
      now(),
      summary.expected_cash,
      summary.expected_card,
      summary.expected_bank,
      closingCash,
      closingCard,
      closingBank,
      diffCash,
      diffCard,
      diffBank,
      actor.id,
      input.review_notes || '',
      expenseId,
      checklistStr,
      shiftId,
    );

    audit(
      actor,
      'اعتماد محاسبي وإغلاق وردية كاشير مع التدقيق المالي والإثباتات الورقية',
      'POS_SHIFT',
      shiftId,
      `كاش: ${closingCash / 100} (فارق: ${diffCash / 100}) | فيزا: ${closingCard / 100} (فارق: ${diffCard / 100}) | إنستاباي: ${closingBank / 100} (فارق: ${diffBank / 100})${expenseId ? ' (تم ترحيل قيد عجز نقدية)' : ''}`,
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
      closing_card: input.closing_card,
      closing_bank: input.closing_bank,
      review_notes: input.review_notes || input.notes || '',
      verification_checklist: input.verification_checklist,
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
 * 3. Creates Document (SALE), posts it, and adds payment(s) (single or split).
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
        throw new AppError(
          409,
          'الوردية المحددة غير صالحة أو مغلقة بالفعل أو بانتظار اعتماد الخزنة',
        );
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

    // Record payments (single payment or split payments)
    let changeDue = 0;
    const recordedPayments: Array<{ method: string; amount: number; reference?: string }> = [];

    if (input.split_payments && input.split_payments.length > 0) {
      for (const sp of input.split_payments) {
        const pMethod = sp.method;
        const accId = sp.account_id || resolveDefaultAccountId(pMethod, branch.id);
        const ref =
          sp.reference ||
          (pMethod === 'CARD'
            ? 'بطاقة بنكية (POS)'
            : pMethod === 'BANK'
              ? 'إنستاباي / محفظة'
              : 'نقدي (POS)');
        addPayment(
          postedDoc.id,
          {
            amount: sp.amount,
            method: pMethod,
            date: input.date,
            reference: ref,
            account_id: accId,
          },
          actor,
        );
        recordedPayments.push({ method: pMethod, amount: sp.amount, reference: ref });
      }
    } else if (
      input.payment &&
      input.payment.method !== 'CREDIT' &&
      input.payment.amount_paid > 0
    ) {
      const paymentAmount = Math.min(input.payment.amount_paid, postedDoc.total);
      const paymentMethod =
        input.payment.method === 'CASH'
          ? 'CASH'
          : input.payment.method === 'CARD'
            ? 'CARD'
            : 'BANK';
      const accountId =
        input.payment.account_id || resolveDefaultAccountId(paymentMethod, branch.id);
      const ref =
        input.payment.reference ||
        (paymentMethod === 'CARD'
          ? 'بطاقة بنكية / فيزا (POS)'
          : paymentMethod === 'BANK'
            ? 'إنستاباي / محفظة'
            : 'نقطة بيع سريعة (POS)');

      addPayment(
        postedDoc.id,
        {
          amount: paymentAmount,
          method: paymentMethod,
          date: input.date,
          reference: ref,
          account_id: accountId,
        },
        actor,
      );
      recordedPayments.push({ method: paymentMethod, amount: paymentAmount, reference: ref });

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

    const paymentResult =
      input.split_payments && input.split_payments.length > 0
        ? {
            method: 'SPLIT',
            amount_tendered: input.split_payments.reduce((s, p) => s + p.amount, 0),
            amount_paid: input.split_payments.reduce((s, p) => s + p.amount, 0),
            change_due: 0,
            splits: recordedPayments,
          }
        : {
            method: input.payment?.method || 'CASH',
            amount_tendered: input.payment?.amount_tendered || 0,
            amount_paid: input.payment?.amount_paid || 0,
            change_due: changeDue,
            reference: input.payment?.reference,
            splits: recordedPayments,
          };

    return {
      document: finalDoc,
      lines,
      shift_id: shiftId,
      payment: paymentResult,
    };
  });
}
