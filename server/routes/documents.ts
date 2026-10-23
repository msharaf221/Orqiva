import { Router } from 'express';
import { z } from 'zod';
import { all } from '../db';
import {
  AppError,
  saveDocument,
  documentDetail,
  postDocument,
  cancelDocument,
  addPayment,
} from '../service';
import { getReturnableLines } from '../returns';
import { canSee, scopeFor, scopeSql } from '../scope';
import { requirePermission } from '../rbac';
import { authorizeDoc, authorizePost, authorizePayment } from '../middleware';
import {
  listPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  updatePurchaseOrder,
  confirmPurchaseOrder,
  cancelPurchaseOrder,
  receivePurchaseOrder,
  listLandedCosts,
  applyLandedCost,
} from '../purchase_orders';
import {
  listPriceLists,
  getPriceList,
  createPriceList,
  updatePriceList,
  setPriceListItem,
  deletePriceListItem,
  assignPartyPriceList,
  getPartyPriceList,
  resolveProductPrice,
} from '../pricing';
import {
  listQuotations,
  getQuotation,
  createQuotation,
  confirmQuotation,
  rejectQuotation,
  convertQuotationToSale,
} from '../quotations';
import { priceListSchema, priceListItemSchema, quotationSchema } from '../validation';
import type { Document, QuotationType, QuotationStatus } from '../../src/types';

export const documentsRouter = Router();

documentsRouter.get('/documents', (req, res) => {
  const type = z
    .enum(['SALE', 'PURCHASE', 'SALE_RETURN', 'PURCHASE_RETURN'])
    .optional()
    .parse(req.query.type);
  const f = scopeSql('d.branch_id', scopeFor(req.user, req.query.branch_id));
  const typeClause = type ? 'd.type=?' : '1=1';
  const typeParams = type ? [type] : [];
  const origClause = req.query.original_document_id ? 'd.original_document_id=?' : '1=1';
  const origParams = req.query.original_document_id ? [String(req.query.original_document_id)] : [];

  res.json(
    all<Document>(
      `SELECT d.*,p.name party_name,b.name branch_name,b.code branch_code,
        (SELECT number FROM documents WHERE id=d.original_document_id) original_document_number
       FROM documents d
       JOIN parties p ON p.id=d.party_id JOIN branches b ON b.id=d.branch_id
       WHERE ${typeClause} AND ${origClause} AND ${f.sql} ORDER BY d.date DESC,d.created_at DESC`,
      ...typeParams,
      ...origParams,
      ...f.params,
    ),
  );
});

documentsRouter.get('/documents/:id/returnable', (req, res) => {
  const doc = documentDetail(String(req.params.id));
  if (!canSee(req.user, doc.branch_id)) throw new AppError(403, 'ليس لديك صلاحية على هذه الفاتورة');
  res.json(getReturnableLines(String(req.params.id)));
});

documentsRouter.get('/documents/:id', (req, res) => {
  const doc = documentDetail(String(req.params.id));
  if (!canSee(req.user, doc.branch_id)) throw new AppError(403, 'ليس لديك صلاحية على هذه الفاتورة');
  res.json(doc);
});

documentsRouter.post('/documents', authorizeDoc, (req, res) =>
  res.status(201).json(saveDocument(req.body, req.user)),
);

documentsRouter.put('/documents/:id', authorizeDoc, (req, res) =>
  res.json(saveDocument(req.body, req.user, String(req.params.id))),
);

documentsRouter.post('/documents/:id/post', authorizePost, (req, res) =>
  res.json(postDocument(String(req.params.id), req.user)),
);

documentsRouter.post('/documents/:id/cancel', requirePermission('documents:cancel'), (req, res) =>
  res.json(cancelDocument(String(req.params.id), req.user)),
);

documentsRouter.post('/documents/:id/payments', authorizePayment, (req, res) =>
  res
    .status(201)
    .json(addPayment(String(req.params.id), req.body, req.user, req.get('Idempotency-Key'))),
);

documentsRouter.get('/payments', (req, res) => {
  const f = scopeSql('d.branch_id', scopeFor(req.user, req.query.branch_id));
  res.json(
    all(
      `SELECT p.*,d.number,d.type,pr.name party_name,b.name branch_name FROM payments p
       JOIN documents d ON d.id=p.document_id JOIN parties pr ON pr.id=d.party_id
       JOIN branches b ON b.id=d.branch_id
       WHERE ${f.sql} ORDER BY p.date DESC,p.created_at DESC`,
      ...f.params,
    ),
  );
});

// ---------------------------------------------------------------------------
// Purchase Orders & Landed Costs
// ---------------------------------------------------------------------------

documentsRouter.get('/purchase-orders', (req, res) => {
  res.json(
    listPurchaseOrders(req.user, {
      branchId: req.query.branch_id ? String(req.query.branch_id) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      partyId: req.query.party_id ? String(req.query.party_id) : undefined,
    }),
  );
});

documentsRouter.post(
  '/purchase-orders',
  requirePermission('documents:create_purchase'),
  (req, res) => {
    res.status(201).json(createPurchaseOrder(req.body, req.user));
  },
);

