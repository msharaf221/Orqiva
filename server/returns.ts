/**
 * Returns, Credit Notes & Debit Notes engine.
 *
 * Concepts:
 *  - SALE_RETURN (إشعار دائن / Credit Note):
 *    Linked to a POSTED SALE invoice. Returns goods into branch stock.
 *    Restores inventory at the snapshotted COGS from the original sale line.
 *    Decreases customer receivables (credit note).
 *
 *  - PURCHASE_RETURN (إشعار مدين / Debit Note):
 *    Linked to a POSTED PURCHASE invoice. Ships goods out of branch stock.
 *    Reduces stock and inventory total value.
 *    Decreases supplier payables (debit note).
 *
 * Supports partial returns:
 *  - Customers/suppliers can return a subset of lines or partial quantities.
 *  - Cumulative returned quantities across all active (DRAFT or POSTED) returns
 *    are tracked and cannot exceed original invoiced quantities.
 */

import { all, one } from './db';
import { AppError } from './errors';
import type { Document, ReturnableLine } from '../src/types';

/**
 * Returns the line items of an invoice annotated with:
 *  - original quantity
 *  - already returned quantity (from DRAFT or POSTED returns)
 *  - remaining returnable quantity
 */
export function getReturnableLines(
  originalDocId: string,
  excludeReturnDocId?: string | null,
): ReturnableLine[] {
  const original = one<Document>('SELECT * FROM documents WHERE id=?', originalDocId);
  if (!original) {
    throw new AppError(404, 'الفاتورة الأصلية غير موجودة');
  }
  if (original.status !== 'POSTED') {
    throw new AppError(400, 'لا يمكن عمل مرتجع إلا لفاتورة معتمدة');
  }

  const lines = all<{
    product_id: string;
    name: string;
    sku: string;
    quantity: number;
    unit_price: number;
    cost_price: number;
  }>(
    'SELECT product_id, name, sku, quantity, unit_price, cost_price FROM document_lines WHERE document_id=?',
    originalDocId,
  );

  return lines.map((l) => {
    // Count already-returned quantity across non-cancelled return documents
    const returnedRow = one<{ qty: number | null }>(
      `SELECT SUM(rl.quantity) qty
       FROM document_lines rl
       JOIN documents rd ON rd.id=rl.document_id
       WHERE rd.original_document_id=?
         AND rd.status IN ('DRAFT','POSTED')
         AND (? IS NULL OR rd.id<>?)
         AND rl.product_id=?`,
      originalDocId,
      excludeReturnDocId ?? null,
      excludeReturnDocId ?? null,
      l.product_id,
    );
    const alreadyReturned = returnedRow?.qty ?? 0;
    const returnable = Math.max(0, l.quantity - alreadyReturned);

    return {
      product_id: l.product_id,
      name: l.name,
      sku: l.sku,
      quantity: l.quantity,
      unit_price: l.unit_price,
      cost_price: l.cost_price,
      already_returned: alreadyReturned,
      returnable,
    };
  });
}

/**
 * Validates that lines being returned:
 * 1. Existed in the original invoice.
 * 2. Do not exceed the remaining returnable quantity for each line.
 */
export function validateReturnLines(
  originalDocId: string,
  returnLines: { product_id: string; quantity: number }[],
  excludeReturnDocId?: string | null,
) {
  const returnables = getReturnableLines(originalDocId, excludeReturnDocId);
  const byProduct = new Map(returnables.map((r) => [r.product_id, r]));

  for (const item of returnLines) {
    const meta = byProduct.get(item.product_id);
    if (!meta) {
      throw new AppError(400, `المنتج غير موجود في الفاتورة الأصلية`);
    }
    if (item.quantity <= 0) {
      throw new AppError(400, `الكمية المرتجعة يجب أن تكون أكبر من صفر`);
    }
    if (item.quantity > meta.returnable) {
      throw new AppError(
        400,
        `الكمية المرتجعة للمنتج (${meta.name}) هي ${item.quantity}، بينما المتبقي القابل للإرجاع هو ${meta.returnable}`,
      );
    }
  }
}
