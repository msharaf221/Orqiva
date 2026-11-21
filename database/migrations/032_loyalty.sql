-- Loyalty points (add-on). Points are earned on POS sales and can be redeemed as a discount.
CREATE TABLE loyalty_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  -- Piasters of net sale value that earn 1 point (default 100.00 per point).
  earn_per INTEGER NOT NULL DEFAULT 10000 CHECK(earn_per>0),
  -- Piasters of discount one redeemed point is worth (default 1.00 per point).
  point_value INTEGER NOT NULL DEFAULT 100 CHECK(point_value>0)
);
INSERT INTO loyalty_settings(id) VALUES(1);
CREATE TABLE loyalty_ledger (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id),
  points INTEGER NOT NULL CHECK(points<>0),
  reason TEXT NOT NULL CHECK(reason IN ('EARN','REDEEM','REVERSAL','ADJUST')),
  document_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_loyalty_party ON loyalty_ledger(party_id, created_at);
