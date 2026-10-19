import { Router } from 'express';
import { requirePermission } from '../rbac';
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
 */
const canReadAccounts = requirePermission('finance:view', 'finance:payments', 'finance:expenses');

accountsRouter.get('/', canReadAccounts, (req, res) => {
  const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined;
  res.json(listCashAccounts(branchId));
});

accountsRouter.get('/transfers', canReadAccounts, (_req, res) => {
  res.json(listAccountTransfers());
});

accountsRouter.get('/:id', canReadAccounts, (req, res) => {
  res.json(getCashAccount(String(req.params.id)));
});

accountsRouter.get('/:id/statement', canReadAccounts, (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  res.json(getAccountStatement(String(req.params.id), from, to));
});

accountsRouter.post('/', requirePermission('finance:accounts'), (req, res) => {
  res.status(201).json(createCashAccount(req.body, req.user));
});

accountsRouter.put('/:id', requirePermission('finance:accounts'), (req, res) => {
  res.json(updateCashAccount(String(req.params.id), req.body, req.user));
});

accountsRouter.post('/transfers', requirePermission('finance:accounts'), (req, res) => {
  res.status(201).json(createAccountTransfer(req.body, req.user));
});
