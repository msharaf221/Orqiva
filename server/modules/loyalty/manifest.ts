import type { AddonManifest } from '../../addons/registry';
import { loyaltyRouter } from './routes';

export const loyaltyAddon: AddonManifest = {
  id: 'loyalty',
  name: 'نقاط ولاء العملاء',
  version: '1.0.0',
  mountPath: '/api/loyalty',
  router: loyaltyRouter,
};
