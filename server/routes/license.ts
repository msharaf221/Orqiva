import { Router, type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { transaction } from '../db';
import { audit } from '../service';
import { requirePermission } from '../rbac';
import { AppError } from '../errors';
import { checkLicenseKey, licenseAllowsBase, licenseStatus, storeLicenseKey } from '../license';

const keyBody = z.object({ key: z.string().trim().min(10).max(4000) });

/**
 * Locks the whole app until a valid base license is installed. Only health, login/session,
 * and the license endpoints stay reachable so a buyer can sign in and activate.
 */
export function requireBaseLicense(req: Request, res: Response, next: NextFunction) {
  if (licenseAllowsBase()) return next();
  const p = req.path;
  if (p === '/health' || p.startsWith('/auth/') || p === '/license' || p.startsWith('/license/'))
    return next();
  const { state } = licenseStatus();
  res.status(402).json({
    error: 'النظام يحتاج مفتاح ترخيص ساري للاستخدام',
    code: 'LICENSE_REQUIRED',
    state,
  });
}

/** Public routes: the activation screen runs before anyone has signed in. */
export const licensePublicRouter = Router();

licensePublicRouter.get('/license/status', (_req, res) => {
  const { enforced, state } = licenseStatus();
  res.json({ enforced, state, locked: !licenseAllowsBase() });
});

// A valid key can only be entered while the app is locked. Replacing a working key needs
// an administrator session (PUT /api/license below).
licensePublicRouter.put(
  '/license/activate',
  rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }),
  (req, res) => {
    if (licenseAllowsBase()) throw new AppError(409, 'النظام مفعّل بالفعل');
    const { key } = keyBody.parse(req.body);
    const problem = checkLicenseKey(key);
    if (problem) throw new AppError(400, problem);
    storeLicenseKey(key);
    const { enforced, state } = licenseStatus();
    res.json({ enforced, state, locked: !licenseAllowsBase() });
  },
);

export const licenseRouter = Router();

licenseRouter.get('/license', requirePermission('users:manage'), (_req, res) => {
  res.json(licenseStatus());
});

licenseRouter.put('/license', requirePermission('users:manage'), (req, res) => {
  const { key } = keyBody.parse(req.body);
  const problem = checkLicenseKey(key);
  if (problem) throw new AppError(400, problem);
  transaction(() => {
    storeLicenseKey(key);
    audit(req.user!, 'تثبيت مفتاح ترخيص', 'LICENSE', '1');
  });
  res.json(licenseStatus());
});
