import { all, one, run, transaction, id, now } from './db';
import { transferReceiveSchema, transferSchema } from './validation';
import {
  AppError,
  assertAssortment,
  audit,
  moveStock,
  nextNumber,
  requireRow,
  type Actor,
  type ProductRow,
} from './service';
import { effectiveCost } from './cost';
import { postTransferShipLedger, postTransferReceiveLedger } from './posting';
import { reverseBySource } from './ledger';
import { accessibleBranchIds, scopeSql, writableBranch, type Scope } from './scope';
import type { Branch, Transfer, TransferLine, TransferSuggestion } from '../src/types';

const transferSelect = `SELECT t.*,fb.name from_branch_name,tb.name to_branch_name
  FROM transfers t JOIN branches fb ON fb.id=t.from_branch_id JOIN branches tb ON tb.id=t.to_branch_id`;

/** Transfers touching any branch in scope: outgoing or incoming. */
export function listTransfers(scope: Scope, status?: string): Transfer[] {
  const outgoing = scopeSql('t.from_branch_id', scope);
  const incoming = scopeSql('t.to_branch_id', scope);
  return all<Transfer>(
    `${transferSelect} WHERE (${outgoing.sql} OR ${incoming.sql})${status ? ' AND t.status=?' : ''}
     ORDER BY t.date DESC,t.created_at DESC`,
    ...outgoing.params,
    ...incoming.params,
    ...(status ? [status] : []),
  );
}

export function transferDetail(transferId: string): Transfer {
  const transfer = requireRow(one<Transfer>(`${transferSelect} WHERE t.id=?`, transferId));
  return {
    ...transfer,
    lines: all<TransferLine>(
      'SELECT * FROM transfer_lines WHERE transfer_id=? ORDER BY name',
      transferId,
    ),
  };
}

/** Checks the destination lists every product; the source may still hold delisted stock. */
function prepareLines(lines: { product_id: string; quantity: number }[], toBranchId: string) {
  return lines.map((line) => {
    const product = requireRow(
      one<ProductRow>('SELECT * FROM products WHERE id=? AND active=1', line.product_id),
    );
    assertAssortment(toBranchId, product.id, product.name);
    return {
      product_id: product.id,
      name: product.name,
      sku: product.sku,
      quantity: line.quantity,
    };
  });
}

export function createTransfer(raw: unknown, actor: Actor) {
  const input = transferSchema.parse(raw);
  const transferId = id();
  return transaction(() => {
    const from = writableBranch(actor, input.from_branch_id);
    const to = requireRow(one<Branch>('SELECT * FROM branches WHERE id=?', input.to_branch_id));
    if (!to.active) throw new AppError(409, 'الفرع المستلم مؤرشف');
    const lines = prepareLines(input.lines, to.id);
    const number = nextNumber('TR', input.date.slice(0, 4));
    run(
      "INSERT INTO transfers(id,number,from_branch_id,to_branch_id,status,date,notes,created_by,created_at) VALUES(?,?,?,?,'DRAFT',?,?,?,?)",
      transferId,
      number,
      from.id,
      to.id,
      input.date,
      input.notes,
      actor.id,
      now(),
    );
    for (const line of lines)
      run(
        'INSERT INTO transfer_lines(id,transfer_id,product_id,name,sku,quantity_sent,quantity_received,unit_cost) VALUES(?,?,?,?,?,?,NULL,0)',
        id(),
        transferId,
        line.product_id,
        line.name,
        line.sku,
        line.quantity,
      );
    audit(actor, 'إنشاء تحويل', 'TRANSFER', transferId, `${number}: ${from.name} ← ${to.name}`);
    return transferDetail(transferId);
  });
}

export function updateTransfer(transferId: string, raw: unknown, actor: Actor) {
  const input = transferSchema.parse(raw);
  return transaction(() => {
    const existing = requireRow(one<Transfer>('SELECT * FROM transfers WHERE id=?', transferId));
    if (existing.status !== 'DRAFT') throw new AppError(409, 'لا يمكن تعديل تحويل بعد شحنه');
    const from = writableBranch(actor, input.from_branch_id);
    const to = requireRow(one<Branch>('SELECT * FROM branches WHERE id=?', input.to_branch_id));
    if (!to.active) throw new AppError(409, 'الفرع المستلم مؤرشف');
    const lines = prepareLines(input.lines, to.id);
    run(
      'UPDATE transfers SET from_branch_id=?,to_branch_id=?,date=?,notes=? WHERE id=?',
      from.id,
      to.id,
      input.date,
      input.notes,
      transferId,
    );
    run('DELETE FROM transfer_lines WHERE transfer_id=?', transferId);
    for (const line of lines)
      run(
        'INSERT INTO transfer_lines(id,transfer_id,product_id,name,sku,quantity_sent,quantity_received,unit_cost) VALUES(?,?,?,?,?,?,NULL,0)',
        id(),
        transferId,
        line.product_id,
        line.name,
        line.sku,
        line.quantity,
      );
    audit(actor, 'تعديل تحويل', 'TRANSFER', transferId, existing.number);
    return transferDetail(transferId);
  });
}

