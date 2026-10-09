CREATE TABLE users (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'STAFF' CHECK(role IN ('ADMIN','STAFF')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL
);
CREATE TABLE sessions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
CREATE TABLE company (
 id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
 address TEXT NOT NULL DEFAULT '', tax_number TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT 'EGP' CHECK(currency='EGP'),
 tax_rate INTEGER NOT NULL DEFAULT 1400 CHECK(tax_rate BETWEEN 0 AND 10000), invoice_note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE parties (
 id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('CUSTOMER','SUPPLIER')), name TEXT NOT NULL,
 email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
 tax_number TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL
);
CREATE INDEX idx_parties_type ON parties(type, active);
CREATE TABLE products (
 id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'عام',
 unit TEXT NOT NULL DEFAULT 'قطعة', sale_price INTEGER NOT NULL CHECK(sale_price>=0), cost_price INTEGER NOT NULL CHECK(cost_price>=0),
 stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0), min_stock INTEGER NOT NULL DEFAULT 5 CHECK(min_stock>=0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL
);
CREATE TABLE sequences (id TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);
CREATE TABLE documents (
 id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, type TEXT NOT NULL CHECK(type IN ('SALE','PURCHASE')),
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','POSTED','CANCELLED')), party_id TEXT NOT NULL REFERENCES parties(id),
 date TEXT NOT NULL, due_date TEXT NOT NULL, subtotal INTEGER NOT NULL CHECK(subtotal>=0), discount INTEGER NOT NULL DEFAULT 0 CHECK(discount>=0 AND discount<=subtotal),
 tax_rate INTEGER NOT NULL CHECK(tax_rate BETWEEN 0 AND 10000), tax INTEGER NOT NULL CHECK(tax>=0), total INTEGER NOT NULL CHECK(total=subtotal-discount+tax),
 paid INTEGER NOT NULL DEFAULT 0 CHECK(paid>=0 AND paid<=total), notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX idx_documents_type ON documents(type,status,date);
CREATE INDEX idx_documents_party ON documents(party_id);
CREATE TABLE document_lines (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id),
 name TEXT NOT NULL, sku TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), unit_price INTEGER NOT NULL CHECK(unit_price>=0),
 cost_price INTEGER NOT NULL CHECK(cost_price>=0), total INTEGER NOT NULL CHECK(total=quantity*unit_price), UNIQUE(document_id,product_id)
);
CREATE TABLE payments (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), amount INTEGER NOT NULL CHECK(amount>0),
 method TEXT NOT NULL CHECK(method IN ('CASH','BANK','CARD')), date TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX idx_payments_document ON payments(document_id);
CREATE INDEX idx_payments_date ON payments(date);
CREATE TABLE stock_movements (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), document_id TEXT REFERENCES documents(id),
 quantity INTEGER NOT NULL CHECK(quantity<>0), reason TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX idx_stock_product ON stock_movements(product_id,created_at);
CREATE TABLE expenses (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), date TEXT NOT NULL,
 method TEXT NOT NULL CHECK(method IN ('CASH','BANK','CARD')), notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX idx_expenses_date ON expenses(date);
CREATE TABLE audit_logs (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), user_name TEXT NOT NULL, action TEXT NOT NULL,
 entity TEXT NOT NULL, entity_id TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_date ON audit_logs(created_at);
INSERT INTO company(id,name,email,phone,address,tax_number,currency,tax_rate,invoice_note)
 VALUES(1,'شركة أوركيفا للتجارة','hello@orqiva.local','010 1234 5678','القاهرة، مصر','','EGP',1400,'شكراً لثقتكم بنا. نسعد دائماً بخدمتكم.');
