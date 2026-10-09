import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash, compare } from 'bcryptjs';
import { z, ZodError } from 'zod';
import { all, one, run, now, id, transaction, migrate } from './db';
import {
  AppError,
  audit,
  requireRow,
  saveDocument,
  documentDetail,
  postDocument,
  cancelDocument,
  addPayment,
} from './service';
import {
  partySchema,
  productSchema,
  expenseSchema,
  companySchema,
  userSchema,
  date,
} from './validation';
import { report } from './reports';
import type { User, Product, Party, Document, Company } from '../src/types';

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
// Non-simple custom header + SameSite cookie prevent cross-site mutations; no CORS is enabled.
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Orqiva-Request') !== '1')
    return res.status(403).json({ error: 'طلب غير موثوق' });
  next();
});
app.get('/api/health', (_req, res) => {
  one('SELECT 1');
  res.json({ status: 'ok' });
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'محاولات كثيرة. يرجى المحاولة بعد ١٥ دقيقة.' },
});
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.COOKIE_SECURE === 'true',
  path: '/',
};
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const input = z
    .object({ email: z.string().email().max(200), password: z.string().min(1).max(128) })
    .parse(req.body);
  const user = one<User & { password_hash: string }>(
    'SELECT * FROM users WHERE email=? AND active=1',
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
  res.cookie('orqiva_session', token, { ...cookieOptions, maxAge: 8 * 3600000 });
  const { password_hash: _password, ...safeUser } = user;
  res.json(safeUser);
});
app.use('/api', (req, res, next) => {
  const token: unknown = req.cookies.orqiva_session;
  const user =
    typeof token === 'string'
      ? one<User>(
          'SELECT u.id,u.name,u.email,u.role,u.active,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>? AND u.active=1',
          tokenHash(token),
          now(),
        )
      : undefined;
  if (!user) return res.status(401).json({ error: 'يرجى تسجيل الدخول للمتابعة' });
  req.user = user;
  next();
});
const admin = (req: Request, _res: Response, next: NextFunction) => {
  if (req.user.role !== 'ADMIN') throw new AppError(403, 'هذه العملية متاحة لمدير النظام فقط');
  next();
};
const authorizeDoc = (req: Request, _res: Response, next: NextFunction) => {
  const type = req.params.id
    ? requireRow(one<Document>('SELECT * FROM documents WHERE id=?', String(req.params.id))).type
    : req.body?.type;
  if (type === 'PURCHASE' && req.user.role !== 'ADMIN')
    throw new AppError(403, 'اعتماد المشتريات متاح لمدير النظام فقط');
  next();
};
app.get('/api/auth/me', (req, res) => res.json(req.user));
app.post('/api/auth/logout', (req, res) => {
  run('DELETE FROM sessions WHERE id=?', tokenHash(req.cookies.orqiva_session));
  res.clearCookie('orqiva_session', cookieOptions).json({ ok: true });
});
app.post('/api/auth/password', async (req, res) => {
  const input = z
    .object({ current: z.string().max(128), password: z.string().min(10).max(128) })
    .parse(req.body);
  const user = requireRow(
    one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id=?', req.user.id),
  );
  if (!(await compare(input.current, user.password_hash)))
    throw new AppError(400, 'كلمة المرور الحالية غير صحيحة');
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
app.get('/api/company', (_req, res) => res.json(one<Company>('SELECT * FROM company WHERE id=1')));
app.put('/api/company', admin, (req, res) => {
  const c = companySchema.parse(req.body);
  transaction(() => {
    run(
      'UPDATE company SET name=?,email=?,phone=?,address=?,tax_number=?,tax_rate=?,invoice_note=? WHERE id=1',
      c.name,
      c.email,
      c.phone,
      c.address,
      c.tax_number,
      c.tax_rate,
      c.invoice_note,
    );
    audit(req.user, 'تحديث إعدادات الشركة', 'COMPANY', '1');
  });
  res.json(one('SELECT * FROM company WHERE id=1'));
});
app.get('/api/products', (_req, res) =>
  res.json(all<Product>('SELECT * FROM products ORDER BY active DESC,created_at DESC')),
);
app.post('/api/products', admin, (req, res) => {
  const p = productSchema.parse(req.body);
  const productId = id();
  transaction(() => {
    run(
      'INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      productId,
      p.sku,
      p.name,
      p.category,
      p.unit,
      p.sale_price,
      p.cost_price,
      p.stock,
      p.min_stock,
      1,
      now(),
    );
    if (p.stock)
      run(
        'INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?)',
        id(),
        productId,
        null,
        p.stock,
        'رصيد افتتاحي',
        req.user.id,
        now(),
      );
    audit(req.user, 'إضافة منتج', 'PRODUCT', productId, p.name);
  });
  res.status(201).json(one('SELECT * FROM products WHERE id=?', productId));
});
app.put('/api/products/:id', admin, (req, res) => {
  const productId = String(req.params.id);
  const p = productSchema.omit({ stock: true }).parse(req.body);
  requireRow(one('SELECT id FROM products WHERE id=?', productId));
  transaction(() => {
    run(
      'UPDATE products SET sku=?,name=?,category=?,unit=?,sale_price=?,cost_price=?,min_stock=? WHERE id=?',
      p.sku,
      p.name,
      p.category,
      p.unit,
      p.sale_price,
      p.cost_price,
      p.min_stock,
      productId,
    );
    audit(req.user, 'تعديل منتج', 'PRODUCT', productId, p.name);
  });
  res.json(one('SELECT * FROM products WHERE id=?', productId));
});
app.post('/api/products/:id/adjust', admin, (req, res) => {
  const input = z
    .object({
      quantity: z
        .number()
        .int()
        .min(-1_000_000)
        .max(1_000_000)
        .refine((q) => q !== 0),
      reason: z.string().trim().min(3).max(300),
    })
    .strict()
    .parse(req.body);
  const productId = String(req.params.id);
  transaction(() => {
    const p = requireRow(one<Product>('SELECT * FROM products WHERE id=? AND active=1', productId));
    if (p.stock + input.quantity < 0 || p.stock + input.quantity > 1_000_000)
      throw new AppError(400, 'الكمية الجديدة خارج النطاق المسموح');
    run('UPDATE products SET stock=stock+? WHERE id=?', input.quantity, productId);
    run(
      'INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?)',
      id(),
      productId,
      null,
      input.quantity,
      input.reason,
      req.user.id,
      now(),
    );
    audit(
      req.user,
      'تسوية مخزون',
      'PRODUCT',
      productId,
      `${p.name}: ${input.quantity > 0 ? '+' : ''}${input.quantity} — ${input.reason}`,
    );
  });
  res.json(one('SELECT * FROM products WHERE id=?', productId));
});
app.get('/api/parties', (req, res) => {
  const type = z.enum(['CUSTOMER', 'SUPPLIER']).parse(req.query.type);
  res.json(
    all<Party>(
      `SELECT p.*,COALESCE(SUM(CASE WHEN d.status='POSTED' THEN d.total-d.paid ELSE 0 END),0) balance,COUNT(d.id) documents_count FROM parties p LEFT JOIN documents d ON d.party_id=p.id WHERE p.type=? GROUP BY p.id ORDER BY p.active DESC,p.created_at DESC`,
      type,
    ),
  );
});
app.post('/api/parties', (req, res) => {
  const p = partySchema.parse(req.body);
  if (p.type === 'SUPPLIER' && req.user.role !== 'ADMIN')
    throw new AppError(403, 'إدارة الموردين متاحة للمدير فقط');
  const partyId = id();
  transaction(() => {
    run(
      'INSERT INTO parties VALUES(?,?,?,?,?,?,?,?,?,?)',
      partyId,
      p.type,
      p.name,
      p.email,
      p.phone,
      p.address,
      p.tax_number,
      p.notes,
      1,
      now(),
    );
    audit(req.user, p.type === 'CUSTOMER' ? 'إضافة عميل' : 'إضافة مورد', 'PARTY', partyId, p.name);
  });
  res.status(201).json(one('SELECT * FROM parties WHERE id=?', partyId));
});
app.put('/api/parties/:id', (req, res) => {
  const partyId = String(req.params.id);
  const p = partySchema.parse(req.body);
  const existing = requireRow(one<Party>('SELECT * FROM parties WHERE id=?', partyId));
  if (p.type !== existing.type) throw new AppError(400, 'لا يمكن تغيير نوع الحساب');
  if (p.type === 'SUPPLIER' && req.user.role !== 'ADMIN')
    throw new AppError(403, 'إدارة الموردين متاحة للمدير فقط');
  transaction(() => {
    run(
      'UPDATE parties SET name=?,email=?,phone=?,address=?,tax_number=?,notes=? WHERE id=?',
      p.name,
      p.email,
      p.phone,
      p.address,
      p.tax_number,
      p.notes,
      partyId,
    );
    audit(req.user, 'تعديل بيانات حساب', 'PARTY', partyId, p.name);
  });
  res.json(one('SELECT * FROM parties WHERE id=?', partyId));
});
for (const table of ['products', 'parties'] as const)
  app.patch(`/api/${table}/:id/active`, admin, (req, res) => {
    const entityId = String(req.params.id);
    const { active } = z.object({ active: z.boolean() }).strict().parse(req.body);
    requireRow(one(`SELECT id FROM ${table} WHERE id=?`, entityId));
    transaction(() => {
      run(`UPDATE ${table} SET active=? WHERE id=?`, active ? 1 : 0, entityId);
      audit(req.user, active ? 'إعادة تفعيل' : 'أرشفة', table, entityId);
    });
    res.json({ ok: true });
  });
app.get('/api/documents', (req, res) => {
  const type = z.enum(['SALE', 'PURCHASE']).parse(req.query.type);
  res.json(
    all<Document>(
      'SELECT d.*,p.name party_name FROM documents d JOIN parties p ON p.id=d.party_id WHERE d.type=? ORDER BY d.date DESC,d.created_at DESC',
      type,
    ),
  );
});
app.get('/api/documents/:id', (req, res) => res.json(documentDetail(String(req.params.id))));
app.post('/api/documents', authorizeDoc, (req, res) =>
  res.status(201).json(saveDocument(req.body, req.user)),
);
app.put('/api/documents/:id', authorizeDoc, (req, res) =>
  res.json(saveDocument(req.body, req.user, String(req.params.id))),
);
app.post('/api/documents/:id/post', authorizeDoc, (req, res) =>
  res.json(postDocument(String(req.params.id), req.user)),
);
app.post('/api/documents/:id/cancel', admin, (req, res) =>
  res.json(cancelDocument(String(req.params.id), req.user)),
);
app.post('/api/documents/:id/payments', authorizeDoc, (req, res) =>
  res
    .status(201)
    .json(addPayment(String(req.params.id), req.body, req.user, req.get('Idempotency-Key'))),
);
app.get('/api/payments', (_req, res) =>
  res.json(
    all(
      'SELECT p.*,d.number,d.type,pr.name party_name FROM payments p JOIN documents d ON d.id=p.document_id JOIN parties pr ON pr.id=d.party_id ORDER BY p.date DESC,p.created_at DESC',
    ),
  ),
);
app.get('/api/movements', (_req, res) =>
  res.json(
    all(
      'SELECT m.*,p.name product_name,p.sku,d.number,u.name user_name FROM stock_movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.created_by LEFT JOIN documents d ON d.id=m.document_id ORDER BY m.created_at DESC,m.rowid DESC LIMIT 1000',
    ),
  ),
);
app.get('/api/expenses', (_req, res) =>
  res.json(all('SELECT * FROM expenses ORDER BY date DESC,created_at DESC')),
);
app.post('/api/expenses', admin, (req, res) => {
  const p = expenseSchema.parse(req.body);
  const expenseId = id();
  transaction(() => {
    run(
      'INSERT INTO expenses VALUES(?,?,?,?,?,?,?,?,?)',
      expenseId,
      p.title,
      p.category,
      p.amount,
      p.date,
      p.method,
      p.notes,
      req.user.id,
      now(),
    );
    audit(req.user, 'تسجيل مصروف', 'EXPENSE', expenseId, p.title);
  });
  res.status(201).json(one('SELECT * FROM expenses WHERE id=?', expenseId));
});
app.get('/api/dashboard', (req, res) => {
  const input = z
    .object({ from: date, to: date })
    .refine(
      (d) => d.to >= d.from && Date.parse(d.to) - Date.parse(d.from) <= 365 * 86400000,
      'الفترة يجب أن تكون بين يوم و٣٦٦ يوماً',
    )
    .parse(req.query);
  res.json(report(input.from, input.to));
});
app.get('/api/audit', admin, (_req, res) =>
  res.json(all('SELECT * FROM audit_logs ORDER BY created_at DESC,rowid DESC LIMIT 500')),
);
app.get('/api/users', admin, (_req, res) =>
  res.json(all<User>('SELECT id,name,email,role,active,created_at FROM users ORDER BY created_at')),
);
app.post('/api/users', admin, async (req, res) => {
  const p = userSchema.parse(req.body);
  const password = await hash(p.password, 12);
  const userId = id();
  transaction(() => {
    run(
      'INSERT INTO users VALUES(?,?,?,?,?,?,?)',
      userId,
      p.name,
      p.email,
      password,
      p.role,
      1,
      now(),
    );
    audit(req.user, 'إضافة مستخدم', 'USER', userId, p.name);
  });
  res
    .status(201)
    .json(one('SELECT id,name,email,role,active,created_at FROM users WHERE id=?', userId));
});
app.patch('/api/users/:id', admin, (req, res) => {
  const userId = String(req.params.id);
  const input = z
    .object({ active: z.boolean(), role: z.enum(['ADMIN', 'STAFF']) })
    .strict()
    .parse(req.body);
  if (userId === req.user.id)
    throw new AppError(400, 'لا يمكنك تغيير صلاحيات أو تعطيل حسابك الحالي');
  requireRow(one('SELECT id FROM users WHERE id=?', userId));
  transaction(() => {
    run('UPDATE users SET active=?,role=? WHERE id=?', input.active ? 1 : 0, input.role, userId);
    run('DELETE FROM sessions WHERE user_id=?', userId);
    audit(req.user, 'تعديل صلاحيات مستخدم', 'USER', userId);
  });
  res.json({ ok: true });
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'المسار غير موجود' }));
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError)
    return res.status(400).json({
      error: 'تحقق من البيانات المدخلة',
      details: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  if (error instanceof AppError) return res.status(error.status).json({ error: error.message });
  if (error instanceof SyntaxError && 'body' in error)
    return res.status(400).json({ error: 'صيغة الطلب غير صالحة' });
  if (error instanceof Error && error.message.includes('UNIQUE constraint'))
    return res.status(409).json({ error: 'هذا الكود أو البريد الإلكتروني مستخدم بالفعل' });
  console.error(error);
  res.status(500).json({ error: 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.' });
});
