-- Tax policy becomes a per-company setting instead of a global switch.
-- Defaults keep today's behavior: VAT off, ETA off, payroll tax off.
--   tax_mode           NONE = no VAT on documents; VAT = VAT at company.tax_rate
--   eta_enabled        e-invoicing to ETA (only effective when tax_mode = VAT)
--   payroll_tax_enabled social insurance, income tax and martyrs fund in payroll
ALTER TABLE company ADD COLUMN tax_mode TEXT NOT NULL DEFAULT 'NONE' CHECK(tax_mode IN ('NONE','VAT'));
ALTER TABLE company ADD COLUMN eta_enabled INTEGER NOT NULL DEFAULT 0 CHECK(eta_enabled IN (0,1));
ALTER TABLE company ADD COLUMN payroll_tax_enabled INTEGER NOT NULL DEFAULT 0 CHECK(payroll_tax_enabled IN (0,1));
