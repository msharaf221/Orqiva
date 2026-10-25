/**
 * Pack 2.4: Purchase Orders workflow and Landed Costs capitalization onto WAC.
 */

import { all, one, run, transaction, id, now } from './db';
import { AppError } from './errors';
import { type Actor, canSee, writableBranch, scopeFor, scopeSql } from './scope';
import { nextNumber, saveDocument, documentDetail } from './service';
import { purchaseOrderSchema, landedCostSchema } from './validation';
import { getBranchCost, upsertBranchCost, insertCostMovement } from './cost';
import { postEntry, type LedgerLineInput } from './ledger';
import { calculateTax, effectiveTaxRate } from '../src/config';
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  LandedCost,
  LandedCostAllocation,
  Document,
  DocLine,
} from '../src/types';

// ---------------------------------------------------------------------------
// Purchase Orders Core
// ---------------------------------------------------------------------------

export function listPurchaseOrders(
  actor: Actor,
  opts: { branchId?: string; status?: string; partyId?: string } = {},
): PurchaseOrder[] {
  const f = scopeSql('po.branch_id', scopeFor(actor, opts.branchId));
  const statusClause = opts.status ? 'po.status = ?' : '1=1';
  const statusParams = opts.status ? [opts.status] : [];
  const partyClause = opts.partyId ? 'po.party_id = ?' : '1=1';
  const partyParams = opts.partyId ? [opts.partyId] : [];

  return all<PurchaseOrder>(
    `SELECT po.*,
            p.name as party_name,
            p.phone as party_phone,
            b.name as branch_name,
            b.code as branch_code,
            u.name as created_by_name
     FROM purchase_orders po
     JOIN parties p ON p.id = po.party_id
     JOIN branches b ON b.id = po.branch_id
     LEFT JOIN users u ON u.id = po.created_by
     WHERE ${f.sql} AND ${statusClause} AND ${partyClause}
     ORDER BY po.date DESC, po.created_at DESC`,
    ...f.params,
    ...statusParams,
    ...partyParams,
  );
}

export function getPurchaseOrder(orderId: string, actor: Actor): PurchaseOrder {
  const po = one<PurchaseOrder>(
    `SELECT po.*,
            p.name as party_name,
            p.phone as party_phone,
            b.name as branch_name,
            b.code as branch_code,
            u.name as created_by_name
     FROM purchase_orders po
     JOIN parties p ON p.id = po.party_id
     JOIN branches b ON b.id = po.branch_id
     LEFT JOIN users u ON u.id = po.created_by
     WHERE po.id = ?`,
    orderId,
  );
  if (!po) throw new AppError(404, 'أمر الشراء غير موجود');
  if (!canSee(actor, po.branch_id)) throw new AppError(403, 'ليس لديك صلاحية على هذا الفرع');

  const lines = all<PurchaseOrderLine>(
    `SELECT pol.*,
            p.name as product_name,
            p.sku,
            p.unit
     FROM purchase_order_lines pol
     JOIN products p ON p.id = pol.product_id
     WHERE pol.order_id = ?
     ORDER BY pol.rowid ASC`,
    orderId,
  );

  return { ...po, lines };
}

