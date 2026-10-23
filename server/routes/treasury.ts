import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../rbac';
import {
  listCheques,
  getCheque,
  createCheque,
  collectCheque,
  bounceCheque,
  payCheque,
} from '../cheques';
import {
  listCostCenters,
  createCostCenter,
  listBankStatements,
  getBankStatement,
  createBankStatement,
  matchStatementLine,
  forecastCashFlow,
} from '../treasury_advanced';
import { AppError } from '../errors';
import type { ChequeType, ChequeStatus } from '../../src/types';

export const treasuryRouter = Router();

// --- Cheques ---

treasuryRouter.get('/cheques', requirePermission('finance:view'), (req, res) => {
  const type = req.query.type ? (String(req.query.type) as ChequeType) : undefined;
  const status = req.query.status ? (String(req.query.status) as ChequeStatus) : undefined;
  const partyId = req.query.party_id ? String(req.query.party_id) : undefined;
  res.json(listCheques({ type, status, partyId }));
});

treasuryRouter.post('/cheques', requirePermission('finance:accounts'), (req, res) => {
  const schema = z.object({
    number: z.string().trim().min(1, 'رقم الشيك مطلوب'),
    type: z.enum(['RECEIVABLE', 'PAYABLE']),
    party_id: z.string().min(1, 'الطرف مطلوب'),
    bank_name: z.string().trim().min(1, 'اسم البنك مطلوب'),
    branch_name: z.string().trim().optional(),
    amount: z.number().int().positive('المبلغ يجب أن يكون أكبر من صفر'),
    issue_date: z.string(),
    due_date: z.string(),
    notes: z.string().optional(),
  });
  const parsed = schema.parse(req.body);
  res.status(201).json(createCheque(parsed, req.user?.id));
});

treasuryRouter.get('/cheques/:id', requirePermission('finance:view'), (req, res) => {
  const c = getCheque(String(req.params.id));
  if (!c) throw new AppError(404, 'الشيك غير موجود');
  res.json(c);
});

treasuryRouter.post('/cheques/:id/collect', requirePermission('finance:accounts'), (req, res) => {
  const { bank_account_id, collection_date } = req.body;
  if (!bank_account_id) throw new AppError(400, 'حساب البنك مطلوب');
  res.json(collectCheque(String(req.params.id), bank_account_id, collection_date, req.user?.id));
});

treasuryRouter.post('/cheques/:id/bounce', requirePermission('finance:accounts'), (req, res) => {
  const { reason } = req.body;
  res.json(bounceCheque(String(req.params.id), req.user?.id, reason));
});

treasuryRouter.post('/cheques/:id/pay', requirePermission('finance:accounts'), (req, res) => {
  const { bank_account_id, payment_date } = req.body;
  if (!bank_account_id) throw new AppError(400, 'حساب البنك مطلوب');
  res.json(payCheque(String(req.params.id), bank_account_id, payment_date, req.user?.id));
});

// --- Bank Reconciliation ---

treasuryRouter.get('/bank-statements', requirePermission('finance:view'), (req, res) => {
  const accId = req.query.cash_account_id ? String(req.query.cash_account_id) : undefined;
  res.json(listBankStatements(accId));
});

treasuryRouter.post('/bank-statements', requirePermission('finance:accounts'), (req, res) => {
  const schema = z.object({
    cash_account_id: z.string().min(1),
    statement_date: z.string(),
    opening_balance: z.number().int(),
    closing_balance: z.number().int(),
    notes: z.string().optional(),
    lines: z.array(
      z.object({
        date: z.string(),
        description: z.string().min(1),
        reference: z.string().optional(),
        amount: z.number().int(),
      }),
    ),
  });
  const parsed = schema.parse(req.body);
  res.status(201).json(createBankStatement(parsed));
});

treasuryRouter.get('/bank-statements/:id', requirePermission('finance:view'), (req, res) => {
  const stmt = getBankStatement(String(req.params.id));
  if (!stmt) throw new AppError(404, 'كشف الحساب غير موجود');
  res.json(stmt);
});

treasuryRouter.post(
  '/bank-statements/lines/:lineId/match',
  requirePermission('finance:accounts'),
  (req, res) => {
    const { payment_id } = req.body;
    if (!payment_id) throw new AppError(400, 'معرف حركة السداد مطلوب');
    matchStatementLine(String(req.params.lineId), payment_id);
    res.json({ ok: true });
  },
);

// --- Cash Flow Forecast ---

treasuryRouter.get('/cash-flow-forecast', requirePermission('reports:view'), (req, res) => {
  const days = Math.max(7, parseInt(String(req.query.days || '30')) || 30);
  res.json(forecastCashFlow(days));
});

// --- Cost Centers ---

treasuryRouter.get('/cost-centers', requirePermission('finance:view'), (_req, res) => {
  res.json(listCostCenters());
});

treasuryRouter.post('/cost-centers', requirePermission('finance:accounts'), (req, res) => {
  const schema = z.object({
    code: z.string().trim().min(1, 'كود مركز التكلفة مطلوب'),
    name: z.string().trim().min(2, 'اسم مركز التكلفة مطلوب'),
    parent_id: z.string().optional(),
    notes: z.string().optional(),
  });
  const parsed = schema.parse(req.body);
  res.status(201).json(createCostCenter(parsed));
});
