-- Migration 016: Warehouse Bins, Locations & Barcode Stocktake
--
-- Adds structured warehouse locations (Aisle, Rack, Shelf, Bin) per branch
-- and maps products to primary/secondary warehouse locations for fast picking and barcode scanning.

CREATE TABLE warehouse_locations (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  aisle TEXT NOT NULL DEFAULT '',
  rack TEXT NOT NULL DEFAULT '',
  shelf TEXT NOT NULL DEFAULT '',
  bin TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE(branch_id, code)
);

CREATE INDEX idx_warehouse_loc_branch ON warehouse_locations(branch_id, active);

CREATE TABLE product_locations (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES warehouse_locations(id) ON DELETE CASCADE,
  is_primary INTEGER NOT NULL DEFAULT 1 CHECK(is_primary IN (0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(product_id, location_id)
);

CREATE INDEX idx_prod_loc_product ON product_locations(product_id);
CREATE INDEX idx_prod_loc_location ON product_locations(location_id);
