-- Migration 012: POS Parked Sales (Hold/Resume) & Return-to-Shift linking
--
-- 1. pos_parked_sales lets a cashier suspend an in-progress cart (interrupted customer,
--    price check, manager call) and resume it later without losing the basket. The cart is
--    serialised as JSON so the shape can evolve without schema churn.
--
-- 2. documents.pos_shift_id is extended to SALE_RETURN rows so a cashier's shift summary
--    can net refunds against cash collected (previously returns were invisible to the shift).

CREATE TABLE pos_parked_sales (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  shift_id TEXT REFERENCES pos_shifts(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL DEFAULT '',
  customer_id TEXT REFERENCES parties(id),
  label_discount INTEGER NOT NULL DEFAULT 0 CHECK(label_discount>=0),
  cart TEXT NOT NULL DEFAULT '[]',
  total INTEGER NOT NULL DEFAULT 0 CHECK(total>=0),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_parked_branch ON pos_parked_sales(branch_id, created_at);
CREATE INDEX idx_parked_user ON pos_parked_sales(user_id, created_at);
