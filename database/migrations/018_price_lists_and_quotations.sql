-- Migration 018: Price Lists, Customer Tiers, Quotations & Proforma Invoices (Phase 3)

CREATE TABLE price_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  discount_basis_pts INTEGER NOT NULL DEFAULT 0 CHECK(discount_basis_pts >= 0 AND discount_basis_pts <= 10000),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE price_list_items (
  id TEXT PRIMARY KEY,
  price_list_id TEXT NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  min_quantity INTEGER NOT NULL DEFAULT 1 CHECK(min_quantity >= 1),
  price INTEGER NOT NULL CHECK(price >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(price_list_id, product_id, min_quantity)
);
CREATE INDEX idx_price_list_items_lookup ON price_list_items(price_list_id, product_id);

CREATE TABLE party_price_tiers (
  party_id TEXT PRIMARY KEY REFERENCES parties(id) ON DELETE CASCADE,
  price_list_id TEXT NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE
);

CREATE TABLE quotations (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('QUOTATION','PROFORMA')),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  party_id TEXT NOT NULL REFERENCES parties(id),
  date TEXT NOT NULL,
  valid_until TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','CONVERTED','REJECTED','EXPIRED')),
  subtotal INTEGER NOT NULL DEFAULT 0 CHECK(subtotal >= 0),
  discount INTEGER NOT NULL DEFAULT 0 CHECK(discount >= 0),
  tax_rate INTEGER NOT NULL DEFAULT 1400,
  tax INTEGER NOT NULL DEFAULT 0 CHECK(tax >= 0),
  total INTEGER NOT NULL DEFAULT 0 CHECK(total >= 0),
  converted_document_id TEXT REFERENCES documents(id),
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_quotations_party ON quotations(party_id);
CREATE INDEX idx_quotations_branch ON quotations(branch_id);

CREATE TABLE quotation_lines (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_price INTEGER NOT NULL CHECK(unit_price >= 0),
  total INTEGER NOT NULL CHECK(total >= 0),
  notes TEXT
);
CREATE INDEX idx_quotation_lines_quotation ON quotation_lines(quotation_id);

-- Seed standard system price tiers
INSERT OR IGNORE INTO price_lists(id, name, code, discount_basis_pts, is_active, is_default, notes, created_at)
VALUES
  ('pl-retail', 'سعر قطاعي (افتراضي)', 'RETAIL', 0, 1, 1, 'سعر البيع الافتراضي للمستهلك', '2026-01-01T00:00:00.000Z'),
  ('pl-wholesale', 'سعر جملة', 'WHOLESALE', 1000, 1, 0, 'خصم جملة 10% أو تسعير مخصص', '2026-01-01T00:00:00.000Z'),
  ('pl-distributor', 'سعر كبار الموزعين', 'DISTRIBUTOR', 1500, 1, 0, 'خصم موزعين 15%', '2026-01-01T00:00:00.000Z');
