import { Router } from 'express';
import { z } from 'zod';
import { scopeFor } from '../scope';
import { visibleTransfer } from '../middleware';
import {
  listTransfers,
  createTransfer,
  updateTransfer,
  shipTransfer,
  receiveTransfer,
  cancelTransfer,
  suggestTransfers,
} from '../transfers';

export const transfersRouter = Router();

transfersRouter.get('/', (req, res) => {
  const status = req.query.status
    ? z.enum(['DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED']).parse(req.query.status)
    : undefined;
  res.json(listTransfers(scopeFor(req.user, req.query.branch_id), status));
});

transfersRouter.get('/suggestions', (req, res) =>
  res.json(suggestTransfers(req.user, scopeFor(req.user, req.query.branch_id))),
);

transfersRouter.post('/', (req, res) => res.status(201).json(createTransfer(req.body, req.user)));

transfersRouter.get('/:id', (req, res) =>
  res.json(visibleTransfer(req.user, String(req.params.id))),
);

transfersRouter.put('/:id', (req, res) =>
  res.json(updateTransfer(String(req.params.id), req.body, req.user)),
);

transfersRouter.post('/:id/ship', (req, res) =>
  res.json(shipTransfer(String(req.params.id), req.user)),
);

transfersRouter.post('/:id/receive', (req, res) =>
  res.json(receiveTransfer(String(req.params.id), req.body, req.user)),
);

transfersRouter.post('/:id/cancel', (req, res) =>
  res.json(cancelTransfer(String(req.params.id), req.user)),
);
