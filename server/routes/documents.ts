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
import type { Document } from '../../src/types';

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
