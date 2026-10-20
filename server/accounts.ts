import { all, one, run, transaction, id, now, type SQLInputValue } from './db';
import { cashAccountSchema, updateCashAccountSchema, accountTransferSchema } from './validation';
import { AppError, audit, nextNumber, requireRow, type Actor } from './service';
import { postAccountTransferLedger } from './posting';
import type { CashAccount, AccountTransfer, AccountStatementEntry } from '../src/types';

const ACCOUNT_BALANCE_EXPR = `
  (
    ca.initial_balance
    + COALESCE((SELECT SUM(p.amount) FROM payments p JOIN documents d ON d.id=p.document_id WHERE p.account_id=ca.id AND d.type IN ('SALE', 'PURCHASE_RETURN')), 0)
    + COALESCE((SELECT SUM(e.amount) FROM equity_entries e WHERE e.account_id=ca.id AND e.kind='CONTRIBUTION'), 0)
    + COALESCE((SELECT SUM(t.amount) FROM account_transfers t WHERE t.to_account_id=ca.id), 0)
    - COALESCE((SELECT SUM(p.amount) FROM payments p JOIN documents d ON d.id=p.document_id WHERE p.account_id=ca.id AND d.type IN ('PURCHASE', 'SALE_RETURN')), 0)
    - COALESCE((SELECT SUM(ex.amount) FROM expenses ex WHERE ex.account_id=ca.id), 0)
    - COALESCE((SELECT SUM(dp.amount) FROM distribution_payments dp WHERE dp.account_id=ca.id), 0)
    - COALESCE((SELECT SUM(e.amount) FROM equity_entries e WHERE e.account_id=ca.id AND e.kind='WITHDRAWAL'), 0)
    - COALESCE((SELECT SUM(t.amount) FROM account_transfers t WHERE t.from_account_id=ca.id), 0)
  )
`;

const ACCOUNT_IN_EXPR = `
  (
    ca.initial_balance
    + COALESCE((SELECT SUM(p.amount) FROM payments p JOIN documents d ON d.id=p.document_id WHERE p.account_id=ca.id AND d.type IN ('SALE', 'PURCHASE_RETURN')), 0)
    + COALESCE((SELECT SUM(e.amount) FROM equity_entries e WHERE e.account_id=ca.id AND e.kind='CONTRIBUTION'), 0)
    + COALESCE((SELECT SUM(t.amount) FROM account_transfers t WHERE t.to_account_id=ca.id), 0)
  )
`;

const ACCOUNT_OUT_EXPR = `
  (
    COALESCE((SELECT SUM(p.amount) FROM payments p JOIN documents d ON d.id=p.document_id WHERE p.account_id=ca.id AND d.type IN ('PURCHASE', 'SALE_RETURN')), 0)
    + COALESCE((SELECT SUM(ex.amount) FROM expenses ex WHERE ex.account_id=ca.id), 0)
    + COALESCE((SELECT SUM(dp.amount) FROM distribution_payments dp WHERE dp.account_id=ca.id), 0)
    + COALESCE((SELECT SUM(e.amount) FROM equity_entries e WHERE e.account_id=ca.id AND e.kind='WITHDRAWAL'), 0)
    + COALESCE((SELECT SUM(t.amount) FROM account_transfers t WHERE t.from_account_id=ca.id), 0)
  )
`;

export function listCashAccounts(branchId?: string): CashAccount[] {
  let sql = `
    SELECT
      ca.*,
      b.name AS branch_name,
      ${ACCOUNT_BALANCE_EXPR} AS balance,
      ${ACCOUNT_IN_EXPR} AS total_in,
      ${ACCOUNT_OUT_EXPR} AS total_out
    FROM cash_accounts ca
    LEFT JOIN branches b ON b.id = ca.branch_id
  `;
  const params: SQLInputValue[] = [];
  if (branchId) {
    sql += ' WHERE (ca.branch_id = ? OR ca.branch_id IS NULL)';
    params.push(branchId);
  }
  sql += ' ORDER BY ca.active DESC, ca.type ASC, ca.created_at ASC';
  return all<CashAccount>(sql, ...params);
}