documentsRouter.get('/purchase-orders/:id', (req, res) => {
  res.json(getPurchaseOrder(String(req.params.id), req.user));
});

documentsRouter.put(
  '/purchase-orders/:id',
  requirePermission('documents:create_purchase'),
  (req, res) => {
    res.json(updatePurchaseOrder(String(req.params.id), req.body, req.user));
  },
);

documentsRouter.post(
  '/purchase-orders/:id/confirm',
  requirePermission('documents:create_purchase'),
  (req, res) => {
    res.json(confirmPurchaseOrder(String(req.params.id), req.user));
  },
);

documentsRouter.post(
  '/purchase-orders/:id/cancel',
  requirePermission('documents:cancel'),
  (req, res) => {
    res.json(cancelPurchaseOrder(String(req.params.id), req.user));
  },
);

documentsRouter.post(
  '/purchase-orders/:id/receive',
  requirePermission('documents:create_purchase'),
  (req, res) => {
    res.json(receivePurchaseOrder(String(req.params.id), req.user, req.body));
  },
);

documentsRouter.get('/documents/:id/landed-costs', (req, res) => {
  res.json(listLandedCosts(String(req.params.id), req.user));
});

documentsRouter.post(
  '/documents/:id/landed-costs',
  requirePermission('documents:create_purchase'),
  (req, res) => {
    res.status(201).json(applyLandedCost(String(req.params.id), req.body, req.user));
  },
);

// --- Phase 3: Quotations & Proforma Invoices ---

documentsRouter.get('/quotations', (req, res) => {
  const branchId = req.query.branch_id ? String(req.query.branch_id) : undefined;
  const type = req.query.type ? (String(req.query.type) as QuotationType) : undefined;
  const status = req.query.status ? (String(req.query.status) as QuotationStatus) : undefined;
  res.json(listQuotations({ branchId, type, status }));
});

documentsRouter.post('/quotations', requirePermission('documents:create'), (req, res) => {
  const parsed = quotationSchema.parse(req.body);
  res.status(201).json(createQuotation(parsed, req.user?.id));
});

documentsRouter.get('/quotations/:id', (req, res) => {
  const q = getQuotation(String(req.params.id));
  if (!q) throw new AppError(404, 'عرض السعر غير موجود');
  res.json(q);
});

documentsRouter.post(
  '/quotations/:id/confirm',
  requirePermission('documents:create'),
  (req, res) => {
    res.json(confirmQuotation(String(req.params.id), req.user?.id));
  },
);

documentsRouter.post(
  '/quotations/:id/reject',
  requirePermission('documents:create'),
  (req, res) => {
    res.json(rejectQuotation(String(req.params.id), req.user?.id));
  },
);

documentsRouter.post(
  '/quotations/:id/convert',
  requirePermission('documents:create'),
  (req, res) => {
    res.json(convertQuotationToSale(String(req.params.id), req.user?.id));
  },
);

// --- Phase 3: Price Lists & Customer Tiers ---

documentsRouter.get('/price-lists', (_req, res) => {
  res.json(listPriceLists());
});

documentsRouter.post('/price-lists', requirePermission('catalog:edit'), (req, res) => {
  const parsed = priceListSchema.parse(req.body);
  res.status(201).json(createPriceList(parsed));
});

documentsRouter.get('/price-lists/:id', (req, res) => {
  const pl = getPriceList(String(req.params.id));
  if (!pl) throw new AppError(404, 'قائمة الأسعار غير موجودة');
  res.json(pl);
});

documentsRouter.put('/price-lists/:id', requirePermission('catalog:edit'), (req, res) => {
  res.json(updatePriceList(String(req.params.id), req.body));
});

documentsRouter.post('/price-lists/:id/items', requirePermission('catalog:edit'), (req, res) => {
  const parsed = priceListItemSchema.parse({
    ...req.body,
    price_list_id: req.params.id,
  });
  res.status(201).json(setPriceListItem(parsed));
});

documentsRouter.delete(
  '/price-lists/items/:itemId',
  requirePermission('catalog:edit'),
  (req, res) => {
    deletePriceListItem(String(req.params.itemId));
    res.json({ ok: true });
  },
);

documentsRouter.get('/pricing/resolve', (req, res) => {
  const productId = String(req.query.product_id || '');
  const quantity = Math.max(1, parseInt(String(req.query.quantity || '1')) || 1);
  const partyId = req.query.party_id ? String(req.query.party_id) : undefined;
  const priceListId = req.query.price_list_id ? String(req.query.price_list_id) : undefined;

  if (!productId) throw new AppError(400, 'كود المنتج مطلوب');
  res.json(resolveProductPrice(productId, quantity, partyId, priceListId));
});

documentsRouter.post('/parties/:id/price-list', requirePermission('parties:edit'), (req, res) => {
  const plId = req.body.price_list_id ? String(req.body.price_list_id) : null;
  assignPartyPriceList(String(req.params.id), plId);
  res.json({ ok: true });
});

documentsRouter.get('/parties/:id/price-list', (req, res) => {
  res.json(getPartyPriceList(String(req.params.id)));
});
