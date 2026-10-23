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

import { all, one, run, id, now } from './db';
import { type Actor, type Scope, scopeSql } from './scope';
import type { ProductValuationRow, StockValuationResponse, CostMovement } from '../src/types';

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

export function upsertBranchCost(
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

export function insertCostMovement(opts: {
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

// ---------------------------------------------------------------------------
// Pack 2.1: Stock Valuation & WAC Cost History
// ---------------------------------------------------------------------------

export function getStockValuation(
  scope: Scope,
  branchId?: string | null,
  category?: string | null,
  stockFilter?: string | null,
): StockValuationResponse {
  const asOf = new Date().toISOString().slice(0, 10);
  let branchName: string | null = null;
  if (branchId && branchId !== 'all') {
    const b = one<{ name: string }>('SELECT name FROM branches WHERE id=?', branchId);
    branchName = b?.name ?? null;
  }

  const isSpecificBranch = Boolean(branchId && branchId !== 'all');
  let rows: ProductValuationRow[] = [];

  if (isSpecificBranch) {
    const raw = all<{
      product_id: string;
      sku: string;
      name: string;
      category: string;
      unit: string;
      branch_id: string;
      branch_name: string;
      branch_code: string;
      quantity: number;
      avg_cost: number;
      ref_cost: number;
      sale_price: number;
      updated_at: string | null;
    }>(
      `SELECT 
         p.id as product_id,
         p.sku,
         p.name,
         p.category,
         p.unit,
         b.id as branch_id,
         b.name as branch_name,
         b.code as branch_code,
         COALESCE(bs.quantity, 0) as quantity,
         COALESCE(bc.avg_cost, 0) as avg_cost,
         p.cost_price as ref_cost,
         COALESCE(bp.sale_price, p.sale_price) as sale_price,
         bc.updated_at
       FROM products p
       CROSS JOIN branches b ON b.id = ?
       LEFT JOIN branch_products bp ON bp.product_id = p.id AND bp.branch_id = b.id
       LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = b.id
       LEFT JOIN branch_cost bc ON bc.product_id = p.id AND bc.branch_id = b.id
       WHERE p.active = 1
       ORDER BY p.name ASC`,
      branchId!,
    );

    rows = raw.map((r) => {
      const unitCost = r.avg_cost > 0 ? r.avg_cost : r.ref_cost;
      const totalCost = r.quantity > 0 ? r.quantity * unitCost : 0;
      const totalRetail = r.quantity > 0 ? r.quantity * r.sale_price : 0;
      const potentialProfit = totalRetail - totalCost;
      const marginPercent =
        totalRetail > 0 ? Math.round(((totalRetail - totalCost) / totalRetail) * 10000) / 100 : 0;

      return {
        product_id: r.product_id,
        sku: r.sku,
        name: r.name,
        category: r.category,
        unit: r.unit,
        branch_id: r.branch_id,
        branch_name: r.branch_name,
        branch_code: r.branch_code,
        quantity: r.quantity,
        unit_cost: unitCost,
        total_cost: totalCost,
        sale_price: r.sale_price,
        total_retail: totalRetail,
        potential_profit: potentialProfit,
        margin_percent: marginPercent,
        last_cost_update: r.updated_at,
      };
    });
  } else {
    // Consolidated enterprise view across visible branches
    const branchFilter = scopeSql('bs.branch_id', scope);
    const raw = all<{
      product_id: string;
      sku: string;
      name: string;
      category: string;
      unit: string;
      quantity: number;
      total_val: number;
      ref_cost: number;
      sale_price: number;
      last_update: string | null;
    }>(
      `SELECT 
         p.id as product_id,
         p.sku,
         p.name,
         p.category,
         p.unit,
         p.cost_price as ref_cost,
         p.sale_price,
         COALESCE(SUM(bs.quantity), 0) as quantity,
         COALESCE(SUM(CASE WHEN bs.quantity > 0 THEN bs.quantity * COALESCE(NULLIF(bc.avg_cost, 0), p.cost_price) ELSE 0 END), 0) as total_val,
         MAX(bc.updated_at) as last_update
       FROM products p
       LEFT JOIN branch_stock bs ON bs.product_id = p.id AND ${branchFilter.sql}
       LEFT JOIN branch_cost bc ON bc.product_id = bs.product_id AND bc.branch_id = bs.branch_id
       WHERE p.active = 1
       GROUP BY p.id
       ORDER BY p.name ASC`,
      ...branchFilter.params,
    );

    rows = raw.map((r) => {
      const unitCost = r.quantity > 0 ? Math.round(r.total_val / r.quantity) : r.ref_cost;
      const totalCost = r.total_val;
      const totalRetail = r.quantity > 0 ? r.quantity * r.sale_price : 0;
      const potentialProfit = totalRetail - totalCost;
      const marginPercent =
        totalRetail > 0 ? Math.round(((totalRetail - totalCost) / totalRetail) * 10000) / 100 : 0;

      return {
        product_id: r.product_id,
        sku: r.sku,
        name: r.name,
        category: r.category,
        unit: r.unit,
        branch_id: null,
        branch_name: 'كافة الفروع',
        branch_code: 'ALL',
        quantity: r.quantity,
        unit_cost: unitCost,
        total_cost: totalCost,
        sale_price: r.sale_price,
        total_retail: totalRetail,
        potential_profit: potentialProfit,
        margin_percent: marginPercent,
        last_cost_update: r.last_update,
      };
    });
  }

  // Extract distinct categories before filtering
  const categories = Array.from(new Set(rows.map((r) => r.category)))
    .filter(Boolean)
    .sort();

  // Apply filters
  if (category && category !== 'all') {
    rows = rows.filter((r) => r.category === category);
  }

  if (stockFilter === 'in_stock') {
    rows = rows.filter((r) => r.quantity > 0);
  } else if (stockFilter === 'out_of_stock') {
    rows = rows.filter((r) => r.quantity === 0);
  } else if (stockFilter === 'negative') {
    rows = rows.filter((r) => r.quantity < 0);
  }

  // Summary
  let totalProducts = 0;
  let totalQty = 0;
  let totalCostVal = 0;
  let totalRetailVal = 0;

  for (const r of rows) {
    totalProducts++;
    if (r.quantity > 0) {
      totalQty += r.quantity;
      totalCostVal += r.total_cost;
      totalRetailVal += r.total_retail;
    }
  }

  const totalPotentialProfit = totalRetailVal - totalCostVal;
  const overallMarginPercent =
    totalRetailVal > 0 ? Math.round((totalPotentialProfit / totalRetailVal) * 10000) / 100 : 0;

  // GL Inventory Reconciliation (acc_inventory / system_key: 'INVENTORY' / code: 1140)
  const glAccount = one<{ id: string; code: string; name: string }>(
    "SELECT id, code, name FROM chart_of_accounts WHERE system_key = 'INVENTORY' LIMIT 1",
  ) ?? { id: '', code: '1140', name: 'بضاعة المخزن' };

  let glFilterSql = '1=1';
  const glParams: (string | number)[] = [];
  if (isSpecificBranch) {
    glFilterSql = 'COALESCE(l.branch_id, e.branch_id) = ?';
    glParams.push(branchId!);
  } else if (scope.ids?.length) {
    glFilterSql = `COALESCE(l.branch_id, e.branch_id) IN (${scope.ids.map(() => '?').join(',')})`;
    glParams.push(...scope.ids);
  }

  const glBalRow = one<{ total_debit: number; total_credit: number }>(
    `SELECT 
       COALESCE(SUM(l.debit), 0) as total_debit,
       COALESCE(SUM(l.credit), 0) as total_credit
     FROM journal_lines l
     JOIN journal_entries e ON e.id = l.entry_id
     WHERE l.account_id = ?
       AND e.status IN ('POSTED', 'REVERSED')
       AND ${glFilterSql}`,
    glAccount.id,
    ...glParams,
  );

  const glInventoryBalance = (glBalRow?.total_debit ?? 0) - (glBalRow?.total_credit ?? 0);
  const variance = totalCostVal - glInventoryBalance;
  const reconciled = variance === 0;

  return {
    branch_id: branchId ?? null,
    branch_name: branchName,
    as_of: asOf,
    rows,
    summary: {
      total_products: totalProducts,
      total_quantity: totalQty,
      total_inventory_cost: totalCostVal,
      total_inventory_retail: totalRetailVal,
      total_potential_profit: totalPotentialProfit,
      overall_margin_percent: overallMarginPercent,
    },
    gl_check: {
      gl_inventory_balance: glInventoryBalance,
      stock_valuation_total: totalCostVal,
      variance,
      reconciled,
      account_code: glAccount.code,
      account_name: glAccount.name,
    },
    categories,
  };
}

export function getProductCostHistory(
  productId: string,
  branchId?: string | null,
  scope?: Scope,
): CostMovement[] {
  let branchFilterSql = '1=1';
  const params: (string | number)[] = [productId];

  if (branchId && branchId !== 'all') {
    branchFilterSql = 'cm.branch_id = ?';
    params.push(branchId);
  } else if (scope?.ids?.length) {
    branchFilterSql = `cm.branch_id IN (${scope.ids.map(() => '?').join(',')})`;
    params.push(...scope.ids);
  }

  return all<CostMovement>(
    `SELECT 
       cm.id,
       cm.branch_id,
       b.name as branch_name,
       cm.product_id,
       p.name as product_name,
       p.sku,
       cm.delta_qty,
       cm.unit_cost,
       cm.avg_before,
       cm.avg_after,
       cm.reason,
       cm.document_id,
       cm.transfer_id,
       u.name as user_name,
       cm.created_at
     FROM cost_movements cm
     JOIN products p ON p.id = cm.product_id
     JOIN branches b ON b.id = cm.branch_id
     JOIN users u ON u.id = cm.created_by
     WHERE cm.product_id = ?
       AND ${branchFilterSql}
     ORDER BY cm.created_at DESC, cm.rowid DESC
     LIMIT 200`,
    ...params,
  );
}
