ALTER TABLE payments ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX idx_payment_request_key ON payments(request_key) WHERE request_key IS NOT NULL;
