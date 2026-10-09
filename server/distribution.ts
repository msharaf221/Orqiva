import { z } from 'zod';
import { all, one, run, transaction, id, now } from './db';
import { distributionPaymentSchema, distributionSchema } from './validation';
import { AppError, audit, nextNumber, requireRow, type Actor } from './service';
import { largestRemainder } from './allocation';
import { branchResults } from './reports';
import { cashBalance, egp, SHARE_TOTAL } from './owners';
import type { BranchResult, Distribution, DistributionPreview } from '../src/types';

/** Statutory-style reserve taken from positive profit before anything reaches owners (5%). */
export const DEFAULT_RESERVE_BPS = 500;

/**
 * Pure calculation of a profit distribution for a period. Nothing is written here, so the same
 * function drives the live simulator, the stored draft and the re-check before approval.
 *
 * Group net profit = sales − cost of goods − every expense (branch-specific and shared).
 * Losses in one branch offset profits in another; the reserve is taken only from a positive total.
 */
export function computePeriod(
  from: string,
  to: string,
  reserveBps: number,
): Omit<DistributionPreview, 'overlap'> {
  const branches: BranchResult[] = [...branchResults(from, to).values()].filter(
    (r) => r.sales || r.cost || r.expenses,
  );
  const netProfit = branches.reduce((s, r) => s + r.net, 0);
  const reserve = netProfit > 0 ? Math.floor((netProfit * reserveBps) / 10000) : 0;
  const distributable = Math.max(0, netProfit - reserve);
  const owners = all<{ id: string; name: string; share_bps: number }>(
    'SELECT id,name,share_bps FROM owners WHERE active=1 ORDER BY created_at,id',
  );
  const shareTotal = owners.reduce((s, o) => s + o.share_bps, 0);
  const amounts =
    shareTotal === SHARE_TOTAL && distributable > 0
      ? largestRemainder(
          distributable,
          owners.map((o) => o.share_bps),
        )
      : owners.map(() => 0);
  const cash = cashBalance();
  return {
    period_from: from,
    period_to: to,
    reserve_bps: reserveBps,
    branches,
    netProfit,
    reserve,
    distributable,
    shareTotal,
    cashAvailable: cash,
    uncovered: Math.max(0, distributable - cash),
    lines: owners.map((o, index) => ({
      owner_id: o.id,
      owner_name: o.name,
      share_bps: o.share_bps,
      amount: amounts[index],
    })),
  };
}

export function previewDistribution(raw: unknown): DistributionPreview {
  const input = distributionSchema.parse(raw);
  const clash = overlapping(input.period_from, input.period_to);
  return {
    ...computePeriod(input.period_from, input.period_to, input.reserve_bps),
    overlap: clash ? { number: clash.number } : null,
  };
}

function overlapping(from: string, to: string, excludingId = '') {
  return one<{ number: string }>(
    "SELECT number FROM distributions WHERE status<>'CANCELLED' AND period_from<=? AND period_to>=? AND id<>?",
    to,
    from,
    excludingId,
  );
}

export function distributionDetail(distributionId: string): Distribution {
  const distribution = requireRow(
    one<Distribution>('SELECT * FROM distributions WHERE id=?', distributionId),
  );
  const lines = all<NonNullable<Distribution['lines']>[number]>(
    'SELECT id,owner_id,owner_name,share_bps,amount,paid FROM distribution_lines WHERE distribution_id=? ORDER BY share_bps DESC,owner_name',
    distributionId,
  );
  const payments = all<NonNullable<Distribution['payments']>[number]>(
    `SELECT p.id,p.line_id,l.owner_name,p.amount,p.method,p.date,p.reference
     FROM distribution_payments p JOIN distribution_lines l ON l.id=p.line_id
     WHERE l.distribution_id=? ORDER BY p.date DESC,p.created_at DESC`,
    distributionId,
  );
  const snapshot = JSON.parse(distribution.snapshot || '{}') as { branches?: BranchResult[] };
  return { ...distribution, lines, payments, breakdown: snapshot.branches ?? [] };
}

