import { Router } from 'express';
import { z } from 'zod';
import { all, id, now, one, run, transaction } from '../db';
import { AppError, audit, requireRow } from '../service';
import { requirePermission } from '../rbac';
import { partySchema } from '../validation';
import type { Party } from '../../src/types';

export const partiesRouter = Router();

partiesRouter.get('/', (req, res) => {
  const type = z.enum(['CUSTOMER', 'SUPPLIER']).parse(req.query.type);
  res.json(
    all<Party>(
      `SELECT p.*,
        COALESCE(SUM(CASE
          WHEN d.status='POSTED' AND d.type IN ('SALE','PURCHASE') THEN (d.total-d.paid)
          WHEN d.status='POSTED' AND d.type IN ('SALE_RETURN','PURCHASE_RETURN') THEN -(d.total-d.paid)
          ELSE 0 END),0) balance,
        COUNT(d.id) documents_count
       FROM parties p
       LEFT JOIN documents d ON d.party_id=p.id
       WHERE p.type=? GROUP BY p.id ORDER BY p.active DESC,p.created_at DESC`,
      type,
    ),
  );
});

// فتح حسابات العملاء متاح لحاملي parties:manage، أما الموردون فيبقون للمدير فقط.
partiesRouter.post('/', requirePermission('parties:manage'), (req, res) => {
  const p = partySchema.parse(req.body);
  if (p.type === 'SUPPLIER' && req.user.role !== 'ADMIN') {
    throw new AppError(403, 'إدارة الموردين متاحة للمدير فقط');
  }
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

partiesRouter.put('/:id', requirePermission('parties:manage'), (req, res) => {
  const partyId = String(req.params.id);
  const p = partySchema.parse(req.body);
  const existing = requireRow(one<Party>('SELECT * FROM parties WHERE id=?', partyId));
  if (p.type !== existing.type) throw new AppError(400, 'لا يمكن تغيير نوع الحساب');
  if (p.type === 'SUPPLIER' && req.user.role !== 'ADMIN') {
    throw new AppError(403, 'إدارة الموردين متاحة للمدير فقط');
  }
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

partiesRouter.patch('/:id/active', requirePermission('parties:manage'), (req, res) => {
  const entityId = String(req.params.id);
  const { active } = z.object({ active: z.boolean() }).strict().parse(req.body);
  requireRow(one('SELECT id FROM parties WHERE id=?', entityId));
  transaction(() => {
    run('UPDATE parties SET active=? WHERE id=?', active ? 1 : 0, entityId);
    audit(req.user, active ? 'إعادة تفعيل' : 'أرشفة', 'PARTY', entityId);
  });
  res.json({ ok: true });
});
