-- Company currency becomes a setting. Migration 001 pinned it to EGP with a CHECK,
-- which SQLite cannot drop, so the company table is rebuilt with the same columns.
CREATE TABLE company_new (
  id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '', tax_number TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'EGP' CHECK(length(currency)=3 AND currency=upper(currency)),
  tax_rate INTEGER NOT NULL DEFAULT 1400 CHECK(tax_rate BETWEEN 0 AND 10000), invoice_note TEXT NOT NULL DEFAULT '',
  tax_registration_number TEXT NOT NULL DEFAULT '', activity_code TEXT NOT NULL DEFAULT '',
  eta_environment TEXT NOT NULL DEFAULT 'stub' CHECK(eta_environment IN ('stub','preprod','production')),
  invoice_settings TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO company_new(id,name,email,phone,address,tax_number,currency,tax_rate,invoice_note,tax_registration_number,activity_code,eta_environment,invoice_settings)
  SELECT id,name,email,phone,address,tax_number,currency,tax_rate,invoice_note,tax_registration_number,activity_code,eta_environment,invoice_settings FROM company;
DROP TABLE company;
ALTER TABLE company_new RENAME TO company;
