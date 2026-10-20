/**
 * General Ledger (دفتر الأستاذ) — double-entry books of record.
 *
 * Design notes:
 *  - Balances are never stored. Everything is derived from `journal_lines`, so the books
 *    cannot drift from the source of truth.
 *  - An entry is written as DRAFT, its lines are appended, then it is flipped to POSTED.
 *    A trigger refuses to post an entry that does not have at least two lines whose debit
 *    and credit totals are equal, and posted lines are immutable.
 *  - Corrections are made by posting a reversing entry (`reverseEntry`), never by editing
 *    history.
 *  - The system accounts carry a `system_key`; the posting integration looks accounts up by
 *    that key so renaming or renumbering in the UI never breaks automatic posting.
 *
 * Every amount in the ledger is a minor-unit integer (piasters), matching the rest of the app.
 */

import { all, one, run, transaction, id, now } from './db';
import { AppError } from './errors';
import { audit, nextNumber, requireRow, type Actor } from './service';
import { writableBranch, type Scope, scopeSql } from './scope';
import { chartAccountSchema, journalEntrySchema, glSettingsSchema } from './validation';
import type {
  ChartAccount,
  GlAccountType,
  JournalEntry,
  JournalLine,
  TrialBalanceRow,
  LedgerAccountStatement,
} from '../src/types';

interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: GlAccountType;
  normal_side: 'DEBIT' | 'CREDIT';
  parent_id: string | null;
  system_key: string | null;
  active: number;
  notes: string;
}

/** Looks an account up by its stable system key; throws if the chart has been tampered with. */
export function systemAccount(key: string): AccountRow {
  const account = one<AccountRow>('SELECT * FROM chart_of_accounts WHERE system_key=?', key);
  if (!account) throw new AppError(500, `حساب النظام «${key}» غير موجود في دليل الحسابات`);
  if (!account.active) throw new AppError(409, `حساب النظام «${account.name}» غير مُفعّل`);
  return account;
}

function accountById(accountId: string): AccountRow {
  return requireRow(one<AccountRow>('SELECT * FROM chart_of_accounts WHERE id=?', accountId));
}

export interface LedgerLineInput {
  /** Either a concrete `accountId` or a `systemKey` must be supplied. */
  accountId?: string;
  systemKey?: string;
  debit?: number;
  credit?: number;
  branchId?: string | null;
  memo?: string;
}

export interface PostEntryInput {
  date: string;
  memo?: string;
  sourceType: JournalEntry['source_type'];
  sourceId?: string | null;
  branchId?: string | null;
  lines: LedgerLineInput[];
}

/** The date a period is locked through, if any (`YYYY-MM-DD`). */
export function closedThrough(): string | null {
  return (
    one<{ closed_through: string | null }>('SELECT closed_through FROM gl_settings WHERE id=1')
      ?.closed_through ?? null
  );
}

function assertPeriodOpen(date: string) {
  const closed = closedThrough();
  if (closed && date <= closed)
    throw new AppError(409, `الفترة المحاسبية مُقفلة حتى ${closed}؛ لا يمكن الترحيل فيها`);
}

function resolveLine(line: LedgerLineInput): { accountId: string; debit: number; credit: number } {
  const account = line.systemKey
    ? systemAccount(line.systemKey)
    : accountById(line.accountId || '');
  const debit = line.debit ?? 0;
  const credit = line.credit ?? 0;
  if (debit < 0 || credit < 0) throw new AppError(400, 'لا يمكن ترحيل مبالغ سالبة');
  if (debit > 0 === credit > 0)
    throw new AppError(400, 'كل بند قيد يجب أن يكون مديناً أو دائناً، وليس كليهما أو لا شيء');
  return { accountId: account.id, debit, credit };
}

/**
 * Writes a balanced journal entry and posts it. Must be called inside a transaction when it
 * is part of a larger operation (invoicing, payment, expense) — it is savepoint-aware.
 */
