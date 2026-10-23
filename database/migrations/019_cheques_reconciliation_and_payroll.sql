-- Migration 019: Cheques Portfolio, Bank Reconciliation, Cost Centers, and Egyptian Payroll (Phases 4 & 5)

-- Phase 4.1: Cheques & Commercial Papers Portfolio
CREATE TABLE cheques (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('RECEIVABLE','PAYABLE')),
  party_id TEXT NOT NULL REFERENCES parties(id),
  bank_name TEXT NOT NULL,
  branch_name TEXT,
  amount INTEGER NOT NULL CHECK(amount > 0),
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PORTFOLIO' CHECK(status IN ('PORTFOLIO','COLLECTED','DEPOSITED','BOUNCED','CANCELLED','PAID')),
  cash_account_id TEXT REFERENCES cash_accounts(id),
  journal_entry_id TEXT REFERENCES journal_entries(id),
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(type, number, bank_name)
);
CREATE INDEX idx_cheques_due ON cheques(due_date);
CREATE INDEX idx_cheques_party ON cheques(party_id);
CREATE INDEX idx_cheques_status ON cheques(status);

-- Phase 4.2: Bank Statements & Reconciliation
CREATE TABLE bank_statements (
  id TEXT PRIMARY KEY,
  cash_account_id TEXT NOT NULL REFERENCES cash_accounts(id),
  statement_date TEXT NOT NULL,
  opening_balance INTEGER NOT NULL DEFAULT 0,
  closing_balance INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','RECONCILED')),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE bank_statement_lines (
  id TEXT PRIMARY KEY,
  statement_id TEXT NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  reference TEXT,
  amount INTEGER NOT NULL, -- positive for deposit, negative for withdrawal
  matched_payment_id TEXT REFERENCES payments(id),
  matched_at TEXT
);
CREATE INDEX idx_bank_stmt_lines_stmt ON bank_statement_lines(statement_id);

-- Phase 4.3: Cost Centers & Analytical Accounting
CREATE TABLE cost_centers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES cost_centers(id),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE journal_line_cost_centers (
  journal_line_id TEXT PRIMARY KEY REFERENCES journal_lines(id) ON DELETE CASCADE,
  cost_center_id TEXT NOT NULL REFERENCES cost_centers(id) ON DELETE CASCADE
);

-- Phase 5.1 & 5.2: Egyptian HR & Payroll Engine
CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  national_id TEXT,
  phone TEXT,
  job_title TEXT NOT NULL,
  department TEXT,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  employment_type TEXT NOT NULL DEFAULT 'FULL_TIME' CHECK(employment_type IN ('FULL_TIME','PART_TIME','CONTRACT')),
  basic_salary INTEGER NOT NULL CHECK(basic_salary >= 0),
  variable_salary INTEGER NOT NULL DEFAULT 0 CHECK(variable_salary >= 0),
  insured_salary INTEGER NOT NULL DEFAULT 0 CHECK(insured_salary >= 0),
  insurance_number TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  hire_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_employees_branch ON employees(branch_id);

CREATE TABLE employee_advances (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK(amount > 0),
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REPAID')),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE payroll_runs (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL, -- YYYY-MM
  branch_id TEXT REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','PAID','CANCELLED')),
  total_basic INTEGER NOT NULL DEFAULT 0,
  total_variable INTEGER NOT NULL DEFAULT 0,
  total_gross INTEGER NOT NULL DEFAULT 0,
  total_social_insurance_employee INTEGER NOT NULL DEFAULT 0,
  total_social_insurance_employer INTEGER NOT NULL DEFAULT 0,
  total_income_tax INTEGER NOT NULL DEFAULT 0,
  total_martyrs_fund INTEGER NOT NULL DEFAULT 0,
  total_advances INTEGER NOT NULL DEFAULT 0,
  total_net INTEGER NOT NULL DEFAULT 0,
  journal_entry_id TEXT REFERENCES journal_entries(id),
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(month, branch_id)
);

CREATE TABLE payroll_slips (
  id TEXT PRIMARY KEY,
  payroll_run_id TEXT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  basic_salary INTEGER NOT NULL,
  variable_salary INTEGER NOT NULL DEFAULT 0,
  gross_salary INTEGER NOT NULL,
  social_insurance_employee INTEGER NOT NULL DEFAULT 0,
  social_insurance_employer INTEGER NOT NULL DEFAULT 0,
  income_tax INTEGER NOT NULL DEFAULT 0,
  martyrs_fund INTEGER NOT NULL DEFAULT 0,
  advances_deduction INTEGER NOT NULL DEFAULT 0,
  other_deductions INTEGER NOT NULL DEFAULT 0,
  net_salary INTEGER NOT NULL,
  notes TEXT,
  UNIQUE(payroll_run_id, employee_id)
);
CREATE INDEX idx_payroll_slips_run ON payroll_slips(payroll_run_id);

-- Chart of Accounts extensions for Phase 4 & 5
INSERT OR IGNORE INTO chart_of_accounts(id, code, name, type, normal_side, is_system, system_key, active, notes, created_at)
VALUES
  ('acc_notes_receivable', '1135', 'أوراق قبض (شيكات تحت التحصيل)', 'ASSET',     'DEBIT',  1, 'NOTES_RECEIVABLE', 1, 'شيكات العملاء تحت التحصيل', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_notes_payable',    '2115', 'أوراق دفع (شيكات صادرة للموردين)', 'LIABILITY', 'CREDIT', 1, 'NOTES_PAYABLE',    1, 'شيكات صادرة ومؤجلة للموردين', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_emp_advances',     '1165', 'سلف وعهد العاملين',            'ASSET',     'DEBIT',  1, 'EMP_ADVANCES',     1, 'سلفيات الموظفين تحت التسوية', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_salaries_exp',     '6120', 'مصروفات الرواتب والأجور',      'EXPENSE',   'DEBIT',  1, 'SALARIES_EXPENSE', 1, 'إجمالي أجور ورواتب العاملين', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_social_ins',       '2140', 'هيئة التأمينات الاجتماعية',    'LIABILITY', 'CREDIT', 1, 'SOCIAL_INSURANCE', 1, 'مستحقات التأمينات الاجتماعية حصة العامل والشركة', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc_payroll_tax',      '2150', 'مصلحة الضرائب - كسب عمل',     'LIABILITY', 'CREDIT', 1, 'PAYROLL_TAX',      1, 'استقطاعات ضريبة كسب العمل وصندوق الشهداء', strftime('%Y-%m-%dT%H:%M:%fZ','now'));


