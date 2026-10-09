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
import { partySchema, expenseSchema, companySchema, userSchema, date } from './validation';
import { report, groupOverview, stockMatrix } from './reports';
import { canSee, scopeFor, scopeSql } from './scope';
import { listProducts, createProduct, updateProduct, adjustStock } from './catalog';
import {
  listBranches,
  branchDetail,
  createBranch,
  updateBranch,
  setBranchActive,
  assortment,
  setAssortmentItem,
  branchStaff,
  setBranchStaff,
} from './branches';
import {
  listTransfers,
  transferDetail,
  createTransfer,
  updateTransfer,
  shipTransfer,
  receiveTransfer,
  cancelTransfer,
  suggestTransfers,
} from './transfers';
import {
  listOwners,
  createOwner,
  updateOwner,
  setOwnerActive,
  addEquityEntry,
  ownerLedger,
} from './owners';
import {
  previewDistribution,
  listDistributions,
  distributionDetail,
  createDistribution,
  approveDistribution,
  cancelDistribution,
  payDistribution,
} from './distribution';
import { sessionCookieOptions } from './session-cookie';
import type { User, Party, Document, Company, Expense, Branch } from '../src/types';

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
  res.cookie('orqiva_session', token, { ...sessionCookieOptions(req), maxAge: 8 * 3600000 });
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
/** Period filter shared by reports (optional branch); ranges are capped at one year. */
const period = z
  .object({ from: date, to: date, branch_id: z.string().max(100).optional() })
  .refine(
    (d) => d.to >= d.from && Date.parse(d.to) - Date.parse(d.from) <= 365 * 86400000,
    'الفترة يجب أن تكون بين يوم و٣٦٦ يوماً',
  );
const visibleTransfer = (user: User, transferId: string) => {
  const transfer = transferDetail(transferId);
  if (!canSee(user, transfer.from_branch_id) && !canSee(user, transfer.to_branch_id))
    throw new AppError(403, 'ليس لديك صلاحية على هذا التحويل');
  return transfer;
};
const assignedBranches = (userId: string) =>
  all<{ branch_id: string }>('SELECT branch_id FROM user_branches WHERE user_id=?', userId).map(
    (r) => r.branch_id,
  );

