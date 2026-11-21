import { all, one, run, transaction, id, now } from './db';
import { adjustSchema, productSchema, productUpdateSchema } from './validation';
import {
  AppError,
  audit,
  branchStock,
  moveStock,
  requireRow,
  type Actor,
  type ProductRow,
} from './service';
import { scopeSql, writableBranch, type Scope } from './scope';
import type { Product } from '../src/types';

/**
 * Products are one shared catalogue. Stock and sellability are per branch, so reads take a scope:
 * a single branch gives that branch's stock and effective price; the group gives totals.
 */
export function listProducts(scope: Scope): Product[] {
  const products = listProductsBase(scope);
  const byProduct = new Map<string, string[]>();
  for (const b of all<{ barcode: string; product_id: string }>(
    'SELECT barcode, product_id FROM product_barcodes ORDER BY created_at, barcode',
  ))
    byProduct.set(b.product_id, [...(byProduct.get(b.product_id) ?? []), b.barcode]);
  return products.map((p) => ({ ...p, barcodes: byProduct.get(p.id) ?? [] }));
}

/** Replaces a product's barcodes. A barcode already used by another product is rejected. */
function syncBarcodes(productId: string, barcodes: string[] | undefined): void {
  if (barcodes === undefined) return;
  const unique = [...new Set(barcodes.map((b) => b.trim()).filter(Boolean))];
  for (const code of unique) {
    const owner = one<{ product_id: string; name: string }>(
      'SELECT b.product_id, p.name FROM product_barcodes b JOIN products p ON p.id=b.product_id WHERE b.barcode=?',
      code,
    );
    if (owner && owner.product_id !== productId)
      throw new AppError(409, `الباركود «${code}» مستخدم بالفعل للمنتج «${owner.name}»`);
    const skuOwner = one<{ id: string; name: string }>(
      'SELECT id, name FROM products WHERE sku=? AND id<>?',
      code,
      productId,
    );
    if (skuOwner) throw new AppError(409, `الباركود «${code}» يطابق كود المنتج «${skuOwner.name}»`);
  }
  run('DELETE FROM product_barcodes WHERE product_id=?', productId);
  for (const code of unique)
    run(
      'INSERT INTO product_barcodes(barcode,product_id,created_at) VALUES(?,?,?)',
      code,
      productId,
      now(),
    );
}

function listProductsBase(scope: Scope): Product[] {
  if (scope.ids?.length === 1) {
    const branchId = scope.ids[0];
    return all<Product>(
      `SELECT p.id,p.sku,p.name,p.category,p.unit,p.cost_price,p.active,p.created_at,
        COALESCE(pbs.track_batches, 0) track_batches,
        COALESCE(bp.sale_price,p.sale_price) sale_price,
        COALESCE(bp.min_stock,p.min_stock) min_stock,
        COALESCE(bs.quantity,0) stock,
        COALESCE(bp.active,0) available,
        COALESCE(NULLIF(bc.avg_cost,0), p.cost_price) avg_cost,
        ? branch_id,
        (SELECT name FROM branches WHERE id=?) branch_name
      FROM products p
      LEFT JOIN product_batch_settings pbs ON pbs.product_id=p.id
      LEFT JOIN branch_products bp ON bp.product_id=p.id AND bp.branch_id=?
      LEFT JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=?
      LEFT JOIN branch_cost bc ON bc.product_id=p.id AND bc.branch_id=?
      ORDER BY p.active DESC,p.created_at DESC`,
      branchId,
      branchId,
      branchId,
      branchId,
      branchId,
    );
  }
  const stock = scopeSql('bs.branch_id', scope);
  const listed = scopeSql('bp.branch_id', scope);
  return all<Product>(
    `SELECT p.id,p.sku,p.name,p.category,p.unit,p.sale_price,p.cost_price,p.min_stock,p.active,p.created_at,
      COALESCE(pbs.track_batches, 0) track_batches,
      COALESCE((SELECT SUM(bs.quantity) FROM branch_stock bs WHERE bs.product_id=p.id AND ${stock.sql}),0) stock,
      (SELECT COUNT(*) FROM branch_products bp WHERE bp.product_id=p.id AND bp.active=1 AND ${listed.sql}) available,
      COALESCE((
        SELECT CAST(ROUND(SUM(bc.total_value)*1.0 / NULLIF(SUM(bs.quantity),0)) AS INTEGER)
        FROM branch_stock bs
        LEFT JOIN branch_cost bc ON bc.branch_id=bs.branch_id AND bc.product_id=bs.product_id
        WHERE bs.product_id=p.id AND ${stock.sql}
      ), p.cost_price) avg_cost
    FROM products p
    LEFT JOIN product_batch_settings pbs ON pbs.product_id=p.id
    ORDER BY p.active DESC,p.created_at DESC`,
    ...stock.params,
    ...listed.params,
    ...stock.params,
  );
}

