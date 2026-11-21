import { all, id, now, one, run } from '../../db';
import { AppError } from '../../errors';
import { isAddonEnabled } from '../../addons/registry';

export interface LoyaltySettings {
  enabled: boolean;
  earn_per: number;
  point_value: number;
}

const WALK_IN = 'walk-in-customer';

export function loyaltySettings(): LoyaltySettings {
  const r = one<{ enabled: number; earn_per: number; point_value: number }>(
    'SELECT enabled, earn_per, point_value FROM loyalty_settings WHERE id=1',
  )!;
  return { enabled: r.enabled === 1, earn_per: r.earn_per, point_value: r.point_value };
}

/** Settings when the program is on (add-on enabled and switched on), otherwise null. */
export function activeLoyalty(): LoyaltySettings | null {
  if (!isAddonEnabled('loyalty')) return null;
  const s = loyaltySettings();
  return s.enabled ? s : null;
}

export const isLoyaltyParty = (partyId: string): boolean => partyId !== WALK_IN;

export function pointsBalance(partyId: string): number {
  return (
    one<{ b: number }>(
      'SELECT COALESCE(SUM(points),0) b FROM loyalty_ledger WHERE party_id=?',
      partyId,
    )?.b ?? 0
  );
}

function add(
  partyId: string,
  points: number,
  reason: 'EARN' | 'REDEEM' | 'REVERSAL' | 'ADJUST',
  documentId: string | null,
  note = '',
): void {
  if (points === 0) return;
  run(
    'INSERT INTO loyalty_ledger(id,party_id,points,reason,document_id,note,created_at) VALUES(?,?,?,?,?,?,?)',
    id(),
    partyId,
    points,
    reason,
    documentId,
    note,
    now(),
  );
}

/** Validates a redemption and returns the discount (piasters) it is worth. Call inside the sale transaction. */
export function redemptionDiscount(partyId: string, points: number): number {
  if (points <= 0) return 0;
  const s = activeLoyalty();
  if (!s) throw new AppError(400, 'برنامج نقاط الولاء غير مفعّل');
  if (!isLoyaltyParty(partyId)) throw new AppError(400, 'اختر عميلاً مسجلاً لاستبدال النقاط');
  if (points > pointsBalance(partyId))
    throw new AppError(409, 'رصيد النقاط لا يكفي للاستبدال المطلوب');
  return points * s.point_value;
}

export function recordRedeem(partyId: string, points: number, documentId: string): void {
  if (points > 0) add(partyId, -points, 'REDEEM', documentId, 'استبدال نقاط في بيع');
}

/** Awards points on a posted sale's net total. Walk-in sales earn nothing. */
export function recordEarn(partyId: string, total: number, documentId: string): number {
  const s = activeLoyalty();
  if (!s || !isLoyaltyParty(partyId)) return 0;
  const points = Math.floor(total / s.earn_per);
  add(partyId, points, 'EARN', documentId, 'نقاط من بيع');
  return points;
}

/** Takes back the points earned on a refunded amount, never below a zero balance. */
export function reverseEarn(partyId: string, refundTotal: number, documentId: string): void {
  const s = activeLoyalty();
  if (!s || !isLoyaltyParty(partyId)) return;
  const points = Math.min(Math.floor(refundTotal / s.earn_per), pointsBalance(partyId));
  add(partyId, -points, 'REVERSAL', documentId, 'عكس نقاط مرتجع');
}

export function adjustPoints(partyId: string, points: number, note: string): void {
  if (points < 0 && -points > pointsBalance(partyId))
    throw new AppError(409, 'التعديل يجعل الرصيد سالباً');
  add(partyId, points, 'ADJUST', null, note);
}

export function ledgerFor(partyId: string) {
  return all<{
    id: string;
    points: number;
    reason: string;
    document_id: string | null;
    note: string;
    created_at: string;
  }>(
    'SELECT id, points, reason, document_id, note, created_at FROM loyalty_ledger WHERE party_id=? ORDER BY created_at DESC, rowid DESC LIMIT 200',
    partyId,
  );
}
