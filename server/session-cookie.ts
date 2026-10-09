import type { CookieOptions, Request } from 'express';

/** CHIPS keeps embedded preview sessions isolated to their top-level site. */
export function sessionCookieOptions(req: Pick<Request, 'hostname'>): CookieOptions {
  // Use Host (not arbitrary forwarded headers); Express does not trust proxies by default.
  const embeddedPreview =
    process.env.NODE_ENV !== 'production' && req.hostname.toLowerCase().endsWith('.e2b.app');
  const partitioned = embeddedPreview || process.env.COOKIE_PARTITIONED === 'true';
  return {
    httpOnly: true,
    sameSite: partitioned ? 'none' : 'lax',
    secure: partitioned || process.env.COOKIE_SECURE === 'true',
    partitioned,
    path: '/',
  };
}
