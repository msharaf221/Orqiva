import { all } from './db';
import type { ExpenseAllocation } from '../src/types';

/**
 * Splits `total` (integer piastres) proportionally to `weights` so the parts add back exactly.
 * Largest-remainder method: leftover piastres go to the largest fractional parts, ties by index.
 */
export function largestRemainder(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0)
    throw new Error('الإجمالي يجب أن يكون عدداً صحيحاً غير سالب');
  if (!weights.length) return [];
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0))
    throw new Error('الأوزان يجب أن تكون أعداداً صحيحة غير سالبة');
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) throw new Error('مجموع الأوزان يجب أن يكون أكبر من صفر');
  const T = BigInt(total);
  const W = BigInt(sum);
  const parts = weights.map((w) => {
    const product = T * BigInt(w);
    return { base: product / W, rest: product % W };
  });
  let leftover = T - parts.reduce((s, p) => s + p.base, 0n);
  const order = parts
    .map((_, index) => index)
    .sort((a, b) =>
      parts[b].rest > parts[a].rest ? 1 : parts[b].rest < parts[a].rest ? -1 : a - b,
    );
  for (const index of order) {
    if (leftover === 0n) break;
    parts[index].base += 1n;
    leftover -= 1n;
  }
  return parts.map((p) => Number(p.base));
}

const monthStart = (month: string) => `${month}-01`;
const monthEnd = (month: string) => {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
};

export interface AllocationRow {
  expense_id: string;
  title: string;
  category: string;
  date: string;
  allocation: ExpenseAllocation;
  branch_id: string;
  amount: number;
}

/**
 * Attributes every expense in [from, to] to branches.
 * - BRANCH: the whole amount goes to the branch that incurred it.
 * - EQUAL: split equally among branches open on the expense date.
 * - REVENUE: split by the branches' posted net sales in the expense's own month (equal split when
 *   that month has no sales). Using the expense month keeps each row stable across report ranges.
 * Rows always add back to the expense amount, so group totals never change with allocation.
 */
export function allocateExpenses(from: string, to: string): AllocationRow[] {
  const expenses = all<{
    id: string;
    title: string;
    category: string;
    amount: number;
    date: string;
    allocation: ExpenseAllocation;
    branch_id: string | null;
  }>(
    'SELECT id,title,category,amount,date,allocation,branch_id FROM expenses WHERE date BETWEEN ? AND ? ORDER BY date,created_at,id',
    from,
    to,
  );
  if (!expenses.length) return [];
  const branches = all<{ id: string; opened_on: string; closed_on: string | null }>(
    'SELECT id,opened_on,closed_on FROM branches ORDER BY opened_on,code',
  );
  const revenueMonths = expenses
    .filter((e) => e.allocation === 'REVENUE')
    .map((e) => e.date.slice(0, 7))
    .sort();
  const revenue = new Map<string, number>();
  if (revenueMonths.length) {
    const rows = all<{ month: string; branch_id: string; amount: number }>(
      "SELECT substr(date,1,7) month,branch_id,SUM(subtotal-discount) amount FROM documents WHERE type='SALE' AND status='POSTED' AND date BETWEEN ? AND ? GROUP BY month,branch_id",
      monthStart(revenueMonths[0]),
      monthEnd(revenueMonths[revenueMonths.length - 1]),
    );
    for (const row of rows) revenue.set(`${row.month}|${row.branch_id}`, row.amount);
  }
  const eligible = (date: string) => {
    const open = branches.filter(
      (b) => b.opened_on <= date && (!b.closed_on || b.closed_on >= date),
    );
    return open.length ? open : branches.slice(0, 1);
  };
  const result: AllocationRow[] = [];
  for (const e of expenses) {
    // A branch-specific expense without a branch cannot be attributed; spread it equally instead.
    if (e.allocation === 'BRANCH' && e.branch_id) {
      result.push({
        expense_id: e.id,
        title: e.title,
        category: e.category,
        date: e.date,
        allocation: 'BRANCH',
        branch_id: e.branch_id,
        amount: e.amount,
      });
      continue;
    }
    const basis: ExpenseAllocation = e.allocation === 'REVENUE' ? 'REVENUE' : 'EQUAL';
    const pool = eligible(e.date);
    const month = e.date.slice(0, 7);
    const revenueWeights = pool.map((b) => revenue.get(`${month}|${b.id}`) ?? 0);
    const useRevenue = basis === 'REVENUE' && revenueWeights.some((w) => w > 0);
    const parts = largestRemainder(e.amount, useRevenue ? revenueWeights : pool.map(() => 1));
    pool.forEach((b, index) => {
      if (parts[index] > 0)
        result.push({
          expense_id: e.id,
          title: e.title,
          category: e.category,
          date: e.date,
          allocation: useRevenue ? 'REVENUE' : 'EQUAL',
          branch_id: b.id,
          amount: parts[index],
        });
    });
  }
  return result;
}
