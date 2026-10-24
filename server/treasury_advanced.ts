/**
 * Advanced Treasury: Bank Reconciliation, Cost Centers, and Cash Flow Forecasting (Phase 4.2 & 4.3).
 */

import { all, one, run, transaction, id, now } from './db';
import { AppError } from './errors';
import { inScope, type Scope } from './scope';
import { CostCenter } from '../src/types';

function readableBranchSql(
  scope: Scope | undefined,
  column: string,
  allowGroup = false,
): { sql: string; params: string[] } {
  if (!scope || scope.ids === null) return { sql: '1=1', params: [] };
  if (!scope.ids.length)
    return allowGroup ? { sql: `${column} IS NULL`, params: [] } : { sql: '0=1', params: [] };
  const placeholders = scope.ids.map(() => '?').join(',');
  return {
    sql: allowGroup
      ? `(${column} IS NULL OR ${column} IN (${placeholders}))`
      : `${column} IN (${placeholders})`,
    params: scope.ids,
  };
}

function assertBankAccountVisible(accountId: string, scope?: Scope) {
  const account = one<{ id: string; type: string; branch_id: string | null }>(
    'SELECT id, type, branch_id FROM cash_accounts WHERE id=?',
    accountId,
  );
  if (!account) throw new AppError(404, 'الحساب البنكي غير موجود');
  if (account.branch_id !== null && scope && !inScope(scope, account.branch_id)) {
    throw new AppError(404, 'الحساب البنكي غير موجود');
  }
  return account;
}

// --- Cost Centers ---

export function listCostCenters(): CostCenter[] {
  return all<CostCenter>('SELECT * FROM cost_centers ORDER BY code ASC');
}

export function createCostCenter(data: {
  code: string;
  name: string;
  parent_id?: string;
  notes?: string;
}): CostCenter {
  const existing = one<{ id: string }>('SELECT id FROM cost_centers WHERE code=?', data.code);
  if (existing) throw new AppError(400, 'كود مركز التكلفة موجود بالفعل');

  const ccId = id();
  const ts = now();
  run(
    `INSERT INTO cost_centers(id, code, name, parent_id, is_active, notes, created_at)
     VALUES(?,?,?,?, 1, ?, ?)`,
    ccId,
    data.code,
    data.name,
    data.parent_id || null,
    data.notes || null,
    ts,
  );
  return one<CostCenter>('SELECT * FROM cost_centers WHERE id=?', ccId)!;
}

// --- Bank Reconciliation ---

export interface BankStatementLine {
  id: string;
  statement_id: string;
  date: string;
  description: string;
  reference: string | null;
  amount: number;
  matched_payment_id: string | null;
  matched_at: string | null;
}

export interface BankStatement {
  id: string;
  cash_account_id: string;
  cash_account_name?: string;
  statement_date: string;
  opening_balance: number;
  closing_balance: number;
  status: 'DRAFT' | 'RECONCILED';
  notes: string | null;
  created_at: string;
  lines?: BankStatementLine[];
}

export function listBankStatements(scope?: Scope, cashAccountId?: string): BankStatement[] {
  const clauses: string[] = [];
  const params: (string | number | null)[] = [];
  if (cashAccountId) {
    clauses.push('bs.cash_account_id=?');
    params.push(cashAccountId);
  }
  const visible = readableBranchSql(scope, 'ca.branch_id', true);
  clauses.push(visible.sql);
  params.push(...visible.params);
  return all<BankStatement>(
    `SELECT bs.*, ca.name AS cash_account_name
     FROM bank_statements bs
     JOIN cash_accounts ca ON ca.id = bs.cash_account_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY bs.statement_date DESC`,
    ...params,
  );
}

export function getBankStatement(id: string, scope?: Scope): BankStatement | null {
  const visible = readableBranchSql(scope, 'ca.branch_id', true);
  const stmt = one<BankStatement>(
    `SELECT bs.*, ca.name AS cash_account_name
     FROM bank_statements bs
     JOIN cash_accounts ca ON ca.id = bs.cash_account_id
     WHERE bs.id=? AND ${visible.sql}`,
    id,
    ...visible.params,
  );
  if (!stmt) return null;

  const lines = all<BankStatementLine>(
    'SELECT * FROM bank_statement_lines WHERE statement_id=? ORDER BY date ASC',
    id,
  );
  return { ...stmt, lines };
}

