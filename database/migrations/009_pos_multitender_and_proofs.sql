-- Migration 009: POS Multi-Tender Shift Closeout, Proof Documents & Treasury Audit
-- Supports full accounting reconciliation for Card/Visa and InstaPay/Bank alongside Cash,
-- with paper evidence tracking (POS terminal settlement batch slip, slip counts, safe envelope #, verification checklist).

ALTER TABLE pos_shifts ADD COLUMN expected_card INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pos_shifts ADD COLUMN expected_bank INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pos_shifts ADD COLUMN cashier_declared_card INTEGER;
ALTER TABLE pos_shifts ADD COLUMN cashier_declared_bank INTEGER;
ALTER TABLE pos_shifts ADD COLUMN closing_card INTEGER;
ALTER TABLE pos_shifts ADD COLUMN closing_bank INTEGER;
ALTER TABLE pos_shifts ADD COLUMN card_difference INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pos_shifts ADD COLUMN bank_difference INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pos_shifts ADD COLUMN terminal_batch_number TEXT NOT NULL DEFAULT '';
ALTER TABLE pos_shifts ADD COLUMN card_slips_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pos_shifts ADD COLUMN bank_transfers_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pos_shifts ADD COLUMN safe_envelope_number TEXT NOT NULL DEFAULT '';
ALTER TABLE pos_shifts ADD COLUMN proof_documents TEXT NOT NULL DEFAULT '';
ALTER TABLE pos_shifts ADD COLUMN verification_checklist TEXT NOT NULL DEFAULT '';
