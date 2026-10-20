import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import { one, now, migrate } from './db';
import { AppError } from './service';
import { getUserPermissions } from './rbac';
import { tokenHash } from './middleware';

// Modular Express Routers
import { publicAuthRouter, authRouter } from './routes/auth';
import { branchesRouter } from './routes/branches';
import { catalogRouter } from './routes/catalog';
import { partiesRouter } from './routes/parties';
import { documentsRouter } from './routes/documents';
import { transfersRouter } from './routes/transfers';
import { expensesRouter } from './routes/expenses';
import { accountsRouter } from './routes/accounts';
import { reportsRouter } from './routes/reports';
import { ownersRouter } from './routes/owners';
import { rbacRouter } from './routes/rbac';
import { posRouter } from './routes/pos';
import { etaRouter } from './routes/eta';
import { ledgerRouter } from './routes/ledger';

import type { User } from '../src/types';

declare global {
  namespace Express {
    interface Request {
      user: User;
    }
  }
}

export const app = express();
migrate();

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'frame-ancestors': null,
        'upgrade-insecure-requests': null,
      },
    },
    frameguard: false,
    crossOriginResourcePolicy: false,
  }),
);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// Non-simple custom header prevents cross-site mutations, including with embedded cookies.
// No CORS is enabled, so other origins cannot send the required header.
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Orqiva-Request') !== '1') {
    return res.status(403).json({ error: 'طلب غير موثوق' });
  }
  next();
});

// Health check endpoint (Public)
app.get('/api/health', (_req, res) => {
  one('SELECT 1');
  res.json({ status: 'ok' });
});

// Public authentication routes (login with rate limiter)
app.use('/api/auth', publicAuthRouter);

// Session authentication middleware for all remaining /api routes
app.use('/api', (req, res, next) => {
  const token: unknown = req.cookies.orqiva_session;
  const userRow =
    typeof token === 'string'
      ? one<User & { role_name?: string }>(
          `SELECT u.id,u.name,u.email,
                  COALESCE(u.role, r.code) as role,
                  ur.role_id,u.active,u.created_at,
                  COALESCE(r.name, CASE WHEN u.role = 'ADMIN' THEN 'مدير النظام' ELSE 'موظف مبيعات' END) as role_name
           FROM sessions s
           JOIN users u ON u.id=s.user_id
           LEFT JOIN user_roles ur ON ur.user_id=u.id
           LEFT JOIN roles r ON r.id=ur.role_id
           WHERE s.id=? AND s.expires_at>? AND u.active=1`,
          tokenHash(token),
          now(),
        )
      : undefined;

  if (!userRow) return res.status(401).json({ error: 'يرجى تسجيل الدخول للمتابعة' });

  const permissions = getUserPermissions(userRow);
  req.user = {
    ...userRow,
    permissions,
  };
  next();
});

// Protected session endpoints (/api/auth/me, /api/auth/logout, /api/auth/password)
app.use('/api/auth', authRouter);

// Mount modular business domain routers
app.use('/api/branches', branchesRouter);
app.use('/api', catalogRouter);
app.use('/api/parties', partiesRouter);
app.use('/api', documentsRouter);
app.use('/api/transfers', transfersRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/cash-accounts', accountsRouter);
app.use('/api', reportsRouter);
app.use('/api', ownersRouter);
app.use('/api', rbacRouter);
app.use('/api/pos', posRouter);
app.use('/api', etaRouter);
app.use('/api', ledgerRouter);

// API 404 handler
app.use('/api', (_req, res) => res.status(404).json({ error: 'المسار غير موجود' }));

// Static frontend serving in production
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

// Global error handling middleware
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: 'تحقق من البيانات المدخلة',
      details: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }
  if (error instanceof AppError) return res.status(error.status).json({ error: error.message });
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ error: 'صيغة الطلب غير صالحة' });
  }
  if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
    return res.status(409).json({ error: 'هذا الكود أو البريد الإلكتروني مستخدم بالفعل' });
  }
  console.error(error);
  res.status(500).json({ error: 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.' });
});