export function postEntry(input: PostEntryInput, actor: Actor): JournalEntry {
  assertPeriodOpen(input.date);
  const lines = input.lines.map(resolveLine);
  if (lines.length < 2) throw new AppError(400, 'القيد المحاسبي يجب أن يحتوي بندين على الأقل');
  const debit = lines.reduce((s, l) => s + l.debit, 0);
  const credit = lines.reduce((s, l) => s + l.credit, 0);
  if (debit !== credit)
    throw new AppError(
      400,
      `القيد غير متوازن: إجمالي المدين ${debit} لا يساوي إجمالي الدائن ${credit}`,
    );
  if (debit === 0) throw new AppError(400, 'لا يمكن ترحيل قيد بمبلغ صفر');

  return transaction(() => {
    const entryId = id();
    const year = input.date.slice(0, 4);
    const number = nextNumber('JV', year);
    run(
      `INSERT INTO journal_entries(id,number,date,memo,source_type,source_id,branch_id,status,created_by,created_at)
       VALUES(?,?,?,?,?,?,?,'DRAFT',?,?)`,
      entryId,
      number,
      input.date,
      input.memo || '',
      input.sourceType,
      input.sourceId ?? null,
      input.branchId ?? null,
      actor.id,
      now(),
    );
    for (const line of lines) {
      run(
        `INSERT INTO journal_lines(id,entry_id,account_id,debit,credit,branch_id,memo)
         VALUES(?,?,?,?,?,?,?)`,
        id(),
        entryId,
        line.accountId,
        line.debit,
        line.credit,
        input.branchId ?? null,
        input.memo || '',
      );
    }
    // The trigger validates the two-line + balanced invariants at this transition.
    run("UPDATE journal_entries SET status='POSTED' WHERE id=?", entryId);
    return requireRow(one<JournalEntry>('SELECT * FROM journal_entries WHERE id=?', entryId));
  });
}

/**
 * Reverses a posted entry by writing its mirror image, linked back to the original. Used when
 * a source document is cancelled after it had already been posted to the ledger.
 */
export function reverseEntry(entryId: string, actor: Actor, memo?: string): JournalEntry | null {
  const entry = one<JournalEntry>('SELECT * FROM journal_entries WHERE id=?', entryId);
  if (!entry) return null;
  if (entry.status === 'REVERSED') return null;
  const lines = all<JournalLine>('SELECT * FROM journal_lines WHERE entry_id=?', entryId);

  return transaction(() => {
    const newId = id();
    const number = nextNumber('JV', entry.date.slice(0, 4));
    run(
      `INSERT INTO journal_entries(id,number,date,memo,source_type,source_id,branch_id,status,reversal_of,created_by,created_at)
       VALUES(?,?,?,?,'REVERSAL',?,?, 'DRAFT', ?,?,?)`,
      newId,
      number,
      entry.date,
      memo || `عكس القيد ${entry.number}`,
      entry.source_id,
      entry.branch_id,
      entryId,
      actor.id,
      now(),
    );
    for (const line of lines) {
      run(
        `INSERT INTO journal_lines(id,entry_id,account_id,debit,credit,branch_id,memo)
         VALUES(?,?,?,?,?,?,?)`,
        id(),
        newId,
        line.account_id,
        line.credit,
        line.debit,
        line.branch_id,
        memo || `عكس ${line.memo}`,
      );
    }
    run("UPDATE journal_entries SET status='POSTED' WHERE id=?", newId);
    run("UPDATE journal_entries SET status='REVERSED' WHERE id=?", entryId);
    audit(actor, 'عكس قيد محاسبي', 'JOURNAL_ENTRY', newId, `${entry.number} → ${number}`);
    return requireRow(one<JournalEntry>('SELECT * FROM journal_entries WHERE id=?', newId));
  });
}

/**
 * Reverses every posted entry tied to a source record. Idempotent: entries already reversed
 * are skipped, so calling it twice after a cancel is safe.
 */
