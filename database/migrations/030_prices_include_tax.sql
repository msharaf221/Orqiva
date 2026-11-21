-- Default entry mode for new sales and POS: 1 = entered prices already include VAT.
ALTER TABLE company ADD COLUMN prices_include_tax INTEGER NOT NULL DEFAULT 0 CHECK(prices_include_tax IN (0,1));
