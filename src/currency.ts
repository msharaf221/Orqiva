/**
 * Currencies an installation can use. Amounts are always stored as integer
 * minor units (piasters/cents); the currency only changes the label shown to
 * people. There is no conversion: pick the currency before entering data.
 */
export const CURRENCIES: { code: string; name: string; symbol: string }[] = [
  { code: 'EGP', name: 'الجنيه المصري', symbol: 'ج.م' },
  { code: 'SAR', name: 'الريال السعودي', symbol: 'ر.س' },
  { code: 'AED', name: 'الدرهم الإماراتي', symbol: 'د.إ' },
  { code: 'KWD', name: 'الدينار الكويتي', symbol: 'د.ك' },
  { code: 'QAR', name: 'الريال القطري', symbol: 'ر.ق' },
  { code: 'BHD', name: 'الدينار البحريني', symbol: 'د.ب' },
  { code: 'OMR', name: 'الريال العماني', symbol: 'ر.ع' },
  { code: 'JOD', name: 'الدينار الأردني', symbol: 'د.أ' },
  { code: 'USD', name: 'الدولار الأمريكي', symbol: '$' },
  { code: 'EUR', name: 'اليورو', symbol: '€' },
];

export const DEFAULT_CURRENCY = 'EGP';

export function currencySymbol(code: string | null | undefined): string {
  const found = CURRENCIES.find((c) => c.code === code);
  return found ? found.symbol : code || 'ج.م';
}

let activeCurrency = DEFAULT_CURRENCY;

/** Called once the company loads, before any money is rendered. */
export function setActiveCurrency(code: string | null | undefined): void {
  activeCurrency = code || DEFAULT_CURRENCY;
}

/** The label to print next to amounts, e.g. ج.م. */
export function cur(): string {
  return currencySymbol(activeCurrency);
}