export function createPurchaseOrder(raw: unknown, actor: Actor): PurchaseOrder {
  const input = purchaseOrderSchema.parse(raw);
  const branch = writableBranch(actor, input.branch_id);

  return transaction(() => {
    const orderId = id();
    const year = input.date.slice(0, 4);
    const prefix = `PO-ORD-${branch.code}`;
    const number = nextNumber(prefix, year);

    let subtotal = 0;
    const taxRate = effectiveTaxRate(input.tax_rate);
    const computedLines = input.lines.map((line) => {
      const lineSubtotal = line.quantity * line.unit_price;
      subtotal += lineSubtotal;
      return {
        id: id(),
        order_id: orderId,
        product_id: line.product_id,
        quantity: line.quantity,
        unit_price: line.unit_price,
        tax_rate: taxRate,
        line_total: lineSubtotal,
      };
    });

    const tax = calculateTax(subtotal, taxRate);
    const total = subtotal + tax;

    run(
      `INSERT INTO purchase_orders(
        id, number, branch_id, party_id, status, date,
        expected_delivery_date, subtotal, tax_rate, tax, total,
        notes, created_by, created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      orderId,
      number,
      branch.id,
      input.party_id,
      'DRAFT',
      input.date,
      input.expected_delivery_date ?? null,
      subtotal,
      taxRate,
      tax,
      total,
      input.notes ?? null,
      actor.id,
      now(),
    );

    for (const l of computedLines) {
      run(
        `INSERT INTO purchase_order_lines(
          id, order_id, product_id, quantity, received_quantity,
          unit_price, tax_rate, line_total
        ) VALUES(?,?,?,?,0,?,?,?)`,
        l.id,
        l.order_id,
        l.product_id,
        l.quantity,
        l.unit_price,
        l.tax_rate,
        l.line_total,
      );
    }

    return getPurchaseOrder(orderId, actor);
  });
}

export function updatePurchaseOrder(orderId: string, raw: unknown, actor: Actor): PurchaseOrder {
  const existing = one<{ status: string; branch_id: string }>(
    'SELECT status, branch_id FROM purchase_orders WHERE id = ?',
    orderId,
  );
  if (!existing) throw new AppError(404, 'أمر الشراء غير موجود');
  if (existing.status !== 'DRAFT') {
    throw new AppError(400, 'لا يمكن تعديل أمر شراء بعد تأكيده أو استلامه');
  }

  const input = purchaseOrderSchema.parse(raw);
  const branch = writableBranch(actor, input.branch_id);

  return transaction(() => {
    let subtotal = 0;
    const taxRate = effectiveTaxRate(input.tax_rate);
    const computedLines = input.lines.map((line) => {
      const lineSubtotal = line.quantity * line.unit_price;
      subtotal += lineSubtotal;
      return {
        id: id(),
        order_id: orderId,
        product_id: line.product_id,
        quantity: line.quantity,
        unit_price: line.unit_price,
        tax_rate: taxRate,
        line_total: lineSubtotal,
      };
    });

    const tax = calculateTax(subtotal, taxRate);
    const total = subtotal + tax;

    run(
      `UPDATE purchase_orders
       SET branch_id = ?, party_id = ?, date = ?, expected_delivery_date = ?,
           subtotal = ?, tax_rate = ?, tax = ?, total = ?, notes = ?
       WHERE id = ?`,
      branch.id,
      input.party_id,
      input.date,
      input.expected_delivery_date ?? null,
      subtotal,
      taxRate,
      tax,
      total,
      input.notes ?? null,
      orderId,
    );

    run('DELETE FROM purchase_order_lines WHERE order_id = ?', orderId);

    for (const l of computedLines) {
      run(
        `INSERT INTO purchase_order_lines(
          id, order_id, product_id, quantity, received_quantity,
          unit_price, tax_rate, line_total
        ) VALUES(?,?,?,?,0,?,?,?)`,
        l.id,
        l.order_id,
        l.product_id,
        l.quantity,
        l.unit_price,
        l.tax_rate,
        l.line_total,
      );
    }

    return getPurchaseOrder(orderId, actor);
  });
}

export function confirmPurchaseOrder(orderId: string, actor: Actor): PurchaseOrder {
  const po = getPurchaseOrder(orderId, actor);
  writableBranch(actor, po.branch_id);

  if (po.status !== 'DRAFT') {
    throw new AppError(400, 'فقط أوامر الشراء المسودة يمكن تأكيدها');
  }

  run("UPDATE purchase_orders SET status = 'CONFIRMED' WHERE id = ?", orderId);
  return getPurchaseOrder(orderId, actor);
}

export function cancelPurchaseOrder(orderId: string, actor: Actor): PurchaseOrder {
  const po = getPurchaseOrder(orderId, actor);
  writableBranch(actor, po.branch_id);

  if (po.status === 'RECEIVED') {
    throw new AppError(400, 'لا يمكن إلغاء أمر شراء تم استلامه بالكامل');
  }

  run("UPDATE purchase_orders SET status = 'CANCELLED' WHERE id = ?", orderId);
  return getPurchaseOrder(orderId, actor);
}

/**
 * Converts or receives goods against a confirmed Purchase Order.
 * Generates an official PURCHASE document (bill).
 */
export function receivePurchaseOrder(
  orderId: string,
  actor: Actor,
  payload?: {
    received_lines?: { product_id: string; quantity: number }[];
    notes?: string;
  },
): { purchase_order: PurchaseOrder; document: Document } {
  const po = getPurchaseOrder(orderId, actor);
  writableBranch(actor, po.branch_id);

  if (po.status !== 'CONFIRMED' && po.status !== 'PARTIALLY_RECEIVED') {
    throw new AppError(400, 'يجب تأكيد أمر الشراء أولاً قبل التوريد أو الاستلام');
  }

  const lines = po.lines || [];
  if (!lines.length) throw new AppError(400, 'أمر الشراء لا يحتوي على بنود');

  return transaction(() => {
    // Map quantities to receive per product
    const toReceiveMap = new Map<string, number>();
    if (payload?.received_lines && payload.received_lines.length > 0) {
      for (const item of payload.received_lines) {
        if (item.quantity > 0) {
          toReceiveMap.set(
            item.product_id,
            (toReceiveMap.get(item.product_id) || 0) + item.quantity,
          );
        }
      }
    } else {
      // Receive all remaining
      for (const l of lines) {
        const remaining = l.quantity - l.received_quantity;
        if (remaining > 0) {
          toReceiveMap.set(l.product_id, remaining);
        }
      }
    }

    if (toReceiveMap.size === 0) {
      throw new AppError(400, 'لم يتم تحديد أي كميات متاحة للتوريد');
    }

    // Prepare Document lines for the PURCHASE invoice
    const docLines: Array<{
      product_id: string;
      quantity: number;
      unit_price: number;
    }> = [];

    for (const l of lines) {
      const qtyToReceive = toReceiveMap.get(l.product_id);
      if (!qtyToReceive) continue;

      const remaining = l.quantity - l.received_quantity;
      if (qtyToReceive > remaining) {
        throw new AppError(
          400,
          `الكمية المراد استلامها للصنف (${l.product_name}) تتجاوز الكمية المتبقية في أمر الشراء (${remaining})`,
        );
      }

      run(
        'UPDATE purchase_order_lines SET received_quantity = received_quantity + ? WHERE id = ?',
        qtyToReceive,
        l.id,
      );

      docLines.push({
        product_id: l.product_id,
        quantity: qtyToReceive,
        unit_price: l.unit_price,
      });
    }

    // Check if PO is now fully received or partially received
    const updatedLines = all<PurchaseOrderLine>(
      'SELECT quantity, received_quantity FROM purchase_order_lines WHERE order_id = ?',
      orderId,
    );
    const fullyReceived = updatedLines.every((l) => l.received_quantity >= l.quantity);
    const newStatus = fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';

    run('UPDATE purchase_orders SET status = ? WHERE id = ?', newStatus, orderId);

    // Create PURCHASE document linked to this PO
    const docPayload = {
      type: 'PURCHASE',
      branch_id: po.branch_id,
      party_id: po.party_id,
      date: now().slice(0, 10),
      due_date: po.expected_delivery_date || now().slice(0, 10),
      discount: 0,
      tax_rate: po.tax_rate,
      notes: `توريد واستلام مبني على أمر الشراء رقم ${po.number}${payload?.notes ? ` - ${payload.notes}` : ''}`,
      lines: docLines,
    };

    const doc = saveDocument(docPayload, actor);

    return {
      purchase_order: getPurchaseOrder(orderId, actor),
      document: doc,
    };
  });
}

// ---------------------------------------------------------------------------
// Landed Costs Core (تكاليف الشحن / الجمارك / التخليص ورسملتها على المخزون)
// ---------------------------------------------------------------------------

export function listLandedCosts(documentId: string, actor: Actor): LandedCost[] {
  const doc = documentDetail(documentId);
  if (!canSee(actor, doc.branch_id)) throw new AppError(403, 'ليس لديك صلاحية على هذا الفرع');

  const costs = all<LandedCost>(
    `SELECT lc.*,
            u.name as created_by_name,
            d.number as document_number
     FROM landed_costs lc
     JOIN documents d ON d.id = lc.document_id
     LEFT JOIN users u ON u.id = lc.created_by
     WHERE lc.document_id = ?
     ORDER BY lc.created_at ASC`,
    documentId,
  );

  return costs.map((cost) => {
    const allocations = all<LandedCostAllocation>(
      `SELECT lca.*,
              p.name as product_name,
              p.sku
       FROM landed_cost_allocations lca
       JOIN products p ON p.id = lca.product_id
       WHERE lca.landed_cost_id = ?
       ORDER BY lca.rowid ASC`,
      cost.id,
    );
    return { ...cost, allocations };
  });
}

/**
 * Capitalizes Landed Costs (shipping, customs, clearance) onto inventory WAC
 * and creates corresponding balanced GL entries.
 */
export function applyLandedCost(documentId: string, raw: unknown, actor: Actor): LandedCost {
  const input = landedCostSchema.parse(raw);
  const doc = documentDetail(documentId);
  writableBranch(actor, doc.branch_id);

  if (doc.type !== 'PURCHASE') {
    throw new AppError(400, 'لا يمكن إضافة تكاليف شحن وجمارك إلا لفواتير الشراء');
  }
  if (doc.status !== 'POSTED') {
    throw new AppError(400, 'يجب اعتماد فاتورة الشراء أولاً لرسملة التكاليف الإضافية على المخزون');
  }

  const lines = doc.lines || [];
  if (!lines.length) {
    throw new AppError(400, 'فاتورة الشراء لا تحتوي على أي بنود لتوزيع التكلفة عليها');
  }

  return transaction(() => {
    const landedCostId = id();

    // Calculate total basis
    let totalBasis = 0;
    if (input.allocation_method === 'BY_VALUE') {
      totalBasis = lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);
    } else {
      totalBasis = lines.reduce((sum, l) => sum + l.quantity, 0);
    }

    if (totalBasis <= 0) {
      throw new AppError(400, 'إجمالي أساس التوزيع يجب أن يكون أكبر من صفر');
    }

    // Allocate across lines
    let allocatedSum = 0;
    const allocations: Array<{
      id: string;
      line: DocLine;
      allocatedAmount: number;
      additionalUnitCost: number;
    }> = lines.map((l) => {
      const lineBasis =
        input.allocation_method === 'BY_VALUE' ? l.quantity * l.unit_price : l.quantity;
      const share = Math.round((lineBasis / totalBasis) * input.amount);
      allocatedSum += share;
      const additionalUnitCost = Math.round(share / l.quantity);
      return {
        id: id(),
        line: l,
        allocatedAmount: share,
        additionalUnitCost,
      };
    });

    // Adjust any rounding discrepancy on the line with the largest allocation
    const diff = input.amount - allocatedSum;
    if (diff !== 0 && allocations.length > 0) {
      const maxAlloc = allocations.reduce((prev, curr) =>
        curr.allocatedAmount > prev.allocatedAmount ? curr : prev,
      );
      maxAlloc.allocatedAmount += diff;
      maxAlloc.additionalUnitCost = Math.round(maxAlloc.allocatedAmount / maxAlloc.line.quantity);
    }

    // Insert landed_costs
    run(
      `INSERT INTO landed_costs(
        id, document_id, cost_type, cost_name, amount,
        allocation_method, notes, created_by, created_at
      ) VALUES(?,?,?,?,?,?,?,?,?)`,
      landedCostId,
      documentId,
      input.cost_type,
      input.cost_name,
      input.amount,
      input.allocation_method,
      input.notes ?? null,
      actor.id,
      now(),
    );

    // Insert allocations and recalculate branch WAC
    for (const a of allocations) {
      run(
        `INSERT INTO landed_cost_allocations(
          id, landed_cost_id, document_line_id, product_id,
          allocated_amount, additional_unit_cost
        ) VALUES(?,?,?,?,?,?)`,
        a.id,
        landedCostId,
        a.line.id,
        a.line.product_id,
        a.allocatedAmount,
        a.additionalUnitCost,
      );

      // Capitalize onto branch_cost WAC
      const existing = getBranchCost(doc.branch_id, a.line.product_id);
      const stockRow = one<{ quantity: number }>(
        'SELECT quantity FROM branch_stock WHERE branch_id = ? AND product_id = ?',
        doc.branch_id,
        a.line.product_id,
      );
      const currentStock = stockRow?.quantity ?? 0;

      if (currentStock > 0) {
        const avgBefore = existing.avg_cost;
        const newTotalValue = existing.total_value + a.allocatedAmount;
        const newAvg = Math.round(newTotalValue / currentStock);
        const finalValue = newAvg * currentStock;

        upsertBranchCost(doc.branch_id, a.line.product_id, newAvg, finalValue);
        insertCostMovement({
          branchId: doc.branch_id,
          productId: a.line.product_id,
          deltaQty: a.line.quantity,
          unitCost: a.additionalUnitCost,
          avgBefore,
          avgAfter: newAvg,
          reason: `رسملة تكلفة إضافية (${input.cost_name}) لفاتورة مشتريات ${doc.number}`,
          actor,
          documentId,
        });
      }
    }

    // Post to General Ledger (Qayd Mozdawaj)
    const hasGl = one('SELECT 1 FROM gl_settings WHERE id = 1');
    if (hasGl) {
      const glLines: LedgerLineInput[] = [
        {
          systemKey: 'INVENTORY',
          debit: input.amount,
          branchId: doc.branch_id,
          memo: `رسملة مخزون: ${input.cost_name} - ${doc.number}`,
        },
        {
          systemKey: 'AP',
          credit: input.amount,
          branchId: doc.branch_id,
          memo: `مستحقات تكلفة إضافية: ${input.cost_name} - ${doc.number}`,
        },
      ];

      postEntry(
        {
          date: doc.date,
          memo: `تكاليف إضافية (${input.cost_name}) على فاتورة المشتريات ${doc.number}`,
          sourceType: 'PURCHASE',
          sourceId: landedCostId,
          branchId: doc.branch_id,
          lines: glLines,
        },
        actor,
      );
    }

    const created = listLandedCosts(documentId, actor).find((c) => c.id === landedCostId);
    if (!created) throw new AppError(500, 'فشل استرجاع بيانات التكلفة الإضافية بعد الحفظ');
    return created;
  });
}