export function createBankStatement(
  data: {
    cash_account_id: string;
    statement_date: string;
    opening_balance: number;
    closing_balance: number;
    notes?: string;
    lines: Array<{
      date: string;
      description: string;
      reference?: string;
      amount: number;
    }>;
  },
  scope?: Scope,
): BankStatement {
  assertBankAccountVisible(data.cash_account_id, scope);

  const stmtId = id();
  const ts = now();

  transaction(() => {
    run(
      `INSERT INTO bank_statements(id, cash_account_id, statement_date, opening_balance, closing_balance, status, notes, created_at)
       VALUES(?,?,?,?,?, 'DRAFT', ?,?)`,
      stmtId,
      data.cash_account_id,
      data.statement_date,
      data.opening_balance,
      data.closing_balance,
      data.notes || null,
      ts,
    );

    for (const l of data.lines) {
      run(
        `INSERT INTO bank_statement_lines(id, statement_id, date, description, reference, amount)
         VALUES(?,?,?,?,?,?)`,
        id(),
        stmtId,
        l.date,
        l.description,
        l.reference || null,
        l.amount,
      );
    }
  });

  return getBankStatement(stmtId)!;
}

export function matchStatementLine(lineId: string, paymentId: string, scope?: Scope): void {
  const line = one<BankStatementLine & { branch_id: string | null }>(
    `SELECT bsl.*, ca.branch_id
     FROM bank_statement_lines bsl
     JOIN bank_statements bs ON bs.id = bsl.statement_id
     JOIN cash_accounts ca ON ca.id = bs.cash_account_id
     WHERE bsl.id=?`,
    lineId,
  );
  if (!line) throw new AppError(404, 'سطر كشف الحساب غير موجود');
  if (line.branch_id !== null && scope && !inScope(scope, line.branch_id)) {
    throw new AppError(404, 'سطر كشف الحساب غير موجود');
  }

  const payment = one<{ id: string; branch_id: string }>(
    `SELECT p.id, d.branch_id
     FROM payments p
     JOIN documents d ON d.id = p.document_id
     WHERE p.id=?`,
    paymentId,
  );
  if (!payment) throw new AppError(404, 'حركة السداد غير موجودة');
  if (scope && !inScope(scope, payment.branch_id)) {
    throw new AppError(404, 'حركة السداد غير موجودة');
  }

  run(
    'UPDATE bank_statement_lines SET matched_payment_id=?, matched_at=? WHERE id=?',
    paymentId,
    now(),
    lineId,
  );
}

// --- Cash Flow Forecasting ---

export interface CashFlowForecast {
  currentCashBalance: number;
  forecastDays: number;
  projectedInflows: number;
  projectedOutflows: number;
  projectedNetChange: number;
  projectedEndingBalance: number;
  details: {
    receivableInvoices: Array<{
      id: string;
      number: string;
      party_name: string;
      due_date: string;
      amount_due: number;
    }>;
    receivableCheques: Array<{
      id: string;
      number: string;
      party_name: string;
      due_date: string;
      amount: number;
    }>;
    payableBills: Array<{
      id: string;
      number: string;
      party_name: string;
      due_date: string;
      amount_due: number;
    }>;
    payableCheques: Array<{
      id: string;
      number: string;
      party_name: string;
      due_date: string;
      amount: number;
    }>;
    purchaseOrders: Array<{
      id: string;
      number: string;
      party_name: string;
      expected_delivery_date: string;
      total: number;
    }>;
  };
}

