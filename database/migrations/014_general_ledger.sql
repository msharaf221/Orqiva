-- Migration 014: General Ledger (دفتر الأستاذ)
--
-- A proper double-entry ledger. Until now the P&L was aggregated directly from
-- documents/expenses/payments in server/reports.ts; this adds the books of record so
-- every business event that already goes through a posting engine also writes a balanced
-- journal entry:
--
--   postDocument / cancelDocument  → AR/AP, revenue, COGS, inventory, VAT
--   addPayment                     → cash/bank vs AR/AP
--   expenses                       → expense vs cash/bank
--   account transfers              → cash/bank vs cash/bank
--   POS cash movements / shift closing → drawer cash reconciliation
--   transfers / stocktakes          → inventory between branches / shrinkage
--
-- Balances are derived, never stored: the trial balance sums journal_lines. Journal
-- entries are immutable once posted (corrections use a new reversing entry), which keeps
-- the audit trail honest.
--
-- An entry is written while DRAFT, its lines are inserted, then it is flipped to POSTED.
-- A trigger on that transition asserts debit total = credit total and at least two lines,
-- so an unbalanced entry can never become part of the books.

CREATE TABLE chart_of_accounts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  -- Normal balance side; debit accounts (assets/expense) grow on debit.
  normal_side TEXT NOT NULL CHECK(normal_side IN ('DEBIT','CREDIT')),
  parent_id TEXT REFERENCES chart_of_accounts(id),
  -- System accounts cannot be deleted and drive automatic posting by key.
  is_system INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0,1)),
  -- Stable key used by the posting engine (e.g. 'AR', 'INVENTORY', 'VAT_OUTPUT').
  system_key TEXT UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_coa_type ON chart_of_accounts(type, active);
CREATE INDEX idx_coa_code ON chart_of_accounts(code);

CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  -- Human description, e.g. «فاتورة بيع SAL-2026-0007».
  memo TEXT NOT NULL DEFAULT '',
  -- What produced the entry, for traceability and reposting guards.
  source_type TEXT NOT NULL CHECK(source_type IN (
    'SALE','PURCHASE','SALE_RETURN','PURCHASE_RETURN','PAYMENT','EXPENSE',
    'ACCOUNT_TRANSFER','POS_CASH','POS_SHIFT','TRANSFER','STOCKTAKE',
    'DISTRIBUTION','EQUITY','MANUAL','REVERSAL','OPENING'
  )),
  source_id TEXT,
  branch_id TEXT REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','POSTED','REVERSED')),
  -- Set when this entry was produced by reversing another entry.
  reversal_of TEXT REFERENCES journal_entries(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_journal_date ON journal_entries(date, id);
CREATE INDEX idx_journal_source ON journal_entries(source_type, source_id);
CREATE INDEX idx_journal_branch ON journal_entries(branch_id, date);

CREATE TABLE journal_lines (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
  -- Exactly one side is non-zero; a line is either a debit or a credit, never both.
  debit INTEGER NOT NULL DEFAULT 0 CHECK(debit >= 0),
  credit INTEGER NOT NULL DEFAULT 0 CHECK(credit >= 0),
  branch_id TEXT REFERENCES branches(id),
  memo TEXT NOT NULL DEFAULT '',
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE INDEX idx_journal_lines_entry ON journal_lines(entry_id);
CREATE INDEX idx_journal_lines_account ON journal_lines(account_id, entry_id);

-- A posted entry must balance: at least two lines with equal debit and credit totals.
CREATE TRIGGER trg_journal_posted_balanced
BEFORE UPDATE OF status ON journal_entries
WHEN NEW.status = 'POSTED' AND OLD.status = 'DRAFT'
BEGIN
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM journal_lines WHERE entry_id = NEW.id
  ) < 2 THEN RAISE(ABORT, 'journal entry needs at least two lines') END;
  SELECT CASE WHEN (
    SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE entry_id = NEW.id
  ) <> (
    SELECT COALESCE(SUM(credit),0) FROM journal_lines WHERE entry_id = NEW.id
  ) THEN RAISE(ABORT, 'journal entry is not balanced') END;
END;

-- A posted entry is immutable: its lines cannot change once POSTED.
CREATE TRIGGER trg_journal_lines_no_write_when_posted
BEFORE INSERT ON journal_lines
WHEN (SELECT status FROM journal_entries WHERE id = NEW.entry_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'cannot add lines to a posted journal entry');
END;

CREATE TRIGGER trg_journal_lines_no_update_when_posted
BEFORE UPDATE ON journal_lines
WHEN (SELECT status FROM journal_entries WHERE id = NEW.entry_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'cannot modify lines of a posted journal entry');
END;

-- Fiscal calendar and period lock.
CREATE TABLE gl_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  fiscal_year_start_month INTEGER NOT NULL DEFAULT 1 CHECK(fiscal_year_start_month BETWEEN 1 AND 12),
  -- When set, the period is closed up to and including this date (YYYY-MM-DD).
  closed_through TEXT,
  updated_at TEXT
);
INSERT INTO gl_settings(id, fiscal_year_start_month, updated_at) VALUES (1, 1, NULL);

