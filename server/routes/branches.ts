import { Router } from 'express';
import { admin } from '../middleware';
import { scopeFor } from '../scope';
import {
  listBranches,
  branchDetail,
  createBranch,
  updateBranch,
  setBranchActive,
  assortment,
  setAssortmentItem,
  branchStaff,
  setBranchStaff,
} from '../branches';

export const branchesRouter = Router();

branchesRouter.get('/', (req, res) =>
  res.json(listBranches(req.user, req.query.include_archived === '1')),
);

branchesRouter.post('/', admin, (req, res) =>
  res.status(201).json(createBranch(req.body, req.user)),
);

branchesRouter.get('/:id', (req, res) => {
  const branchId = String(req.params.id);
  scopeFor(req.user, branchId);
  res.json(branchDetail(branchId));
});

branchesRouter.put('/:id', admin, (req, res) =>
  res.json(updateBranch(String(req.params.id), req.body, req.user)),
);

branchesRouter.patch('/:id/active', admin, (req, res) =>
  res.json(setBranchActive(String(req.params.id), req.body, req.user)),
);

branchesRouter.get('/:id/assortment', (req, res) => {
  const branchId = String(req.params.id);
  scopeFor(req.user, branchId);
  res.json(assortment(branchId));
});

branchesRouter.put('/:id/products/:productId', admin, (req, res) =>
  res.json(
    setAssortmentItem(String(req.params.id), String(req.params.productId), req.body, req.user),
  ),
);

branchesRouter.get('/:id/staff', admin, (req, res) => res.json(branchStaff(String(req.params.id))));

branchesRouter.put('/:id/staff', admin, (req, res) =>
  res.json(setBranchStaff(String(req.params.id), req.body, req.user)),
);
