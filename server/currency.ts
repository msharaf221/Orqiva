import { one } from './db';
import { currencySymbol, DEFAULT_CURRENCY } from '../src/currency';

/** The company's currency label (e.g. ج.م), for messages and audit text. */
export function currencyLabel(): string {
  const row = one<{ currency: string }>('SELECT currency FROM company WHERE id=1');
  return currencySymbol(row?.currency ?? DEFAULT_CURRENCY);
}
