/**
 * Batch & Expiry Date Management (إدارة أرقام التشغيلات وتواريخ الصلاحية).
 *
 * Implements:
 *  - Batch tracking per branch and product.
 *  - First-Expired, First-Out (FEFO) automated allocation.
 *  - Expired batch isolation (prevents sale of expired goods).
 *  - Expiry alert reporting (critical < 30 days, warning 30-90 days, healthy).
 */

import { all, one, run, id, now } from './db';
import { AppError } from './errors';
import type { Scope } from './scope';
import type { StockBatch, ExpiryAlertResponse, BatchExpiryStatus } from '../src/types';

/**
 * Calculates days to expiry and categorical status based on today's date.
 */
export function computeBatchStatus(expiryDate: string): {
  daysToExpiry: number;
  status: BatchExpiryStatus;
} {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate + 'T00:00:00Z');
  const diffTime = expiry.getTime() - today.getTime();
  const daysToExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  let status: BatchExpiryStatus = 'HEALTHY';
  if (daysToExpiry < 0) {
    status = 'EXPIRED';
  } else if (daysToExpiry <= 30) {
    status = 'CRITICAL';
  } else if (daysToExpiry <= 90) {
    status = 'WARNING';
  }

  return { daysToExpiry, status };
}

/**
 * Lists all active batches for a single product in a specific branch.
 */
export function getProductBatches(productId: string, branchId: string): StockBatch[] {
  const rows = all<{
    id: string;
    product_id: string;
    branch_id: string;
    batch_number: string;
    production_date: string | null;
    expiry_date: string;
    quantity: number;
    cost_price: number;
    created_at: string;
    product_name: string;
    sku: string;
    category: string;
    unit: string;
    branch_name: string;
    branch_code: string;
    sale_price: number;
  }>(
    `SELECT b.*, p.name AS product_name, p.sku, p.category, p.unit, p.sale_price,
            br.name AS branch_name, br.code AS branch_code
     FROM stock_batches b
     JOIN products p ON p.id = b.product_id
     JOIN branches br ON br.id = b.branch_id
     WHERE b.product_id = ? AND b.branch_id = ?
     ORDER BY b.expiry_date ASC, b.created_at ASC`,
    productId,
    branchId,
  );

  return rows.map((r) => {
    const { daysToExpiry, status } = computeBatchStatus(r.expiry_date);
    return {
      ...r,
      days_to_expiry: daysToExpiry,
      status,
    };
  });
}

/**
 * Computes expiry alerts summary and list of batches across branches in scope.
 */
export function getExpiryAlerts(
  scope: Scope,
  branchId?: string | null,
  category?: string,
  statusFilter?: string,
): ExpiryAlertResponse {
  const isSpecificBranch = branchId && branchId !== 'all';
  const branchClause = isSpecificBranch
    ? 'b.branch_id = ?'
    : scope.ids?.length
      ? `b.branch_id IN (${scope.ids.map(() => '?').join(',')})`
      : '1=1';

  const branchParams = isSpecificBranch ? [branchId!] : scope.ids?.length ? scope.ids : [];

  let catSql = '1=1';
  const catParams: string[] = [];
  if (category && category !== 'all') {
    catSql = 'p.category = ?';
    catParams.push(category);
  }

  const rows = all<{
    id: string;
    product_id: string;
    branch_id: string;
    batch_number: string;
    production_date: string | null;
    expiry_date: string;
    quantity: number;
    cost_price: number;
    created_at: string;
    product_name: string;
    sku: string;
    category: string;
    unit: string;
    branch_name: string;
    branch_code: string;
    sale_price: number;
  }>(
    `SELECT b.*, p.name AS product_name, p.sku, p.category, p.unit, p.sale_price,
            br.name AS branch_name, br.code AS branch_code
     FROM stock_batches b
     JOIN products p ON p.id = b.product_id
     JOIN branches br ON br.id = b.branch_id
     WHERE ${branchClause} AND ${catSql} AND b.quantity > 0
     ORDER BY b.expiry_date ASC, p.name ASC`,
    ...branchParams,
    ...catParams,
  );

  const categories = [...new Set(rows.map((r) => r.category))];

  let expiredCount = 0;
  let expiredQuantity = 0;
  let expiredValue = 0;

  let criticalCount = 0;
  let criticalQuantity = 0;
  let criticalValue = 0;

  let warningCount = 0;
  let warningQuantity = 0;
  let warningValue = 0;

  let healthyCount = 0;
  let totalQuantity = 0;
  let totalValue = 0;

  const processedBatches: StockBatch[] = [];

  for (const r of rows) {
    const { daysToExpiry, status } = computeBatchStatus(r.expiry_date);
    const val = r.quantity * r.cost_price;

    totalQuantity += r.quantity;
    totalValue += val;

    if (status === 'EXPIRED') {
      expiredCount++;
      expiredQuantity += r.quantity;
      expiredValue += val;
    } else if (status === 'CRITICAL') {
      criticalCount++;
      criticalQuantity += r.quantity;
      criticalValue += val;
    } else if (status === 'WARNING') {
      warningCount++;
      warningQuantity += r.quantity;
      warningValue += val;
    } else {
      healthyCount++;
    }

    if (!statusFilter || statusFilter === 'all' || statusFilter === status.toLowerCase()) {
      processedBatches.push({
        ...r,
        days_to_expiry: daysToExpiry,
        status,
      });
    }
  }

  const branchName = isSpecificBranch
    ? (one<{ name: string }>('SELECT name FROM branches WHERE id=?', branchId!)?.name ?? null)
    : null;

  return {
    branch_id: branchId ?? null,
    branch_name: branchName,
    as_of: new Date().toISOString(),
    summary: {
      total_batches: rows.length,
      total_quantity: totalQuantity,
      total_value: totalValue,
      expired_count: expiredCount,
      expired_quantity: expiredQuantity,
      expired_value: expiredValue,
      critical_count: criticalCount,
      critical_quantity: criticalQuantity,
      critical_value: criticalValue,
      warning_count: warningCount,
      warning_quantity: warningQuantity,
      warning_value: warningValue,
      healthy_count: healthyCount,
    },
    batches: processedBatches,
    categories,
  };
}

