-- Migration 024: universal branch isolation and least-privilege payroll access
--
-- 1) Cheques were only tagged with a free-text bank branch name, so they could not be
--    scoped, reported, or authorized per company branch. Add the real branch owner and
--    backfill from the collection account; fall back to HQ for historical rows.
ALTER TABLE cheques ADD COLUMN branch_id TEXT REFERENCES branches(id);

UPDATE cheques
SET branch_id = COALESCE(
  (SELECT ca.branch_id FROM cash_accounts ca WHERE ca.id = cheques.cash_account_id),
  (SELECT id FROM branches WHERE id = 'main'),
  (SELECT id FROM branches ORDER BY code LIMIT 1)
)
WHERE branch_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_cheques_branch ON cheques(branch_id);

-- 2) Payroll and HR reads no longer ride on the broad `finance:view` permission.
--    Accountants run and approve payroll; branch managers may view their own branch.
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES
  ('role_accountant', 'hr:view'),
  ('role_accountant', 'hr:manage'),
  ('role_gen_acc', 'hr:view'),
  ('role_gen_acc', 'hr:manage'),
  ('role_branch_mgr', 'hr:view');