-- Standard Egyptian chart of accounts. Codes follow the 4/5/6/7/8 first-digit convention
-- (1 = assets, 2 = liabilities, 3 = equity, 4 = revenue, 5 = cost of sales, 6 = expenses).
-- The system keys are what the posting engine looks up; renaming a row is safe, changing a
-- key is not.
INSERT INTO chart_of_accounts(id, code, name, type, normal_side, is_system, system_key, active, notes, created_at) VALUES
  ('acc_cash',        '1110', 'النقدية بالخزينة',              'ASSET',     'DEBIT', 1, 'CASH',           1, 'النقدية في الصندوق والدرج',              strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_bank',        '1120', 'النقدية بالبنك',                'ASSET',     'DEBIT', 1, 'BANK',           1, 'الحسابات الجارية وحسابات إنستاباي',       strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_ar',          '1130', 'العملاء (ذمم مدينة)',           'ASSET',     'DEBIT', 1, 'AR',             1, 'المبالغ المستحقة من العملاء',            strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_inventory',   '1140', 'المخزون',                       'ASSET',     'DEBIT', 1, 'INVENTORY',      1, 'المخزون بالتكلفة المتوسطة المرجحة',       strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_vat_input',   '1150', 'ضريبة القيمة المضافة (مدخلات)', 'ASSET',     'DEBIT', 1, 'VAT_INPUT',      1, 'ض.ق.م على المشتريات القابلة للخصم',       strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_ap',          '2110', 'الموردون (ذمم دائنة)',          'LIABILITY', 'CREDIT',1, 'AP',             1, 'المبالغ المستحقة للموردين',              strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_vat_output',  '2120', 'ضريبة القيمة المضافة (مخرجات)', 'LIABILITY', 'CREDIT',1, 'VAT_OUTPUT',     1, 'ض.ق.م المحصلة على المبيعات',             strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_salaries',    '2130', 'أجور مستحقة',                   'LIABILITY', 'CREDIT',1, 'SALARIES_PAYABLE',1,'رواتب وأجور لم تُصرف بعد',              strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_capital',     '3110', 'رأس المال',                     'EQUITY',    'CREDIT',1, 'CAPITAL',        1, 'رأس المال المدفوع',                       strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_drawings',    '3120', 'مسحوبات الشركاء',               'EQUITY',    'DEBIT', 1, 'DRAWINGS',       1, 'المسحوبات الشخصية للشركاء',               strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_retained',    '3130', 'أرباح مرحلة',                   'EQUITY',    'CREDIT',1, 'RETAINED',       1, 'أرباح الفترات السابقة',                   strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_opening',     '3190', 'أرصدة افتتاحية',                'EQUITY',    'CREDIT',1, 'OPENING_EQUITY', 1, 'حساب مقابل للقيود الافتتاحية',            strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_sales',       '4110', 'إيرادات المبيعات',              'REVENUE',   'CREDIT',1, 'SALES',          1, 'صافي إيراد المبيعات قبل ض.ق.م',           strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_sales_ret',   '4120', 'مردودات ومسموحات المبيعات',     'REVENUE',   'DEBIT', 1, 'SALES_RETURNS',  1, 'مرتجعات العملاء',                         strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_discounts',   '4130', 'الخصومات المسموحة',             'REVENUE',   'DEBIT', 1, 'DISCOUNTS',      1, 'خصومات على المبيعات',                     strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_cogs',        '5110', 'تكلفة المبيعات',                'EXPENSE',   'DEBIT', 1, 'COGS',           1, 'تكلفة البضاعة المباعة (WAC)',             strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_shrinkage',   '5120', 'فروقات الجرد والتلف',           'EXPENSE',   'DEBIT', 1, 'SHRINKAGE',      1, 'عجز الجرد والتالف',                       strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_purch_ret',   '5130', 'مردودات المشتريات',             'EXPENSE',   'DEBIT', 1, 'PURCHASE_RETURNS',1,'مرتجعات إلى الموردين',                   strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_expense',     '6110', 'مصروفات تشغيلية',               'EXPENSE',   'DEBIT', 1, 'EXPENSE',        1, 'التصنيف العام لأي مصروف',                 strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Cash accounts mirror the operational cash_accounts so that drawer/bank balances in the
-- treasury module map onto ledger accounts one-to-one. The link is stored on cash_accounts.
ALTER TABLE cash_accounts ADD COLUMN gl_account_id TEXT REFERENCES chart_of_accounts(id);
UPDATE cash_accounts SET gl_account_id = CASE WHEN type = 'CASH' THEN 'acc_cash' ELSE 'acc_bank' END;

-- Seeded roles may open the books and post manual entries.
INSERT OR IGNORE INTO role_permissions(role_id, permission) VALUES
  ('role_gen_acc', 'gl:view'),
  ('role_gen_acc', 'gl:manage'),
  ('role_admin', 'gl:view'),
  ('role_admin', 'gl:manage');