export function listDistributions() {
  return all<Distribution & { paid_total: number }>(
    `SELECT d.*,COALESCE((SELECT SUM(l.paid) FROM distribution_lines l WHERE l.distribution_id=d.id),0) paid_total
     FROM distributions d ORDER BY d.period_to DESC,d.created_at DESC`,
  );
}

/** Freezes the calculation as a draft. Periods may not overlap a live distribution. */
export function createDistribution(raw: unknown, actor: Actor) {
  const input = distributionSchema.parse(raw);
  return transaction(() => {
    const clash = overlapping(input.period_from, input.period_to);
    if (clash)
      throw new AppError(
        409,
        `الفترة تتداخل مع التوزيع ${clash.number}؛ ألغِه أو اختر فترة مختلفة`,
      );
    const preview = computePeriod(input.period_from, input.period_to, input.reserve_bps);
    if (preview.shareTotal !== SHARE_TOTAL)
      throw new AppError(409, 'مجموع نسب الملاك يجب أن يساوي ١٠٠٪ قبل التوزيع');
    if (preview.distributable <= 0)
      throw new AppError(409, 'لا توجد أرباح قابلة للتوزيع في هذه الفترة');
    const distributionId = id();
    const number = nextNumber('DIST', input.period_to.slice(0, 4));
    run(
      "INSERT INTO distributions(id,number,period_from,period_to,status,reserve_bps,net_profit,reserve_amount,distributable,snapshot,notes,created_by,created_at) VALUES(?,?,?,?,'DRAFT',?,?,?,?,?,?,?,?)",
      distributionId,
      number,
      input.period_from,
      input.period_to,
      input.reserve_bps,
      preview.netProfit,
      preview.reserve,
      preview.distributable,
      JSON.stringify({ branches: preview.branches }),
      input.notes,
      actor.id,
      now(),
    );
    for (const line of preview.lines)
      run(
        'INSERT INTO distribution_lines(id,distribution_id,owner_id,owner_name,share_bps,amount,paid) VALUES(?,?,?,?,?,?,0)',
        id(),
        distributionId,
        line.owner_id,
        line.owner_name,
        line.share_bps,
        line.amount,
      );
    audit(
      actor,
      'إنشاء توزيع أرباح',
      'DISTRIBUTION',
      distributionId,
      `${number} · ${egp(preview.distributable)} ج.م`,
    );
    return distributionDetail(distributionId);
  });
}

/**
 * Approval re-runs the calculation. If a sale was posted, cancelled or re-priced in the period,
 * or the owner list changed, the draft is stale and must be replaced instead of approved.
 */
export function approveDistribution(distributionId: string, actor: Actor) {
  return transaction(() => {
    const distribution = requireRow(
      one<Distribution>('SELECT * FROM distributions WHERE id=?', distributionId),
    );
    if (distribution.status !== 'DRAFT') throw new AppError(409, 'هذا التوزيع ليس مسودة');
    const fresh = computePeriod(
      distribution.period_from,
      distribution.period_to,
      distribution.reserve_bps,
    );
    const stored = all<{ owner_id: string; amount: number }>(
      'SELECT owner_id,amount FROM distribution_lines WHERE distribution_id=?',
      distributionId,
    );
    const unchanged =
      fresh.shareTotal === SHARE_TOTAL &&
      fresh.netProfit === distribution.net_profit &&
      fresh.distributable === distribution.distributable &&
      fresh.lines.length === stored.length &&
      fresh.lines.every((l) =>
        stored.some((s) => s.owner_id === l.owner_id && s.amount === l.amount),
      );
    if (!unchanged)
      throw new AppError(
        409,
        'تغيّرت أرقام الفترة أو نسب الملاك منذ إنشاء المسودة؛ ألغِ المسودة وأنشئ توزيعاً جديداً',
      );
    run(
      "UPDATE distributions SET status='APPROVED',approved_by=?,approved_at=? WHERE id=?",
      actor.id,
      now(),
      distributionId,
    );
    audit(actor, 'اعتماد توزيع أرباح', 'DISTRIBUTION', distributionId, distribution.number);
    return distributionDetail(distributionId);
  });
}

