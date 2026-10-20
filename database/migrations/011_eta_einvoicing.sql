-- orqiva:foreign_keys=off
-- Migration 011: Egyptian Tax Authority (ETA) E-Invoicing Foundation
-- Lays the groundwork for UBL 2.1 e-invoice submission without requiring ETA sandbox
-- credentials yet. Adds the mandatory document UUID, an outbox/submission tracker with
-- retry bookkeeping, taxpayer identity fields on the company, and links credit/debit
-- notes to the e-invoice of the original sale.
--
-- The submission pipeline runs in "stub" mode until ETA_* secrets are configured; it is
-- designed so enabling real integration only requires supplying credentials in server/eta.ts.

-- 1. UBL 2.1 mandatory UUID (internal_code) per invoice + ETA business fields.
ALTER TABLE documents ADD COLUMN internal_code TEXT;
ALTER TABLE documents ADD COLUMN eta_status TEXT NOT NULL DEFAULT 'NOT_SUBMITTED';
ALTER TABLE documents ADD COLUMN eta_long_id TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX idx_documents_internal_code
  ON documents(internal_code) WHERE internal_code IS NOT NULL;
CREATE INDEX idx_documents_eta_status ON documents(eta_status);

-- Backfill UUIDs for every existing document so the constraint holds going forward.
UPDATE documents SET internal_code = lower(hex(randomblob(4))) || '-' ||
  lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' ||
  substr('89ab',abs(random()) % 4 + 1,1) || substr(lower(hex(randomblob(2))),2) || '-' ||
  lower(hex(randomblob(6)))
WHERE internal_code IS NULL;

-- 2. Submission outbox: one row per document submission attempt lifecycle.
CREATE TABLE e_invoice_submissions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  uuid TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'INVOICE',
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','SUBMITTED','VALID','INVALID','FAILED','CANCELLED')),
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT NOT NULL,
  submitted_at TEXT,
  completed_at TEXT,
  eta_long_id TEXT NOT NULL DEFAULT '',
  eta_response TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_einvoicedoc ON e_invoice_submissions(document_id);
CREATE INDEX idx_einvoicestatus ON e_invoice_submissions(status, next_attempt_at);

-- 3. Taxpayer identity fields required to build a compliant UBL payload.
ALTER TABLE company ADD COLUMN tax_registration_number TEXT NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN activity_code TEXT NOT NULL DEFAULT '';
ALTER TABLE company ADD COLUMN eta_environment TEXT NOT NULL DEFAULT 'stub'
  CHECK(eta_environment IN ('stub','preprod','production'));

-- 4. Credit/Debit notes reference the e-invoice of the original document.
ALTER TABLE documents ADD COLUMN reference_uuid TEXT NOT NULL DEFAULT '';

-- 5. Seed the new ETA permissions to the roles that operate e-invoicing.
--    Admin carries admin:all implicitly; accountants/external reviewers get read access to
--    submission status, and admin/accountant roles may retry failed submissions.
INSERT OR IGNORE INTO role_permissions(role_id, permission) VALUES
  ('role_gen_acc', 'eta:view'),
  ('role_gen_acc', 'eta:manage'),
  ('role_sales', 'eta:view'),
  ('role_cashier', 'eta:view');