export function reverseBySource(
  sourceType: JournalEntry['source_type'],
  sourceId: string,
  actor: Actor,
  memo?: string,
): number {
  const entries = all<JournalEntry>(
    "SELECT * FROM journal_entries WHERE source_type=? AND source_id=? AND status='POSTED'",
    sourceType,
    sourceId,
  );
  let count = 0;
  for (const entry of entries) {
    if (entry.source_type === 'REVERSAL') continue;
    if (reverseEntry(entry.id, actor, memo)) count++;
  }
  return count;
}

/** Finds a single posted entry by source, used to guard against double posting. */
export function entryBySource(
  sourceType: JournalEntry['source_type'],
  sourceId: string,
): JournalEntry | undefined {
  return one<JournalEntry>(
    "SELECT * FROM journal_entries WHERE source_type=? AND source_id=? AND status='POSTED' ORDER BY created_at LIMIT 1",
    sourceType,
    sourceId,
  );
}

// ── Chart of accounts ────────────────────────────────────────────────────────────────────

export function listAccounts(): ChartAccount[] {
  return all<ChartAccount>(
    `SELECT a.*,
       (SELECT COUNT(*) FROM journal_lines l WHERE l.account_id=a.id) lines_count
     FROM chart_of_accounts a ORDER BY a.code`,
  );
}

export function createAccount(raw: unknown, actor: Actor): ChartAccount {
  const input = chartAccountSchema.parse(raw);
  return transaction(() => {
    const accountId = id();
    const normalSide = input.normal_side;
    run(
      `INSERT INTO chart_of_accounts(id,code,name,type,normal_side,parent_id,is_system,active,notes,created_at)
       VALUES(?,?,?,?,?,?,0,?,?,?)`,
      accountId,
      input.code,
      input.name,
      input.type,
      normalSide,
      input.parent_id ?? null,
      input.active ? 1 : 0,
      input.notes,
      now(),
    );
    audit(actor, 'إنشاء حساب محاسبي', 'CHART_ACCOUNT', accountId, `${input.code} · ${input.name}`);
    return requireRow(one<ChartAccount>('SELECT * FROM chart_of_accounts WHERE id=?', accountId));
  });
}

export function updateAccount(accountId: string, raw: unknown, actor: Actor): ChartAccount {
  const input = chartAccountSchema.partial().parse(raw);
  const existing = accountById(accountId);
  return transaction(() => {
    run(
      `UPDATE chart_of_accounts SET code=?, name=?, type=?, normal_side=?, parent_id=?, active=?, notes=? WHERE id=?`,
      input.code ?? existing.code,
      input.name ?? existing.name,
      input.type ?? existing.type,
      input.normal_side ?? existing.normal_side,
      input.parent_id === undefined ? existing.parent_id : input.parent_id,
      (input.active ?? existing.active === 1) ? 1 : 0,
      input.notes ?? existing.notes,
      accountId,
    );
    audit(actor, 'تعديل حساب محاسبي', 'CHART_ACCOUNT', accountId, input.name ?? existing.name);
    return requireRow(one<ChartAccount>('SELECT * FROM chart_of_accounts WHERE id=?', accountId));
  });
}

/** Deletes an account that has never been used. System accounts cannot be removed. */
export function deleteAccount(accountId: string, actor: Actor) {
  const account = accountById(accountId);
  if (account.system_key) throw new AppError(409, 'لا يمكن حذف حساب نظامي');
  const used = one<{ n: number }>(
    'SELECT COUNT(*) n FROM journal_lines WHERE account_id=?',
    accountId,
  );
  if ((used?.n ?? 0) > 0)
    throw new AppError(409, 'لا يمكن حذف حساب له حركات؛ يمكن أرشفته بدلاً من ذلك');
  transaction(() => {
    run('DELETE FROM chart_of_accounts WHERE id=?', accountId);
    audit(
      actor,
      'حذف حساب محاسبي',
      'CHART_ACCOUNT',
      accountId,
      `${account.code} · ${account.name}`,
    );
  });
  return { ok: true };
}

