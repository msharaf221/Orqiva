import { Router, text } from 'express';
import { z } from 'zod';
import { requirePermission } from '../rbac';
import { scopeFor } from '../scope';
import {
  listDevices,
  getDevice,
  createDevice,
  updateDevice,
  setDeviceActive,
  rotateDeviceKey,
  deleteDevice,
  listMappings,
  createMapping,
  deleteMapping,
  listUnmappedUsers,
  listPunches,
  processDevicePunches,
  importCsvForDevice,
  simulatePunches,
  ingestWithApiKey,
  type PunchInput,
} from '../attendance_devices';

const punchType = z.enum(['IN', 'OUT', 'AUTO']);
const verifyMode = z.enum(['FINGERPRINT', 'CARD', 'PASSWORD', 'FACE', 'OTHER']);

const punchSchema = z
  .object({
    device_user_id: z.string().trim().min(1).max(100),
    punched_at: z.string().trim().min(10).max(40),
    punch_type: punchType.optional(),
    verify_mode: verifyMode.optional(),
    raw: z.string().max(4000).optional(),
  })
  .strict();

const deviceSchema = z
  .object({
    name: z.string().trim().min(2, 'اسم الجهاز مطلوب').max(100),
    serial_number: z.string().trim().min(1, 'الرقم التسلسلي مطلوب').max(100),
    model: z.string().trim().max(100).optional(),
    ip_address: z.string().trim().max(100).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    branch_id: z.string().trim().min(1, 'الفرع مطلوب'),
    work_start: z
      .string()
      .regex(/^\d{2}:\d{2}$/, 'وقت البداية غير صالح')
      .optional(),
    work_end: z
      .string()
      .regex(/^\d{2}:\d{2}$/, 'وقت النهاية غير صالح')
      .optional(),
    late_grace_minutes: z.number().int().min(0).max(240).optional(),
    overtime_after_minutes: z.number().int().min(0).max(240).optional(),
  })
  .strict();

/** Public, device-authenticated ingestion. No session cookie or CSRF header is required. */
export const attendanceDevicesPublicRouter = Router();

function deviceKey(req: { get(name: string): string | undefined }): string {
  const header = req.get('X-Device-Key') || req.get('X-Api-Key') || '';
  if (header) return header.trim();
  const auth = req.get('Authorization') || '';
  return auth.replace(/^Bearer\s+/i, '').trim();
}

function parsePayload(body: unknown): { punches?: PunchInput[]; csv?: string } {
  if (typeof body === 'string') return { csv: body };
  if (Array.isArray(body)) {
    return { punches: z.array(punchSchema).max(5000).parse(body) };
  }
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (typeof record.csv === 'string') return { csv: record.csv };
    const list = record.punches ?? record.records;
    if (Array.isArray(list)) return { punches: z.array(punchSchema).max(5000).parse(list) };
  }
  throw new z.ZodError([
    {
      code: z.ZodIssueCode.custom,
      message: 'أرسل punches أو records أو csv',
      path: ['punches'],
    },
  ]);
}

attendanceDevicesPublicRouter.post('/ingest', (req, res) => {
  const payload = parsePayload(req.body);
  res.json({ ok: true, ...ingestWithApiKey(deviceKey(req), payload) });
});

attendanceDevicesPublicRouter.post(
  '/ingest/csv',
  text({ type: ['text/*', 'application/octet-stream'] }),
  (req, res) => {
    const csv = typeof req.body === 'string' ? req.body : '';
    res.json({ ok: true, ...ingestWithApiKey(deviceKey(req), { csv }) });
  },
);

/** Authenticated management API. */
export const attendanceDevicesRouter = Router();

attendanceDevicesRouter.get('/', requirePermission('attendance_devices:view'), (req, res) => {
  res.json(listDevices(scopeFor(req.user, req.query.branch_id)));
});

attendanceDevicesRouter.post('/', requirePermission('attendance_devices:manage'), (req, res) => {
  const input = deviceSchema.parse(req.body);
  res.status(201).json(createDevice(input, req.user));
});

attendanceDevicesRouter.get('/:id', requirePermission('attendance_devices:view'), (req, res) => {
  res.json(getDevice(String(req.params.id), scopeFor(req.user, req.query.branch_id)));
});

