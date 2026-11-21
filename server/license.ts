import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { one } from './db';

/**
 * Offline license keys. A key is `base64url(payload).base64url(signature)` where the
 * signature is Ed25519 over the payload bytes. The vendor signs keys with a private
 * key that never ships; each install only holds the public key
 * (`ORQIVA_LICENSE_PUBLIC_KEY`, PEM or base64 SPKI DER).
 *
 * Enforcement is opt-in per build: with no public key configured the install is
 * "open" (development and today's behavior) and every add-on is available. With a
 * public key, add-ons need a valid, unexpired license that lists them. The core ERP
 * is never locked, so an expired license cannot hold a customer's data hostage.
 */
export interface LicensePayload {
  v: 1;
  customer: string;
  /** Add-on ids this license unlocks, or ["*"] for all. */
  addons: string[];
  /** ISO date the license was issued. */
  issued: string;
  /** ISO date after which add-ons stop; null means perpetual. */
  expires: string | null;
}

export type LicenseState = 'open' | 'valid' | 'missing' | 'invalid' | 'expired';

export interface LicenseStatus {
  enforced: boolean;
  state: LicenseState;
  customer?: string;
  addons?: string[];
  expires?: string | null;
}

function publicKey(): KeyObject | null {
  const raw = (process.env.ORQIVA_LICENSE_PUBLIC_KEY ?? '').trim();
  if (!raw) return null;
  try {
    if (raw.includes('BEGIN')) return createPublicKey(raw.replace(/\\n/g, '\n'));
    return createPublicKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

/** Verifies the signature and shape. Does not check expiry. */
export function parseLicense(key: string, pub: KeyObject): LicensePayload | null {
  const parts = key.trim().split('.');
  if (parts.length !== 2) return null;
  try {
    const payloadBytes = Buffer.from(parts[0], 'base64url');
    const sig = Buffer.from(parts[1], 'base64url');
    if (!verify(null, payloadBytes, pub, sig)) return null;
    const p = JSON.parse(payloadBytes.toString('utf8')) as LicensePayload;
    if (p.v !== 1 || typeof p.customer !== 'string' || !Array.isArray(p.addons)) return null;
    if (!p.addons.every((a) => typeof a === 'string')) return null;
    if (
      p.expires !== null &&
      (typeof p.expires !== 'string' || Number.isNaN(Date.parse(p.expires)))
    )
      return null;
    return p;
  } catch {
    return null;
  }
}

export function installedKey(): string | null {
  const env = (process.env.ORQIVA_LICENSE ?? '').trim();
  if (env) return env;
  return one<{ key: string }>('SELECT key FROM license WHERE id=1')?.key ?? null;
}

export function licenseStatus(at: Date = new Date()): LicenseStatus {
  const pub = publicKey();
  if (!(process.env.ORQIVA_LICENSE_PUBLIC_KEY ?? '').trim())
    return { enforced: false, state: 'open' };
  if (!pub) return { enforced: true, state: 'invalid' };
  const key = installedKey();
  if (!key) return { enforced: true, state: 'missing' };
  const p = parseLicense(key, pub);
  if (!p) return { enforced: true, state: 'invalid' };
  const base = { enforced: true, customer: p.customer, addons: p.addons, expires: p.expires };
  if (p.expires && Date.parse(p.expires) + 86_400_000 <= at.getTime())
    return { ...base, state: 'expired' };
  return { ...base, state: 'valid' };
}

/** Whether the license lets this add-on run. Always true on an open install. */
export function licenseAllowsAddon(id: string): boolean {
  const s = licenseStatus();
  if (!s.enforced) return true;
  if (s.state !== 'valid') return false;
  return !!s.addons && (s.addons.includes('*') || s.addons.includes(id));
}

/** Validates a key before it is stored. Returns an Arabic error or null. */
export function checkLicenseKey(key: string): string | null {
  const pub = publicKey();
  if (!pub) return 'هذه النسخة غير مقيّدة بترخيص';
  const p = parseLicense(key, pub);
  if (!p) return 'مفتاح الترخيص غير صالح';
  if (p.expires && Date.parse(p.expires) + 86_400_000 <= Date.now()) return 'انتهت صلاحية المفتاح';
  return null;
}