// ── Reading the books ────────────────────────────────────────────────────────────────────

export interface JournalFilter {
  from?: string;
  to?: string;
  branchId?: string;
  accountId?: string;
  sourceType?: string;
}

export function listJournalEntries(scope: Scope, filter: JournalFilter = {}): JournalEntry[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter.branchId) {
    clauses.push('e.branch_id=?');
    params.push(filter.branchId);
  } else {
    const f = scopeSql('e.branch_id', scope);
    clauses.push(f.sql);
    params.push(...f.params);
  }
  if (filter.from) {
    clauses.push('e.date>=?');
    params.push(filter.from);
  }
  if (filter.to) {
    clauses.push('e.date<=?');
    params.push(filter.to);
  }
  if (filter.sourceType) {
    clauses.push('e.source_type=?');
    params.push(filter.sourceType);
  }
  if (filter.accountId) {
    clauses.push('EXISTS (SELECT 1 FROM journal_lines l WHERE l.entry_id=e.id AND l.account_id=?)');
    params.push(filter.accountId);
  }
  const where = clauses.length ? clauses.join(' AND ') : '1=1';
  return all<JournalEntry>(
    `SELECT e.*, b.name branch_name, u.name created_by_name,
       (SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE entry_id=e.id) total
     FROM journal_entries e
     LEFT JOIN branches b ON b.id=e.branch_id
     JOIN users u ON u.id=e.created_by
     WHERE ${where}
     ORDER BY e.date DESC, e.number DESC LIMIT 500`,
    ...params,
  );
}

export function journalDetail(entryId: string): { entry: JournalEntry; lines: JournalLine[] } {
  const entry = requireRow(
    one<JournalEntry>(
      `SELECT e.*, b.name branch_name, u.name created_by_name FROM journal_entries e
       LEFT JOIN branches b ON b.id=e.branch_id JOIN users u ON u.id=e.created_by WHERE e.id=?`,
      entryId,
    ),
  );
  const lines = all<JournalLine>(
    `SELECT l.*, a.code account_code, a.name account_name, a.type account_type
     FROM journal_lines l JOIN chart_of_accounts a ON a.id=l.account_id
     WHERE l.entry_id=? ORDER BY l.debit DESC, a.code`,
    entryId,
  );
  return { entry, lines };
}

/** Manual journal entry from the UI. */
export function createJournalEntry(raw: unknown, actor: Actor): JournalEntry {
  const input = journalEntrySchema.parse(raw);
  if (input.branch_id) writableBranch(actor, input.branch_id);
  const entry = postEntry(
    {
      date: input.date,
      memo: input.memo,
      sourceType: 'MANUAL',
      branchId: input.branch_id ?? null,
      lines: input.lines.map((l) => ({
        accountId: l.account_id,
        debit: l.debit,
        credit: l.credit,
        memo: l.memo,
      })),
    },
    actor,
  );
  audit(actor, 'ترحيل قيد يدوي', 'JOURNAL_ENTRY', entry.id, entry.number);
  return entry;
}

/**
 * Trial balance: for each account, the total debit and credit posted in the window and the
 * resulting balance on its normal side. The debit/credit columns always reconcile.
 */