export function cancelDistribution(distributionId: string, actor: Actor) {
  return transaction(() => {
    const distribution = requireRow(
      one<Distribution>('SELECT * FROM distributions WHERE id=?', distributionId),
    );
    if (distribution.status === 'CANCELLED') throw new AppError(409, 'التوزيع ملغى بالفعل');
    if (distribution.status === 'PAID')
      throw new AppError(409, 'تم صرف التوزيع بالكامل ولا يمكن إلغاؤه');
    if (
      distribution.status === 'APPROVED' &&
      one(
        'SELECT 1 FROM distribution_payments p JOIN distribution_lines l ON l.id=p.line_id WHERE l.distribution_id=?',
        distributionId,
      )
    )
      throw new AppError(409, 'لا يمكن إلغاء توزيع عليه صرفيات مسجلة');
    run("UPDATE distributions SET status='CANCELLED' WHERE id=?", distributionId);
    audit(actor, 'إلغاء توزيع أرباح', 'DISTRIBUTION', distributionId, distribution.number);
    return distributionDetail(distributionId);
  });
}

/**
 * Pays one partner's share. Payments are partial-capable like invoice payments, are capped at the
 * amount still owed, and cannot take the group's cash below zero.
 */
export function payDistribution(
  distributionId: string,
  raw: unknown,
  actor: Actor,
  requestKey?: string,
) {
  const input = distributionPaymentSchema.parse(raw);
  const key = z.string().uuid().optional().parse(requestKey);
  return transaction(() => {
    if (key) {
      const previous = one<{
        line_id: string;
        amount: number;
        method: string;
        date: string;
        reference: string;
      }>(
        'SELECT line_id,amount,method,date,reference FROM distribution_payments WHERE request_key=?',
        key,
      );
      if (previous) {
        if (
          previous.line_id !== input.line_id ||
          previous.amount !== input.amount ||
          previous.method !== input.method ||
          previous.date !== input.date ||
          previous.reference !== input.reference
        )
          throw new AppError(409, 'مفتاح الطلب مستخدم لصرف مختلف');
        return distributionDetail(distributionId);
      }
    }
    const distribution = requireRow(
      one<Distribution>('SELECT * FROM distributions WHERE id=?', distributionId),
    );
    if (distribution.status === 'DRAFT') throw new AppError(409, 'اعتمد التوزيع أولاً قبل الصرف');
    if (distribution.status !== 'APPROVED')
      throw new AppError(409, 'لا يمكن الصرف على توزيع بهذه الحالة');
    const line = requireRow(
      one<{ id: string; owner_name: string; amount: number; paid: number }>(
        'SELECT id,owner_name,amount,paid FROM distribution_lines WHERE id=? AND distribution_id=?',
        input.line_id,
        distributionId,
      ),
    );
    const due = line.amount - line.paid;
    if (input.amount > due)
      throw new AppError(400, `المبلغ أكبر من المستحق لـ ${line.owner_name} (${egp(due)} ج.م)`);
    const cash = cashBalance();
    if (input.amount > cash)
      throw new AppError(409, `الرصيد النقدي المتاح (${egp(cash)} ج.م) لا يكفي لصرف هذا المبلغ`);
    run(
      'INSERT INTO distribution_payments(id,line_id,amount,method,date,reference,request_key,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      id(),
      line.id,
      input.amount,
      input.method,
      input.date,
      input.reference,
      key || null,
      actor.id,
      now(),
    );
    run('UPDATE distribution_lines SET paid=paid+? WHERE id=?', input.amount, line.id);
    const open = one<{ open: number }>(
      'SELECT COALESCE(SUM(amount-paid),0) open FROM distribution_lines WHERE distribution_id=?',
      distributionId,
    )!.open;
    if (open === 0)
      run("UPDATE distributions SET status='PAID',paid_at=? WHERE id=?", now(), distributionId);
    audit(
      actor,
      'صرف توزيع أرباح',
      'DISTRIBUTION',
      distributionId,
      `${line.owner_name} · ${egp(input.amount)} ج.م`,
    );
    return distributionDetail(distributionId);
  });
}
