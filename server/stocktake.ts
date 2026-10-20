/**
 * Periodic Stocktake engine (جرد دوري).
 *
 * Workflow:
 *  1. `startStocktake` freezes a branch's current stock into a DRAFT session with one
 *     line per active/listed product, snapshotting expected quantity and WAC.
 *  2. The counting user records `counted_qty` per line (`saveCounts`).
 *  3. `submitStocktake` moves the session to SUBMITTED for review.
 *  4. `approveStocktake` posts the variance of every counted line as a stock movement
 *     (reason «تسوية جرد دوري #number») and, optionally, recommends an approval note.
 *     Line and session are stamped with the approving user and time.
 *  5. `cancelStocktake` abandons a session that was never approved.
 *
 * Stock is only ever changed at approval, through the same `moveStock` primitive used by
 * sales, purchases and manual adjustments — so WAC, cost movements and audit stay consistent.
 */

import { all, one, run, transaction, id, now } from './db';
import { AppError } from './errors';
import { audit, moveStock, branchStock } from './service';
import { nextNumber } from './service';
import { writableBranch, type Actor, type Scope, scopeSql } from './scope';
import { stocktakeSubmitSchema, stocktakeCountsSchema } from './validation';
import type { StocktakeSession, StocktakeLine } from '../src/types';

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  cost_price: number;
}

/** Opens a new DRAFT stocktake for a branch, snapshotting every sellable product. */
export function startStocktake(raw: unknown, actor: Actor): StocktakeSession {
  const input = stocktakeSubmitSchema.parse(raw);
  const branch = writableBranch(actor, input.branch_id);

  return transaction(() => {
    const sessionId = id();
    const number = nextNumber(`INV-COUNT-${branch.code}`, new Date().toISOString().slice(0, 4));
    run(
      `INSERT INTO stocktake_sessions(id,number,branch_id,status,notes,counted_by,created_at)
       VALUES(?,?,?, 'DRAFT', ?, ?, ?)`,
      sessionId,
      number,
      branch.id,
      input.notes || '',
      actor.id,
      now(),
    );

    const products = all<ProductRow>(
      `SELECT p.id,p.sku,p.name,p.unit,p.cost_price
       FROM products p
       LEFT JOIN branch_products bp ON bp.product_id=p.id AND bp.branch_id=?
       WHERE p.active=1 AND COALESCE(bp.active,1)=1
       ORDER BY p.name`,
      branch.id,
    );

    const insert = `INSERT INTO stocktake_lines(id,session_id,product_id,product_name,sku,unit,expected_qty,counted_qty,unit_cost)
       VALUES(?,?,?,?,?,?,?,NULL,?)`;
    for (const p of products) {
      const wac = one<{ avg_cost: number }>(
        'SELECT avg_cost FROM branch_cost WHERE branch_id=? AND product_id=?',
        branch.id,
        p.id,
      );
      run(
        insert,
        id(),
        sessionId,
        p.id,
        p.name,
        p.sku,
        p.unit,
        branchStock(branch.id, p.id),
        wac?.avg_cost && wac.avg_cost > 0 ? wac.avg_cost : p.cost_price,
      );
    }

    audit(actor, 'بدء جرد دوري', 'STOCKTAKE', sessionId, `${number} · ${branch.name}`);
    return requireSession(sessionId);
  });
}

export interface StocktakeView extends StocktakeSession {
  branch_name: string;
  counted_by_name: string;
  approved_by_name: string | null;
  lines_count: number;
  variance_lines: number;
  variance_value: number;
}

function requireSession(sessionId: string): StocktakeSession {
  const session = one<StocktakeSession>('SELECT * FROM stocktake_sessions WHERE id=?', sessionId);
  if (!session) throw new AppError(404, 'جلسة الجرد غير موجودة');
  return session;
}

export function getStocktake(sessionId: string): StocktakeView {
  const session = requireSession(sessionId);
  const meta = one<{ name: string }>('SELECT name FROM branches WHERE id=?', session.branch_id);
  const countedBy = one<{ name: string }>('SELECT name FROM users WHERE id=?', session.counted_by);
  const approvedBy = session.approved_by
    ? one<{ name: string }>('SELECT name FROM users WHERE id=?', session.approved_by)
    : undefined;
  const stats = one<{ lines_count: number; variance_lines: number; variance_value: number }>(
    `SELECT COUNT(id) lines_count,
            COALESCE(SUM(CASE WHEN counted_qty IS NOT NULL AND counted_qty<>expected_qty THEN 1 ELSE 0 END),0) variance_lines,
            COALESCE(SUM(CASE WHEN counted_qty IS NOT NULL THEN (counted_qty-expected_qty)*unit_cost ELSE 0 END),0) variance_value
     FROM stocktake_lines WHERE session_id=?`,
    sessionId,
  );
  return {
    ...session,
    branch_name: meta?.name || '',
    counted_by_name: countedBy?.name || '',
    approved_by_name: approvedBy?.name ?? null,
    lines_count: stats?.lines_count ?? 0,
    variance_lines: stats?.variance_lines ?? 0,
    variance_value: stats?.variance_value ?? 0,
  };
}

