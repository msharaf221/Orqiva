/**
 * Per-company tax policy shared by the web client.
 *
 * The policy is configured per company (Settings > Company) and loaded once the
 * company row arrives. The default is tax-free, matching the server.
 */
export interface TaxPolicyInput {
  tax_mode?: string | null;
  eta_enabled?: number | boolean | null;
  payroll_tax_enabled?: number | boolean | null;
}

let vat = false;
let eta = false;
let payrollTax = false;

export function setTaxPolicy(c?: TaxPolicyInput | null): void {
  vat = c?.tax_mode === 'VAT';
  eta = vat && !!c?.eta_enabled;
  payrollTax = !!c?.payroll_tax_enabled;
}

/** True when VAT is off for this company. */
export function taxFree(): boolean {
  return !vat;
}

/** True when payroll income tax, martyrs fund and social insurance are off. */
export function payrollTaxFree(): boolean {
  return !payrollTax;
}

/** The ETA e-invoicing pipeline needs VAT and a tax identity. */
export function etaEnabled(): boolean {
  return eta;
}

/** One-time data migration marker stored in `data_migrations`. */
export const TAX_FREE_MIGRATION = 'tax_free_reset_v1';

/** Returns the rate that may actually be persisted. */
export function effectiveTaxRate(requested: number): number {
  return vat ? requested : 0;
}

/** Tax portion (piasters) contained in a tax-inclusive gross amount. */
export function taxInGross(gross: number, rate: number): number {
  return vat ? gross - Math.round((gross * 10000) / (10000 + rate)) : 0;
}

/** Computes tax in piasters from a pre-tax base and a basis-points rate. */
export function calculateTax(base: number, rate: number): number {
  return vat ? Math.round((base * rate) / 10000) : 0;
}