export function trialBalance(scope: Scope, from?: string, to?: string): TrialBalanceRow[] {
  const f = scopeSql('l.branch_id', scope);
  const clauses = [f.sql];
  const params: (string | number)[] = [...f.params];
  if (from) {
    clauses.push('e.date>=?');
    params.push(from);
  }
  if (to) {
    clauses.push('e.date<=?');
    params.push(to);
  }
  return all<TrialBalanceRow>(
    `SELECT a.id account_id, a.code, a.name, a.type, a.normal_side,
       COALESCE(SUM(l.debit),0) debit,
       COALESCE(SUM(l.credit),0) credit,
       CASE WHEN a.normal_side='DEBIT' THEN COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0)
            ELSE COALESCE(SUM(l.credit),0)-COALESCE(SUM(l.debit),0) END balance,
       (SELECT COALESCE(SUM(l2.debit),0)-COALESCE(SUM(l2.credit),0)
          FROM journal_lines l2 JOIN journal_entries e2 ON e2.id=l2.entry_id
          WHERE l2.account_id=a.id AND e2.status IN ('POSTED','REVERSED')
            ${from ? 'AND e2.date < ?' : ''}) opening
     FROM chart_of_accounts a
     LEFT JOIN journal_lines l ON l.account_id=a.id
       AND EXISTS (SELECT 1 FROM journal_entries e WHERE e.id=l.entry_id AND ${clauses.join(' AND ')})
     GROUP BY a.id HAVING SUM(l.id IS NOT NULL) > 0 OR a.is_system=1
     ORDER BY a.code`,
    ...(from ? [from, ...params] : params),
  );
}

/** Per-account ledger statement: every line that touched the account in the window. */
export function accountStatement(
  accountId: string,
  scope: Scope,
  from?: string,
  to?: string,
): LedgerAccountStatement {
  const account = accountById(accountId);
  const f = scopeSql('l.branch_id', scope);
  const clauses = [`l.account_id=?`, f.sql];
  const params: (string | number)[] = [accountId, ...f.params];
  if (from) {
    clauses.push('e.date>=?');
    params.push(from);
  }
  if (to) {
    clauses.push('e.date<=?');
    params.push(to);
  }
  // Opening balance only has meaning when a start date is given; otherwise the window starts
  // at the beginning of the books and there is nothing before it.
  const opening = from
    ? (one<{ v: number }>(
        `SELECT COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0) v
         FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
         WHERE l.account_id=? AND e.status IN ('POSTED','REVERSED') AND ${f.sql} AND e.date < ?`,
        accountId,
        ...f.params,
        from,
      )?.v ?? 0)
    : 0;
  const lines = all<JournalLine>(
    `SELECT l.*, a.code account_code, a.name account_name, a.type account_type,
       e.number entry_number, e.date, e.memo, e.source_type, e.source_id
     FROM journal_lines l
     JOIN journal_entries e ON e.id=l.entry_id
     JOIN chart_of_accounts a ON a.id=l.account_id
     WHERE ${clauses.join(' AND ')} AND e.status IN ('POSTED','REVERSED')
     ORDER BY e.date, e.number, l.rowid`,
    ...params,
  );
  // Running balance is expressed on the account's normal side: a liability grows as it is
  // credited, an asset as it is debited.
  const signedOpening = account.normal_side === 'DEBIT' ? opening : -opening;
  let running = signedOpening;
  const entries = lines.map((l) => {
    running += account.normal_side === 'DEBIT' ? l.debit - l.credit : l.credit - l.debit;
    return { ...l, running_balance: running };
  });
  return { account: account as unknown as ChartAccount, opening: signedOpening, lines: entries };
}

// ── Period lock ──────────────────────────────────────────────────────────────────────────

export function getGlSettings() {
  return requireRow(
    one<{
      fiscal_year_start_month: number;
      closed_through: string | null;
      updated_at: string | null;
    }>('SELECT fiscal_year_start_month, closed_through, updated_at FROM gl_settings WHERE id=1'),
  );
}

export function updateGlSettings(raw: unknown, actor: Actor) {
  const input = glSettingsSchema.parse(raw);
  transaction(() => {
    run(
      'UPDATE gl_settings SET fiscal_year_start_month=?, closed_through=?, updated_at=? WHERE id=1',
      input.fiscal_year_start_month,
      input.closed_through ?? null,
      now(),
    );
    audit(
      actor,
      'تعديل إعدادات دفتر الأستاذ',
      'GL_SETTINGS',
      '1',
      input.closed_through ? `إقفال حتى ${input.closed_through}` : 'فتح الفترات',
    );
  });
  return getGlSettings();
}
