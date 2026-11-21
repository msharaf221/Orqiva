import type { AddonManifest } from '../../addons/registry';
import { crmRouter } from './routes';

export const crmAddon: AddonManifest = {
  id: 'crm',
  name: 'إدارة العملاء والصفقات (CRM)',
  version: '1.0.0',
  permissions: ['crm:view', 'crm:manage'],
  mountPath: '/api/crm',
  router: crmRouter,
};
