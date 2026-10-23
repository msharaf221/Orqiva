/**
 * Warehouse Locations (Bins, Aisles, Shelves) & Barcode Stocktake Engine.
 *
 * Implements:
 *  - Warehouse location CRUD with hierarchical coordinates (Aisle, Rack, Shelf, Bin).
 *  - Product location mapping (primary and secondary locations).
 *  - Barcode scan-to-count stocktake integration for mobile / handheld scanners.
 */

import { all, one, run, transaction, id, now } from './db';
import { AppError } from './errors';
import { audit } from './service';
import type { Actor, Scope } from './scope';
import { writableBranch } from './scope';
import {
  warehouseLocationSchema,
  productLocationAssignSchema,
  stocktakeScanSchema,
} from './validation';
import type { WarehouseLocation, ProductLocation, StocktakeScanResponse } from '../src/types';

/**
 * Lists warehouse locations for branches in scope.
 */
export function listLocations(scope: Scope, branchId?: string | null): WarehouseLocation[] {
  const isSpecificBranch = branchId && branchId !== 'all';
  const branchClause = isSpecificBranch
    ? 'l.branch_id = ?'
    : scope.ids?.length
      ? `l.branch_id IN (${scope.ids.map(() => '?').join(',')})`
      : '1=1';

  const params = isSpecificBranch ? [branchId!] : scope.ids?.length ? scope.ids : [];

  return all<WarehouseLocation>(
    `SELECT l.*, b.name AS branch_name,
            (SELECT COUNT(*) FROM product_locations pl WHERE pl.location_id = l.id) AS products_count
     FROM warehouse_locations l
     JOIN branches b ON b.id = l.branch_id
     WHERE ${branchClause}
     ORDER BY l.branch_id, l.code ASC`,
    ...params,
  );
}

/**
 * Creates a new warehouse location.
 */
