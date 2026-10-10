-- orqiva:foreign_keys=off
-- POS Shift Treasury Workflow: Handover, Review & Accounting Entries

CREATE TABLE pos_shifts_new (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'PENDING_REVIEW', 'CLOSED')),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  opening_cash INTEGER NOT NULL CHECK(opening_cash >= 0),
  expected_cash INTEGER NOT NULL DEFAULT 0,
  closing_cash INTEGER CHECK(closing_cash IS NULL OR closing_cash >= 0),
  difference INTEGER NOT NULL DEFAULT 0,
  cashier_declared_cash INTEGER CHECK(cashier_declared_cash IS NULL OR cashier_declared_cash >= 0),
  reviewed_by TEXT REFERENCES users(id),
  review_notes TEXT NOT NULL DEFAULT '',
  discrepancy_expense_id TEXT REFERENCES expenses(id),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

INSERT INTO pos_shifts_new(
  id, number, branch_id, user_id, status, opened_at, closed_at,
  opening_cash, expected_cash, closing_cash, difference,
  cashier_declared_cash, reviewed_by, review_notes, discrepancy_expense_id, notes, created_at
)
SELECT
  id, number, branch_id, user_id, status, opened_at, closed_at,
  opening_cash, expected_cash, closing_cash, difference,
  closing_cash, NULL, '', NULL, notes, created_at
FROM pos_shifts;

DROP TABLE pos_shifts;
ALTER TABLE pos_shifts_new RENAME TO pos_shifts;

CREATE INDEX idx_pos_shifts_branch ON pos_shifts(branch_id, status);
CREATE INDEX idx_pos_shifts_user ON pos_shifts(user_id, status);