/** Shipping takes the goods out of the sending branch; they stay in transit until received. */
export function shipTransfer(transferId: string, actor: Actor) {
  return transaction(() => {
    const transfer = requireRow(one<Transfer>('SELECT * FROM transfers WHERE id=?', transferId));
    if (transfer.status !== 'DRAFT') throw new AppError(409, 'لا يمكن شحن تحويل بحالته الحالية');
    const from = writableBranch(actor, transfer.from_branch_id);
    const to = requireRow(one<Branch>('SELECT * FROM branches WHERE id=?', transfer.to_branch_id));
    if (!to.active) throw new AppError(409, 'الفرع المستلم مؤرشف؛ لا يمكن الشحن إليه');
    const lines = all<TransferLine>('SELECT * FROM transfer_lines WHERE transfer_id=?', transferId);
    for (const line of lines) {
      // Snapshot the WAC at the time of shipment (not the reference cost_price)
      const wac = effectiveCost(from.id, line.product_id);
      moveStock({
        branchId: from.id,
        productId: line.product_id,
        delta: -line.quantity_sent,
        reason: `تحويل إلى ${to.name}`,
        actor,
        transferId,
      });
      run('UPDATE transfer_lines SET unit_cost=? WHERE id=?', wac, line.id);
    }
    run(
      "UPDATE transfers SET status='IN_TRANSIT',shipped_by=?,shipped_at=? WHERE id=?",
      actor.id,
      now(),
      transferId,
    );
    // Ledger: goods leave the source branch's inventory.
    const shippedValue = lines.reduce((s, l) => s + l.quantity_sent * (l.unit_cost || 0), 0);
    postTransferShipLedger(
      {
        id: transferId,
        number: transfer.number,
        date: now().slice(0, 10),
        branchId: from.id,
        amount: shippedValue,
      },
      actor,
    );
    audit(actor, 'شحن تحويل', 'TRANSFER', transferId, transfer.number);
    return transferDetail(transferId);
  });
}

/**
 * Receiving closes the transfer. Each line records what actually arrived; whatever did not arrive
 * is kept on the transfer as a shortage, so the stock ledger still reconciles.
 */
export function receiveTransfer(transferId: string, raw: unknown, actor: Actor) {
  const input = transferReceiveSchema.parse(raw);
  return transaction(() => {
    const transfer = requireRow(one<Transfer>('SELECT * FROM transfers WHERE id=?', transferId));
    if (transfer.status !== 'IN_TRANSIT') throw new AppError(409, 'التحويل ليس في الطريق');
    const to = writableBranch(actor, transfer.to_branch_id);
    const lines = all<TransferLine>('SELECT * FROM transfer_lines WHERE transfer_id=?', transferId);
    const received = new Map(input.lines.map((l) => [l.product_id, l.quantity_received]));
    if (received.size !== lines.length || lines.some((l) => !received.has(l.product_id)))
      throw new AppError(400, 'أدخل الكمية المستلمة لكل منتج في التحويل');
    for (const line of lines) {
      const quantity = received.get(line.product_id)!;
      if (quantity > line.quantity_sent)
        throw new AppError(400, `الكمية المستلمة من «${line.name}» أكبر من المرسلة`);
      if (quantity > 0)
        moveStock({
          branchId: to.id,
          productId: line.product_id,
          delta: quantity,
          reason: `استلام من ${transfer.from_branch_name}`,
          actor,
          transferId,
          // Pass the WAC that was snapshotted at shipment time
          unitCost: line.unit_cost,
        });
      run('UPDATE transfer_lines SET quantity_received=? WHERE id=?', quantity, line.id);
    }
    run(
      "UPDATE transfers SET status='RECEIVED',received_by=?,received_at=? WHERE id=?",
      actor.id,
      now(),
      transferId,
    );
    // Ledger: goods enter the destination branch's inventory at the shipped WAC.
    const receivedValue = lines.reduce(
      (s, l) => s + received.get(l.product_id)! * (l.unit_cost || 0),
      0,
    );
    postTransferReceiveLedger(
      {
        id: transferId,
        number: transfer.number,
        date: now().slice(0, 10),
        branchId: to.id,
        amount: receivedValue,
      },
      actor,
    );
    const shortage = lines.reduce(
      (sum, l) => sum + Math.max(0, l.quantity_sent - received.get(l.product_id)!),
      0,
    );
    audit(
      actor,
      'استلام تحويل',
      'TRANSFER',
      transferId,
      `${transfer.number}${shortage ? ` · عجز ${shortage} وحدة` : ''}`,
    );
    return transferDetail(transferId);
  });
}

