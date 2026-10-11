-- Cash and Bank Accounts management with transaction linkage and overdraft controls.

CREATE TABLE cash_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('CASH', 'BANK', 'WALLET')),
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  currency TEXT NOT NULL DEFAULT 'EGP',
  account_number TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  initial_balance INTEGER NOT NULL DEFAULT 0 CHECK(initial_balance >= 0),
  allow_negative INTEGER NOT NULL DEFAULT 0 CHECK(allow_negative IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_cash_accounts_branch ON cash_accounts(branch_id);

-- Insert company default cash and bank accounts so existing transactions map smoothly
INSERT INTO cash_accounts(id, name, type, branch_id, currency, initial_balance, allow_negative, active, notes, created_at)
  VALUES
  ('acc_def_cash', 'الخزينة العامة', 'CASH', NULL, 'EGP', 0, 1, 1, 'الخزينة النقدية الافتراضية للنظام', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_def_bank', 'الحساب البنكي الرئيسي', 'BANK', NULL, 'EGP', 0, 1, 1, 'الحساب البنكي الافتراضي للنظام', strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Link payments to cash_accounts
ALTER TABLE payments ADD COLUMN account_id TEXT REFERENCES cash_accounts(id);
CREATE INDEX idx_payments_account ON payments(account_id);
UPDATE payments SET account_id = CASE WHEN method = 'BANK' THEN 'acc_def_bank' ELSE 'acc_def_cash' END WHERE account_id IS NULL;

-- Link expenses to cash_accounts
ALTER TABLE expenses ADD COLUMN account_id TEXT REFERENCES cash_accounts(id);
CREATE INDEX idx_expenses_account ON expenses(account_id);
UPDATE expenses SET account_id = CASE WHEN method = 'BANK' THEN 'acc_def_bank' ELSE 'acc_def_cash' END WHERE account_id IS NULL;

-- Link distribution_payments to cash_accounts
ALTER TABLE distribution_payments ADD COLUMN account_id TEXT REFERENCES cash_accounts(id);
CREATE INDEX idx_dist_payments_account ON distribution_payments(account_id);
UPDATE distribution_payments SET account_id = CASE WHEN method = 'BANK' THEN 'acc_def_bank' ELSE 'acc_def_cash' END WHERE account_id IS NULL;

-- Link equity_entries to cash_accounts
ALTER TABLE equity_entries ADD COLUMN account_id TEXT REFERENCES cash_accounts(id);
CREATE INDEX idx_equity_account ON equity_entries(account_id);
UPDATE equity_entries SET account_id = CASE WHEN method = 'BANK' THEN 'acc_def_bank' ELSE 'acc_def_cash' END WHERE account_id IS NULL;

-- Inter-account transfers (e.g. cash deposit to bank, or bank withdrawal to branch cash drawer)
CREATE TABLE account_transfers (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  from_account_id TEXT NOT NULL REFERENCES cash_accounts(id),
  to_account_id TEXT NOT NULL REFERENCES cash_accounts(id),
  amount INTEGER NOT NULL CHECK(amount > 0),
  date TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK(from_account_id <> to_account_id)
);
CREATE INDEX idx_transfers_from_acc ON account_transfers(from_account_id);
CREATE INDEX idx_transfers_to_acc ON account_transfers(to_account_id);
CREATE INDEX idx_transfers_date ON account_transfers(date);
