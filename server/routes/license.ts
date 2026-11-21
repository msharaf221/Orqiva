import { Router } from 'express';
import { z } from 'zod';
import { run, transaction, now } from '../db';
import { audit } from '../service';
import { requirePermission } from '../rbac';
import { AppError } from '../errors';
import { checkLicenseKey, licenseStatus } from '../license';

export const licenseRouter = Router();

licenseRouter.get('/license', requirePermission('users:manage'), (_req, res) => {
  res.json(licenseStatus());
});

licenseRouter.put('/license', requirePermission('users:manage'), (req, res) => {
  const { key } = z.object({ key: z.string().trim().min(10).max(4000) }).parse(req.body);
  const problem = checkLicenseKey(key);
  if (problem) throw new AppError(400, problem);
  transaction(() => {
    run(
      'INSERT INTO license(id,key,installed_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET key=excluded.key, installed_at=excluded.installed_at',
      key,
      now(),
    );
    audit(req.user!, 'تثبيت مفتاح ترخيص', 'LICENSE', '1');
  });
  res.json(licenseStatus());
});
