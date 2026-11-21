import { Router } from 'express';
import { requirePermission } from '../../rbac';
import { AppError } from '../../errors';
import { transaction } from '../../db';
import { audit } from '../../service';
import { backupDir, backupPath, cloudStatus, listBackups, runBackup } from './service';

export const backupRouter = Router();
const adminOnly = requirePermission('users:manage');

backupRouter.get('/', adminOnly, (_req, res) => {
  res.json({ backups: listBackups(), cloud: cloudStatus(), directory: backupDir() });
});

backupRouter.post('/run', adminOnly, async (req, res) => {
  let result;
  try {
    result = await runBackup();
  } catch (e) {
    throw new AppError(409, (e as Error).message);
  }
  transaction(() => audit(req.user!, 'نسخة احتياطية يدوية', 'BACKUP', result.file.name));
  res.json(result);
});

backupRouter.get('/download/:name', adminOnly, (req, res) => {
  const file = backupPath(String(req.params.name));
  if (!file) throw new AppError(404, 'النسخة الاحتياطية غير موجودة');
  transaction(() => audit(req.user!, 'تنزيل نسخة احتياطية', 'BACKUP', String(req.params.name)));
  res.download(file);
});
