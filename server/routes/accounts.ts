import { Router } from 'express';
import { requirePermission } from '../rbac';
import { scopeFor } from '../scope';
import {
  listCashAccounts,
  getCashAccount,
  createCashAccount,
  updateCashAccount,
  createAccountTransfer,
  listAccountTransfers,
  getAccountStatement,
} from '../accounts';

export const accountsRouter = Router();

/**
 * قراءة الصناديق النقدية متاحة لكل من يملك قراءة المالية أو تسجيل الدفعات أو المصروفات
 * (نماذج الدفع/التحصيل تعتمد على قائمة الصناديق)؛ أما الإنشاء والتعديل فبصلاحية finance:accounts.
 * كل قراءة مقيدة بفروع المستخدم، والحسابات العامة (بلا فرع) تبقى مشتركة.
 */
const canReadAccounts = requirePermission('finance:view', 'finance:payments', 'finance:expenses');

accountsRouter.get('/', canReadAccounts, (req, res) => {
  res.json(listCashAccounts(scopeFor(req.user, req.query.branch_id)));
});

accountsRouter.get('/transfers', canReadAccounts, (req, res) => {
  res.json(listAccountTransfers(scopeFor(req.user, req.query.branch_id)));
});

accountsRouter.get('/:id', canReadAccounts, (req, res) => {
  res.json(getCashAccount(String(req.params.id), scopeFor(req.user)));
});

accountsRouter.get('/:id/statement', canReadAccounts, (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  res.json(getAccountStatement(String(req.params.id), from, to, scopeFor(req.user)));
});

accountsRouter.post('/', requirePermission('finance:accounts'), (req, res) => {
  res.status(201).json(createCashAccount(req.body, req.user));
});

accountsRouter.put('/:id', requirePermission('finance:accounts'), (req, res) => {
  res.json(updateCashAccount(String(req.params.id), req.body, req.user, scopeFor(req.user)));
});

accountsRouter.post('/transfers', requirePermission('finance:accounts'), (req, res) => {
  res.status(201).json(createAccountTransfer(req.body, req.user, scopeFor(req.user)));
});
