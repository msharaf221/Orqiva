/**
 * Weighted Average Cost (WAC) engine.
 *
 * Rules:
 *  - On PURCHASE receipt: new WAC = (old_value + qty * purchase_unit_cost) / new_qty
 *  - On SALE post: WAC is read and snapshotted into document_lines.cost_price; no WAC change.
 *  - On TRANSFER ship: WAC stays in the sending branch (stock just decreases, value decreases
 *    proportionally so avg stays the same).
 *  - On TRANSFER receive: new WAC = (old_value + qty * transferred_unit_cost) / new_qty
 *  - On ADJUSTMENT (increase): treated like a purchase at the product reference cost.
 *  - On ADJUSTMENT (decrease): WAC unchanged (value decreases proportionally).
 *
 * All functions must run INSIDE an existing transaction.
 */

import { one, run, id, now } from './db';
import type { Actor } from './scope';

type CostRow = { avg_cost: number; total_value: number };

/** Returns the current WAC row for (branch, product), or a zero row. */
export function getBranchCost(branchId: string, productId: string): CostRow {
  return (
    one<CostRow>(
      'SELECT avg_cost, total_value FROM branch_cost WHERE branch_id=? AND product_id=?',
      branchId,
      productId,
    ) ?? { avg_cost: 0, total_value: 0 }
  );
}

/**
 * Returns the best unit cost to use for COGS:
 *  - WAC from branch_cost if available (> 0)
 *  - otherwise falls back to the product's reference cost_price
 */
export function effectiveCost(branchId: string, productId: string): number {
  const row = getBranchCost(branchId, productId);
  if (row.avg_cost > 0) return row.avg_cost;
  // Fallback to reference cost
  return (
    one<{ cost_price: number }>('SELECT cost_price FROM products WHERE id=?', productId)
      ?.cost_price ?? 0
  );
}

/**
 * Updates the WAC when receiving new stock (purchase or transfer-in).
 * new_avg = (old_total_value + qty * unit_cost) / (old_qty + qty)
 *
 * @param branchId   - receiving branch
 * @param productId  - product
 * @param qty        - units being added (positive)
 * @param unitCost   - cost per unit of the incoming batch
 * @param reason     - human-readable reason (e.g. 'شراء', 'استلام تحويل')
 * @param actor      - user performing the action
 * @param documentId - optional: purchase document
 * @param transferId - optional: transfer document
 */
export function recordCostIn(opts: {
  branchId: string;
  productId: string;
  qty: number;
  unitCost: number;
  currentQty: number; // qty BEFORE this movement (already written to branch_stock if called after moveStock)
  reason: string;
  actor: Pick<Actor, 'id'>;
  documentId?: string | null;
  transferId?: string | null;
}) {
  const { branchId, productId, qty, unitCost, reason, actor, documentId, transferId } = opts;
  const existing = getBranchCost(branchId, productId);
  const avgBefore = existing.avg_cost;

  // Recalculate: old_value + incoming_value / new_qty
  const oldValue = existing.total_value;
  const incomingValue = qty * unitCost;
  const newQty = opts.currentQty; // already the post-movement qty
  const newAvg = newQty > 0 ? Math.round((oldValue + incomingValue) / newQty) : 0;
  const newValue = newAvg * newQty;

  upsertBranchCost(branchId, productId, newAvg, newValue);
  insertCostMovement({
    branchId,
    productId,
    deltaQty: qty,
    unitCost,
    avgBefore,
    avgAfter: newAvg,
    reason,
    actor,
    documentId,
    transferId,
  });
}

/**
 * Updates the total_value when stock leaves (sale or transfer-out).
 * The avg_cost itself doesn't change when units leave; only total_value shrinks.
 *
 * @param currentQty - qty AFTER the movement (negative delta already applied)
 */
export function recordCostOut(opts: {
  branchId: string;
  productId: string;
  qty: number; // positive number of units leaving
  currentQty: number; // qty AFTER movement
  reason: string;
  actor: Pick<Actor, 'id'>;
  documentId?: string | null;
  transferId?: string | null;
}) {
  const { branchId, productId, qty, reason, actor, documentId, transferId } = opts;
  const existing = getBranchCost(branchId, productId);
  const avgBefore = existing.avg_cost;
  const newQty = opts.currentQty;
  const newValue = avgBefore * newQty;

  upsertBranchCost(branchId, productId, avgBefore, newValue);
  insertCostMovement({
    branchId,
    productId,
    deltaQty: -qty,
    unitCost: avgBefore,
    avgBefore,
    avgAfter: avgBefore, // avg unchanged on outflow
    reason,
    actor,
    documentId,
    transferId,
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function upsertBranchCost(
  branchId: string,
  productId: string,
  avgCost: number,
  totalValue: number,
) {
  run(
    `INSERT INTO branch_cost(branch_id, product_id, avg_cost, total_value, updated_at)
     VALUES(?,?,?,?,?)
     ON CONFLICT(branch_id, product_id)
     DO UPDATE SET avg_cost=excluded.avg_cost, total_value=excluded.total_value, updated_at=excluded.updated_at`,
    branchId,
    productId,
    avgCost,
    totalValue,
    now(),
  );
}

function insertCostMovement(opts: {
  branchId: string;
  productId: string;
  deltaQty: number;
  unitCost: number;
  avgBefore: number;
  avgAfter: number;
  reason: string;
  actor: Pick<Actor, 'id'>;
  documentId?: string | null;
  transferId?: string | null;
}) {
  run(
    `INSERT INTO cost_movements(id,branch_id,product_id,delta_qty,unit_cost,avg_before,avg_after,reason,document_id,transfer_id,created_by,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    id(),
    opts.branchId,
    opts.productId,
    opts.deltaQty,
    opts.unitCost,
    opts.avgBefore,
    opts.avgAfter,
    opts.reason,
    opts.documentId ?? null,
    opts.transferId ?? null,
    opts.actor.id,
    now(),
  );
}
