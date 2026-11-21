import { Router } from 'express';
import { z } from 'zod';
import { one, run, transaction } from '../db';
import { audit } from '../service';
import { requirePermission } from '../rbac';
import { companySchema } from '../validation';
import { taxPolicy } from '../tax_policy';
import {
  listOwners,
  createOwner,
  updateOwner,
  setOwnerActive,
  addEquityEntry,
  ownerLedger,
} from '../owners';
import {
  previewDistribution,
  listDistributions,
  distributionDetail,
  createDistribution,
  approveDistribution,
  cancelDistribution,
  payDistribution,
} from '../distribution';
import type { Company } from '../../src/types';

export const ownersRouter = Router();

// Company profile & settings
ownersRouter.get('/company', (_req, res) =>
  res.json(one<Company>('SELECT * FROM company WHERE id=1')),
);

ownersRouter.put('/company', requirePermission('branches:manage'), (req, res) => {
  const c = companySchema.parse(req.body);
  const before = taxPolicy();
  const vat = c.tax_mode ? c.tax_mode === 'VAT' : before.vat;
  const eta = vat && (c.eta_enabled ?? before.eta);
  const payrollTax = c.payroll_tax_enabled ?? before.payrollTax;
  transaction(() => {
    run(
      'UPDATE company SET name=?,email=?,phone=?,address=?,tax_number=?,tax_registration_number=?,activity_code=?,tax_rate=?,invoice_note=?,currency=COALESCE(?,currency),tax_mode=?,eta_enabled=?,payroll_tax_enabled=?,eta_environment=COALESCE(?,eta_environment),invoice_settings=COALESCE(?,invoice_settings) WHERE id=1',
      c.name,
      c.email,
      c.phone,
      c.address,
      vat ? (c.tax_number ?? '') : '',
      vat ? c.tax_registration_number || '' : '',
      vat ? c.activity_code || '' : '',
      vat ? (c.tax_rate ?? 1400) : 0,
      c.invoice_note,
      c.currency ?? null,
      vat ? 'VAT' : 'NONE',
      eta ? 1 : 0,
      payrollTax ? 1 : 0,
      c.eta_environment || null,
      c.invoice_settings || null,
    );
    audit(
      req.user,
      'تحديث إعدادات الشركة',
      'COMPANY',
      '1',
      `الضريبة: ${vat ? 'ضريبة القيمة المضافة' : 'بدون'} · الفاتورة الإلكترونية: ${eta ? 'مفعّلة' : 'متوقفة'} · ضرائب الرواتب: ${payrollTax ? 'مفعّلة' : 'متوقفة'}`,
    );
  });
  res.json(one('SELECT * FROM company WHERE id=1'));
});

// Owners & Equity (Administrators only)
ownersRouter.get('/owners', requirePermission('distribution:manage'), (_req, res) =>
  res.json(listOwners()),
);

ownersRouter.post('/owners', requirePermission('distribution:manage'), (req, res) =>
  res.status(201).json(createOwner(req.body, req.user)),
);

ownersRouter.put('/owners/:id', requirePermission('distribution:manage'), (req, res) =>
  res.json(updateOwner(String(req.params.id), req.body, req.user)),
);

ownersRouter.patch('/owners/:id/active', requirePermission('distribution:manage'), (req, res) => {
  const { active } = z.object({ active: z.boolean() }).strict().parse(req.body);
  res.json(setOwnerActive(String(req.params.id), active, req.user));
});

ownersRouter.get('/owners/:id/ledger', requirePermission('distribution:manage'), (req, res) =>
  res.json(ownerLedger(String(req.params.id))),
);

ownersRouter.post('/owners/:id/entries', requirePermission('distribution:manage'), (req, res) =>
  res.status(201).json(addEquityEntry(String(req.params.id), req.body, req.user)),
);

// Profit Distributions (Administrators only)
ownersRouter.get('/distributions', requirePermission('distribution:manage'), (_req, res) =>
  res.json(listDistributions()),
);

ownersRouter.post('/distributions/preview', requirePermission('distribution:manage'), (req, res) =>
  res.json(previewDistribution(req.body)),
);

ownersRouter.post('/distributions', requirePermission('distribution:manage'), (req, res) =>
  res.status(201).json(createDistribution(req.body, req.user)),
);

ownersRouter.get('/distributions/:id', requirePermission('distribution:manage'), (req, res) =>
  res.json(distributionDetail(String(req.params.id))),
);

ownersRouter.post(
  '/distributions/:id/approve',
  requirePermission('distribution:manage'),
  (req, res) => res.json(approveDistribution(String(req.params.id), req.user)),
);

ownersRouter.post(
  '/distributions/:id/cancel',
  requirePermission('distribution:manage'),
  (req, res) => res.json(cancelDistribution(String(req.params.id), req.user)),
);

ownersRouter.post(
  '/distributions/:id/payments',
  requirePermission('distribution:manage'),
  (req, res) =>
    res
      .status(201)
      .json(payDistribution(String(req.params.id), req.body, req.user, req.get('Idempotency-Key'))),
);
