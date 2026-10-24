import { Router, type Request } from 'express';
import { requirePermission } from '../../rbac';
import { scopeFor, type Actor } from '../../scope';
import {
  activities,
  assignees,
  crmOverview,
  changeDealStage,
  completeActivity,
  convertDealToCustomer,
  convertDealToQuotation,
  createActivity,
  createDeal,
  deal,
  deals,
  setTarget,
  stages,
  targets,
  updateActivity,
  updateDeal,
} from './service';
import {
  activityCompleteSchema,
  activityCreateSchema,
  activityListQuerySchema,
  activityUpdateSchema,
  dealCreateSchema,
  dealListQuerySchema,
  dealUpdateSchema,
  stageChangeSchema,
  targetCreateSchema,
  targetListQuerySchema,
} from './schemas';

export const crmRouter = Router();

function actorOf(req: Request): Actor {
  return { id: req.user.id, name: req.user.name, role: req.user.role };
}

// --- Pipeline stages ------------------------------------------------------------------

crmRouter.get('/stages', requirePermission('crm:view'), (_req, res) => {
  res.json(stages());
});

crmRouter.get('/assignees', requirePermission('crm:view'), (req, res) => {
  res.json(assignees(scopeFor(req.user, req.query.branch_id)));
});

// --- Dashboard ------------------------------------------------------------------------

crmRouter.get('/overview', requirePermission('crm:view'), (req, res) => {
  res.json(crmOverview(scopeFor(req.user, req.query.branch_id)));
});

// --- Deals ----------------------------------------------------------------------------

crmRouter.get('/deals', requirePermission('crm:view'), (req, res) => {
  const query = dealListQuerySchema.parse(req.query);
  res.json(deals(scopeFor(req.user, query.branch_id), query));
});

crmRouter.post('/deals', requirePermission('crm:manage'), (req, res) => {
  const input = dealCreateSchema.parse(req.body);
  const scope = scopeFor(req.user, input.branch_id);
  res.status(201).json(createDeal(input, actorOf(req), scope));
});

crmRouter.get('/deals/:id', requirePermission('crm:view'), (req, res) => {
  res.json(deal(String(req.params.id), scopeFor(req.user, req.query.branch_id)));
});

crmRouter.patch('/deals/:id', requirePermission('crm:manage'), (req, res) => {
  const input = dealUpdateSchema.parse(req.body);
  res.json(
    updateDeal(String(req.params.id), input, actorOf(req), scopeFor(req.user, req.query.branch_id)),
  );
});

crmRouter.patch('/deals/:id/stage', requirePermission('crm:manage'), (req, res) => {
  const input = stageChangeSchema.parse(req.body);
  res.json(
    changeDealStage(
      String(req.params.id),
      input.stage_id,
      input.lost_reason,
      actorOf(req),
      scopeFor(req.user, req.query.branch_id),
    ),
  );
});

crmRouter.post('/deals/:id/convert-customer', requirePermission('crm:manage'), (req, res) => {
  res.json(
    convertDealToCustomer(
      String(req.params.id),
      actorOf(req),
      scopeFor(req.user, req.query.branch_id),
    ),
  );
});

crmRouter.post('/deals/:id/convert-quotation', requirePermission('crm:manage'), (req, res) => {
  res.json(
    convertDealToQuotation(
      String(req.params.id),
      actorOf(req),
      scopeFor(req.user, req.query.branch_id),
    ),
  );
});

// --- Activities -----------------------------------------------------------------------

crmRouter.get('/activities', requirePermission('crm:view'), (req, res) => {
  const query = activityListQuerySchema.parse(req.query);
  res.json(activities(scopeFor(req.user, query.branch_id), query));
});

crmRouter.post('/activities', requirePermission('crm:manage'), (req, res) => {
  const input = activityCreateSchema.parse(req.body);
  res.status(201).json(createActivity(input, actorOf(req), scopeFor(req.user, input.branch_id)));
});

crmRouter.patch('/activities/:id', requirePermission('crm:manage'), (req, res) => {
  const input = activityUpdateSchema.parse(req.body);
  res.json(
    updateActivity(
      String(req.params.id),
      input,
      actorOf(req),
      scopeFor(req.user, req.query.branch_id),
    ),
  );
});

crmRouter.post('/activities/:id/complete', requirePermission('crm:manage'), (req, res) => {
  const input = activityCompleteSchema.parse(req.body);
  res.json(
    completeActivity(
      String(req.params.id),
      input.outcome_notes,
      actorOf(req),
      scopeFor(req.user, req.query.branch_id),
    ),
  );
});

// --- Sales targets --------------------------------------------------------------------

crmRouter.get('/targets', requirePermission('crm:view', 'reports:view'), (req, res) => {
  const query = targetListQuerySchema.parse(req.query);
  res.json(targets(scopeFor(req.user, query.branch_id), query.month, query.user_id));
});

crmRouter.post('/targets', requirePermission('crm:manage'), (req, res) => {
  const input = targetCreateSchema.parse(req.body);
  res.status(201).json(setTarget(input, actorOf(req), scopeFor(req.user, req.query.branch_id)));
});
