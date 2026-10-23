import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../rbac';
import {
  listStages,
  listDeals,
  getDeal,
  createDeal,
  updateDealStage,
  convertDealToCustomer,
  convertDealToQuotation,
  listActivities,
  createActivity,
  completeActivity,
  listSalesTargets,
  setSalesTarget,
} from '../crm';
import { AppError } from '../errors';

export const crmRouter = Router();

// --- Stages ---

crmRouter.get('/stages', requirePermission('crm:view', 'documents:view'), (_req, res) => {
  res.json(listStages());
});

// --- Deals ---

crmRouter.get('/deals', requirePermission('crm:view', 'documents:view'), (req, res) => {
  const deals = listDeals({
    branch_id: req.query.branch_id ? String(req.query.branch_id) : undefined,
    stage_id: req.query.stage_id ? String(req.query.stage_id) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    assigned_to: req.query.assigned_to ? String(req.query.assigned_to) : undefined,
    search: req.query.search ? String(req.query.search) : undefined,
  });
  res.json(deals);
});

crmRouter.post('/deals', requirePermission('crm:manage', 'documents:create_sale'), (req, res) => {
  const schema = z.object({
    title: z.string().trim().min(2, 'عنوان الصفقة مطلوب'),
    contact_name: z.string().trim().min(2, 'اسم جهة الاتصال مطلوب'),
    contact_phone: z.string().trim().optional(),
    contact_email: z.string().trim().optional(),
    party_id: z.string().optional(),
    stage_id: z.string().optional(),
    expected_revenue: z.number().int().min(0).default(0),
    probability: z.number().int().min(0).max(100).optional(),
    expected_close_date: z.string().optional(),
    assigned_to_user_id: z.string().optional(),
    branch_id: z.string().min(1, 'الفرع مطلوب'),
    notes: z.string().optional(),
  });
  const parsed = schema.parse(req.body);
  const deal = createDeal(parsed);
  res.status(201).json(deal);
});

crmRouter.get('/deals/:id', requirePermission('crm:view', 'documents:view'), (req, res) => {
  const deal = getDeal(String(req.params.id));
  if (!deal) throw new AppError(404, 'الصفقة غير موجودة');
  res.json(deal);
});

crmRouter.patch(
  '/deals/:id/stage',
  requirePermission('crm:manage', 'documents:create_sale'),
  (req, res) => {
    const schema = z.object({
      stage_id: z.string().min(1, 'المرحلة مطلوبة'),
    });
    const parsed = schema.parse(req.body);
    const deal = updateDealStage(String(req.params.id), parsed.stage_id);
    res.json(deal);
  },
);

crmRouter.post(
  '/deals/:id/convert-customer',
  requirePermission('crm:manage', 'parties:manage'),
  (req, res) => {
    const result = convertDealToCustomer(String(req.params.id));
    res.json(result);
  },
);

crmRouter.post(
  '/deals/:id/convert-quotation',
  requirePermission('crm:manage', 'documents:create_sale'),
  (req, res) => {
    const actor = {
      id: (req as any).user?.id || 'system',
      name: (req as any).user?.name || 'مسؤول المبيعات',
    };
    const result = convertDealToQuotation(String(req.params.id), actor);
    res.json(result);
  },
);

// --- Activities ---

crmRouter.get('/activities', requirePermission('crm:view', 'documents:view'), (req, res) => {
  const activities = listActivities({
    deal_id: req.query.deal_id ? String(req.query.deal_id) : undefined,
    party_id: req.query.party_id ? String(req.query.party_id) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    user_id: req.query.user_id ? String(req.query.user_id) : undefined,
  });
  res.json(activities);
});

crmRouter.post(
  '/activities',
  requirePermission('crm:manage', 'documents:create_sale'),
  (req, res) => {
    const schema = z.object({
      deal_id: z.string().optional(),
      party_id: z.string().optional(),
      type: z.enum(['CALL', 'MEETING', 'TASK', 'EMAIL', 'NOTE']),
      title: z.string().trim().min(2, 'عنوان النشاط مطلوب'),
      due_date: z.string().min(1, 'تاريخ الاستحقاق مطلوب'),
      due_time: z.string().optional(),
      assigned_to_user_id: z.string().optional(),
    });
    const parsed = schema.parse(req.body);
    const activity = createActivity(parsed);
    res.status(201).json(activity);
  },
);

crmRouter.post(
  '/activities/:id/complete',
  requirePermission('crm:manage', 'documents:create_sale'),
  (req, res) => {
    const schema = z.object({
      outcome_notes: z.string().optional(),
    });
    const parsed = schema.parse(req.body);
    const activity = completeActivity(String(req.params.id), parsed.outcome_notes);
    res.json(activity);
  },
);

// --- Sales Targets & Performance ---

crmRouter.get('/targets', requirePermission('crm:view', 'reports:view'), (req, res) => {
  const month = req.query.month ? String(req.query.month) : undefined;
  const userId = req.query.user_id ? String(req.query.user_id) : undefined;
  res.json(listSalesTargets(month, userId));
});

crmRouter.post('/targets', requirePermission('crm:manage', 'branches:manage'), (req, res) => {
  const schema = z.object({
    user_id: z.string().min(1, 'المستخدم مطلوب'),
    month: z.string().min(7, 'الشهر مطلوب بالصيغة YYYY-MM'),
    target_amount: z.number().int().positive('المستهدف يجب أن يكون أكبر من صفر'),
    commission_bps: z.number().int().min(0).default(200),
    notes: z.string().optional(),
  });
  const parsed = schema.parse(req.body);
  const target = setSalesTarget(parsed);
  res.status(201).json(target);
});
