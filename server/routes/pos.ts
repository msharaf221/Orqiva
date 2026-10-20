import { Router } from 'express';
import { all } from '../db';
import { requirePermission } from '../rbac';
import { scopeFor, scopeSql } from '../scope';
import { getReturnableLines } from '../returns';
import type { Document } from '../../src/types';
import {
  getCurrentShift,
  openShift,
  addCashMovement,
  getShiftSummary,
  submitShiftClosing,
  approveShiftClosing,
  closeShift,
  listPendingReviewShifts,
  listShifts,
  posCheckout,
  posReturn,
  parkSale,
  listParkedSales,
  resumeParkedSale,
  discardParkedSale,
} from '../pos';

export const posRouter = Router();

posRouter.get('/shifts/current', requirePermission('pos:access'), (req, res) => {
  const branchId = String(req.query.branch_id || req.user.branch_ids?.[0] || 'main');
  res.json(getCurrentShift(req.user.id, branchId));
});

posRouter.post('/shifts/open', requirePermission('pos:shift_open', 'pos:access'), (req, res) => {
  res.status(201).json(openShift(req.body, req.user));
});

posRouter.post(
  '/shifts/:id/cash-movement',
  requirePermission('pos:cash_movement', 'pos:access'),
  (req, res) => {
    res.status(201).json(addCashMovement(String(req.params.id), req.body, req.user));
  },
);

posRouter.get(
  '/shifts/:id/summary',
  requirePermission('pos:access', 'pos:shift_close', 'finance:view', 'finance:accounts'),
  (req, res) => {
    res.json(getShiftSummary(String(req.params.id), req.user));
  },
);

posRouter.post('/shifts/:id/submit', requirePermission('pos:access'), (req, res) => {
  res.json(submitShiftClosing(String(req.params.id), req.body, req.user));
});

posRouter.post('/shifts/:id/approve', requirePermission('pos:shift_close'), (req, res) => {
  res.json(approveShiftClosing(String(req.params.id), req.body, req.user));
});

posRouter.post(
  '/shifts/:id/close',
  requirePermission('pos:shift_close', 'pos:access'),
  (req, res) => {
    res.json(closeShift(String(req.params.id), req.body, req.user));
  },
);

posRouter.get('/shifts/pending-review', requirePermission('pos:shift_close'), (req, res) => {
  const scope = scopeFor(req.user, req.query.branch_id);
  res.json(listPendingReviewShifts(scope));
});

posRouter.get(
  '/shifts',
  requirePermission('pos:access', 'pos:shift_close', 'finance:view', 'finance:accounts'),
  (req, res) => {
    const scope = scopeFor(req.user, req.query.branch_id);
    res.json(listShifts(scope, req.query.status ? String(req.query.status) : undefined));
  },
);

posRouter.post('/checkout', requirePermission('pos:access'), (req, res) => {
  res.status(201).json(posCheckout(req.body, req.user));
});

posRouter.post('/return', requirePermission('pos:access', 'documents:create_sale'), (req, res) => {
  res.status(201).json(posReturn(req.body, req.user));
});

/**
 * Finds a previous POS sale to refund, by invoice number / internal code (exact-ish) or barcode
 * of the receipt. Only POSTED sales in branches the user can write are returned.
 */
posRouter.get('/sales/lookup', requirePermission('pos:access'), (req, res) => {
  const scope = scopeFor(req.user, req.query.branch_id);
  const f = scopeSql('d.branch_id', scope);
  const term = String(req.query.q || '').trim();
  if (!term) return res.json([]);
  const like = `%${term}%`;
  res.json(
    all<Document>(
      `SELECT d.*, p.name party_name, b.name branch_name, b.code branch_code,
        (SELECT COALESCE(SUM(rl.quantity),0) FROM document_lines rl
           JOIN documents rd ON rd.id=rl.document_id
          WHERE rd.original_document_id=d.id AND rd.status IN ('DRAFT','POSTED')) returned_qty
       FROM documents d
       JOIN parties p ON p.id=d.party_id
       JOIN branches b ON b.id=d.branch_id
       WHERE d.type='SALE' AND d.status='POSTED'
         AND (d.number LIKE ? OR d.internal_code LIKE ? OR d.reference_uuid LIKE ?)
         AND ${f.sql}
       ORDER BY d.date DESC, d.created_at DESC LIMIT 20`,
      like,
      like,
      like,
      ...f.params,
    ),
  );
});

/** The returnable lines (original/returned/returnable) of one POS sale, for the refund dialog. */
posRouter.get('/sales/:id/returnable', requirePermission('pos:access'), (req, res) => {
  res.json(getReturnableLines(String(req.params.id)));
});

posRouter.get('/products', requirePermission('pos:access'), (req, res) => {
  const branchId = String(req.query.branch_id || 'main');
  const search = req.query.search ? String(req.query.search).trim() : '';
  const category = req.query.category ? String(req.query.category).trim() : '';
  const limit = req.query.limit ? Math.min(Number(req.query.limit) || 200, 500) : null;
  const offset = req.query.offset ? Math.max(Number(req.query.offset) || 0, 0) : 0;
  // `top=N` orders by units sold in the branch over the last 90 days (fast-mover shelf).
  const top = req.query.top ? Math.min(Number(req.query.top) || 0, 100) : 0;

  const clauses = ['p.active=1', 'COALESCE(bp.active, 1)=1'];
  const params: (string | number)[] = [];
  if (search) {
    clauses.push('(p.name LIKE ? OR p.sku LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category && category !== 'ALL') {
    clauses.push('p.category=?');
    params.push(category);
  }
  let pagination = '';
  if (limit !== null) {
    pagination = ' LIMIT ? OFFSET ?';
    params.push(limit, offset);
  }

  res.json(
    all(
      `SELECT p.*, COALESCE(bs.quantity, 0) stock,
              COALESCE(bp.sale_price, p.sale_price) sale_price,
              COALESCE(sold.units, 0) units_sold
       FROM products p
       LEFT JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=?
       LEFT JOIN branch_products bp ON bp.product_id=p.id AND bp.branch_id=?
       LEFT JOIN (
         SELECT dl.product_id, SUM(dl.quantity) units
         FROM document_lines dl
         JOIN documents d ON d.id=dl.document_id
         WHERE d.type='SALE' AND d.status='POSTED' AND d.branch_id=?
           AND d.date >= date('now','-90 day')
         GROUP BY dl.product_id
       ) sold ON sold.product_id=p.id
       WHERE ${clauses.join(' AND ')}
       ORDER BY ${top ? 'units_sold DESC, p.name' : 'p.name'}${pagination}`,
      branchId,
      branchId,
      branchId,
      ...params,
    ),
  );
});
// --- Parked (held) sales: suspend a cart and resume it later ---
posRouter.get('/parked', requirePermission('pos:access'), (req, res) => {
  const scope = scopeFor(req.user, req.query.branch_id);
  res.json(
    listParkedSales(scope, {
      branchId: req.query.branch_id ? String(req.query.branch_id) : undefined,
      userId: req.query.mine === '1' ? req.user.id : undefined,
    }),
  );
});

posRouter.post('/parked', requirePermission('pos:access'), (req, res) => {
  res.status(201).json(parkSale(req.body, req.user));
});

posRouter.post('/parked/:id/resume', requirePermission('pos:access'), (req, res) => {
  res.json(resumeParkedSale(String(req.params.id), req.user));
});

posRouter.delete('/parked/:id', requirePermission('pos:access'), (req, res) => {
  res.json(discardParkedSale(String(req.params.id), req.user));
});