/** Drafts are simply dropped; goods already shipped return to the sending branch. */
export function cancelTransfer(transferId: string, actor: Actor) {
  return transaction(() => {
    const transfer = requireRow(one<Transfer>('SELECT * FROM transfers WHERE id=?', transferId));
    if (transfer.status !== 'DRAFT' && transfer.status !== 'IN_TRANSIT')
      throw new AppError(409, 'لا يمكن إلغاء تحويل مستلم أو ملغى');
    const from = writableBranch(actor, transfer.from_branch_id);
    if (transfer.status === 'IN_TRANSIT') {
      const lines = all<TransferLine>(
        'SELECT * FROM transfer_lines WHERE transfer_id=?',
        transferId,
      );
      for (const line of lines)
        moveStock({
          branchId: from.id,
          productId: line.product_id,
          delta: line.quantity_sent,
          reason: `إلغاء تحويل ${transfer.number}`,
          actor,
          transferId,
          // Return at the snapshotted WAC
          unitCost: line.unit_cost,
        });
    }
    run("UPDATE transfers SET status='CANCELLED',cancelled_at=? WHERE id=?", now(), transferId);
    // Reverse whatever the transfer had already posted to the ledger.
    reverseBySource('TRANSFER', transferId, actor, `إلغاء تحويل ${transfer.number}`);
    audit(actor, 'إلغاء تحويل', 'TRANSFER', transferId, transfer.number);
    return transferDetail(transferId);
  });
}

/**
 * Rebalancing suggestions: fills shortfalls below each branch's reorder level from branches that
 * hold more than their own reorder level. Both ends stay inside the caller's scope.
 */
export function suggestTransfers(user: Actor, requested: Scope): TransferSuggestion[] {
  const visible = requested.ids === null ? accessibleBranchIds(user) : requested.ids;
  if (user.role !== 'ADMIN') {
    const allowed = new Set(accessibleBranchIds(user));
    if (visible.some((b) => !allowed.has(b)))
      throw new AppError(403, 'ليس لديك صلاحية على هذا الفرع');
  }
  if (!visible.length) return [];
  const scope = scopeSql('b.id', { ids: visible });
  const rows = all<{
    branch_id: string;
    branch_code: string;
    branch_name: string;
    product_id: string;
    sku: string;
    product_name: string;
    listed: number;
    minimum: number;
    stock: number;
  }>(
    `SELECT b.id branch_id,b.code branch_code,b.name branch_name,p.id product_id,p.sku,p.name product_name,
      COALESCE(bp.active,0) listed,COALESCE(bp.min_stock,p.min_stock) minimum,COALESCE(bs.quantity,0) stock
    FROM branches b
    CROSS JOIN products p
    LEFT JOIN branch_products bp ON bp.branch_id=b.id AND bp.product_id=p.id
    LEFT JOIN branch_stock bs ON bs.branch_id=b.id AND bs.product_id=p.id
    WHERE b.active=1 AND p.active=1 AND ${scope.sql}`,
    ...scope.params,
  );
  const byProduct = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byProduct.get(row.product_id) ?? [];
    list.push(row);
    byProduct.set(row.product_id, list);
  }
  const suggestions: TransferSuggestion[] = [];
  for (const list of byProduct.values()) {
    const needs = list
      .filter((r) => r.listed && r.minimum > 0 && r.stock < r.minimum)
      .map((r) => ({ row: r, left: r.minimum - r.stock }))
      .sort((a, b) => b.left - a.left || a.row.branch_code.localeCompare(b.row.branch_code));
    const surplus = list
      .filter((r) => r.stock > r.minimum)
      .map((r) => ({ row: r, left: r.stock - r.minimum }))
      .sort((a, b) => b.left - a.left || a.row.branch_code.localeCompare(b.row.branch_code));
    for (const need of needs)
      for (const give of surplus) {
        if (need.left <= 0) break;
        if (give.left <= 0 || give.row.branch_id === need.row.branch_id) continue;
        const quantity = Math.min(need.left, give.left);
        suggestions.push({
          product_id: need.row.product_id,
          sku: need.row.sku,
          name: need.row.product_name,
          from_branch_id: give.row.branch_id,
          from_branch_name: give.row.branch_name,
          to_branch_id: need.row.branch_id,
          to_branch_name: need.row.branch_name,
          quantity,
        });
        need.left -= quantity;
        give.left -= quantity;
      }
  }
  return suggestions.slice(0, 200);
}
