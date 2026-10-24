-- Migration 020: HR Leaves, Attendance, and Employee Contracts

-- 1. Leave Types
CREATE TABLE IF NOT EXISTS leave_types (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  days_per_year INTEGER NOT NULL DEFAULT 21,
  is_paid INTEGER NOT NULL DEFAULT 1 CHECK(is_paid IN (0,1)),
  deduct_from_salary INTEGER NOT NULL DEFAULT 0 CHECK(deduct_from_salary IN (0,1)),
  created_at TEXT NOT NULL
);

-- Seed standard leave types
INSERT OR IGNORE INTO leave_types (id, code, name, days_per_year, is_paid, deduct_from_salary, created_at) VALUES
  ('lt_annual', 'ANNUAL', 'إجازة سنوية / اعتيادية', 21, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('lt_casual', 'CASUAL', 'إجازة عارضة', 7, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('lt_sick',   'SICK',   'إجازة مرضية', 30, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('lt_unpaid', 'UNPAID', 'إجازة بدون راتب', 0, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- 2. Employee Leaves & Requests
CREATE TABLE IF NOT EXISTS employee_leaves (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  total_days INTEGER NOT NULL CHECK(total_days > 0),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_employee_leaves_emp ON employee_leaves(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_leaves_dates ON employee_leaves(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_employee_leaves_status ON employee_leaves(status);

-- 3. Employee Daily Attendance
CREATE TABLE IF NOT EXISTS employee_attendance (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  date TEXT NOT NULL,
  check_in TEXT,
  check_out TEXT,
  status TEXT NOT NULL DEFAULT 'PRESENT' CHECK(status IN ('PRESENT','ABSENT','LATE','EXCUSED','REST_DAY')),
  late_minutes INTEGER NOT NULL DEFAULT 0 CHECK(late_minutes >= 0),
  overtime_hours REAL NOT NULL DEFAULT 0 CHECK(overtime_hours >= 0),
  notes TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(employee_id, date)
);
CREATE INDEX IF NOT EXISTS idx_employee_attendance_emp ON employee_attendance(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_attendance_date ON employee_attendance(date);

-- 4. Extend employees table with contract information
ALTER TABLE employees ADD COLUMN contract_end_date TEXT;
ALTER TABLE employees ADD COLUMN probation_end_date TEXT;
ALTER TABLE employees ADD COLUMN emergency_contact TEXT;

-- 5. Extend payroll_slips with granular attendance, overtime, and commission tracking
ALTER TABLE payroll_slips ADD COLUMN overtime_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_slips ADD COLUMN attendance_deduction INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_slips ADD COLUMN sales_commission INTEGER NOT NULL DEFAULT 0;
