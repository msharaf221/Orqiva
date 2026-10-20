/**
 * Automatic posting: turns business events into balanced journal entries.
 *
 * These helpers are called from inside the originating transaction (document posting,
 * payments, expenses, cash movements, transfers, stocktakes), so the ledger write either
 * commits with the business event or rolls back with it. Nothing here opens its own
 * transaction; `postEntry` is savepoint-aware.
 *
 * Account mapping uses system keys from migration 014:
 *   CASH, BANK, AR, INVENTORY, VAT_INPUT, AP, VAT_OUTPUT, SALES, SALES_RETURNS,
 *   DISCOUNTS, COGS, SHRINKAGE, PURCHASE_RETURNS, EXPENSE, RETAINED, OPENING_EQUITY
 *
 * Amounts match the app: line totals are pre-tax minor units, VAT is booked separately.
 */

import { one } from './db';
import { postEntry, reverseBySource, systemAccount, type LedgerLineInput } from './ledger';
import type { Actor } from './scope';
import type { Document, DocLine, JournalSourceType } from '../src/types';

interface PostedDocument extends Document {
  lines: DocLine[];
}

/** Ledger entry lines for a posted document, keyed by document type. */
function documentLines(doc: PostedDocument): LedgerLineInput[] {
  // Documents store money as: subtotal (pre-tax, before discount), discount, tax, total.
  const net = doc.subtotal - doc.discount;
  const total = doc.total;
  const tax = doc.tax;
  const cogs = doc.lines.reduce((s, l) => s + l.quantity * l.cost_price, 0);
  const branchId = doc.branch_id;
  const memo = doc.number;

  switch (doc.type) {
    case 'SALE': {
      // Dr AR/cash (total) = Cr Sales (net) + Cr VAT output (tax)
      // Dr COGS = Cr Inventory
      const lines: LedgerLineInput[] = [
        { systemKey: 'AR', debit: total, branchId, memo },
        { systemKey: 'SALES', credit: net, branchId, memo },
      ];
      if (tax > 0) lines.push({ systemKey: 'VAT_OUTPUT', credit: tax, branchId, memo });
      if (cogs > 0) {
        lines.push({ systemKey: 'COGS', debit: cogs, branchId, memo });
        lines.push({ systemKey: 'INVENTORY', credit: cogs, branchId, memo });
      }
      return lines;
    }
    case 'PURCHASE': {
      // Dr Inventory (net) + Dr VAT input (tax) = Cr AP (total)
      const lines: LedgerLineInput[] = [
        { systemKey: 'INVENTORY', debit: net, branchId, memo },
        { systemKey: 'AP', credit: total, branchId, memo },
      ];
      if (tax > 0) lines.push({ systemKey: 'VAT_INPUT', debit: tax, branchId, memo });
      return lines;
    }
    case 'SALE_RETURN': {
      // Mirror of a sale: Dr Sales returns (net) + Dr VAT output (tax) = Cr AR (total)
      // Dr Inventory = Cr COGS (goods come back at their original cost)
      const lines: LedgerLineInput[] = [
        { systemKey: 'SALES_RETURNS', debit: net, branchId, memo },
        { systemKey: 'AR', credit: total, branchId, memo },
      ];
      if (tax > 0) lines.push({ systemKey: 'VAT_OUTPUT', debit: tax, branchId, memo });
      if (cogs > 0) {
        lines.push({ systemKey: 'INVENTORY', debit: cogs, branchId, memo });
        lines.push({ systemKey: 'COGS', credit: cogs, branchId, memo });
      }
      return lines;
    }
    case 'PURCHASE_RETURN': {
      // Dr AP (total) = Cr Inventory (net) + Cr VAT input (tax). Goods leave stock and the
      // payable to the supplier drops by the same pre-tax value.
      const lines: LedgerLineInput[] = [
        { systemKey: 'AP', debit: total, branchId, memo },
        { systemKey: 'INVENTORY', credit: net, branchId, memo },
      ];
      if (tax > 0) lines.push({ systemKey: 'VAT_INPUT', credit: tax, branchId, memo });
      return lines;
    }
    default:
      return [];
  }
}