export function getCashAccount(accountId: string): CashAccount {
  const account = one<CashAccount>(
    `SELECT
      ca.*,
      b.name AS branch_name,
      ${ACCOUNT_BALANCE_EXPR} AS balance,
      ${ACCOUNT_IN_EXPR} AS total_in,
      ${ACCOUNT_OUT_EXPR} AS total_out
    FROM cash_accounts ca
    LEFT JOIN branches b ON b.id = ca.branch_id
    WHERE ca.id = ?`,
    accountId,
  );
  return requireRow(account);
}

export function getAccountBalance(accountId: string): number {
  const row = one<{ balance: number }>(
    `SELECT ${ACCOUNT_BALANCE_EXPR} AS balance FROM cash_accounts ca WHERE ca.id = ?`,
    accountId,
  );
  if (!row) throw new AppError(404, 'الحساب المالي غير موجود');
  return row.balance;
}

export function resolveDefaultAccountId(method: string, branchId?: string | null): string {
  if (method === 'BANK') {
    const bankAcc = one<{ id: string }>(
      "SELECT id FROM cash_accounts WHERE type = 'BANK' AND active = 1 ORDER BY (id = 'acc_def_bank') DESC LIMIT 1",
    );
    if (bankAcc) return bankAcc.id;
  }
  if (branchId) {
    const branchCash = one<{ id: string }>(
      "SELECT id FROM cash_accounts WHERE type = 'CASH' AND branch_id = ? AND active = 1 LIMIT 1",
      branchId,
    );
    if (branchCash) return branchCash.id;
  }
  const defaultCash = one<{ id: string }>(
    "SELECT id FROM cash_accounts WHERE type = 'CASH' AND active = 1 ORDER BY (id = 'acc_def_cash') DESC LIMIT 1",
  );
  if (defaultCash) return defaultCash.id;
  const anyAcc = one<{ id: string }>('SELECT id FROM cash_accounts WHERE active = 1 LIMIT 1');
  return anyAcc ? anyAcc.id : 'acc_def_cash';
}

/**
 * The ledger account a cash/bank account posts against. Treasury accounts mirror a GL
 * account directly; if the mapping is somehow missing we fall back to the system cash/bank
 * accounts so a posting is never silently dropped.
 */
export function glAccountForCashAccount(accountId: string): string {
  const row = one<{ gl_account_id: string | null; type: string }>(
    'SELECT gl_account_id, type FROM cash_accounts WHERE id=?',
    accountId,
  );
  if (row?.gl_account_id) return row.gl_account_id;
  const key = row?.type === 'CASH' ? 'CASH' : 'BANK';
  return one<{ id: string }>('SELECT id FROM chart_of_accounts WHERE system_key=?', key)?.id ?? '';
}

