-- orqiva:foreign_keys=off
-- Migration 005: Returns, Credit Notes & Debit Notes
-- Allows documents to have types 'SALE_RETURN' (Credit Note) and 'PURCHASE_RETURN' (Debit Note),
-- and links return documents to an original posted invoice via original_document_id.

CREATE TABLE documents_new (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('SALE','PURCHASE','SALE_RETURN','PURCHASE_RETURN')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','POSTED','CANCELLED')),
  branch_id TEXT NOT NULL DEFAULT 'main' REFERENCES branches(id),
  party_id TEXT NOT NULL REFERENCES parties(id),
  original_document_id TEXT REFERENCES documents(id),
  date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  subtotal INTEGER NOT NULL CHECK(subtotal>=0),
  discount INTEGER NOT NULL DEFAULT 0 CHECK(discount>=0 AND discount<=subtotal),
  tax_rate INTEGER NOT NULL CHECK(tax_rate BETWEEN 0 AND 10000),
  tax INTEGER NOT NULL CHECK(tax>=0),
  total INTEGER NOT NULL CHECK(total=subtotal-discount+tax),
  paid INTEGER NOT NULL DEFAULT 0 CHECK(paid>=0 AND paid<=total),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

INSERT INTO documents_new(id,number,type,status,branch_id,party_id,original_document_id,date,due_date,subtotal,discount,tax_rate,tax,total,paid,notes,created_by,created_at)
  SELECT id,number,type,status,branch_id,party_id,NULL,date,due_date,subtotal,discount,tax_rate,tax,total,paid,notes,created_by,created_at
  FROM documents;

DROP TABLE documents;
ALTER TABLE documents_new RENAME TO documents;

CREATE INDEX idx_documents_type ON documents(type,status,date);
CREATE INDEX idx_documents_party ON documents(party_id);
CREATE INDEX idx_documents_branch ON documents(branch_id,type,status,date);
CREATE INDEX idx_documents_original ON documents(original_document_id);
