-- Migration 015: Batch & Expiry Date Tracking (أرقام التشغيلات وتواريخ الصلاحية)
--
-- Enables pharmaceutical, food, chemical, and retail operations to track stock batches
-- with production & expiry dates, enforcing First-Expired, First-Out (FEFO) dispensing
-- and preventing the sale of expired inventory.

-- 1. Table for product batch tracking configuration (preserves products table schema for legacy queries)
CREATE TABLE product_batch_settings (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  track_batches INTEGER NOT NULL DEFAULT 0 CHECK(track_batches IN (0,1))
);

-- 2. Stock batches table: maintains per-branch on-hand quantities and expiry dates
CREATE TABLE stock_batches (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  batch_number TEXT NOT NULL,
  production_date TEXT,
  expiry_date TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  cost_price INTEGER NOT NULL DEFAULT 0 CHECK(cost_price >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(branch_id, product_id, batch_number)
);
CREATE INDEX idx_batches_product_branch ON stock_batches(product_id, branch_id);
CREATE INDEX idx_batches_expiry ON stock_batches(branch_id, expiry_date);

-- 3. Link document lines and stock movements to specific batches
ALTER TABLE document_lines ADD COLUMN batch_id TEXT REFERENCES stock_batches(id);
ALTER TABLE document_lines ADD COLUMN batch_number TEXT;
ALTER TABLE document_lines ADD COLUMN expiry_date TEXT;

ALTER TABLE stock_movements ADD COLUMN batch_id TEXT REFERENCES stock_batches(id);
