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
import { audit, nextNumber, requireRow, moveStock, type Actor } from './service';
import { writableBranch, type Scope, scopeSql } from './scope';
import {
  chartAccountSchema,
  journalEntrySchema,
  glSettingsSchema,
  openingBalancesSchema,
} from './validation';
import type {
  ChartAccount,
  GlAccountType,
  JournalEntry,
  JournalLine,
  TrialBalanceRow,
  LedgerAccountStatement,
  ProfitAndLossReport,
  BalanceSheetReport,
  FinancialReportRow,
  FinancialReportSection,
  OpeningBalancesStatus,
  VatReturnReport,
  TaxRegisterRow,
  TaxRegisterResponse,
} from '../src/types';

interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: GlAccountType;
  normal_side: 'DEBIT' | 'CREDIT';
  parent_id: string | null;
  is_system: number;
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
       p.code as parent_code,
       p.name as parent_name,
       (SELECT COUNT(*) FROM journal_lines l WHERE l.account_id=a.id) lines_count,
       (SELECT COUNT(*) FROM chart_of_accounts c WHERE c.parent_id=a.id) children_count,
       COALESCE((
         SELECT CASE WHEN a.normal_side = 'DEBIT' THEN SUM(l.debit) - SUM(l.credit)
                     ELSE SUM(l.credit) - SUM(l.debit) END
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         WHERE l.account_id = a.id AND e.status IN ('POSTED', 'REVERSED')
       ), 0) balance
     FROM chart_of_accounts a
     LEFT JOIN chart_of_accounts p ON p.id = a.parent_id
     ORDER BY a.code`,
  );
}

export function suggestNextCode(parentId: string): {
  code: string;
  parent: {
    id: string;
    code: string;
    name: string;
    type: GlAccountType;
    normal_side: 'DEBIT' | 'CREDIT';
  };
} {
  const parent = accountById(parentId);
  const children = all<{ code: string }>(
    'SELECT code FROM chart_of_accounts WHERE parent_id = ? ORDER BY code',
    parentId,
  );

  let candidateCode = '';
  if (children.length > 0) {
    let maxSuffixNum = 0;
    let suffixLen = 2;
    for (const child of children) {
      if (child.code.startsWith(parent.code)) {
        const suffix = child.code.slice(parent.code.length);
        if (/^\d+$/.test(suffix)) {
          const num = parseInt(suffix, 10);
          if (num > maxSuffixNum) {
            maxSuffixNum = num;
            suffixLen = Math.max(suffixLen, suffix.length);
          }
        }
      }
    }
    const nextNum = maxSuffixNum + 1;
    candidateCode = `${parent.code}${String(nextNum).padStart(suffixLen, '0')}`;
  } else {
    // Default child suffix depending on parent code length
    if (parent.code.length <= 2) {
      candidateCode = `${parent.code}1`;
    } else {
      candidateCode = `${parent.code}01`;
    }
  }

  // Ensure candidate is unique in DB
  let finalCode = candidateCode;
  let counter = 1;
  while (one('SELECT 1 FROM chart_of_accounts WHERE code = ?', finalCode)) {
    counter++;
    const sLen = Math.max(2, candidateCode.length - parent.code.length);
    finalCode = `${parent.code}${String(counter).padStart(sLen, '0')}`;
  }

  return {
    code: finalCode,
    parent: {
      id: parent.id,
      code: parent.code,
      name: parent.name,
      type: parent.type,
      normal_side: parent.normal_side,
    },
  };
}

export function createAccount(raw: unknown, actor: Actor): ChartAccount {
  const input = chartAccountSchema.parse(raw);
  if (input.parent_id) {
    const parent = one<AccountRow>('SELECT * FROM chart_of_accounts WHERE id=?', input.parent_id);
    if (!parent) throw new AppError(404, 'الحساب الأب المحدد غير موجود');
    if (parent.type !== input.type) {
      throw new AppError(400, 'يجب أن يكون نوع الحساب الفرعي مطابقاً لنوع الحساب الأب');
    }
  }

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

  if (input.parent_id && input.parent_id === accountId) {
    throw new AppError(400, 'لا يمكن للحساب أن يكون أباً لنفسه');
  }

  const used = one<{ n: number }>(
    'SELECT COUNT(*) n FROM journal_lines WHERE account_id=?',
    accountId,
  );
  const hasMovements = (used?.n ?? 0) > 0;

  if (hasMovements) {
    if (input.type && input.type !== existing.type) {
      throw new AppError(409, 'لا يمكن تعديل نوع الحساب لوجود قيود مرحّلة عليه');
    }
    if (input.normal_side && input.normal_side !== existing.normal_side) {
      throw new AppError(409, 'لا يمكن تعديل طبيعة الرصيد (مدين/دائن) لحساب تم تسجيل قيود عليه');
    }
  }

  if (existing.system_key && input.active === false) {
    throw new AppError(409, 'لا يمكن تعطيل حساب نظامي أساسي في شجرة الحسابات');
  }

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
  if (account.system_key || account.is_system === 1) {
    throw new AppError(409, 'لا يمكن حذف حساب نظامي');
  }
  const used = one<{ n: number }>(
    'SELECT COUNT(*) n FROM journal_lines WHERE account_id=?',
    accountId,
  );
  if ((used?.n ?? 0) > 0) {
    throw new AppError(409, 'لا يمكن حذف حساب له حركات في دفتر الأستاذ؛ يمكنك أرشفته بدلاً من ذلك');
  }
  const children = one<{ n: number }>(
    'SELECT COUNT(*) n FROM chart_of_accounts WHERE parent_id=?',
    accountId,
  );
  if ((children?.n ?? 0) > 0) {
    throw new AppError(
      409,
      'لا يمكن حذف حساب رئيسي يحتوي على حسابات فرعية؛ يرجى حذف أو نقل الحسابات الفرعية أولاً',
    );
  }

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

// ── Opening Balances Wizard (معالج الأرصدة الافتتاحية) ───────────────────────────────────

export function getOpeningBalancesStatus(): OpeningBalancesStatus {
  const openingEntry = one<JournalEntry>(
    `SELECT * FROM journal_entries WHERE source_type = 'OPENING' AND status = 'POSTED' ORDER BY date DESC LIMIT 1`,
  );

  let openingLines: JournalLine[] = [];
  if (openingEntry) {
    openingLines = all<JournalLine>(
      `SELECT l.*, a.code as account_code, a.name as account_name, a.type as account_type
       FROM journal_lines l
       JOIN chart_of_accounts a ON a.id = l.account_id
       WHERE l.entry_id = ?
       ORDER BY l.debit DESC, a.code`,
      openingEntry.id,
    );
  }

  const earliestOther = one<{ min_date: string | null }>(
    `SELECT MIN(date) as min_date FROM journal_entries 
     WHERE status IN ('POSTED', 'REVERSED')
       AND source_type <> 'OPENING'
       AND id NOT IN (SELECT id FROM journal_entries WHERE reversal_of IN (SELECT id FROM journal_entries WHERE source_type = 'OPENING'))`,
  );

  return {
    has_opening_entry: !!openingEntry,
    opening_entry: openingEntry ?? undefined,
    opening_lines: openingLines,
    can_post: !openingEntry,
    earliest_transaction_date: earliestOther?.min_date ?? null,
  };
}

export function postOpeningBalances(raw: unknown, actor: Actor): JournalEntry {
  const input = openingBalancesSchema.parse(raw);
  assertPeriodOpen(input.date);

  // 1. Guard against later movements in the books (excluding any prior reversed opening entries)
  const laterEntry = one<{ id: string; date: string; number: string }>(
    `SELECT id, date, number FROM journal_entries 
     WHERE status IN ('POSTED', 'REVERSED') 
       AND date > ?
       AND source_type <> 'OPENING'
       AND id NOT IN (SELECT id FROM journal_entries WHERE reversal_of IN (SELECT id FROM journal_entries WHERE source_type = 'OPENING'))
     LIMIT 1`,
    input.date,
  );
  if (laterEntry) {
    throw new AppError(
      409,
      `لا يمكن ترحيل أرصدة افتتاحية بتاريخ ${input.date}؛ يوجد قيد محاسبي لاحق برقم ${laterEntry.number} وتاريخ ${laterEntry.date}`,
    );
  }

  // 2. Guard against existing active opening entry
  const existingOpening = one<{ id: string; number: string }>(
    `SELECT id, number FROM journal_entries WHERE source_type = 'OPENING' AND status = 'POSTED' LIMIT 1`,
  );
  if (existingOpening) {
    throw new AppError(
      409,
      `تم ترحيل قيد أرصدة افتتاحية مسبقاً برقم ${existingOpening.number}. لتعديل الأرصدة، يرجى إلغاء/عكس القيد الافتتاحي أولاً`,
    );
  }

  return transaction(() => {
    const lines: LedgerLineInput[] = [];

    // Cash & Bank
    if (input.cash_accounts?.length) {
      for (const ca of input.cash_accounts) {
        if (ca.amount > 0) {
          const cashAcc = requireRow(
            one<{ id: string; name: string; type: string; gl_account_id: string | null }>(
              'SELECT id, name, type, gl_account_id FROM cash_accounts WHERE id=?',
              ca.cash_account_id,
            ),
          );
          const targetGlId =
            cashAcc.gl_account_id || (cashAcc.type === 'CASH' ? 'acc_cash' : 'acc_bank');
          lines.push({
            accountId: targetGlId,
            debit: ca.amount,
            memo: `رصيد افتتاحي: ${cashAcc.name}`,
          });
          run(
            'UPDATE cash_accounts SET initial_balance=? WHERE id=?',
            ca.amount,
            ca.cash_account_id,
          );
        }
      }
    }

    // Customers (AR)
    if (input.customers?.length) {
      for (const cust of input.customers) {
        if (cust.amount > 0) {
          const party = requireRow(
            one<{ id: string; name: string }>(
              'SELECT id, name FROM parties WHERE id=?',
              cust.party_id,
            ),
          );
          lines.push({
            systemKey: 'AR',
            debit: cust.amount,
            memo: `رصيد افتتاحي للعميل: ${party.name}`,
          });
        }
      }
    }

    // Suppliers (AP)
    if (input.suppliers?.length) {
      for (const supp of input.suppliers) {
        if (supp.amount > 0) {
          const party = requireRow(
            one<{ id: string; name: string }>(
              'SELECT id, name FROM parties WHERE id=?',
              supp.party_id,
            ),
          );
          lines.push({
            systemKey: 'AP',
            credit: supp.amount,
            memo: `رصيد افتتاحي للمورد: ${party.name}`,
          });
        }
      }
    }

    // Inventory items
    if (input.inventory_items?.length) {
      for (const item of input.inventory_items) {
        if (item.quantity > 0) {
          const product = requireRow(
            one<{ id: string; name: string; unit: string }>(
              'SELECT id, name, unit FROM products WHERE id=?',
              item.product_id,
            ),
          );
          const totalCost = item.quantity * item.unit_cost;
          if (totalCost > 0) {
            lines.push({
              systemKey: 'INVENTORY',
              branchId: item.branch_id,
              debit: totalCost,
              memo: `رصيد مخزون افتتاحي: ${product.name} (${item.quantity} ${product.unit})`,
            });
          }
          moveStock({
            branchId: item.branch_id,
            productId: item.product_id,
            delta: item.quantity,
            unitCost: item.unit_cost,
            reason: 'رصيد مخزون افتتاحي',
            actor,
          });
        }
      }
    }

    // Other accounts
    if (input.other_accounts?.length) {
      for (const oa of input.other_accounts) {
        if (oa.debit > 0) {
          lines.push({
            accountId: oa.account_id,
            debit: oa.debit,
            memo: oa.memo || 'رصيد افتتاحي',
          });
        }
        if (oa.credit > 0) {
          lines.push({
            accountId: oa.account_id,
            credit: oa.credit,
            memo: oa.memo || 'رصيد افتتاحي',
          });
        }
      }
    }

    // Balancing calculation
    const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
    const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);

    if (totalDebit === 0 && totalCredit === 0) {
      throw new AppError(400, 'يجب إدخال رصيد واحد على الأقل لترحيل الأرصدة الافتتاحية');
    }

    if (totalDebit > totalCredit) {
      const diff = totalDebit - totalCredit;
      lines.push({
        systemKey: input.balancing_account,
        credit: diff,
        memo: 'تسوية الفارق للأرصدة الافتتاحية',
      });
    } else if (totalCredit > totalDebit) {
      const diff = totalCredit - totalDebit;
      lines.push({
        systemKey: input.balancing_account,
        debit: diff,
        memo: 'تسوية الفارق للأرصدة الافتتاحية',
      });
    }

    const entry = postEntry(
      {
        date: input.date,
        memo: input.memo || 'قيد الأرصدة الافتتاحية',
        sourceType: 'OPENING',
        lines,
      },
      actor,
    );

    audit(actor, 'ترحيل الأرصدة الافتتاحية', 'OPENING_BALANCES', entry.id, entry.number);
    return entry;
  });
}

export function reverseOpeningBalances(actor: Actor): JournalEntry {
  const openingEntry = one<JournalEntry>(
    `SELECT * FROM journal_entries WHERE source_type = 'OPENING' AND status = 'POSTED' ORDER BY date DESC LIMIT 1`,
  );
  if (!openingEntry) {
    throw new AppError(404, 'لا يوجد قيد أرصدة افتتاحية مرحّل لعكسه');
  }

  const laterEntry = one<{ id: string; date: string; number: string }>(
    `SELECT id, date, number FROM journal_entries 
     WHERE status IN ('POSTED', 'REVERSED') 
       AND date > ?
       AND source_type <> 'OPENING'
       AND id NOT IN (SELECT id FROM journal_entries WHERE reversal_of IN (SELECT id FROM journal_entries WHERE source_type = 'OPENING'))
     LIMIT 1`,
    openingEntry.date,
  );
  if (laterEntry) {
    throw new AppError(
      409,
      `لا يمكن عكس الأرصدة الافتتاحية لوجود قيود محاسبية لاحقة برقم ${laterEntry.number} وتاريخ ${laterEntry.date}`,
    );
  }

  return transaction(() => {
    const reversed = reverseEntry(
      openingEntry.id,
      actor,
      `إلغاء وعكس الأرصدة الافتتاحية ${openingEntry.number}`,
    );
    if (!reversed) {
      throw new AppError(500, 'فشل عكس قيد الأرصدة الافتتاحية');
    }

    // Reset initial balances on cash accounts
    run('UPDATE cash_accounts SET initial_balance = 0');

    // Rollback any stock movements created for opening inventory
    const openingStockMovements = all<{
      id: string;
      branch_id: string;
      product_id: string;
      quantity: number;
    }>(
      "SELECT id, branch_id, product_id, quantity FROM stock_movements WHERE reason = 'رصيد مخزون افتتاحي'",
    );

    for (const sm of openingStockMovements) {
      moveStock({
        branchId: sm.branch_id,
        productId: sm.product_id,
        delta: -sm.quantity,
        reason: 'إلغاء رصيد مخزون افتتاحي',
        actor,
      });
    }

    return reversed;
  });
}

// ── Financial Statements (P&L & Balance Sheet) ───────────────────────────────────────────

export function computePreviousPeriod(from: string, to: string): { from: string; to: string } {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  const durationMs = Math.max(86400000, toMs - fromMs + 86400000);
  const prevToMs = fromMs - 86400000;
  const prevFromMs = prevToMs - durationMs + 86400000;
  return {
    from: new Date(prevFromMs).toISOString().slice(0, 10),
    to: new Date(prevToMs).toISOString().slice(0, 10),
  };
}

export function calculateChangePercent(current: number, previous?: number): number | null {
  if (previous === undefined || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

interface PeriodAccountMovement {
  id: string;
  code: string;
  name: string;
  type: GlAccountType;
  normal_side: 'DEBIT' | 'CREDIT';
  system_key: string | null;
  debit: number;
  credit: number;
}

function fetchMovements(
  scope: Scope,
  pFrom: string,
  pTo: string,
  types: GlAccountType[],
): PeriodAccountMovement[] {
  const f = scopeSql('l.branch_id', scope);
  const typePlaceholders = types.map(() => '?').join(',');
  return all<PeriodAccountMovement>(
    `SELECT a.id, a.code, a.name, a.type, a.normal_side, a.system_key,
       COALESCE(SUM(l.debit), 0) as debit,
       COALESCE(SUM(l.credit), 0) as credit
     FROM chart_of_accounts a
     LEFT JOIN journal_lines l ON l.account_id = a.id
       AND EXISTS (
         SELECT 1 FROM journal_entries e 
         WHERE e.id = l.entry_id 
           AND e.status IN ('POSTED', 'REVERSED')
           AND e.date >= ? AND e.date <= ?
           AND ${f.sql}
       )
     WHERE a.type IN (${typePlaceholders})
     GROUP BY a.id
     HAVING (COALESCE(SUM(l.debit), 0) > 0 OR COALESCE(SUM(l.credit), 0) > 0 OR a.is_system = 1)
     ORDER BY a.code`,
    pFrom,
    pTo,
    ...f.params,
    ...types,
  );
}

/**
 * Profit and Loss Statement (قائمة الدخل).
 *
 * Derived exclusively from posted journal lines:
 *  - Net Sales = Gross Sales (Cr-Dr) - Sales Returns (Dr-Cr) - Discounts Allowed (Dr-Cr)
 *  - Cost of Goods Sold = COGS + Shrinkage - Purchase Returns
 *  - Gross Profit = Net Sales - COGS
 *  - Operating Expenses = Other expenses (Dr-Cr)
 *  - Net Profit = Gross Profit - Operating Expenses
 */
export function profitLoss(
  scope: Scope,
  from: string,
  to: string,
  compareFrom?: string,
  compareTo?: string,
): ProfitAndLossReport {
  const curr = fetchMovements(scope, from, to, ['REVENUE', 'EXPENSE']);
  const hasCompare = Boolean(compareFrom && compareTo);
  const prev = hasCompare
    ? fetchMovements(scope, compareFrom!, compareTo!, ['REVENUE', 'EXPENSE'])
    : [];
  const prevMap = new Map(prev.map((p) => [p.id, p]));

  // Helper to build rows and calculate change %
  const buildSection = (
    title: string,
    filterFn: (m: PeriodAccountMovement) => boolean,
    amountFn: (m: PeriodAccountMovement) => number,
    isDeduction = false,
  ): FinancialReportSection => {
    const rows: FinancialReportRow[] = [];
    let total = 0;
    let prevTotal = 0;

    for (const m of curr.filter(filterFn)) {
      const amount = amountFn(m);
      const p = prevMap.get(m.id);
      const prevAmount = p ? amountFn(p) : 0;
      total += amount;
      prevTotal += prevAmount;
      if (amount !== 0 || prevAmount !== 0) {
        rows.push({
          account_id: m.id,
          code: m.code,
          name: m.name,
          amount,
          previous_amount: hasCompare ? prevAmount : undefined,
          change_percent: hasCompare ? calculateChangePercent(amount, prevAmount) : undefined,
          is_deduction: isDeduction,
        });
      }
    }

    return {
      title,
      rows,
      total,
      previous_total: hasCompare ? prevTotal : undefined,
      change_percent: hasCompare ? calculateChangePercent(total, prevTotal) : undefined,
    };
  };

  // 1. Gross Sales: REVENUE accounts with normal_side CREDIT
  const grossSales = buildSection(
    'إيرادات المبيعات',
    (m) => m.type === 'REVENUE' && m.normal_side === 'CREDIT',
    (m) => m.credit - m.debit,
  );

  // 2. Sales Deductions: REVENUE accounts with normal_side DEBIT (Returns 4120, Discounts 4130)
  const salesDeductions = buildSection(
    'مردودات ومسموحات المبيعات والخصومات',
    (m) => m.type === 'REVENUE' && m.normal_side === 'DEBIT',
    (m) => m.debit - m.credit,
    true,
  );

  const netRevenue = grossSales.total - salesDeductions.total;
  const prevNetRevenue = hasCompare
    ? (grossSales.previous_total ?? 0) - (salesDeductions.previous_total ?? 0)
    : undefined;

  // 3. Cost of Goods Sold: EXPENSE accounts starting with 5 or with system keys COGS/SHRINKAGE/PURCHASE_RETURNS
  const isCogsAccount = (m: PeriodAccountMovement) =>
    m.type === 'EXPENSE' &&
    (m.code.startsWith('5') ||
      ['COGS', 'SHRINKAGE', 'PURCHASE_RETURNS'].includes(m.system_key || ''));

  const cogsSection = buildSection('تكلفة المبيعات', isCogsAccount, (m) =>
    m.normal_side === 'DEBIT' ? m.debit - m.credit : -(m.credit - m.debit),
  );

  const totalCogs = cogsSection.total;
  const prevTotalCogs = cogsSection.previous_total;

  // 4. Gross Profit
  const grossProfit = netRevenue - totalCogs;
  const prevGrossProfit = hasCompare ? (prevNetRevenue ?? 0) - (prevTotalCogs ?? 0) : undefined;

  // 5. Operating Expenses: all other EXPENSE accounts (e.g. 6110 and custom expense accounts)
  const operatingExpenses = buildSection(
    'المصروفات التشغيلية والإدارية',
    (m) => m.type === 'EXPENSE' && !isCogsAccount(m),
    (m) => (m.normal_side === 'DEBIT' ? m.debit - m.credit : -(m.credit - m.debit)),
  );

  const totalOperatingExpenses = operatingExpenses.total;
  const prevTotalOperatingExpenses = operatingExpenses.previous_total;

  // 6. Net Profit
  const netProfit = grossProfit - totalOperatingExpenses;
  const prevNetProfit = hasCompare
    ? (prevGrossProfit ?? 0) - (prevTotalOperatingExpenses ?? 0)
    : undefined;

  return {
    period: { from, to },
    comparison_period: hasCompare ? { from: compareFrom!, to: compareTo! } : undefined,
    gross_sales: grossSales,
    sales_deductions: salesDeductions,
    net_revenue: netRevenue,
    cogs: cogsSection,
    total_cogs: totalCogs,
    gross_profit: grossProfit,
    operating_expenses: operatingExpenses,
    total_operating_expenses: totalOperatingExpenses,
    net_profit: netProfit,
    previous_net_revenue: prevNetRevenue,
    previous_total_cogs: prevTotalCogs,
    previous_gross_profit: prevGrossProfit,
    previous_total_operating_expenses: prevTotalOperatingExpenses,
    previous_net_profit: prevNetProfit,
    change_net_revenue: calculateChangePercent(netRevenue, prevNetRevenue),
    change_gross_profit: calculateChangePercent(grossProfit, prevGrossProfit),
    change_net_profit: calculateChangePercent(netProfit, prevNetProfit),
  };
}

/**
 * Balance Sheet (قائمة المركز المالي / الميزانية العمومية).
 *
 * Derived exclusively from cumulative posted journal lines as of `asOf`:
 *  - Total Assets = Total Liabilities + Total Equity
 *  - Current Period Earnings is dynamically reconciled from unclosed revenue/expense movements.
 */
export function balanceSheet(scope: Scope, asOf: string, compareAsOf?: string): BalanceSheetReport {
  const f = scopeSql('l.branch_id', scope);

  const getCumulativeData = (targetDate: string) => {
    // 1. All balance sheet accounts and their cumulative balances
    const rows = all<{
      id: string;
      code: string;
      name: string;
      type: GlAccountType;
      normal_side: 'DEBIT' | 'CREDIT';
      system_key: string | null;
      is_system: number;
      debit: number;
      credit: number;
    }>(
      `SELECT a.id, a.code, a.name, a.type, a.normal_side, a.system_key, a.is_system,
         COALESCE(SUM(l.debit), 0) as debit,
         COALESCE(SUM(l.credit), 0) as credit
       FROM chart_of_accounts a
       LEFT JOIN journal_lines l ON l.account_id = a.id
         AND EXISTS (
           SELECT 1 FROM journal_entries e 
           WHERE e.id = l.entry_id 
             AND e.status IN ('POSTED', 'REVERSED')
             AND e.date <= ?
             AND ${f.sql}
         )
       WHERE a.active = 1 OR a.is_system = 1
       GROUP BY a.id
       ORDER BY a.code`,
      targetDate,
      ...f.params,
    );

    // 2. Fiscal year start for unclosed current period earnings
    const settings = getGlSettings();
    const targetYear = parseInt(targetDate.slice(0, 4), 10);
    const targetMonth = parseInt(targetDate.slice(5, 7), 10);
    const startMonth = settings.fiscal_year_start_month || 1;
    const fyYear = targetMonth >= startMonth ? targetYear : targetYear - 1;
    const fiscalYearStart = `${fyYear}-${String(startMonth).padStart(2, '0')}-01`;

    // 3. Earnings split: prior periods vs current fiscal year
    const earningsRows = all<{
      period_type: 'PRIOR' | 'CURRENT';
      rev_credit: number;
      rev_debit: number;
      exp_debit: number;
      exp_credit: number;
    }>(
      `SELECT 
         CASE WHEN e.date < ? THEN 'PRIOR' ELSE 'CURRENT' END as period_type,
         SUM(CASE WHEN a.type = 'REVENUE' THEN l.credit ELSE 0 END) as rev_credit,
         SUM(CASE WHEN a.type = 'REVENUE' THEN l.debit ELSE 0 END) as rev_debit,
         SUM(CASE WHEN a.type = 'EXPENSE' THEN l.debit ELSE 0 END) as exp_debit,
         SUM(CASE WHEN a.type = 'EXPENSE' THEN l.credit ELSE 0 END) as exp_credit
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN chart_of_accounts a ON a.id = l.account_id
       WHERE e.status IN ('POSTED', 'REVERSED')
         AND e.date <= ?
         AND a.type IN ('REVENUE', 'EXPENSE')
         AND ${f.sql}
       GROUP BY period_type`,
      fiscalYearStart,
      targetDate,
      ...f.params,
    );

    let priorEarnings = 0;
    let currentEarnings = 0;
    for (const er of earningsRows) {
      const net = er.rev_credit - er.rev_debit - (er.exp_debit - er.exp_credit);
      if (er.period_type === 'PRIOR') priorEarnings += net;
      else currentEarnings += net;
    }

    return { rows, priorEarnings, currentEarnings };
  };

  const currData = getCumulativeData(asOf);
  const hasCompare = Boolean(compareAsOf);
  const prevData = hasCompare ? getCumulativeData(compareAsOf!) : null;

  const prevMap = prevData ? new Map(prevData.rows.map((r) => [r.id, r])) : null;

  const buildSection = (
    title: string,
    filterFn: (r: (typeof currData.rows)[0]) => boolean,
    amountFn: (r: (typeof currData.rows)[0]) => number,
    isDeduction = false,
  ): FinancialReportSection => {
    const rows: FinancialReportRow[] = [];
    let total = 0;
    let prevTotal = 0;

    for (const r of currData.rows.filter(filterFn)) {
      const amount = amountFn(r);
      const pr = prevMap?.get(r.id);
      const prevAmount = pr ? amountFn(pr) : 0;
      total += amount;
      prevTotal += prevAmount;
      if (amount !== 0 || prevAmount !== 0 || r.is_system === 1) {
        rows.push({
          account_id: r.id,
          code: r.code,
          name: r.name,
          amount,
          previous_amount: hasCompare ? prevAmount : undefined,
          change_percent: hasCompare ? calculateChangePercent(amount, prevAmount) : undefined,
          is_deduction: isDeduction,
        });
      }
    }

    return {
      title,
      rows,
      total,
      previous_total: hasCompare ? prevTotal : undefined,
      change_percent: hasCompare ? calculateChangePercent(total, prevTotal) : undefined,
    };
  };

  // Assets: Current vs Non-Current
  const isCurrentAsset = (r: (typeof currData.rows)[0]) =>
    r.type === 'ASSET' &&
    (r.code.startsWith('11') ||
      ['CASH', 'BANK', 'AR', 'INVENTORY', 'VAT_INPUT'].includes(r.system_key || ''));

  const currentAssets = buildSection('الأصول المتداولة', isCurrentAsset, (r) => r.debit - r.credit);

  const nonCurrentAssets = buildSection(
    'الأصول غير المتداولة (الثابتة)',
    (r) => r.type === 'ASSET' && !isCurrentAsset(r),
    (r) => r.debit - r.credit,
  );

  const totalAssets = currentAssets.total + nonCurrentAssets.total;
  const prevTotalAssets = hasCompare
    ? (currentAssets.previous_total ?? 0) + (nonCurrentAssets.previous_total ?? 0)
    : undefined;

  // Liabilities: Current vs Non-Current
  const isCurrentLiability = (r: (typeof currData.rows)[0]) =>
    r.type === 'LIABILITY' &&
    (r.code.startsWith('21') ||
      ['AP', 'VAT_OUTPUT', 'SALARIES_PAYABLE'].includes(r.system_key || ''));

  const currentLiabilities = buildSection(
    'الالتزامات المتداولة',
    isCurrentLiability,
    (r) => r.credit - r.debit,
  );

  const nonCurrentLiabilities = buildSection(
    'الالتزامات غير المتداولة',
    (r) => r.type === 'LIABILITY' && !isCurrentLiability(r),
    (r) => r.credit - r.debit,
  );

  const totalLiabilities = currentLiabilities.total + nonCurrentLiabilities.total;
  const prevTotalLiabilities = hasCompare
    ? (currentLiabilities.previous_total ?? 0) + (nonCurrentLiabilities.previous_total ?? 0)
    : undefined;

  // Equity Items
  const equityItems = buildSection(
    'حقوق الملكية',
    (r) => r.type === 'EQUITY',
    (r) => (r.normal_side === 'CREDIT' ? r.credit - r.debit : -(r.debit - r.credit)),
  );

  const priorEarnings = currData.priorEarnings;
  const currentEarnings = currData.currentEarnings;
  const totalEquity = equityItems.total + priorEarnings + currentEarnings;

  const prevTotalEquity = hasCompare
    ? (equityItems.previous_total ?? 0) +
      (prevData?.priorEarnings ?? 0) +
      (prevData?.currentEarnings ?? 0)
    : undefined;

  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
  const prevTotalLiabilitiesAndEquity = hasCompare
    ? (prevTotalLiabilities ?? 0) + (prevTotalEquity ?? 0)
    : undefined;

  return {
    as_of: asOf,
    comparison_as_of: compareAsOf,
    assets: {
      current_assets: currentAssets,
      non_current_assets: nonCurrentAssets,
      total_assets: totalAssets,
      previous_total_assets: prevTotalAssets,
    },
    total_assets: totalAssets,
    liabilities: {
      current_liabilities: currentLiabilities,
      non_current_liabilities: nonCurrentLiabilities,
      total_liabilities: totalLiabilities,
      previous_total_liabilities: prevTotalLiabilities,
    },
    total_liabilities: totalLiabilities,
    equity: {
      items: equityItems,
      prior_period_earnings: priorEarnings,
      current_period_earnings: currentEarnings,
      total_equity: totalEquity,
      previous_total_equity: prevTotalEquity,
    },
    total_equity: totalEquity,
    total_liabilities_and_equity: totalLiabilitiesAndEquity,
    previous_total_liabilities_and_equity: prevTotalLiabilitiesAndEquity,
    is_balanced: totalAssets === totalLiabilitiesAndEquity,
  };
}

// ── Egyptian VAT Return Model 10 & Tax Registers ──────────────────────────────────────────

export function computeVatReturn(
  from: string,
  to: string,
  branchId?: string | null,
  scope?: Scope,
): VatReturnReport {
  let branchName: string | null = null;
  if (branchId && branchId !== 'all') {
    const b = one<{ name: string }>('SELECT name FROM branches WHERE id=?', branchId);
    branchName = b?.name ?? null;
  }

  const glFilter = () => {
    if (branchId && branchId !== 'all') {
      return { sql: 'l.branch_id = ?', params: [branchId] };
    }
    if (scope) {
      return scopeSql('l.branch_id', scope);
    }
    return { sql: '1=1', params: [] };
  };
  const gf = glFilter();

  // 1. Output tax from GL (Accrued sales VAT: credit - debit on VAT_OUTPUT)
  const glOutputRow = one<{ credit: number; debit: number }>(
    `SELECT 
       COALESCE(SUM(l.credit), 0) as credit,
       COALESCE(SUM(l.debit), 0) as debit
     FROM journal_lines l
     JOIN journal_entries e ON e.id = l.entry_id
     JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE e.status IN ('POSTED', 'REVERSED')
       AND e.date BETWEEN ? AND ?
       AND a.system_key = 'VAT_OUTPUT'
       AND ${gf.sql}`,
    from,
    to,
    ...gf.params,
  );
  const glOutputBalance = (glOutputRow?.credit ?? 0) - (glOutputRow?.debit ?? 0);

  // 2. Input tax from GL (Deductible purchase VAT: debit - credit on VAT_INPUT)
  const glInputRow = one<{ debit: number; credit: number }>(
    `SELECT 
       COALESCE(SUM(l.debit), 0) as debit,
       COALESCE(SUM(l.credit), 0) as credit
     FROM journal_lines l
     JOIN journal_entries e ON e.id = l.entry_id
     JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE e.status IN ('POSTED', 'REVERSED')
       AND e.date BETWEEN ? AND ?
       AND a.system_key = 'VAT_INPUT'
       AND ${gf.sql}`,
    from,
    to,
    ...gf.params,
  );
  const glInputBalance = (glInputRow?.debit ?? 0) - (glInputRow?.credit ?? 0);

  // 3. Document-level breakdown from posted documents
  const docFilter = () => {
    if (branchId && branchId !== 'all') {
      return { sql: 'd.branch_id = ?', params: [branchId] };
    }
    if (scope) {
      return scopeSql('d.branch_id', scope);
    }
    return { sql: '1=1', params: [] };
  };
  const df = docFilter();

  const docStats = all<{
    type: string;
    count: number;
    base: number;
    tax: number;
  }>(
    `SELECT 
       d.type,
       COUNT(*) as count,
       COALESCE(SUM(d.subtotal - d.discount), 0) as base,
       COALESCE(SUM(d.tax), 0) as tax
     FROM documents d
     WHERE d.status = 'POSTED'
       AND d.date BETWEEN ? AND ?
       AND d.type IN ('SALE', 'SALE_RETURN', 'PURCHASE', 'PURCHASE_RETURN')
       AND ${df.sql}
     GROUP BY d.type`,
    from,
    to,
    ...df.params,
  );

  const statMap = new Map(docStats.map((s) => [s.type, s]));

  const saleStat = statMap.get('SALE') || { count: 0, base: 0, tax: 0 };
  const saleReturnStat = statMap.get('SALE_RETURN') || { count: 0, base: 0, tax: 0 };
  const purchaseStat = statMap.get('PURCHASE') || { count: 0, base: 0, tax: 0 };
  const purchaseReturnStat = statMap.get('PURCHASE_RETURN') || { count: 0, base: 0, tax: 0 };

  const netSalesBase = saleStat.base - saleReturnStat.base;
  const netOutputTax = saleStat.tax - saleReturnStat.tax;

  const netPurchasesBase = purchaseStat.base - purchaseReturnStat.base;
  const netInputTax = purchaseStat.tax - purchaseReturnStat.tax;

  const totalOutputTax = glOutputBalance;
  const totalInputTax = glInputBalance;

  const netDifference = totalOutputTax - totalInputTax;
  const netTaxDue = netDifference > 0 ? netDifference : 0;
  const creditBalance = netDifference < 0 ? Math.abs(netDifference) : 0;

  const glReconciled = netOutputTax === glOutputBalance && netInputTax === glInputBalance;

  return {
    from,
    to,
    branch_id: branchId ?? null,
    branch_name: branchName,
    sales: {
      standard_rated_14: {
        taxable_base: saleStat.base,
        tax_amount: saleStat.tax,
        documents_count: saleStat.count,
      },
      returns: {
        taxable_base: saleReturnStat.base,
        tax_amount: saleReturnStat.tax,
        documents_count: saleReturnStat.count,
      },
      net_taxable_sales: netSalesBase,
      net_output_tax: netOutputTax,
    },
    purchases: {
      standard_rated_14: {
        taxable_base: purchaseStat.base,
        tax_amount: purchaseStat.tax,
        documents_count: purchaseStat.count,
      },
      returns: {
        taxable_base: purchaseReturnStat.base,
        tax_amount: purchaseReturnStat.tax,
        documents_count: purchaseReturnStat.count,
      },
      net_taxable_purchases: netPurchasesBase,
      net_deductible_input_tax: netInputTax,
    },
    summary: {
      total_output_tax: totalOutputTax,
      total_input_tax: totalInputTax,
      net_tax_due: netTaxDue,
      credit_balance: creditBalance,
      gl_output_tax_balance: glOutputBalance,
      gl_input_tax_balance: glInputBalance,
      gl_reconciled: glReconciled,
    },
  };
}

export function getTaxRegister(
  registerType: 'SALES' | 'PURCHASES',
  from: string,
  to: string,
  branchId?: string | null,
  scope?: Scope,
): TaxRegisterResponse {
  const isSales = registerType === 'SALES';
  const targetTypes = isSales ? ['SALE', 'SALE_RETURN'] : ['PURCHASE', 'PURCHASE_RETURN'];

  const docFilter = () => {
    if (branchId && branchId !== 'all') {
      return { sql: 'd.branch_id = ?', params: [branchId] };
    }
    if (scope) {
      return scopeSql('d.branch_id', scope);
    }
    return { sql: '1=1', params: [] };
  };
  const df = docFilter();

  const rawRows = all<{
    id: string;
    number: string;
    date: string;
    type: 'SALE' | 'SALE_RETURN' | 'PURCHASE' | 'PURCHASE_RETURN';
    subtotal: number;
    discount: number;
    tax_rate: number;
    tax: number;
    total: number;
    party_id: string;
    party_name: string;
    party_tax_number: string;
    branch_id: string;
    branch_name: string;
    eta_status: TaxRegisterRow['eta_status'];
    eta_uuid: string | null;
    eta_long_id: string | null;
  }>(
    `SELECT 
       d.id,
       d.number,
       d.date,
       d.type,
       d.subtotal,
       d.discount,
       d.tax_rate,
       d.tax,
       d.total,
       d.party_id,
       COALESCE(p.name, '') as party_name,
       COALESCE(p.tax_number, '') as party_tax_number,
       d.branch_id,
       COALESCE(b.name, '') as branch_name,
       eta.status as eta_status,
       eta.uuid as eta_uuid,
       eta.eta_long_id
     FROM documents d
     JOIN parties p ON p.id = d.party_id
     JOIN branches b ON b.id = d.branch_id
     LEFT JOIN (
       SELECT document_id, status, uuid, eta_long_id,
              ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY created_at DESC) as rn
       FROM e_invoice_submissions
     ) eta ON eta.document_id = d.id AND eta.rn = 1
     WHERE d.status = 'POSTED'
       AND d.date BETWEEN ? AND ?
       AND d.type IN (${targetTypes.map(() => '?').join(',')})
       AND ${df.sql}
     ORDER BY d.date DESC, d.number DESC`,
    from,
    to,
    ...targetTypes,
    ...df.params,
  );

  let totalBase = 0;
  let totalTax = 0;
  let totalDocAmount = 0;

  const rows: TaxRegisterRow[] = rawRows.map((r) => {
    const isReturn = r.type === 'SALE_RETURN' || r.type === 'PURCHASE_RETURN';
    const base = r.subtotal - r.discount;
    const tax = r.tax;
    const docTotal = r.total;

    if (isReturn) {
      totalBase -= base;
      totalTax -= tax;
      totalDocAmount -= docTotal;
    } else {
      totalBase += base;
      totalTax += tax;
      totalDocAmount += docTotal;
    }

    let typeLabel = '';
    if (r.type === 'SALE') typeLabel = 'فاتورة بيع ضريبية';
    else if (r.type === 'SALE_RETURN') typeLabel = 'إشعار دائن (مرتجع مبيعات)';
    else if (r.type === 'PURCHASE') typeLabel = 'فاتورة شراء ضريبية';
    else if (r.type === 'PURCHASE_RETURN') typeLabel = 'إشعار مدين (مرتجع مشتريات)';

    return {
      id: r.id,
      number: r.number,
      date: r.date,
      type: r.type,
      type_label: typeLabel,
      party_id: r.party_id,
      party_name: r.party_name,
      party_tax_number: r.party_tax_number || undefined,
      branch_id: r.branch_id,
      branch_name: r.branch_name,
      taxable_base: isReturn ? -base : base,
      tax_rate: r.tax_rate,
      tax_amount: isReturn ? -tax : tax,
      total_amount: isReturn ? -docTotal : docTotal,
      eta_status: r.eta_status ?? 'UNSUBMITTED',
      eta_uuid: r.eta_uuid ?? null,
      eta_long_id: r.eta_long_id ?? null,
    };
  });

  return {
    from,
    to,
    branch_id: branchId ?? null,
    register_type: registerType,
    rows,
    totals: {
      taxable_base: totalBase,
      tax_amount: totalTax,
      total_amount: totalDocAmount,
      count: rows.length,
    },
  };
}