export function listStocktakes(scope: Scope, branchId?: string): StocktakeView[] {
  const f = scopeSql('s.branch_id', scope);
  const clauses = [f.sql];
  const params: (string | number)[] = [...f.params];
  if (branchId) {
    clauses.push('s.branch_id=?');
    params.push(branchId);
  }
  return all<StocktakeView>(
    `SELECT s.*, b.name branch_name, u.name counted_by_name, a.name approved_by_name,
            (SELECT COUNT(id) FROM stocktake_lines WHERE session_id=s.id) lines_count,
            (SELECT COALESCE(SUM(CASE WHEN counted_qty IS NOT NULL AND counted_qty<>expected_qty THEN 1 ELSE 0 END),0)
             FROM stocktake_lines WHERE session_id=s.id) variance_lines,
            (SELECT COALESCE(SUM(CASE WHEN counted_qty IS NOT NULL THEN (counted_qty-expected_qty)*unit_cost ELSE 0 END),0)
             FROM stocktake_lines WHERE session_id=s.id) variance_value
     FROM stocktake_sessions s
     JOIN branches b ON b.id=s.branch_id
     JOIN users u ON u.id=s.counted_by
     LEFT JOIN users a ON a.id=s.approved_by
     WHERE ${clauses.join(' AND ')}
     ORDER BY s.created_at DESC LIMIT 200`,
    ...params,
  );
}

export function stocktakeLines(sessionId: string): StocktakeLine[] {
  requireSession(sessionId);
  return all<StocktakeLine>(
    'SELECT * FROM stocktake_lines WHERE session_id=? ORDER BY product_name',
    sessionId,
  );
}

/** Saves counted quantities (and clears a count when `counted_qty` is null). */
export function saveCounts(sessionId: string, raw: unknown, actor: Actor): StocktakeView {
  const input = stocktakeCountsSchema.parse(raw);
  const session = requireSession(sessionId);
  writableBranch(actor, session.branch_id);
  if (session.status !== 'DRAFT') throw new AppError(409, 'لا يمكن تعديل جرد بعد تسليمه للمراجعة');

  transaction(() => {
    const ts = now();
    for (const line of input.counts) {
      const row = one<{ id: string }>(
        'SELECT id FROM stocktake_lines WHERE id=? AND session_id=?',
        line.line_id,
        sessionId,
      );
      if (!row) throw new AppError(404, 'بند جرد غير موجود في هذه الجلسة');
      run(
        'UPDATE stocktake_lines SET counted_qty=?, counted_at=? WHERE id=?',
        line.counted_qty,
        line.counted_qty === null ? null : ts,
        line.line_id,
      );
    }
    run(
      'UPDATE stocktake_sessions SET notes=? WHERE id=?',
      input.notes ?? session.notes,
      sessionId,
    );
  });
  return getStocktake(sessionId);
}

/** Moves a DRAFT session to SUBMITTED, requiring every line to be counted. */
export function submitStocktake(sessionId: string, actor: Actor): StocktakeView {
  const session = requireSession(sessionId);
  writableBranch(actor, session.branch_id);
  if (session.status !== 'DRAFT') throw new AppError(409, 'الجرد ليس في مرحلة العد');
  const uncounted = one<{ n: number }>(
    'SELECT COUNT(id) n FROM stocktake_lines WHERE session_id=? AND counted_qty IS NULL',
    sessionId,
  );
  if ((uncounted?.n ?? 0) > 0)
    throw new AppError(409, `يجب عدّ جميع البنود قبل التسليم (متبقي ${uncounted?.n})`);
  transaction(() => {
    run(
      "UPDATE stocktake_sessions SET status='SUBMITTED', submitted_at=? WHERE id=?",
      now(),
      sessionId,
    );
    audit(actor, 'تسليم جرد للمراجعة', 'STOCKTAKE', sessionId, session.number);
  });
  return getStocktake(sessionId);
}