export function createLocation(raw: unknown, actor: Actor): WarehouseLocation {
  const input = warehouseLocationSchema.parse(raw);
  const branch = writableBranch(actor, input.branch_id);

  const locId = id();
  transaction(() => {
    const existing = one<{ id: string }>(
      'SELECT id FROM warehouse_locations WHERE branch_id = ? AND code = ?',
      branch.id,
      input.code,
    );
    if (existing) {
      throw new AppError(409, `كود موقع التخزين «${input.code}» مستخدم بالفعل في هذا الفرع`);
    }

    run(
      `INSERT INTO warehouse_locations(id, branch_id, code, name, aisle, rack, shelf, bin, notes, active, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      locId,
      branch.id,
      input.code,
      input.name,
      input.aisle || '',
      input.rack || '',
      input.shelf || '',
      input.bin || '',
      input.notes || '',
      input.active ?? 1,
      now(),
    );

    audit(actor, 'إضافة موقع تخزين', 'WAREHOUSE_LOCATION', locId, `${input.code} · ${input.name}`);
  });

  const created = one<WarehouseLocation>(
    `SELECT l.*, b.name AS branch_name
     FROM warehouse_locations l
     JOIN branches b ON b.id = l.branch_id
     WHERE l.id = ?`,
    locId,
  );
  if (!created) throw new AppError(500, 'فشل إنشاء موقع التخزين');
  return created;
}

/**
 * Updates an existing warehouse location.
 */
export function updateLocation(locationId: string, raw: unknown, actor: Actor): WarehouseLocation {
  const existing = one<WarehouseLocation>(
    'SELECT * FROM warehouse_locations WHERE id = ?',
    locationId,
  );
  if (!existing) throw new AppError(404, 'موقع التخزين غير موجود');

  const input = warehouseLocationSchema.parse(raw);
  const branch = writableBranch(actor, input.branch_id);

  transaction(() => {
    const duplicate = one<{ id: string }>(
      'SELECT id FROM warehouse_locations WHERE branch_id = ? AND code = ? AND id <> ?',
      branch.id,
      input.code,
      locationId,
    );
    if (duplicate) {
      throw new AppError(409, `كود موقع التخزين «${input.code}» مستخدم بالفعل في هذا الفرع`);
    }

    run(
      `UPDATE warehouse_locations
       SET branch_id = ?, code = ?, name = ?, aisle = ?, rack = ?, shelf = ?, bin = ?, notes = ?, active = ?
       WHERE id = ?`,
      branch.id,
      input.code,
      input.name,
      input.aisle || '',
      input.rack || '',
      input.shelf || '',
      input.bin || '',
      input.notes || '',
      input.active ?? 1,
      locationId,
    );

    audit(
      actor,
      'تعديل موقع تخزين',
      'WAREHOUSE_LOCATION',
      locationId,
      `${input.code} · ${input.name}`,
    );
  });

  const updated = one<WarehouseLocation>(
    `SELECT l.*, b.name AS branch_name
     FROM warehouse_locations l
     JOIN branches b ON b.id = l.branch_id
     WHERE l.id = ?`,
    locationId,
  );
  if (!updated) throw new AppError(500, 'فشل تحديث موقع التخزين');
  return updated;
}

/**
 * Assigns a product to a warehouse location.
 */
export function assignProductLocation(
  productId: string,
  raw: unknown,
  actor: Actor,
): ProductLocation {
  const input = productLocationAssignSchema.parse(raw);

  const product = one<{ id: string; name: string }>(
    'SELECT id, name FROM products WHERE id = ?',
    productId,
  );
  if (!product) throw new AppError(404, 'المنتج غير موجود');

  const location = one<WarehouseLocation>(
    'SELECT * FROM warehouse_locations WHERE id = ?',
    input.location_id,
  );
  if (!location) throw new AppError(404, 'موقع التخزين غير موجود');

  writableBranch(actor, location.branch_id);

  transaction(() => {
    if (input.is_primary) {
      // Clear previous primary location for this product in this branch
      run(
        `UPDATE product_locations
         SET is_primary = 0
         WHERE product_id = ? AND location_id IN (
           SELECT id FROM warehouse_locations WHERE branch_id = ?
         )`,
        productId,
        location.branch_id,
      );
    }

    run(
      `INSERT INTO product_locations(product_id, location_id, is_primary, created_at)
       VALUES(?, ?, ?, ?)
       ON CONFLICT(product_id, location_id) DO UPDATE SET is_primary = excluded.is_primary`,
      productId,
      input.location_id,
      input.is_primary ?? 1,
      now(),
    );

    audit(
      actor,
      'تعيين موقع تخزين للمنتج',
      'PRODUCT',
      productId,
      `${product.name} -> ${location.code}`,
    );
  });

  return {
    product_id: productId,
    product_name: product.name,
    location_id: location.id,
    location_code: location.code,
    location_name: location.name,
    branch_id: location.branch_id,
    is_primary: input.is_primary ?? 1,
    created_at: now(),
  };
}

/**
 * Lists locations assigned to a product.
 */
export function getProductLocations(productId: string): ProductLocation[] {
  return all<ProductLocation>(
    `SELECT pl.product_id, p.name AS product_name, p.sku,
            pl.location_id, l.code AS location_code, l.name AS location_name,
            l.branch_id, pl.is_primary, pl.created_at
     FROM product_locations pl
     JOIN products p ON p.id = pl.product_id
     JOIN warehouse_locations l ON l.id = pl.location_id
     WHERE pl.product_id = ?
     ORDER BY pl.is_primary DESC, l.code ASC`,
    productId,
  );
}

/**
 * Fast Barcode Scan increment during a Stocktake session.
 *
 * Scans a barcode or SKU and increments the counted quantity for that line.
 */
export function scanStocktakeBarcode(
  sessionId: string,
  raw: unknown,
  actor: Actor,
): StocktakeScanResponse {
  const input = stocktakeScanSchema.parse(raw);

  const session = one<{ id: string; branch_id: string; status: string }>(
    'SELECT id, branch_id, status FROM stocktake_sessions WHERE id = ?',
    sessionId,
  );
  if (!session) throw new AppError(404, 'جلسة الجرد غير موجودة');
  if (session.status !== 'DRAFT') {
    throw new AppError(400, 'لا يمكن تعديل كميات الجرد إلا في جلسات المسودة (DRAFT)');
  }

  writableBranch(actor, session.branch_id);

  return transaction(() => {
    // 1. Look up line in session matching barcode or SKU
    const line = one<{
      id: string;
      product_id: string;
      product_name: string;
      sku: string;
      expected_qty: number;
      counted_qty: number | null;
    }>(
      `SELECT sl.id, sl.product_id, sl.product_name, sl.sku, sl.expected_qty, sl.counted_qty
       FROM stocktake_lines sl
       WHERE sl.session_id = ? AND (sl.sku = ? OR sl.product_id = ?)`,
      sessionId,
      input.barcode,
      input.barcode,
    );

    if (!line) {
      throw new AppError(404, `الباركود «${input.barcode}» غير مدرج ضمن بنود جلسة الجرد الحالية`);
    }

    const currentCount = line.counted_qty ?? 0;
    const newCount = currentCount + input.quantity;

    run('UPDATE stocktake_lines SET counted_qty = ? WHERE id = ?', newCount, line.id);

    // Get primary location if any
    const primaryLoc = one<{ code: string }>(
      `SELECT l.code
       FROM product_locations pl
       JOIN warehouse_locations l ON l.id = pl.location_id
       WHERE pl.product_id = ? AND l.branch_id = ? AND pl.is_primary = 1
       LIMIT 1`,
      line.product_id,
      session.branch_id,
    );

    return {
      session_id: sessionId,
      line_id: line.id,
      product_id: line.product_id,
      product_name: line.product_name,
      sku: line.sku,
      expected_qty: line.expected_qty,
      counted_qty: newCount,
      variance_qty: newCount - line.expected_qty,
      incremented_by: input.quantity,
      location_code: primaryLoc?.code ?? null,
    };
  });
}