/**
 * Handles stock batch movement:
 *  - For inflows: creates/updates batch record and increases quantity.
 *  - For outflows: verifies availability, enforces FEFO or deducts from designated batch.
 *
 * Returns the resolved or primary batchId touched by the operation.
 */
export function recordBatchStock(input: {
  branchId: string;
  productId: string;
  delta: number;
  reason: string;
  unitCost?: number;
  batchId?: string | null;
  batchNumber?: string | null;
  productionDate?: string | null;
  expiryDate?: string | null;
}): { batchId?: string } {
  const product = one<{ name: string; track_batches: number }>(
    `SELECT p.name, COALESCE(pbs.track_batches, 0) AS track_batches
     FROM products p
     LEFT JOIN product_batch_settings pbs ON pbs.product_id = p.id
     WHERE p.id=?`,
    input.productId,
  );
  if (!product) return {};

  const tracksBatches = Boolean(product.track_batches);
  const today = new Date().toISOString().slice(0, 10);
  const isSale = input.reason.startsWith('بيع') || input.reason.startsWith('فاتورة بيع');

  // Inflow (purchase, positive adjustment, sale return reversal)
  if (input.delta > 0) {
    if (input.batchId) {
      run(
        'UPDATE stock_batches SET quantity = quantity + ? WHERE id = ?',
        input.delta,
        input.batchId,
      );
      return { batchId: input.batchId };
    }
    if (input.batchNumber && input.expiryDate) {
      const existing = one<{ id: string }>(
        'SELECT id FROM stock_batches WHERE branch_id=? AND product_id=? AND batch_number=?',
        input.branchId,
        input.productId,
        input.batchNumber,
      );
      if (existing) {
        run(
          'UPDATE stock_batches SET quantity = quantity + ?, expiry_date = ?, cost_price = ? WHERE id = ?',
          input.delta,
          input.expiryDate,
          input.unitCost ?? 0,
          existing.id,
        );
        return { batchId: existing.id };
      }
      const newBatchId = id();
      run(
        `INSERT INTO stock_batches(id, product_id, branch_id, batch_number, production_date, expiry_date, quantity, cost_price, created_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        newBatchId,
        input.productId,
        input.branchId,
        input.batchNumber,
        input.productionDate ?? null,
        input.expiryDate,
        input.delta,
        input.unitCost ?? 0,
        now(),
      );
      return { batchId: newBatchId };
    }
    return {};
  }

  // Outflow (sale, negative adjustment, transfer out, purchase return)
  if (input.delta < 0) {
    const absQty = Math.abs(input.delta);

    // If specific batch is requested
    if (input.batchId) {
      const batch = one<{
        id: string;
        batch_number: string;
        quantity: number;
        expiry_date: string;
      }>(
        'SELECT id, batch_number, quantity, expiry_date FROM stock_batches WHERE id=?',
        input.batchId,
      );
      if (!batch) {
        throw new AppError(404, 'التشغيلة المحددة غير موجودة');
      }
      if (isSale && batch.expiry_date < today) {
        throw new AppError(
          400,
          `لا يمكن صرف تشغيلة منتهية الصلاحية «${batch.batch_number}» (انتهت في ${batch.expiry_date})`,
        );
      }
      if (batch.quantity < absQty) {
        throw new AppError(
          409,
          `الكمية المتاحة في التشغيلة «${batch.batch_number}» غير كافية؛ المتاح: ${batch.quantity}`,
        );
      }
      run('UPDATE stock_batches SET quantity = quantity - ? WHERE id = ?', absQty, batch.id);
      return { batchId: batch.id };
    }

    // Automated FEFO allocation if product tracks batches
    if (tracksBatches) {
      const expiryFilter = isSale ? 'AND expiry_date >= ?' : '';
      const expiryParams = isSale ? [today] : [];

      const availableBatches = all<{
        id: string;
        batch_number: string;
        quantity: number;
        expiry_date: string;
      }>(
        `SELECT id, batch_number, quantity, expiry_date
         FROM stock_batches
         WHERE branch_id=? AND product_id=? AND quantity > 0 ${expiryFilter}
         ORDER BY expiry_date ASC, created_at ASC`,
        input.branchId,
        input.productId,
        ...expiryParams,
      );

      const totalValid = availableBatches.reduce((sum, b) => sum + b.quantity, 0);
      if (totalValid < absQty && isSale) {
        throw new AppError(
          409,
          `الكمية الصالحة غير منتهية الصلاحية للمنتج «${product.name}» غير كافية؛ المتاح: ${totalValid}، والمطلوب: ${absQty}`,
        );
      }

      let needed = absQty;
      let primaryBatchId: string | undefined;

      for (const b of availableBatches) {
        if (needed <= 0) break;
        const take = Math.min(b.quantity, needed);
        run('UPDATE stock_batches SET quantity = quantity - ? WHERE id = ?', take, b.id);
        needed -= take;
        if (!primaryBatchId) primaryBatchId = b.id;
      }

      return { batchId: primaryBatchId };
    }
  }

  return {};
}
