-- A product can carry several barcodes (EAN/UPC, supplier, pack). A barcode belongs to one product.
CREATE TABLE product_barcodes (
  barcode TEXT PRIMARY KEY COLLATE NOCASE,
  product_id TEXT NOT NULL REFERENCES products(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_product_barcodes_product ON product_barcodes(product_id);
