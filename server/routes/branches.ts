import { Router } from 'express';
import { requirePermission } from '../rbac';
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

branchesRouter.post('/', requirePermission('branches:manage'), (req, res) =>
  res.status(201).json(createBranch(req.body, req.user)),
);

branchesRouter.get('/:id', (req, res) => {
  const branchId = String(req.params.id);
  scopeFor(req.user, branchId);
  res.json(branchDetail(branchId));
});

branchesRouter.put('/:id', requirePermission('branches:manage'), (req, res) =>
  res.json(updateBranch(String(req.params.id), req.body, req.user)),
);

branchesRouter.patch('/:id/active', requirePermission('branches:manage'), (req, res) =>
  res.json(setBranchActive(String(req.params.id), req.body, req.user)),
);

branchesRouter.get('/:id/assortment', (req, res) => {
  const branchId = String(req.params.id);
  scopeFor(req.user, branchId);
  res.json(assortment(branchId));
});

branchesRouter.put('/:id/products/:productId', requirePermission('branches:manage'), (req, res) =>
  res.json(
    setAssortmentItem(String(req.params.id), String(req.params.productId), req.body, req.user),
  ),
);

branchesRouter.get('/:id/staff', requirePermission('branches:manage'), (req, res) =>
  res.json(branchStaff(String(req.params.id))),
);

branchesRouter.put('/:id/staff', requirePermission('branches:manage'), (req, res) =>
  res.json(setBranchStaff(String(req.params.id), req.body, req.user)),
);
