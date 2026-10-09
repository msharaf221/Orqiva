import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionCookieOptions } from '../server/session-cookie';
afterEach(() => vi.unstubAllEnvs());
describe('session cookie policy', () => {
  it('keeps local HTTP sessions HttpOnly and SameSite=Lax', () => {
    expect(sessionCookieOptions({ hostname: 'localhost' })).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      partitioned: false,
      path: '/',
    });
  });
  it('uses Secure, SameSite=None and Partitioned for embedded preview hosts', () => {
    expect(sessionCookieOptions({ hostname: '5173-demo.e2b.app' })).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      partitioned: true,
      path: '/',
    });
  });
  it('does not enable embedded cookies for lookalike host names', () => {
    expect(sessionCookieOptions({ hostname: 'demo.e2b.app.attacker.test' }).partitioned).toBe(
      false,
    );
    expect(sessionCookieOptions({ hostname: 'note2b.app' }).partitioned).toBe(false);
  });
  it('keeps production policy explicit, even on a preview host', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(sessionCookieOptions({ hostname: '5173-demo.e2b.app' }).sameSite).toBe('lax');
  });
  it('forces Secure for explicitly configured HTTPS embeds', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('COOKIE_PARTITIONED', 'true');
    vi.stubEnv('COOKIE_SECURE', 'false');
    expect(sessionCookieOptions({ hostname: 'erp.example.test' })).toMatchObject({
      secure: true,
      sameSite: 'none',
      partitioned: true,
    });
  });
  it('respects Secure cookies on standalone HTTPS without changing SameSite', () => {
    vi.stubEnv('COOKIE_SECURE', 'true');
    expect(sessionCookieOptions({ hostname: 'erp.example.test' })).toMatchObject({
      secure: true,
      sameSite: 'lax',
      partitioned: false,
    });
  });
});
