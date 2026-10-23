import { Router } from 'express';
import { requirePermission } from '../rbac';
import { scopeFor } from '../scope';
import {
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  suggestNextCode,
  listJournalEntries,
  journalDetail,
  createJournalEntry,
  trialBalance,
  accountStatement,
  profitLoss,
  balanceSheet,
  getOpeningBalancesStatus,
  postOpeningBalances,
  reverseOpeningBalances,
  getGlSettings,
  updateGlSettings,
  computeVatReturn,
  getTaxRegister,
} from '../ledger';

export const ledgerRouter = Router();

// Chart of accounts
ledgerRouter.get('/gl/accounts', requirePermission('gl:view'), (_req, res) => {
  res.json(listAccounts());
});

ledgerRouter.get('/gl/accounts/next-code', requirePermission('gl:view'), (req, res) => {
  const parentId = req.query.parent_id ? String(req.query.parent_id) : undefined;
  if (!parentId) {
    res.status(400).json({ error: 'parent_id مطلوب لاقتراح كود الحساب الفرعي' });
    return;
  }
  res.json(suggestNextCode(parentId));
});

ledgerRouter.post('/gl/accounts', requirePermission('gl:manage'), (req, res) => {
  res.status(201).json(createAccount(req.body, req.user));
});

ledgerRouter.put('/gl/accounts/:id', requirePermission('gl:manage'), (req, res) => {
  res.json(updateAccount(String(req.params.id), req.body, req.user));
});

ledgerRouter.delete('/gl/accounts/:id', requirePermission('gl:manage'), (req, res) => {
  res.json(deleteAccount(String(req.params.id), req.user));
});

// Journal entries
ledgerRouter.get('/gl/journal', requirePermission('gl:view'), (req, res) => {
  res.json(
    listJournalEntries(scopeFor(req.user, req.query.branch_id), {
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      branchId:
        req.query.branch_id && req.query.branch_id !== 'all'
          ? String(req.query.branch_id)
          : undefined,
      accountId: req.query.account_id ? String(req.query.account_id) : undefined,
      sourceType: req.query.source_type ? String(req.query.source_type) : undefined,
    }),
  );
});

ledgerRouter.post('/gl/journal', requirePermission('gl:manage'), (req, res) => {
  res.status(201).json(createJournalEntry(req.body, req.user));
});

ledgerRouter.get('/gl/journal/:id', requirePermission('gl:view'), (req, res) => {
  res.json(journalDetail(String(req.params.id)));
});

// Trial balance and account statements
ledgerRouter.get('/gl/trial-balance', requirePermission('gl:view'), (req, res) => {
  res.json(
    trialBalance(
      scopeFor(req.user, req.query.branch_id),
      req.query.from ? String(req.query.from) : undefined,
      req.query.to ? String(req.query.to) : undefined,
    ),
  );
});

ledgerRouter.get('/gl/accounts/:id/statement', requirePermission('gl:view'), (req, res) => {
  res.json(
    accountStatement(
      String(req.params.id),
      scopeFor(req.user, req.query.branch_id),
      req.query.from ? String(req.query.from) : undefined,
      req.query.to ? String(req.query.to) : undefined,
    ),
  );
});

// Profit and Loss Statement (قائمة الدخل)
ledgerRouter.get('/gl/profit-and-loss', requirePermission('gl:view'), (req, res) => {
  const scope = scopeFor(req.user, req.query.branch_id);
  const from = req.query.from ? String(req.query.from) : new Date().toISOString().slice(0, 10);
  const to = req.query.to ? String(req.query.to) : new Date().toISOString().slice(0, 10);
  const compareFrom = req.query.compare_from ? String(req.query.compare_from) : undefined;
  const compareTo = req.query.compare_to ? String(req.query.compare_to) : undefined;
  res.json(profitLoss(scope, from, to, compareFrom, compareTo));
});

// Balance Sheet (قائمة المركز المالي / الميزانية العمومية)
ledgerRouter.get('/gl/balance-sheet', requirePermission('gl:view'), (req, res) => {
  const scope = scopeFor(req.user, req.query.branch_id);
  const asOf = req.query.as_of ? String(req.query.as_of) : new Date().toISOString().slice(0, 10);
  const compareAsOf = req.query.compare_as_of ? String(req.query.compare_as_of) : undefined;
  res.json(balanceSheet(scope, asOf, compareAsOf));
});

// Opening Balances (معالج الأرصدة الافتتاحية)
ledgerRouter.get('/gl/opening-balances', requirePermission('gl:view'), (_req, res) => {
  res.json(getOpeningBalancesStatus());
});

ledgerRouter.post('/gl/opening-balances', requirePermission('gl:manage'), (req, res) => {
  res.status(201).json(postOpeningBalances(req.body, req.user));
});

ledgerRouter.post('/gl/opening-balances/reverse', requirePermission('gl:manage'), (req, res) => {
  res.json(reverseOpeningBalances(req.user));
});

// Settings / period lock
ledgerRouter.get('/gl/settings', requirePermission('gl:view'), (_req, res) => {
  res.json(getGlSettings());
});

ledgerRouter.put('/gl/settings', requirePermission('gl:manage'), (req, res) => {
  res.json(updateGlSettings(req.body, req.user));
});

// VAT Return Model 10 (إقرار ضريبة القيمة المضافة - نموذج 10)
ledgerRouter.get('/gl/vat-return', requirePermission('gl:view'), (req, res) => {
  const scope = scopeFor(req.user, req.query.branch_id);
  const from = req.query.from ? String(req.query.from) : new Date().toISOString().slice(0, 10);
  const to = req.query.to ? String(req.query.to) : new Date().toISOString().slice(0, 10);
  const branchId = req.query.branch_id ? String(req.query.branch_id) : undefined;
  res.json(computeVatReturn(from, to, branchId, scope));
});

// Tax Registers (سجل الفواتير الضريبية: مبيعات ومشتريات)
ledgerRouter.get('/gl/tax-register', requirePermission('gl:view'), (req, res) => {
  const scope = scopeFor(req.user, req.query.branch_id);
  const registerType = (req.query.register_type === 'PURCHASES' ? 'PURCHASES' : 'SALES') as
    'SALES' | 'PURCHASES';
  const from = req.query.from ? String(req.query.from) : new Date().toISOString().slice(0, 10);
  const to = req.query.to ? String(req.query.to) : new Date().toISOString().slice(0, 10);
  const branchId = req.query.branch_id ? String(req.query.branch_id) : undefined;
  res.json(getTaxRegister(registerType, from, to, branchId, scope));
});