/** Posts the ledger entry for a document that was just posted. Safe to call once per doc. */
export function postDocumentLedger(doc: PostedDocument, actor: Actor) {
  const sourceType = doc.type as JournalSourceType;
  const already = one<{ id: string }>(
    "SELECT id FROM journal_entries WHERE source_type=? AND source_id=? AND status='POSTED'",
    sourceType,
    doc.id,
  );
  if (already) return null;
  const lines = documentLines(doc);
  if (lines.length < 2) return null;
  return postEntry(
    {
      date: doc.date,
      memo: `${labelFor(doc.type)} ${doc.number} · ${doc.party_name}`,
      sourceType,
      sourceId: doc.id,
      branchId: doc.branch_id,
      lines,
    },
    actor,
  );
}

/** Reverses the ledger entry of a cancelled document. */
export function reverseDocumentLedger(doc: Document, actor: Actor) {
  return reverseBySource(
    doc.type as JournalSourceType,
    doc.id,
    actor,
    `إلغاء ${labelFor(doc.type)} ${doc.number}`,
  );
}

function labelFor(type: Document['type']): string {
  switch (type) {
    case 'SALE':
      return 'فاتورة بيع';
    case 'PURCHASE':
      return 'فاتورة شراء';
    case 'SALE_RETURN':
      return 'مرتجع بيع';
    case 'PURCHASE_RETURN':
      return 'مرتجع شراء';
    default:
      return 'مستند';
  }
}

/**
 * Payment collected from a customer (SALE / PURCHASE_RETURN) or paid to a supplier
 * (PURCHASE / SALE_RETURN).
 *   collected → Dr Cash/Bank = Cr AR
 *   disbursed → Dr AP = Cr Cash/Bank
 */
export function postPaymentLedger(
  input: {
    id: string;
    documentId: string;
    documentType: Document['type'];
    documentNumber: string;
    partyName: string;
    amount: number;
    date: string;
    branchId: string;
    glAccountId: string;
    reference: string;
  },
  actor: Actor,
) {
  const inbound = input.documentType === 'SALE' || input.documentType === 'PURCHASE_RETURN';
  const cashSide: LedgerLineInput = inbound
    ? { accountId: input.glAccountId, debit: input.amount }
    : { accountId: input.glAccountId, credit: input.amount };
  const counterSide: LedgerLineInput = inbound
    ? { systemKey: 'AR', credit: input.amount }
    : { systemKey: 'AP', debit: input.amount };
  return postEntry(
    {
      date: input.date,
      memo: `دفعة على ${labelFor(input.documentType)} ${input.documentNumber} · ${input.partyName}`,
      sourceType: 'PAYMENT',
      sourceId: input.id,
      branchId: input.branchId,
      lines: [cashSide, counterSide],
    },
    actor,
  );
}

/** Expense: Dr Expense (or a chosen GL account) = Cr Cash/Bank. */
export function postExpenseLedger(
  input: {
    id: string;
    title: string;
    category: string;
    amount: number;
    date: string;
    branchId: string | null;
    glAccountId: string;
  },
  actor: Actor,
) {
  return postEntry(
    {
      date: input.date,
      memo: `مصروف ${input.category} · ${input.title}`,
      sourceType: 'EXPENSE',
      sourceId: input.id,
      branchId: input.branchId,
      lines: [
        { systemKey: 'EXPENSE', debit: input.amount },
        { accountId: input.glAccountId, credit: input.amount },
      ],
    },
    actor,
  );
}

/** Transfer of funds between cash/bank accounts: Dr destination = Cr source. */
export function postAccountTransferLedger(
  input: {
    id: string;
    number: string;
    amount: number;
    date: string;
    fromGlAccountId: string;
    toGlAccountId: string;
    fromName: string;
    toName: string;
  },
  actor: Actor,
) {
  return postEntry(
    {
      date: input.date,
      memo: `تحويل مالي ${input.number} · من ${input.fromName} إلى ${input.toName}`,
      sourceType: 'ACCOUNT_TRANSFER',
      sourceId: input.id,
      lines: [
        { accountId: input.toGlAccountId, debit: input.amount },
        { accountId: input.fromGlAccountId, credit: input.amount },
      ],
    },
    actor,
  );
}