function productView(productId: string): Product {
  return requireRow(listProducts({ ids: null }).find((p) => p.id === productId));
}

export function createProduct(raw: unknown, actor: Actor) {
  const p = productSchema.parse(raw);
  const productId = id();
  transaction(() => {
    const branch = p.stock ? writableBranch(actor, p.branch_id!) : null;
    run(
      'INSERT INTO products(id,sku,name,category,unit,sale_price,cost_price,min_stock,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      productId,
      p.sku,
      p.name,
      p.category,
      p.unit,
      p.sale_price,
      p.cost_price,
      p.min_stock,
      1,
      now(),
    );
    if (p.track_batches) {
      run('INSERT INTO product_batch_settings(product_id,track_batches) VALUES(?,?)', productId, 1);
    }
    syncBarcodes(productId, p.barcodes);
    // New products are listed by every open branch; administrators switch off what a branch does not carry.
    run(
      'INSERT INTO branch_products(branch_id,product_id,active) SELECT id,?,1 FROM branches WHERE active=1',
      productId,
    );
    if (branch && p.stock)
      moveStock({
        branchId: branch.id,
        productId,
        delta: p.stock,
        reason: 'رصيد افتتاحي',
        actor,
        // Use the reference cost as the initial WAC
        unitCost: p.cost_price,
      });
    audit(actor, 'إضافة منتج', 'PRODUCT', productId, p.name);
  });
  return productView(productId);
}

export function updateProduct(productId: string, raw: unknown, actor: Actor) {
  const p = productUpdateSchema.parse(raw);
  requireRow(one('SELECT id FROM products WHERE id=?', productId));
  transaction(() => {
    run(
      'UPDATE products SET sku=?,name=?,category=?,unit=?,sale_price=?,cost_price=?,min_stock=? WHERE id=?',
      p.sku,
      p.name,
      p.category,
      p.unit,
      p.sale_price,
      p.cost_price,
      p.min_stock,
      productId,
    );
    run(
      'INSERT INTO product_batch_settings(product_id,track_batches) VALUES(?,?) ON CONFLICT(product_id) DO UPDATE SET track_batches=excluded.track_batches',
      productId,
      p.track_batches ? 1 : 0,
    );
    syncBarcodes(productId, p.barcodes);
    audit(actor, 'تعديل منتج', 'PRODUCT', productId, p.name);
  });
  return productView(productId);
}

export function adjustStock(productId: string, raw: unknown, actor: Actor) {
  const input = adjustSchema.parse(raw);
  transaction(() => {
    const product = requireRow(
      one<ProductRow>('SELECT * FROM products WHERE id=? AND active=1', productId),
    );
    const branch = writableBranch(actor, input.branch_id);
    const next = branchStock(branch.id, productId) + input.quantity;
    if (next < 0 || next > 1_000_000) throw new AppError(400, 'الكمية الجديدة خارج النطاق المسموح');
    moveStock({
      branchId: branch.id,
      productId,
      delta: input.quantity,
      reason: input.reason,
      actor,
      // For positive adjustments use the product's reference cost to seed/update WAC.
      // Negative adjustments don't change WAC (handled by recordCostOut).
      unitCost: input.quantity > 0 ? product.cost_price : undefined,
    });
    audit(
      actor,
      'تسوية مخزون',
      'PRODUCT',
      productId,
      `${product.name} · ${branch.name}: ${input.quantity > 0 ? '+' : ''}${input.quantity} — ${input.reason}`,
    );
  });
  return productView(productId);
}
