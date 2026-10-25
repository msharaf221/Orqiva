/**
 * Product-wide policy switches shared by the API and the web client.
 *
 * TAX_FREE removes VAT, payroll income tax, the martyrs fund, and social insurance.
 * New transactions are forced to zero in the service layer, and legacy rows are
 * recalculated once by `server/tax_free_reset.ts`.
 */
export const TAX_FREE = true;

/** The ETA e-invoicing pipeline depends on tax identity, so it is dormant in tax-free mode. */
export const ETA_ENABLED = false;

/** One-time data migration marker stored in `data_migrations`. */
export const TAX_FREE_MIGRATION = 'tax_free_reset_v1';

/** Returns the rate that may actually be persisted. */
export function effectiveTaxRate(requested: number): number {
  return TAX_FREE ? 0 : requested;
}

/** Computes tax in piasters from a pre-tax base and a basis-points rate. */
export function calculateTax(base: number, rate: number): number {
  return TAX_FREE ? 0 : Math.round((base * rate) / 10000);
}
