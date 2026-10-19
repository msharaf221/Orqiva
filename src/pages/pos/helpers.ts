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