/** Approves a SUBMITTED session and posts every non-zero variance as a stock movement. */
export function approveStocktake(sessionId: string, actor: Actor): StocktakeView {
  const session = requireSession(sessionId);
  writableBranch(actor, session.branch_id);
  if (session.status !== 'SUBMITTED') throw new AppError(409, 'لا يمكن اعتماد جرد قبل تسليمه');

  transaction(() => {
    const lines = all<StocktakeLine>('SELECT * FROM stocktake_lines WHERE session_id=?', sessionId);
    for (const line of lines) {
      if (line.counted_qty === null) continue;
      const delta = line.counted_qty - line.expected_qty;
      if (delta === 0) continue;
      moveStock({
        branchId: session.branch_id,
        productId: line.product_id,
        delta,
        reason: `تسوية جرد دوري ${session.number}`,
        actor,
        unitCost: delta > 0 ? line.unit_cost : undefined,
      });
    }
    run(
      "UPDATE stocktake_sessions SET status='APPROVED', approved_by=?, approved_at=? WHERE id=?",
      actor.id,
      now(),
      sessionId,
    );
    audit(actor, 'اعتماد جرد دوري', 'STOCKTAKE', sessionId, session.number);
  });
  return getStocktake(sessionId);
}

/** Cancels a session that has not been approved (posting nothing to stock). */
export function cancelStocktake(sessionId: string, actor: Actor): StocktakeView {
  const session = requireSession(sessionId);
  writableBranch(actor, session.branch_id);
  if (session.status === 'APPROVED') throw new AppError(409, 'لا يمكن إلغاء جرد معتمد');
  transaction(() => {
    run("UPDATE stocktake_sessions SET status='CANCELLED' WHERE id=?", sessionId);
    audit(actor, 'إلغاء جرد دوري', 'STOCKTAKE', sessionId, session.number);
  });
  return getStocktake(sessionId);
}

export interface ReorderSuggestion {
  product_id: string;
  sku: string;
  name: string;
  unit: string;
  branch_id: string;
  branch_name: string;
  stock: number;
  min_stock: number;
  /** Units needed to reach a comfortable target (2× min_stock, at least min_stock+1). */
  suggested_qty: number;
  cost_price: number;
  avg_cost: number;
  /** Estimated purchase cost of the suggested quantity. */
  estimated_cost: number;
  /** True when stock is at or below the reorder threshold. */
  below_threshold: boolean;
}

/**
 * Reorder suggestions: every (branch, product) whose stock is at or below `min_stock`,
 * with a suggested top-up quantity and its estimated purchase cost.
 */
export function reorderSuggestions(scope: Scope, branchId?: string): ReorderSuggestion[] {
  const f = scopeSql('bs.branch_id', scope);
  const clauses = [f.sql];
  const params: (string | number)[] = [...f.params];
  if (branchId) {
    clauses.push('bs.branch_id=?');
    params.push(branchId);
  }
  const rows = all<{
    product_id: string;
    sku: string;
    name: string;
    unit: string;
    branch_id: string;
    branch_name: string;
    stock: number;
    min_stock: number;
    cost_price: number;
    avg_cost: number;
  }>(
    `SELECT p.id product_id, p.sku, p.name, p.unit,
            bs.branch_id, b.name branch_name,
            bs.quantity stock,
            COALESCE(bp.min_stock, p.min_stock) min_stock,
            p.cost_price,
            COALESCE(NULLIF(bc.avg_cost,0), p.cost_price) avg_cost
     FROM branch_stock bs
     JOIN products p ON p.id=bs.product_id
     JOIN branches b ON b.id=bs.branch_id
     LEFT JOIN branch_products bp ON bp.branch_id=bs.branch_id AND bp.product_id=bs.product_id
     LEFT JOIN branch_cost bc ON bc.branch_id=bs.branch_id AND bc.product_id=bs.product_id
     WHERE p.active=1 AND COALESCE(bp.active,1)=1 AND ${clauses.join(' AND ')}
       AND bs.quantity <= COALESCE(bp.min_stock, p.min_stock)`,
    ...params,
  );
  return rows
    .map((r) => {
      const target = Math.max(r.min_stock * 2, r.min_stock + 1);
      const suggested = Math.max(target - r.stock, 1);
      const unitCost = r.avg_cost > 0 ? r.avg_cost : r.cost_price;
      return {
        product_id: r.product_id,
        sku: r.sku,
        name: r.name,
        unit: r.unit,
        branch_id: r.branch_id,
        branch_name: r.branch_name,
        stock: r.stock,
        min_stock: r.min_stock,
        suggested_qty: suggested,
        cost_price: r.cost_price,
        avg_cost: unitCost,
        estimated_cost: suggested * unitCost,
        below_threshold: true,
      };
    })
    .sort((a, b) => b.estimated_cost - a.estimated_cost);
}
