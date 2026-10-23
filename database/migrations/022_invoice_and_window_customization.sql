-- Migration 022: Invoice & Window Customization Engine
-- Adds comprehensive branding, template selection, toggleable elements, and bank details to company settings.

ALTER TABLE company ADD COLUMN invoice_settings TEXT NOT NULL DEFAULT '{}';