export function forecastCashFlow(days: number = 30, scope?: Scope): CashFlowForecast {
  const accountBranch = readableBranchSql(scope, 'branch_id', true);
  // 1. Current liquid balance from active cash and bank accounts
  const accounts = all<{ id: string; initial_balance: number }>(
    `SELECT id, initial_balance FROM cash_accounts WHERE active=1 AND ${accountBranch.sql}`,
    ...accountBranch.params,
  );

  let currentCashBalance = 0;
  for (const acc of accounts) {
    const paysIn =
      one<{ total: number }>(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE account_id=? AND document_id IN (SELECT id FROM documents WHERE type IN ('SALE','PURCHASE_RETURN'))`,
        acc.id,
      )?.total || 0;
    const paysOut =
      one<{ total: number }>(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE account_id=? AND document_id IN (SELECT id FROM documents WHERE type IN ('PURCHASE','SALE_RETURN'))`,
        acc.id,
      )?.total || 0;
    const expOut =
      one<{ total: number }>(
        'SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE account_id=?',
        acc.id,
      )?.total || 0;

    currentCashBalance += acc.initial_balance + paysIn - paysOut - expOut;
  }

  const future = new Date();
  future.setDate(future.getDate() + days);
  const endDate = future.toISOString().slice(0, 10);

  // 2. Inflows:
  // Unpaid Sales invoices due between startDate and endDate
  const invoiceBranch = readableBranchSql(scope, 'd.branch_id');
  const receivableInvoices = all<{
    id: string;
    number: string;
    party_name: string;
    due_date: string;
    amount_due: number;
  }>(
    `SELECT d.id, d.number, p.name AS party_name, d.due_date, (d.total - d.paid) AS amount_due
     FROM documents d
     JOIN parties p ON p.id = d.party_id
     WHERE d.type='SALE' AND d.status='POSTED' AND d.paid < d.total
       AND ${invoiceBranch.sql}
       AND d.due_date <= ?
     ORDER BY d.due_date ASC`,
    ...invoiceBranch.params,
    endDate,
  );

  // Receivable cheques in portfolio due within forecast window
  const chequeBranch = readableBranchSql(scope, 'c.branch_id');
  const receivableCheques = all<{
    id: string;
    number: string;
    party_name: string;
    due_date: string;
    amount: number;
  }>(
    `SELECT c.id, c.number, p.name AS party_name, c.due_date, c.amount
     FROM cheques c
     JOIN parties p ON p.id = c.party_id
     WHERE c.type='RECEIVABLE' AND c.status IN ('PORTFOLIO','DEPOSITED')
       AND ${chequeBranch.sql}
       AND c.due_date <= ?
     ORDER BY c.due_date ASC`,
    ...chequeBranch.params,
    endDate,
  );

  // 3. Outflows:
  // Unpaid Purchase bills due within forecast window
  const payableBills = all<{
    id: string;
    number: string;
    party_name: string;
    due_date: string;
    amount_due: number;
  }>(
    `SELECT d.id, d.number, p.name AS party_name, d.due_date, (d.total - d.paid) AS amount_due
     FROM documents d
     JOIN parties p ON p.id = d.party_id
     WHERE d.type='PURCHASE' AND d.status='POSTED' AND d.paid < d.total
       AND ${invoiceBranch.sql}
       AND d.due_date <= ?
     ORDER BY d.due_date ASC`,
    ...invoiceBranch.params,
    endDate,
  );

  // Payable cheques due within forecast window
  const payableCheques = all<{
    id: string;
    number: string;
    party_name: string;
    due_date: string;
    amount: number;
  }>(
    `SELECT c.id, c.number, p.name AS party_name, c.due_date, c.amount
     FROM cheques c
     JOIN parties p ON p.id = c.party_id
     WHERE c.type='PAYABLE' AND c.status='PORTFOLIO'
       AND ${chequeBranch.sql}
       AND c.due_date <= ?
     ORDER BY c.due_date ASC`,
    ...chequeBranch.params,
    endDate,
  );

  // Confirmed Purchase Orders expected for delivery/payment
  const poBranch = readableBranchSql(scope, 'po.branch_id');
  const purchaseOrders = all<{
    id: string;
    number: string;
    party_name: string;
    expected_delivery_date: string;
    total: number;
  }>(
    `SELECT po.id, po.number, p.name AS party_name, COALESCE(po.expected_delivery_date, po.date) AS expected_delivery_date, po.total
     FROM purchase_orders po
     JOIN parties p ON p.id = po.party_id
     WHERE po.status IN ('CONFIRMED','PARTIALLY_RECEIVED')
       AND ${poBranch.sql}
       AND COALESCE(po.expected_delivery_date, po.date) <= ?
     ORDER BY po.date ASC`,
    ...poBranch.params,
    endDate,
  );

  const totalInflows =
    receivableInvoices.reduce((s, r) => s + r.amount_due, 0) +
    receivableCheques.reduce((s, c) => s + c.amount, 0);

  const totalOutflows =
    payableBills.reduce((s, p) => s + p.amount_due, 0) +
    payableCheques.reduce((s, c) => s + c.amount, 0) +
    purchaseOrders.reduce((s, po) => s + po.total, 0);

  const netChange = totalInflows - totalOutflows;

  return {
    currentCashBalance,
    forecastDays: days,
    projectedInflows: totalInflows,
    projectedOutflows: totalOutflows,
    projectedNetChange: netChange,
    projectedEndingBalance: currentCashBalance + netChange,
    details: {
      receivableInvoices,
      receivableCheques,
      payableBills,
      payableCheques,
      purchaseOrders,
    },
  };
}
