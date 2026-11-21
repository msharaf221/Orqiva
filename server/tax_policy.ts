import { one } from './db';

/**
 * Per-company tax policy. Read from the company row on every call so a change in
 * settings takes effect immediately and tests can flip it with one UPDATE.
 */
export interface TaxPolicy {
  /** VAT is charged on documents. */
  vat: boolean;
  /** E-invoicing to ETA. Needs VAT, because it depends on tax identity. */
  eta: boolean;
  /** Social insurance, income tax and martyrs fund in payroll. */
  payrollTax: boolean;
}

export function taxPolicy(): TaxPolicy {
  const row = one<{ tax_mode: string; eta_enabled: number; payroll_tax_enabled: number }>(
    'SELECT tax_mode, eta_enabled, payroll_tax_enabled FROM company WHERE id=1',
  );
  const vat = row?.tax_mode === 'VAT';
  return {
    vat,
    eta: vat && row?.eta_enabled === 1,
    payrollTax: row?.payroll_tax_enabled === 1,
  };
}

export const isTaxFree = (): boolean => !taxPolicy().vat;
export const etaEnabled = (): boolean => taxPolicy().eta;

/** Returns the rate that may actually be persisted for a document. */
export function effectiveTaxRate(requested: number): number {
  return taxPolicy().vat ? requested : 0;
}

/** Computes tax in piasters from a pre-tax base and a basis-points rate. */
export function calculateTax(base: number, rate: number): number {
  return taxPolicy().vat ? Math.round((base * rate) / 10000) : 0;
}

/** Net amount (piasters) of a tax-inclusive gross amount at a basis-points rate. */
export function netOfGross(gross: number, rate: number): number {
  return Math.round((gross * 10000) / (10000 + rate));
}
