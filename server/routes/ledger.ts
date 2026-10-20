import { Router } from 'express';
import { requirePermission } from '../rbac';
import { scopeFor } from '../scope';
import {
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  listJournalEntries,
  journalDetail,
  createJournalEntry,
  trialBalance,
  accountStatement,
  getGlSettings,
  updateGlSettings,
} from '../ledger';

export const ledgerRouter = Router();

// Chart of accounts
ledgerRouter.get('/gl/accounts', requirePermission('gl:view'), (_req, res) => {
  res.json(listAccounts());
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

// Settings / period lock
ledgerRouter.get('/gl/settings', requirePermission('gl:view'), (_req, res) => {
  res.json(getGlSettings());
});

ledgerRouter.put('/gl/settings', requirePermission('gl:manage'), (req, res) => {
  res.json(updateGlSettings(req.body, req.user));
});