attendanceDevicesRouter.put('/:id', requirePermission('attendance_devices:manage'), (req, res) => {
  const input = deviceSchema.parse(req.body);
  res.json(
    updateDevice(String(req.params.id), input, req.user, scopeFor(req.user, req.query.branch_id)),
  );
});

attendanceDevicesRouter.patch(
  '/:id/active',
  requirePermission('attendance_devices:manage'),
  (req, res) => {
    const { active } = z.object({ active: z.boolean() }).strict().parse(req.body);
    res.json(
      setDeviceActive(
        String(req.params.id),
        active,
        req.user,
        scopeFor(req.user, req.query.branch_id),
      ),
    );
  },
);

attendanceDevicesRouter.post(
  '/:id/rotate-key',
  requirePermission('attendance_devices:manage'),
  (req, res) => {
    res.json(
      rotateDeviceKey(String(req.params.id), req.user, scopeFor(req.user, req.query.branch_id)),
    );
  },
);

attendanceDevicesRouter.delete(
  '/:id',
  requirePermission('attendance_devices:manage'),
  (req, res) => {
    deleteDevice(String(req.params.id), req.user, scopeFor(req.user, req.query.branch_id));
    res.json({ ok: true });
  },
);

attendanceDevicesRouter.get(
  '/:id/mappings',
  requirePermission('attendance_devices:view'),
  (req, res) => {
    res.json(listMappings(String(req.params.id), scopeFor(req.user, req.query.branch_id)));
  },
);

attendanceDevicesRouter.post(
  '/:id/mappings',
  requirePermission('attendance_devices:manage'),
  (req, res) => {
    const input = z
      .object({
        device_user_id: z.string().trim().min(1, 'معرّف المستخدم على الجهاز مطلوب').max(100),
        employee_id: z.string().trim().min(1, 'الموظف مطلوب'),
      })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(
        createMapping(
          String(req.params.id),
          input,
          req.user,
          scopeFor(req.user, req.query.branch_id),
        ),
      );
  },
);

attendanceDevicesRouter.delete(
  '/:id/mappings/:mappingId',
  requirePermission('attendance_devices:manage'),
  (req, res) => {
    res.json(
      deleteMapping(
        String(req.params.id),
        String(req.params.mappingId),
        req.user,
        scopeFor(req.user, req.query.branch_id),
      ),
    );
  },
);

attendanceDevicesRouter.get(
  '/:id/unmapped',
  requirePermission('attendance_devices:view'),
  (req, res) => {
    res.json(listUnmappedUsers(String(req.params.id), scopeFor(req.user, req.query.branch_id)));
  },
);

attendanceDevicesRouter.get(
  '/:id/punches',
  requirePermission('attendance_devices:view'),
  (req, res) => {
    res.json(
      listPunches(
        String(req.params.id),
        {
          date: req.query.date ? String(req.query.date) : undefined,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
        },
        scopeFor(req.user, req.query.branch_id),
      ),
    );
  },
);

attendanceDevicesRouter.post(
  '/:id/process',
  requirePermission('attendance_devices:manage'),
  (req, res) => {
    getDevice(String(req.params.id), scopeFor(req.user, req.query.branch_id));
    res.json({ processed: processDevicePunches(String(req.params.id)) });
  },
);

attendanceDevicesRouter.post(
  '/:id/import',
  requirePermission('attendance_devices:manage'),
  (req, res) => {
    const { csv } = z
      .object({ csv: z.string().min(1, 'الملف فارغ').max(5_000_000) })
      .strict()
      .parse(req.body);
    res.json(
      importCsvForDevice(
        String(req.params.id),
        csv,
        req.user,
        scopeFor(req.user, req.query.branch_id),
      ),
    );
  },
);

attendanceDevicesRouter.post(
  '/:id/simulate',
  requirePermission('attendance_devices:manage'),
  (req, res) => {
    const input = z
      .object({
        employee_id: z.string().trim().min(1, 'الموظف مطلوب'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ غير صالح'),
        check_in: z
          .string()
          .regex(/^\d{2}:\d{2}$/, 'وقت الحضور غير صالح')
          .optional(),
        check_out: z
          .string()
          .regex(/^\d{2}:\d{2}$/, 'وقت الانصراف غير صالح')
          .optional(),
        device_user_id: z.string().trim().min(1).max(100).optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      simulatePunches(
        String(req.params.id),
        input,
        req.user,
        scopeFor(req.user, req.query.branch_id),
      ),
    );
  },
);