export function assertAccountFunds(
  accountId: string,
  amount: number,
  actor: Actor,
  overrideOverdraft = false,
) {
  const account = one<{ id: string; name: string; allow_negative: number; active: number }>(
    'SELECT id, name, allow_negative, active FROM cash_accounts WHERE id = ?',
    accountId,
  );
  if (!account) throw new AppError(404, 'الحساب المالي المحدد غير موجود');
  if (!account.active)
    throw new AppError(409, `الحساب المالي "${account.name}" مؤرشف ولا يقبل حركات`);

  if (overrideOverdraft) {
    if (actor.role !== 'ADMIN') {
      throw new AppError(403, 'تجاوز السحب على المكشوف متاح للمديرين فقط');
    }
    return;
  }

  if (account.allow_negative === 0) {
    const balance = getAccountBalance(accountId);
    if (balance < amount) {
      const balanceEgp = (balance / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
      const amountEgp = (amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
      throw new AppError(
        409,
        `رصيد الحساب "${account.name}" المتاح (${balanceEgp} ج.م) لا يكفي لإتمام العملية بمبلغ (${amountEgp} ج.م)`,
      );
    }
  }
}

export function createCashAccount(raw: unknown, actor: Actor): CashAccount {
  const input = cashAccountSchema.parse(raw);
  const accountId = id();

  if (input.branch_id) {
    requireRow(one('SELECT id FROM branches WHERE id = ?', input.branch_id));
  }

  run(
    `INSERT INTO cash_accounts(
      id, name, type, branch_id, currency, account_number, bank_name,
      initial_balance, allow_negative, active, notes, created_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    accountId,
    input.name,
    input.type,
    input.branch_id ?? null,
    input.currency,
    input.account_number,
    input.bank_name,
    input.initial_balance,
    input.allow_negative,
    input.notes,
    now(),
  );

  audit(actor, 'إنشاء حساب مالي', 'CASH_ACCOUNT', accountId, input.name);
  return getCashAccount(accountId);
}

export function updateCashAccount(accountId: string, raw: unknown, actor: Actor): CashAccount {
  const input = updateCashAccountSchema.parse(raw);
  requireRow(one('SELECT id FROM cash_accounts WHERE id = ?', accountId));

  if (input.branch_id) {
    requireRow(one('SELECT id FROM branches WHERE id = ?', input.branch_id));
  }

  run(
    `UPDATE cash_accounts SET
      name = ?, branch_id = ?, account_number = ?, bank_name = ?,
      allow_negative = ?, active = ?, notes = ?
    WHERE id = ?`,
    input.name,
    input.branch_id ?? null,
    input.account_number,
    input.bank_name,
    input.allow_negative,
    input.active,
    input.notes,
    accountId,
  );

  audit(actor, 'تعديل حساب مالي', 'CASH_ACCOUNT', accountId, input.name);
  return getCashAccount(accountId);
}

export function createAccountTransfer(raw: unknown, actor: Actor): AccountTransfer {
  const input = accountTransferSchema.parse(raw);
  return transaction(() => {
    const fromAcc = requireRow(
      one<{ id: string; name: string; active: number }>(
        'SELECT id, name, active FROM cash_accounts WHERE id = ?',
        input.from_account_id,
      ),
    );
    const toAcc = requireRow(
      one<{ id: string; name: string; active: number }>(
        'SELECT id, name, active FROM cash_accounts WHERE id = ?',
        input.to_account_id,
      ),
    );

    if (!fromAcc.active) throw new AppError(409, `حساب المصدر "${fromAcc.name}" مؤرشف`);
    if (!toAcc.active) throw new AppError(409, `حساب الوجهة "${toAcc.name}" مؤرشف`);

    assertAccountFunds(input.from_account_id, input.amount, actor, input.override_overdraft);

    const transferId = id();
    const transferNumber = nextNumber('TR', input.date.slice(0, 4));

    run(
      `INSERT INTO account_transfers(
        id, number, from_account_id, to_account_id, amount, date, notes, created_by, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      transferId,
      transferNumber,
      input.from_account_id,
      input.to_account_id,
      input.amount,
      input.date,
      input.notes,
      actor.id,
      now(),
    );

    audit(
      actor,
      'تحويل مالي بين الحسابات',
      'ACCOUNT_TRANSFER',
      transferId,
      `${transferNumber}: من ${fromAcc.name} إلى ${toAcc.name}`,
    );

    // Ledger: debit the destination GL account, credit the source.
    postAccountTransferLedger(
      {
        id: transferId,
        number: transferNumber,
        amount: input.amount,
        date: input.date,
        fromGlAccountId: glAccountForCashAccount(input.from_account_id),
        toGlAccountId: glAccountForCashAccount(input.to_account_id),
        fromName: fromAcc.name,
        toName: toAcc.name,
      },
      actor,
    );

    return {
      id: transferId,
      number: transferNumber,
      from_account_id: input.from_account_id,
      from_account_name: fromAcc.name,
      to_account_id: input.to_account_id,
      to_account_name: toAcc.name,
      amount: input.amount,
      date: input.date,
      notes: input.notes,
      created_by: actor.name,
      created_at: now(),
    };
  });
}

export function listAccountTransfers(): AccountTransfer[] {
  return all<AccountTransfer>(`
    SELECT
      t.*,
      fa.name AS from_account_name,
      ta.name AS to_account_name,
      u.name AS created_by
    FROM account_transfers t
    JOIN cash_accounts fa ON fa.id = t.from_account_id
    JOIN cash_accounts ta ON ta.id = t.to_account_id
    JOIN users u ON u.id = t.created_by
    ORDER BY t.date DESC, t.created_at DESC
  `);
}

export function getAccountStatement(
  accountId: string,
  from?: string,
  to?: string,
): { account: CashAccount; entries: AccountStatementEntry[] } {
  const account = getCashAccount(accountId);

  interface RawTx {
    id: string;
    date: string;
    created_at: string;
    type: AccountStatementEntry['type'];
    description: string;
    reference: string;
    in_amount: number;
    out_amount: number;
  }

  const txs: RawTx[] = [];

  // Initial balance entry if > 0
  if (account.initial_balance > 0) {
    txs.push({
      id: 'init_' + account.id,
      date: account.created_at.slice(0, 10),
      created_at: account.created_at,
      type: 'INITIAL',
      description: 'الرصيد الافتتاحي للحساب',
      reference: '',
      in_amount: account.initial_balance,
      out_amount: 0,
    });
  }

  // Payments (Customer collections, Supplier payments, Return adjustments)
  const payments = all<{
    id: string;
    amount: number;
    date: string;
    created_at: string;
    reference: string;
    doc_number: string;
    doc_type: string;
    party_name: string;
  }>(
    `SELECT
      p.id, p.amount, p.date, p.created_at, p.reference,
      d.number AS doc_number, d.type AS doc_type, pt.name AS party_name
    FROM payments p
    JOIN documents d ON d.id = p.document_id
    JOIN parties pt ON pt.id = d.party_id
    WHERE p.account_id = ?`,
    accountId,
  );

  for (const p of payments) {
    if (p.doc_type === 'SALE') {
      txs.push({
        id: p.id,
        date: p.date,
        created_at: p.created_at,
        type: 'SALE_PAYMENT',
        description: `تحصيل مبيعات — فاتورة ${p.doc_number} (${p.party_name})`,
        reference: p.reference,
        in_amount: p.amount,
        out_amount: 0,
      });
    } else if (p.doc_type === 'PURCHASE') {
      txs.push({
        id: p.id,
        date: p.date,
        created_at: p.created_at,
        type: 'PURCHASE_PAYMENT',
        description: `سداد مشتريات — فاتورة ${p.doc_number} (${p.party_name})`,
        reference: p.reference,
        in_amount: 0,
        out_amount: p.amount,
      });
    } else if (p.doc_type === 'PURCHASE_RETURN') {
      txs.push({
        id: p.id,
        date: p.date,
        created_at: p.created_at,
        type: 'PURCHASE_RETURN_REFUND',
        description: `استرداد مرتجع مشتريات — إشعار ${p.doc_number} (${p.party_name})`,
        reference: p.reference,
        in_amount: p.amount,
        out_amount: 0,
      });
    } else if (p.doc_type === 'SALE_RETURN') {
      txs.push({
        id: p.id,
        date: p.date,
        created_at: p.created_at,
        type: 'SALE_RETURN_REFUND',
        description: `رد قيمة مرتجع مبيعات — إشعار ${p.doc_number} (${p.party_name})`,
        reference: p.reference,
        in_amount: 0,
        out_amount: p.amount,
      });
    }
  }

  // Expenses
  const expenses = all<{
    id: string;
    title: string;
    amount: number;
    date: string;
    created_at: string;
    notes: string;
  }>(
    'SELECT id, title, amount, date, created_at, notes FROM expenses WHERE account_id = ?',
    accountId,
  );

  for (const ex of expenses) {
    txs.push({
      id: ex.id,
      date: ex.date,
      created_at: ex.created_at,
      type: 'EXPENSE',
      description: `مصروف تشغيلي — ${ex.title}`,
      reference: ex.notes,
      in_amount: 0,
      out_amount: ex.amount,
    });
  }

  // Distribution payments
  const distPayments = all<{
    id: string;
    amount: number;
    date: string;
    created_at: string;
    reference: string;
    owner_name: string;
  }>(
    `SELECT dp.id, dp.amount, dp.date, dp.created_at, dp.reference, dl.owner_name
     FROM distribution_payments dp
     JOIN distribution_lines dl ON dl.id = dp.line_id
     WHERE dp.account_id = ?`,
    accountId,
  );

  for (const dp of distPayments) {
    txs.push({
      id: dp.id,
      date: dp.date,
      created_at: dp.created_at,
      type: 'DISTRIBUTION',
      description: `صرف أرباح للمالك (${dp.owner_name})`,
      reference: dp.reference,
      in_amount: 0,
      out_amount: dp.amount,
    });
  }

  // Equity entries
  const equities = all<{
    id: string;
    kind: string;
    amount: number;
    date: string;
    created_at: string;
    notes: string;
    owner_name: string;
  }>(
    `SELECT e.id, e.kind, e.amount, e.date, e.created_at, e.notes, o.name AS owner_name
     FROM equity_entries e
     JOIN owners o ON o.id = e.owner_id
     WHERE e.account_id = ?`,
    accountId,
  );

  for (const eq of equities) {
    if (eq.kind === 'CONTRIBUTION') {
      txs.push({
        id: eq.id,
        date: eq.date,
        created_at: eq.created_at,
        type: 'CONTRIBUTION',
        description: `إيداع رأس مال — ${eq.owner_name}`,
        reference: eq.notes,
        in_amount: eq.amount,
        out_amount: 0,
      });
    } else {
      txs.push({
        id: eq.id,
        date: eq.date,
        created_at: eq.created_at,
        type: 'WITHDRAWAL',
        description: `مسحوبات المالك — ${eq.owner_name}`,
        reference: eq.notes,
        in_amount: 0,
        out_amount: eq.amount,
      });
    }
  }

  // Transfers in
  const transfersIn = all<{
    id: string;
    number: string;
    amount: number;
    date: string;
    created_at: string;
    notes: string;
    from_name: string;
  }>(
    `SELECT t.id, t.number, t.amount, t.date, t.created_at, t.notes, fa.name AS from_name
     FROM account_transfers t
     JOIN cash_accounts fa ON fa.id = t.from_account_id
     WHERE t.to_account_id = ?`,
    accountId,
  );

  for (const t of transfersIn) {
    txs.push({
      id: t.id,
      date: t.date,
      created_at: t.created_at,
      type: 'TRANSFER_IN',
      description: `تحويل وارد ${t.number} من "${t.from_name}"`,
      reference: t.notes,
      in_amount: t.amount,
      out_amount: 0,
    });
  }

  // Transfers out
  const transfersOut = all<{
    id: string;
    number: string;
    amount: number;
    date: string;
    created_at: string;
    notes: string;
    to_name: string;
  }>(
    `SELECT t.id, t.number, t.amount, t.date, t.created_at, t.notes, ta.name AS to_name
     FROM account_transfers t
     JOIN cash_accounts ta ON ta.id = t.to_account_id
     WHERE t.from_account_id = ?`,
    accountId,
  );

  for (const t of transfersOut) {
    txs.push({
      id: t.id,
      date: t.date,
      created_at: t.created_at,
      type: 'TRANSFER_OUT',
      description: `تحويل صادر ${t.number} إلى "${t.to_name}"`,
      reference: t.notes,
      in_amount: 0,
      out_amount: t.amount,
    });
  }

  // Sort chronologically: opening balance always comes first, then date, then created_at
  txs.sort((a, b) => {
    if (a.type === 'INITIAL') return -1;
    if (b.type === 'INITIAL') return 1;
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.created_at.localeCompare(b.created_at);
  });

  // Calculate running balance
  let running = 0;
  const entries: AccountStatementEntry[] = [];
  for (const tx of txs) {
    running += tx.in_amount - tx.out_amount;
    if (from && tx.date < from) continue;
    if (to && tx.date > to) continue;
    entries.push({
      ...tx,
      balance: running,
    });
  }

  return { account, entries };
}
