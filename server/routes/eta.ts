import { Router } from 'express';
import { requirePermission } from '../rbac';
import {
  listSubmissions,
  retrySubmission,
  getSubmissionByDocument,
  processPendingSubmissions,
  buildEtaInvoice,
  etaQrPayload,
  etaConfigured,
} from '../eta';

export const etaRouter = Router();

/** Overall pipeline state: configured transport + queue counters. */
etaRouter.get('/eta/status', requirePermission('eta:view'), (_req, res) => {
  const submissions = listSubmissions(200);
  const summary = submissions.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});
  res.json({ configured: etaConfigured(), summary });
});

/** Submission log, newest first. */
etaRouter.get('/eta/submissions', requirePermission('eta:view'), (_req, res) => {
  res.json(listSubmissions(200));
});

/** Submission for a specific document (used by invoice screens). */
etaRouter.get('/eta/documents/:id/submission', requirePermission('eta:view'), (req, res) => {
  const submission = getSubmissionByDocument(String(req.params.id));
  res.json({ submission: submission ?? null, qr: etaQrPayload(String(req.params.id)) });
});

/** The UBL 2.1 JSON payload that would be sent to ETA (for audit/inspection). */
etaRouter.get('/eta/documents/:id/payload', requirePermission('eta:view'), (req, res) => {
  res.json(buildEtaInvoice(String(req.params.id)));
});

/** Force a due batch to be processed now (normally a background worker). */
etaRouter.post('/eta/process', requirePermission('eta:manage'), (_req, res) => {
  res.json(processPendingSubmissions(50));
});

/** Manual retry after a permanent failure. */
etaRouter.post('/eta/submissions/:id/retry', requirePermission('eta:manage'), (req, res) => {
  res.json(retrySubmission(String(req.params.id)));
});
