import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { one, run, now, transaction } from '../db';
import { AppError, audit, requireRow } from '../service';
import { getUserPermissions } from '../rbac';
import { sessionCookieOptions } from '../session-cookie';
import { tokenHash } from '../middleware';
import type { User } from '../../src/types';

export const publicAuthRouter = Router();
export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'محاولات كثيرة. يرجى المحاولة بعد ١٥ دقيقة.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// Public login endpoint
publicAuthRouter.post('/login', loginLimiter, async (req, res) => {
  const input = z
    .object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(128) })
    .parse(req.body);

  const user = one<User & { password_hash: string }>(
    `SELECT u.*, ur.role_id,
            COALESCE(u.role, r.code) as role,
            COALESCE(r.name, CASE WHEN u.role = 'ADMIN' THEN 'مدير النظام' ELSE 'موظف مبيعات' END) as role_name
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.email=? AND u.active=1`,
    input.email.toLowerCase(),
  );

  const valid = await compare(
    input.password,
    user?.password_hash || '$2b$12$h.XKvGcSTn0OvHfC6QAVF.cQu.IuuzCEnfS8cpRnfOyNKg6RQAKqm',
  );

  if (!user || !valid) throw new AppError(401, 'البريد الإلكتروني أو كلمة المرور غير صحيحة');

  const token = randomBytes(32).toString('hex');
  transaction(() => {
    run('DELETE FROM sessions WHERE expires_at<?', now());
    run(
      'INSERT INTO sessions VALUES(?,?,?)',
      tokenHash(token),
      user.id,
      new Date(Date.now() + 8 * 3600000).toISOString(),
    );
    audit(user, 'تسجيل دخول', 'USER', user.id);
  });

  res.cookie('orqiva_session', token, { ...sessionCookieOptions(req), maxAge: 8 * 3600000 });
  const { password_hash: _password, ...safeUser } = user;
  const permissions = getUserPermissions(user);
  res.json({
    ...safeUser,
    permissions,
  });
});

// Protected session endpoints
authRouter.get('/me', (req, res) => res.json(req.user));

authRouter.post('/logout', (req, res) => {
  run('DELETE FROM sessions WHERE id=?', tokenHash(req.cookies.orqiva_session));
  res.clearCookie('orqiva_session', sessionCookieOptions(req)).json({ ok: true });
});

authRouter.post('/password', async (req, res) => {
  const input = z
    .object({ current: z.string().max(128), password: z.string().min(10).max(128) })
    .parse(req.body);

  const user = requireRow(
    one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id=?', req.user.id),
  );

  if (!(await compare(input.current, user.password_hash))) {
    throw new AppError(400, 'كلمة المرور الحالية غير صحيحة');
  }

  const password = await hash(input.password, 12);
  transaction(() => {
    run('UPDATE users SET password_hash=? WHERE id=?', password, req.user.id);
    run(
      'DELETE FROM sessions WHERE user_id=? AND id<>?',
      req.user.id,
      tokenHash(req.cookies.orqiva_session),
    );
    audit(req.user, 'تغيير كلمة المرور', 'USER', req.user.id);
  });

  res.json({ ok: true });
});
