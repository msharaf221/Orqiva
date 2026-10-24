-- Migration 023: CRM hardening — branch isolation, lifecycle timestamps, activity priority,
-- reporting indexes, and role grants for the CRM module.

-- 1) Lifecycle timestamps ---------------------------------------------------------------
-- closed_at is set once when a deal reaches a won/lost stage and cleared if it is reopened.
ALTER TABLE crm_deals ADD COLUMN closed_at TEXT;

-- 2) Activities become first-class branch-scoped records ---------------------------------
-- Until now an activity without a deal had no branch at all, so it could not be authorized
-- or reported per branch. Backfill from the parent deal, then from the only existing branch.
ALTER TABLE crm_activities ADD COLUMN branch_id TEXT REFERENCES branches(id);
ALTER TABLE crm_activities ADD COLUMN updated_at TEXT;
ALTER TABLE crm_activities ADD COLUMN priority TEXT NOT NULL DEFAULT 'NORMAL'
  CHECK(priority IN ('LOW','NORMAL','HIGH','URGENT'));

UPDATE crm_activities
SET branch_id = COALESCE(
  (SELECT branch_id FROM crm_deals WHERE crm_deals.id = crm_activities.deal_id),
  'main'
);

UPDATE crm_activities SET updated_at = created_at WHERE updated_at IS NULL;

-- 3) Query indexes used by the pipeline board, activity inbox and branch reports ---------
CREATE INDEX IF NOT EXISTS idx_crm_deals_branch_status
  ON crm_deals(branch_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_deals_branch_stage
  ON crm_deals(branch_id, stage_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_close_date
  ON crm_deals(expected_close_date);
CREATE INDEX IF NOT EXISTS idx_crm_activities_branch_due
  ON crm_activities(branch_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_crm_activities_assignee_due
  ON crm_activities(assigned_to_user_id, status, due_date);

-- 3b) Existing won/lost deals get a close timestamp for cycle-time reporting.
UPDATE crm_deals SET closed_at = updated_at
WHERE status IN ('WON','LOST') AND closed_at IS NULL;

-- 3c) Seed the atomic sequences from existing human-readable codes so the next allocation
--     cannot collide with data created before this migration.
INSERT OR IGNORE INTO sequences(id, value)
SELECT 'DEAL', COALESCE(MAX(CAST(SUBSTR(code, 6) AS INTEGER)), 0)
FROM crm_deals
WHERE code LIKE 'DEAL-%';

INSERT OR IGNORE INTO sequences(id, value)
SELECT 'QTN-' || SUBSTR(number, 5, 4), MAX(CAST(SUBSTR(number, 10) AS INTEGER))
FROM quotations
WHERE number LIKE 'QTN-%'
GROUP BY SUBSTR(number, 5, 4);

-- 4) Role grants ------------------------------------------------------------------------
-- The CRM permission keys existed in the catalog but were never attached to a role, so
-- sales and branch managers could only reach the API through permission fallbacks while
-- the navigation item itself stayed hidden. Grant the intended capabilities explicitly.
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES
  ('role_sales', 'crm:view'),
  ('role_sales', 'crm:manage'),
  ('role_branch_mgr', 'crm:view'),
  ('role_branch_mgr', 'crm:manage'),
  ('role_accountant', 'crm:view'),
  ('role_gen_acc', 'crm:view'),
  ('role_viewer', 'crm:view');
