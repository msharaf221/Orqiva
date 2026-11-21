import type { AddonManifest } from '../../addons/registry';
import { backupRouter } from './routes';

export const backupAddon: AddonManifest = {
  id: 'backup',
  name: 'النسخ الاحتياطي المجدول والسحابي',
  version: '1.0.0',
  mountPath: '/api/backup',
  licenseExempt: true,
  router: backupRouter,
};
