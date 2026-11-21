import { registerAddon } from './registry';
import { crmAddon } from '../modules/crm/manifest';
import { backupAddon } from '../modules/backup/manifest';

let done = false;

/** Registers every built-in add-on once. New add-ons are added here. */
export function registerBuiltinAddons(): void {
  if (done) return;
  done = true;
  registerAddon(crmAddon);
  registerAddon(backupAddon);
}