/**
 * POS drawer movement. A cash-in (float top-up / cash sale deposit) increases the drawer;
 * a cash-out (bank drop, petty cash) decreases it. The counterpart defaults to equity/opening
 * since a drawer movement is an internal reclassification until expenses are attached.
 */
export function postPosCashMovementLedger(
  input: {
    id: string;
    shiftNumber: string;
    type: 'IN' | 'OUT';
    amount: number;
    date: string;
    branchId: string;
    reason: string;
  },
  actor: Actor,
) {
  const counter = systemAccount(input.type === 'IN' ? 'OPENING_EQUITY' : 'EXPENSE');
  return postEntry(
    {
      date: input.date,
      memo: `حركة درج نقطة بيع ${input.shiftNumber} · ${input.reason}`,
      sourceType: 'POS_CASH',
      sourceId: input.id,
      branchId: input.branchId,
      lines:
        input.type === 'IN'
          ? [
              { systemKey: 'CASH', debit: input.amount },
              { accountId: counter.id, credit: input.amount },
            ]
          : [
              { accountId: counter.id, debit: input.amount },
              { systemKey: 'CASH', credit: input.amount },
            ],
    },
    actor,
  );
}

/**
 * Shrinkage posted on stocktake approval: goods that went missing are an expense, and the
 * inventory asset drops by the same amount.
 */
export function postShrinkageLedger(
  input: {
    id: string;
    number: string;
    date: string;
    branchId: string;
    /** Positive = surplus (increase), negative = shortage (expense). */
    amount: number;
  },
  actor: Actor,
) {
  if (input.amount === 0) return null;
  const surplus = input.amount > 0;
  const value = Math.abs(input.amount);
  return postEntry(
    {
      date: input.date,
      memo: `تسوية جرد دوري ${input.number}`,
      sourceType: 'STOCKTAKE',
      sourceId: input.id,
      branchId: input.branchId,
      lines: surplus
        ? [
            { systemKey: 'INVENTORY', debit: value },
            { systemKey: 'SHRINKAGE', credit: value },
          ]
        : [
            { systemKey: 'SHRINKAGE', debit: value },
            { systemKey: 'INVENTORY', credit: value },
          ],
    },
    actor,
  );
}

/**
 * Inter-branch transfer in transit: goods leave the source branch's inventory and become
 * inventory in transit, then land in the destination branch on receipt. Because the ledger
 * is scoped by branch, the two legs are separate entries tied to the same transfer.
 */
export function postTransferShipLedger(
  input: { id: string; number: string; date: string; branchId: string; amount: number },
  actor: Actor,
) {
  if (input.amount <= 0) return null;
  return postEntry(
    {
      date: input.date,
      memo: `تحويل بضاعة ${input.number} (صرف)`,
      sourceType: 'TRANSFER',
      sourceId: input.id,
      branchId: input.branchId,
      lines: [
        { systemKey: 'INVENTORY', credit: input.amount },
        { systemKey: 'OPENING_EQUITY', debit: input.amount },
      ],
    },
    actor,
  );
}

export function postTransferReceiveLedger(
  input: { id: string; number: string; date: string; branchId: string; amount: number },
  actor: Actor,
) {
  if (input.amount <= 0) return null;
  return postEntry(
    {
      date: input.date,
      memo: `تحويل بضاعة ${input.number} (استلام)`,
      sourceType: 'TRANSFER',
      sourceId: input.id,
      branchId: input.branchId,
      lines: [
        { systemKey: 'INVENTORY', debit: input.amount },
        { systemKey: 'OPENING_EQUITY', credit: input.amount },
      ],
    },
    actor,
  );
}
