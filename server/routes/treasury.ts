import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../rbac';
import { scopeFor, type Actor } from '../scope';
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

/**
 * Cheques and bank reconciliation are accountant/treasury surfaces, not a generic
 * `finance:view` read. A sales user must not be able to enumerate banking papers.
 */
const canManageTreasury = requirePermission('finance:accounts');

/** Branch a new cheque belongs to when the client did not send one explicitly. */
function writeBranch(user: Actor, requested?: string): string {
  const scope = scopeFor(user, requested);
  if (requested) return requested;
  if (scope.ids === null) return 'main';
  if (!scope.ids.length) throw new AppError(400, 'لم يتم إسناد أي فرع لهذا المستخدم');
  return scope.ids.includes('main') ? 'main' : scope.ids[0];
}

// --- Cheques ---

treasuryRouter.get('/cheques', canManageTreasury, (req, res) => {
  const type = req.query.type ? (String(req.query.type) as ChequeType) : undefined;
  const status = req.query.status ? (String(req.query.status) as ChequeStatus) : undefined;
  const partyId = req.query.party_id ? String(req.query.party_id) : undefined;
  res.json(listCheques({ type, status, partyId }, scopeFor(req.user, req.query.branch_id)));
});

treasuryRouter.post('/cheques', canManageTreasury, (req, res) => {
  const schema = z.object({
    number: z.string().trim().min(1, 'رقم الشيك مطلوب'),
    type: z.enum(['RECEIVABLE', 'PAYABLE']),
    party_id: z.string().min(1, 'الطرف مطلوب'),
    bank_name: z.string().trim().min(1, 'اسم البنك مطلوب'),
    branch_id: z.string().optional(),
    branch_name: z.string().trim().optional(),
    amount: z.number().int().positive('المبلغ يجب أن يكون أكبر من صفر'),
    issue_date: z.string(),
    due_date: z.string(),
    notes: z.string().optional(),
  });
  const parsed = schema.parse(req.body);
  const branchId = writeBranch(req.user, parsed.branch_id);
  res
    .status(201)
    .json(createCheque({ ...parsed, branch_id: branchId }, req.user, scopeFor(req.user, branchId)));
});

treasuryRouter.get('/cheques/:id', canManageTreasury, (req, res) => {
  const c = getCheque(String(req.params.id), scopeFor(req.user, req.query.branch_id));
  if (!c) throw new AppError(404, 'الشيك غير موجود');
  res.json(c);
});

treasuryRouter.post('/cheques/:id/collect', canManageTreasury, (req, res) => {
  const { bank_account_id, collection_date } = req.body;
  if (!bank_account_id) throw new AppError(400, 'حساب البنك مطلوب');
  res.json(
    collectCheque(
      String(req.params.id),
      bank_account_id,
      collection_date,
      req.user,
      scopeFor(req.user),
    ),
  );
});

treasuryRouter.post('/cheques/:id/bounce', canManageTreasury, (req, res) => {
  const { reason } = req.body;
  res.json(bounceCheque(String(req.params.id), req.user, reason, scopeFor(req.user)));
});

treasuryRouter.post('/cheques/:id/pay', canManageTreasury, (req, res) => {
  const { bank_account_id, payment_date } = req.body;
  if (!bank_account_id) throw new AppError(400, 'حساب البنك مطلوب');
  res.json(
    payCheque(String(req.params.id), bank_account_id, payment_date, req.user, scopeFor(req.user)),
  );
});

// --- Bank Reconciliation ---

treasuryRouter.get('/bank-statements', canManageTreasury, (req, res) => {
  const accId = req.query.cash_account_id ? String(req.query.cash_account_id) : undefined;
  res.json(listBankStatements(scopeFor(req.user, req.query.branch_id), accId));
});

treasuryRouter.post('/bank-statements', canManageTreasury, (req, res) => {
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
  res.status(201).json(createBankStatement(parsed, scopeFor(req.user)));
});

treasuryRouter.get('/bank-statements/:id', canManageTreasury, (req, res) => {
  const stmt = getBankStatement(String(req.params.id), scopeFor(req.user, req.query.branch_id));
  if (!stmt) throw new AppError(404, 'كشف الحساب غير موجود');
  res.json(stmt);
});

treasuryRouter.post('/bank-statements/lines/:lineId/match', canManageTreasury, (req, res) => {
  const { payment_id } = req.body;
  if (!payment_id) throw new AppError(400, 'معرف حركة السداد مطلوب');
  matchStatementLine(String(req.params.lineId), payment_id, scopeFor(req.user));
  res.json({ ok: true });
});

// --- Cash Flow Forecast ---

treasuryRouter.get('/cash-flow-forecast', canManageTreasury, (req, res) => {
  const days = Math.max(7, parseInt(String(req.query.days || '30')) || 30);
  res.json(forecastCashFlow(days, scopeFor(req.user, req.query.branch_id)));
});

// --- Cost Centers ---

treasuryRouter.get('/cost-centers', canManageTreasury, (_req, res) => {
  res.json(listCostCenters());
});

treasuryRouter.post('/cost-centers', canManageTreasury, (req, res) => {
  const schema = z.object({
    code: z.string().trim().min(1, 'كود مركز التكلفة مطلوب'),
    name: z.string().trim().min(2, 'اسم مركز التكلفة مطلوب'),
    parent_id: z.string().optional(),
    notes: z.string().optional(),
  });
  const parsed = schema.parse(req.body);
  res.status(201).json(createCostCenter(parsed));
});
