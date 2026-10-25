-- Migration 025: tax-free mode and attendance-device integration
--
-- Tax-free mode itself is enforced in application code. The one-time historical
-- recalculation lives in server/tax_free_reset.ts so it can reverse and repost ledger
-- entries with the same posting rules as the rest of the app. This migration only adds
-- the supporting schema.
--
-- Attendance devices are intentionally generic: a device is identified by a serial and an
-- API key, users are mapped to employees per device, and raw punches are kept even when
-- they arrive before the mapping exists. ZKTeco ADMS-style ATTLOG lines can be imported
-- through the same ingestion endpoint.

-- 1) Credits created when removing tax leaves a document overpaid. Direction is relative
--    to the party balance: CREDIT reduces what the party owes, DEBIT increases it.
CREATE TABLE IF NOT EXISTS party_credits (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  source_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  remaining INTEGER NOT NULL CHECK(remaining >= 0),
  direction TEXT NOT NULL CHECK(direction IN ('CREDIT', 'DEBIT')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'APPLIED', 'CANCELLED')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_party_credits_party ON party_credits(party_id, status);
CREATE INDEX IF NOT EXISTS idx_party_credits_branch ON party_credits(branch_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_party_credits_source
  ON party_credits(source_document_id) WHERE source_document_id IS NOT NULL;

-- 2) Attendance devices. The API key is stored only as a SHA-256 hash; the plaintext key
--    is shown once when it is generated or rotated.
CREATE TABLE IF NOT EXISTS attendance_devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  serial_number TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  port INTEGER NOT NULL DEFAULT 4370 CHECK(port BETWEEN 1 AND 65535),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  api_key_hash TEXT NOT NULL UNIQUE,
  api_key_prefix TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  work_start TEXT NOT NULL DEFAULT '09:00',
  work_end TEXT NOT NULL DEFAULT '17:00',
  late_grace_minutes INTEGER NOT NULL DEFAULT 10 CHECK(late_grace_minutes >= 0),
  overtime_after_minutes INTEGER NOT NULL DEFAULT 0 CHECK(overtime_after_minutes >= 0),
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attendance_devices_branch ON attendance_devices(branch_id, active);

CREATE TABLE IF NOT EXISTS device_user_mappings (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES attendance_devices(id) ON DELETE CASCADE,
  device_user_id TEXT NOT NULL,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(device_id, device_user_id)
);
CREATE INDEX IF NOT EXISTS idx_device_user_mappings_employee ON device_user_mappings(employee_id);

CREATE TABLE IF NOT EXISTS attendance_punches (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES attendance_devices(id) ON DELETE CASCADE,
  device_user_id TEXT NOT NULL,
  employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  punched_at TEXT NOT NULL,
  punch_type TEXT NOT NULL DEFAULT 'AUTO' CHECK(punch_type IN ('IN', 'OUT', 'AUTO')),
  verify_mode TEXT NOT NULL DEFAULT 'FINGERPRINT'
    CHECK(verify_mode IN ('FINGERPRINT', 'CARD', 'PASSWORD', 'FACE', 'OTHER')),
  raw TEXT NOT NULL DEFAULT '',
  processed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(device_id, device_user_id, punched_at)
);
CREATE INDEX IF NOT EXISTS idx_attendance_punches_employee_date
  ON attendance_punches(employee_id, punched_at);
CREATE INDEX IF NOT EXISTS idx_attendance_punches_device_date
  ON attendance_punches(device_id, punched_at);

-- 3) Provenance for attendance rows so device syncs never silently overwrite a manual edit.
ALTER TABLE employee_attendance ADD COLUMN source TEXT NOT NULL DEFAULT 'MANUAL'
  CHECK(source IN ('MANUAL', 'DEVICE', 'IMPORT'));
ALTER TABLE employee_attendance ADD COLUMN device_id TEXT REFERENCES attendance_devices(id);
ALTER TABLE employee_attendance ADD COLUMN check_in_punch_id TEXT REFERENCES attendance_punches(id);
ALTER TABLE employee_attendance ADD COLUMN check_out_punch_id TEXT REFERENCES attendance_punches(id);

-- 4) One-time data migrations that need application logic (ledger reversal/reposting).
CREATE TABLE IF NOT EXISTS data_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- 5) Least-privilege access to attendance devices. Administrators always receive every
--    permission through their role; accountants run attendance/payroll, branch managers
--    may inspect their own branch.
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES
  ('role_accountant', 'attendance_devices:view'),
  ('role_accountant', 'attendance_devices:manage'),
  ('role_gen_acc', 'attendance_devices:view'),
  ('role_gen_acc', 'attendance_devices:manage'),
  ('role_branch_mgr', 'attendance_devices:view');
