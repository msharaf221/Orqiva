import { Router } from 'express';
import { z } from 'zod';
import { run, transaction, one } from '../../db';
import { AppError } from '../../errors';
import { requirePermission } from '../../rbac';
import { audit } from '../../service';
import { adjustPoints, ledgerFor, loyaltySettings, pointsBalance } from './service';

export const loyaltyRouter = Router();

const partyExists = (partyId: string) => {
  if (!one("SELECT id FROM parties WHERE id=? AND type='CUSTOMER'", partyId))
    throw new AppError(404, 'العميل غير موجود');
};

loyaltyRouter.get('/settings', requirePermission('pos:access', 'users:manage'), (_req, res) => {
  res.json(loyaltySettings());
});

loyaltyRouter.put('/settings', requirePermission('users:manage'), (req, res) => {
  const s = z
    .object({
      enabled: z.boolean(),
      earn_per: z.number().int().min(1).max(100_000_000),
      point_value: z.number().int().min(1).max(100_000_000),
    })
    .strict()
    .parse(req.body);
  transaction(() => {
    run(
      'UPDATE loyalty_settings SET enabled=?, earn_per=?, point_value=? WHERE id=1',
      s.enabled ? 1 : 0,
      s.earn_per,
      s.point_value,
    );
    audit(req.user!, 'تعديل إعدادات نقاط الولاء', 'LOYALTY', '1');
  });
  res.json(loyaltySettings());
});

loyaltyRouter.get(
  '/customers/:id',
  requirePermission('pos:access', 'parties:manage'),
  (req, res) => {
    const partyId = String(req.params.id);
    partyExists(partyId);
    res.json({ balance: pointsBalance(partyId), ledger: ledgerFor(partyId) });
  },
);

loyaltyRouter.post('/customers/:id/adjust', requirePermission('users:manage'), (req, res) => {
  const partyId = String(req.params.id);
  partyExists(partyId);
  const b = z
    .object({
      points: z
        .number()
        .int()
        .min(-1_000_000)
        .max(1_000_000)
        .refine((n) => n !== 0),
      note: z.string().trim().min(3).max(300),
    })
    .strict()
    .parse(req.body);
  transaction(() => {
    adjustPoints(partyId, b.points, b.note);
    audit(req.user!, 'تعديل نقاط عميل', 'LOYALTY', partyId, `${b.points}: ${b.note}`);
  });
  res.json({ balance: pointsBalance(partyId) });
});
