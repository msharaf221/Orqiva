import { Router } from 'express';
import { period } from '../middleware';
import { requirePermission } from '../rbac';
import { scopeFor } from '../scope';
import { report, groupOverview } from '../reports';

export const reportsRouter = Router();

reportsRouter.get('/dashboard', (req, res) => {
  const input = period.parse(req.query);
  res.json(
    report(input.from, input.to, scopeFor(req.user, input.branch_id), req.user.role === 'ADMIN'),
  );
});

reportsRouter.get('/group/overview', requirePermission('reports:group_overview'), (req, res) => {
  const input = period.parse(req.query);
  res.json(groupOverview(input.from, input.to));
});
