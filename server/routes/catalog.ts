import { Router } from 'express';
import { z } from 'zod';
import { all, one, run, transaction } from '../db';
import { audit, requireRow } from '../service';
import { admin } from '../middleware';
import { requirePermission } from '../rbac';
import { scopeFor, scopeSql } from '../scope';
import { listProducts, createProduct, updateProduct, adjustStock } from '../catalog';
import { stockMatrix } from '../reports';
import {
  startStocktake,
  listStocktakes,
  getStocktake,
  stocktakeLines,
  saveCounts,
  submitStocktake,
  approveStocktake,
  cancelStocktake,
  reorderSuggestions,
} from '../stocktake';

export const catalogRouter = Router();

// Products CRUD & Adjustments
catalogRouter.get('/products', (req, res) =>
  res.json(listProducts(scopeFor(req.user, req.query.branch_id))),
);

catalogRouter.post('/products', requirePermission('catalog:manage'), (req, res) =>
  res.status(201).json(createProduct(req.body, req.user)),
);

catalogRouter.put('/products/:id', requirePermission('catalog:manage'), (req, res) =>
  res.json(updateProduct(String(req.params.id), req.body, req.user)),
);

catalogRouter.post('/products/:id/adjust', requirePermission('inventory:adjust'), (req, res) =>
  res.json(adjustStock(String(req.params.id), req.body, req.user)),
);

catalogRouter.patch('/products/:id/active', requirePermission('catalog:manage'), (req, res) => {
  const entityId = String(req.params.id);
  const { active } = z.object({ active: z.boolean() }).strict().parse(req.body);
  requireRow(one('SELECT id FROM products WHERE id=?', entityId));
  transaction(() => {
    run('UPDATE products SET active=? WHERE id=?', active ? 1 : 0, entityId);
    audit(req.user, active ? 'إعادة تفعيل' : 'أرشفة', 'PRODUCT', entityId);
  });
  res.json({ ok: true });
});

// Stock Matrix
catalogRouter.get('/stock/matrix', (req, res) =>
  res.json(stockMatrix(scopeFor(req.user, req.query.branch_id))),
);

/**
 * The branch query parameter is `all` for the group view; only a concrete branch id should narrow
 * the query further, since the scope already resolves the group case.
 */
function explicitBranch(value: unknown): string | undefined {
  return typeof value === 'string' && value && value !== 'all' ? value : undefined;
}

// Reorder suggestions — products at or below their reorder threshold
catalogRouter.get('/inventory/reorder', requirePermission('inventory:view'), (req, res) => {
  res.json(
    reorderSuggestions(
      scopeFor(req.user, req.query.branch_id),
      explicitBranch(req.query.branch_id),
    ),
  );
});

// Periodic Stocktake (جرد دوري)
catalogRouter.get('/stocktakes', requirePermission('inventory:view'), (req, res) => {
  res.json(
    listStocktakes(scopeFor(req.user, req.query.branch_id), explicitBranch(req.query.branch_id)),
  );
});

catalogRouter.post('/stocktakes', requirePermission('inventory:adjust'), (req, res) => {
  res.status(201).json(startStocktake(req.body, req.user));
});

catalogRouter.get('/stocktakes/:id', requirePermission('inventory:view'), (req, res) => {
  const session = getStocktake(String(req.params.id));
  res.json({ session, lines: stocktakeLines(String(req.params.id)) });
});

catalogRouter.put('/stocktakes/:id/counts', requirePermission('inventory:adjust'), (req, res) => {
  res.json(saveCounts(String(req.params.id), req.body, req.user));
});

catalogRouter.post('/stocktakes/:id/submit', requirePermission('inventory:adjust'), (req, res) => {
  res.json(submitStocktake(String(req.params.id), req.user));
});

catalogRouter.post(
  '/stocktakes/:id/approve',
  requirePermission('inventory:stocktake_approve'),
  (req, res) => {
    res.json(approveStocktake(String(req.params.id), req.user));
  },
);

catalogRouter.post('/stocktakes/:id/cancel', requirePermission('inventory:adjust'), (req, res) => {
  res.json(cancelStocktake(String(req.params.id), req.user));
});

// Stock Movements
catalogRouter.get('/movements', (req, res) => {
  const scope = scopeFor(req.user, req.query.branch_id);
  const f = scopeSql('m.branch_id', scope);
  res.json(
    all(
      `SELECT m.*,p.name product_name,p.sku,d.number,u.name user_name,b.name branch_name,t.number transfer_number
       FROM stock_movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.created_by
       JOIN branches b ON b.id=m.branch_id LEFT JOIN documents d ON d.id=m.document_id
       LEFT JOIN transfers t ON t.id=m.transfer_id
       WHERE ${f.sql} ORDER BY m.created_at DESC,m.rowid DESC LIMIT 1000`,
      ...f.params,
    ),
  );
});

// Cost Movements History (Admin only)
catalogRouter.get('/cost-movements', admin, (req, res) => {
  const scope = scopeFor(req.user, req.query.branch_id);
  const f = scopeSql('cm.branch_id', scope);
  res.json(
    all(
      `SELECT cm.*,p.name product_name,p.sku,b.name branch_name,u.name user_name
       FROM cost_movements cm
       JOIN products p ON p.id=cm.product_id
       JOIN branches b ON b.id=cm.branch_id
       JOIN users u ON u.id=cm.created_by
       WHERE ${f.sql} ORDER BY cm.created_at DESC,cm.rowid DESC LIMIT 500`,
      ...f.params,
    ),
  );
});

// Branch Cost Audit (Admin only)
catalogRouter.get('/branch-cost', admin, (req, res) => {
  const scope = scopeFor(req.user, req.query.branch_id);
  const f = scopeSql('bc.branch_id', scope);
  res.json(
    all(
      `SELECT bc.*,p.name product_name,p.sku,p.cost_price ref_cost,b.name branch_name,
        COALESCE(bs.quantity,0) qty
       FROM branch_cost bc
       JOIN products p ON p.id=bc.product_id
       JOIN branches b ON b.id=bc.branch_id
       LEFT JOIN branch_stock bs ON bs.branch_id=bc.branch_id AND bs.product_id=bc.product_id
       WHERE ${f.sql} ORDER BY b.code,p.name`,
      ...f.params,
    ),
  );
});
