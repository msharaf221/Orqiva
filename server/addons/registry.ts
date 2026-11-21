import { Router, type Express } from 'express';
import { licenseAllowsAddon, licenseStatus } from '../license';

/**
 * Add-on kernel. Orqiva is a strong core plus optional add-ons that can be
 * switched on or off per installation (and later per license key).
 *
 * An add-on declares what it needs and exposes its API router; the kernel
 * validates dependencies, mounts enabled add-ons and answers 404 for disabled
 * ones, so one build can ship to every customer with a different module set.
 */
export interface AddonManifest {
  /** Stable machine id, e.g. "crm". Used in settings and licenses. */
  id: string;
  /** Arabic display name. */
  name: string;
  version: string;
  /** Other add-on ids that must be enabled for this one to load. */
  depends?: string[];
  /** Permission codes this add-on introduces (documentation + UI grouping). */
  permissions?: string[];
  /** API mount path, relative to the server root. */
  mountPath: string;
  router: Router;
}

export interface AddonInfo {
  id: string;
  name: string;
  version: string;
  depends: string[];
  enabled: boolean;
  /** Why an add-on is off: switched off by configuration, or a dependency is missing. */
  reason?: 'disabled' | 'missing_dependency' | 'unlicensed';
}

const registered = new Map<string, AddonManifest>();

export function registerAddon(manifest: AddonManifest): void {
  if (!/^[a-z][a-z0-9_]*$/.test(manifest.id)) {
    throw new Error(`Invalid add-on id: ${manifest.id}`);
  }
  if (registered.has(manifest.id)) throw new Error(`Add-on already registered: ${manifest.id}`);
  registered.set(manifest.id, manifest);
}

/**
 * Which add-ons the installation turned on. `ORQIVA_ADDONS` is a comma list of
 * ids; empty, unset or `*` means all registered add-ons. Read on every call so
 * tests and a future license check can change it without a restart.
 */
function requestedIds(): Set<string> | null {
  const raw = (process.env.ORQIVA_ADDONS ?? '').trim();
  if (!raw || raw === '*') return null;
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function listAddons(): AddonInfo[] {
  const wanted = requestedIds();
  // Repeat until stable so a chain of dependencies resolves in any order.
  const infos: AddonInfo[] = [...registered.values()].map((m) => ({
    id: m.id,
    name: m.name,
    version: m.version,
    depends: m.depends ?? [],
    enabled: !wanted || wanted.has(m.id),
    reason: !wanted || wanted.has(m.id) ? undefined : 'disabled',
  }));
  if (licenseStatus().enforced) {
    for (const info of infos) {
      if (info.enabled && !licenseAllowsAddon(info.id)) {
        info.enabled = false;
        info.reason = 'unlicensed';
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const info of infos) {
      if (!info.enabled) continue;
      const missing = info.depends.some((d) => !infos.find((i) => i.id === d)?.enabled);
      if (missing) {
        info.enabled = false;
        info.reason = 'missing_dependency';
        changed = true;
      }
    }
  }
  return infos;
}

export function isAddonEnabled(id: string): boolean {
  return listAddons().find((a) => a.id === id)?.enabled ?? false;
}

/**
 * Mounts every registered add-on. The enabled check runs per request, so a
 * disabled add-on answers 404 and an enabled one behaves exactly as before.
 */
export function mountAddons(app: Express): void {
  const metaRouter = Router();
  metaRouter.get('/addons', (_req, res) => {
    res.json(listAddons());
  });
  app.use('/api', metaRouter);

  for (const manifest of registered.values()) {
    app.use(manifest.mountPath, (req, res, next) => {
      if (!isAddonEnabled(manifest.id)) {
        return res.status(404).json({ error: `الإضافة "${manifest.name}" غير مفعّلة` });
      }
      manifest.router(req, res, next);
    });
  }
}