app.get('/api/auth/me', (req, res) => res.json(req.user));
app.post('/api/auth/logout', (req, res) => {
  run('DELETE FROM sessions WHERE id=?', tokenHash(req.cookies.orqiva_session));
  res.clearCookie('orqiva_session', sessionCookieOptions(req)).json({ ok: true });
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

// Branches ------------------------------------------------------------------------------------
app.get('/api/branches', (req, res) =>
  res.json(listBranches(req.user, req.query.include_archived === '1')),
);
app.post('/api/branches', admin, (req, res) =>
  res.status(201).json(createBranch(req.body, req.user)),
);
app.get('/api/branches/:id', (req, res) => {
  const branchId = String(req.params.id);
  scopeFor(req.user, branchId);
  res.json(branchDetail(branchId));
});
app.put('/api/branches/:id', admin, (req, res) =>
  res.json(updateBranch(String(req.params.id), req.body, req.user)),
);
app.patch('/api/branches/:id/active', admin, (req, res) =>
  res.json(setBranchActive(String(req.params.id), req.body, req.user)),
);
app.get('/api/branches/:id/assortment', (req, res) => {
  const branchId = String(req.params.id);
  scopeFor(req.user, branchId);
  res.json(assortment(branchId));
});
app.put('/api/branches/:id/products/:productId', admin, (req, res) =>
  res.json(
    setAssortmentItem(String(req.params.id), String(req.params.productId), req.body, req.user),
  ),
);
app.get('/api/branches/:id/staff', admin, (req, res) =>
  res.json(branchStaff(String(req.params.id))),
);
app.put('/api/branches/:id/staff', admin, (req, res) =>
  res.json(setBranchStaff(String(req.params.id), req.body, req.user)),
);

// Catalogue and stock --------------------------------------------------------------------------
app.get('/api/products', (req, res) =>
  res.json(listProducts(scopeFor(req.user, req.query.branch_id))),
);
app.post('/api/products', admin, (req, res) =>
  res.status(201).json(createProduct(req.body, req.user)),
);
app.put('/api/products/:id', admin, (req, res) =>
  res.json(updateProduct(String(req.params.id), req.body, req.user)),
);
app.post('/api/products/:id/adjust', admin, (req, res) =>
  res.json(adjustStock(String(req.params.id), req.body, req.user)),
);
app.get('/api/stock/matrix', (req, res) =>
  res.json(stockMatrix(scopeFor(req.user, req.query.branch_id))),
);
app.get('/api/movements', (req, res) => {
  const scope = scopeFor(req.user, req.query.branch_id);
  const f = scopeSql('m.branch_id', scope);
  res.json(
    all(
      `SELECT m.*,p.name product_name,p.sku,d.number,u.name user_name,b.name branch_name,t.number transfer_number
       FROM stock_movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.created_by
       JOIN branches b ON b.id=m.branch_id LEFT JOIN documents d ON d.id=m.document_id
       LEFT JOIN transfers t ON t.id=m.transfer_id
       WHERE ${f.sql} ORDER BY m.created_at DESC,m.rowid DESC LIMIT 1000`,
      ...f.params,
    ),
  );
});

// Parties (shared across branches) -------------------------------------------------------------
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
      'INSERT INTO parties(id,type,name,email,phone,address,tax_number,notes,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
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

// Documents ------------------------------------------------------------------------------------
app.get('/api/documents', (req, res) => {
  const type = z.enum(['SALE', 'PURCHASE']).parse(req.query.type);
  const f = scopeSql('d.branch_id', scopeFor(req.user, req.query.branch_id));
  res.json(
    all<Document>(
      `SELECT d.*,p.name party_name,b.name branch_name,b.code branch_code FROM documents d
       JOIN parties p ON p.id=d.party_id JOIN branches b ON b.id=d.branch_id
       WHERE d.type=? AND ${f.sql} ORDER BY d.date DESC,d.created_at DESC`,
      type,
      ...f.params,
    ),
  );
});
app.get('/api/documents/:id', (req, res) => {
  const doc = documentDetail(String(req.params.id));
  if (!canSee(req.user, doc.branch_id)) throw new AppError(403, 'ليس لديك صلاحية على هذه الفاتورة');
  res.json(doc);
});
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
app.get('/api/payments', (req, res) => {
  const f = scopeSql('d.branch_id', scopeFor(req.user, req.query.branch_id));
  res.json(
    all(
      `SELECT p.*,d.number,d.type,pr.name party_name,b.name branch_name FROM payments p
       JOIN documents d ON d.id=p.document_id JOIN parties pr ON pr.id=d.party_id
       JOIN branches b ON b.id=d.branch_id
       WHERE ${f.sql} ORDER BY p.date DESC,p.created_at DESC`,
      ...f.params,
    ),
  );
});

// Transfers between branches -------------------------------------------------------------------
app.get('/api/transfers', (req, res) => {
  const status = req.query.status
    ? z.enum(['DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED']).parse(req.query.status)
    : undefined;
  res.json(listTransfers(scopeFor(req.user, req.query.branch_id), status));
});
app.get('/api/transfers/suggestions', (req, res) =>
  res.json(suggestTransfers(req.user, scopeFor(req.user, req.query.branch_id))),
);
app.post('/api/transfers', (req, res) => res.status(201).json(createTransfer(req.body, req.user)));
app.get('/api/transfers/:id', (req, res) =>
  res.json(visibleTransfer(req.user, String(req.params.id))),
);
app.put('/api/transfers/:id', (req, res) =>
  res.json(updateTransfer(String(req.params.id), req.body, req.user)),
);
app.post('/api/transfers/:id/ship', (req, res) =>
  res.json(shipTransfer(String(req.params.id), req.user)),
);
app.post('/api/transfers/:id/receive', (req, res) =>
  res.json(receiveTransfer(String(req.params.id), req.body, req.user)),
);
app.post('/api/transfers/:id/cancel', (req, res) =>
  res.json(cancelTransfer(String(req.params.id), req.user)),
);

// Expenses -------------------------------------------------------------------------------------
app.get('/api/expenses', (req, res) => {
  // Shared expenses (no branch) are visible to the whole group only, i.e. administrators.
  const f = scopeSql('e.branch_id', scopeFor(req.user, req.query.branch_id));
  res.json(
    all<Expense>(
      `SELECT e.*,b.name branch_name FROM expenses e LEFT JOIN branches b ON b.id=e.branch_id
       WHERE ${f.sql} ORDER BY e.date DESC,e.created_at DESC`,
      ...f.params,
    ),
  );
});
app.post('/api/expenses', admin, (req, res) => {
  const p = expenseSchema.parse(req.body);
  const expenseId = id();
  transaction(() => {
    if (p.branch_id) {
      const branch = requireRow(one<Branch>('SELECT * FROM branches WHERE id=?', p.branch_id));
      if (!branch.active) throw new AppError(409, 'الفرع مؤرشف ولا يقبل مصروفات جديدة');
    }
    run(
      'INSERT INTO expenses(id,title,category,amount,date,method,notes,created_by,created_at,branch_id,allocation) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      expenseId,
      p.title,
      p.category,
      p.amount,
      p.date,
      p.method,
      p.notes,
      req.user.id,
      now(),
      p.branch_id ?? null,
      p.allocation,
    );
    audit(req.user, 'تسجيل مصروف', 'EXPENSE', expenseId, p.title);
  });
  res.status(201).json(one('SELECT * FROM expenses WHERE id=?', expenseId));
});

// Reports --------------------------------------------------------------------------------------
app.get('/api/dashboard', (req, res) => {
  const input = period.parse(req.query);
  res.json(
    report(input.from, input.to, scopeFor(req.user, input.branch_id), req.user.role === 'ADMIN'),
  );
});
app.get('/api/group/overview', admin, (req, res) => {
  const input = period.parse(req.query);
  res.json(groupOverview(input.from, input.to));
});

// Owners, equity and distributions (administrators only) ---------------------------------------
app.get('/api/owners', admin, (_req, res) => res.json(listOwners()));
app.post('/api/owners', admin, (req, res) => res.status(201).json(createOwner(req.body, req.user)));
app.put('/api/owners/:id', admin, (req, res) =>
  res.json(updateOwner(String(req.params.id), req.body, req.user)),
);
app.patch('/api/owners/:id/active', admin, (req, res) => {
  const { active } = z.object({ active: z.boolean() }).strict().parse(req.body);
  res.json(setOwnerActive(String(req.params.id), active, req.user));
});
app.get('/api/owners/:id/ledger', admin, (req, res) =>
  res.json(ownerLedger(String(req.params.id))),
);
app.post('/api/owners/:id/entries', admin, (req, res) =>
  res.status(201).json(addEquityEntry(String(req.params.id), req.body, req.user)),
);
app.get('/api/distributions', admin, (_req, res) => res.json(listDistributions()));
app.post('/api/distributions/preview', admin, (req, res) =>
  res.json(previewDistribution(req.body)),
);
app.post('/api/distributions', admin, (req, res) =>
  res.status(201).json(createDistribution(req.body, req.user)),
);
app.get('/api/distributions/:id', admin, (req, res) =>
  res.json(distributionDetail(String(req.params.id))),
);
app.post('/api/distributions/:id/approve', admin, (req, res) =>
  res.json(approveDistribution(String(req.params.id), req.user)),
);
app.post('/api/distributions/:id/cancel', admin, (req, res) =>
  res.json(cancelDistribution(String(req.params.id), req.user)),
);
app.post('/api/distributions/:id/payments', admin, (req, res) =>
  res
    .status(201)
    .json(payDistribution(String(req.params.id), req.body, req.user, req.get('Idempotency-Key'))),
);

// Audit and users ------------------------------------------------------------------------------
app.get('/api/audit', admin, (_req, res) =>
  res.json(all('SELECT * FROM audit_logs ORDER BY created_at DESC,rowid DESC LIMIT 500')),
);
app.get('/api/users', admin, (_req, res) =>
  res.json(
    all<User>('SELECT id,name,email,role,active,created_at FROM users ORDER BY created_at').map(
      (u) => ({ ...u, branch_ids: assignedBranches(u.id) }),
    ),
  ),
);
app.post('/api/users', admin, async (req, res) => {
  const p = userSchema.parse(req.body);
  const password = await hash(p.password, 12);
  const userId = id();
  transaction(() => {
    run(
      'INSERT INTO users(id,name,email,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,?)',
      userId,
      p.name,
      p.email,
      password,
      p.role,
      1,
      now(),
    );
    for (const branchId of p.role === 'STAFF' ? p.branch_ids : [])
      run(
        'INSERT OR IGNORE INTO user_branches(user_id,branch_id) VALUES(?,?)',
        userId,
        requireRow(one<{ id: string }>('SELECT id FROM branches WHERE id=?', branchId)).id,
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
