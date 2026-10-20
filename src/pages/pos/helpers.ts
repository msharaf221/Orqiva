import type { Product, Party } from '../../types';

export interface PosProduct extends Product {
  stock: number;
}

export interface CartItem {
  product: PosProduct;
  quantity: number;
  unit_price: number;
}

export interface CheckoutResult {
  document: {
    id: string;
    number: string;
    date: string;
    total: number;
    subtotal: number;
    discount: number;
    tax: number;
    tax_rate: number;
    notes?: string;
    internal_code?: string;
  };
  lines?: {
    id?: string;
    name: string;
    sku?: string;
    quantity: number;
    unit_price: number;
    total: number;
  }[];
  payment: {
    method: string;
    amount_paid: number;
    amount_tendered?: number;
    change_due: number;
    reference?: string;
    splits?: Array<{ method: string; amount: number; reference?: string }>;
  };
}

export const DEFAULT_WALK_IN_CUSTOMER: Party = {
  id: 'walk-in-customer',
  name: 'عميل نقدي (طائر)',
  type: 'CUSTOMER',
  email: '',
  phone: '—',
  address: '',
  tax_number: '',
  notes: '',
  balance: 0,
  documents_count: 0,
  active: 1,
  created_at: new Date().toISOString(),
};

export function playSound(success = true) {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = success ? 1050 : 320;
    osc.type = success ? 'sine' : 'sawtooth';
    gain.gain.value = 0.08;
    osc.start();
    osc.stop(ctx.currentTime + (success ? 0.09 : 0.22));
  } catch {
    // Audio might not be available or permitted
  }
}

export interface StockShortage {
  product_id: string;
  name: string;
  available: number;
  requested: number;
}

/**
 * Pure comparison of a cart against freshly-fetched branch availability.
 * Used to detect a product that was sold on another till while this cart was open
 * (the server still rejects overselling, but only at post time — this surfaces the
 * conflict to the cashier before the payment form is submitted).
 */
export function findStockShortages(
  lines: { product_id: string; name: string; quantity: number }[],
  availability: { id: string; stock: number; name: string }[],
): StockShortage[] {
  const byId = new Map(availability.map((p) => [p.id, p]));
  const shortages: StockShortage[] = [];
  for (const line of lines) {
    const product = byId.get(line.product_id);
    if (!product) {
      shortages.push({
        product_id: line.product_id,
        name: line.name,
        available: 0,
        requested: line.quantity,
      });
      continue;
    }
    if (product.stock < line.quantity) {
      shortages.push({
        product_id: line.product_id,
        name: product.name || line.name,
        available: product.stock,
        requested: line.quantity,
      });
    }
  }
  return shortages;
}
