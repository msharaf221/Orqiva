/**
 * Generic attendance-device integration.
 *
 * The app does not assume a specific vendor. A device is registered with a serial number and
 * a one-time API key, employees are mapped per device, and raw punches are stored before they
 * are aggregated into `employee_attendance`. This keeps the door open for ZKTeco ADMS,
 * Hikvision, Suprema, or a small middleware bridge without changing the domain model.
 *
 * Punch timestamps are stored as device-local `YYYY-MM-DDTHH:mm:ss` strings. That is exactly
 * what attendance means operationally (the date and time on the wall clock at the branch) and
 * avoids DST ambiguity when the device itself has no timezone setting.
 */

import { createHash, randomBytes } from 'node:crypto';
import { all, one, run, transaction, id, now } from './db';
import { AppError } from './errors';
import { audit } from './audit';
import { inScope, writableBranch, type Actor, type Scope } from './scope';
import type {
  AttendanceDevice,
  AttendancePunch,
  DeviceUserMapping,
  EmployeeAttendance,
  UnmappedDeviceUser,
} from '../src/types';

export type PunchType = 'IN' | 'OUT' | 'AUTO';
export type VerifyMode = 'FINGERPRINT' | 'CARD' | 'PASSWORD' | 'FACE' | 'OTHER';

export interface PunchInput {
  device_user_id: string;
  punched_at: string;
  punch_type?: PunchType;
  verify_mode?: VerifyMode;
  raw?: string;
}

export interface DeviceInput {
  name: string;
  serial_number: string;
  model?: string;
  ip_address?: string;
  port?: number;
  branch_id: string;
  work_start?: string;
  work_end?: string;
  late_grace_minutes?: number;
  overtime_after_minutes?: number;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  invalid: number;
  unmapped: number;
  attendance: number;
}

export function hashDeviceKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function generateDeviceKey(): string {
  return `orq_dev_${randomBytes(24).toString('base64url')}`;
}

const DEVICE_SELECT = `
  SELECT d.id, d.name, d.serial_number, d.model, d.ip_address, d.port, d.branch_id,
    d.api_key_prefix, d.active, d.work_start, d.work_end, d.late_grace_minutes,
    d.overtime_after_minutes, d.last_seen_at, d.created_at, d.updated_at,
    b.name AS branch_name,
    (SELECT COUNT(*) FROM attendance_punches p WHERE p.device_id=d.id) AS punches_count,
    (SELECT COUNT(*) FROM device_user_mappings m WHERE m.device_id=d.id) AS mappings_count
  FROM attendance_devices d
  JOIN branches b ON b.id=d.branch_id
`;

export function listDevices(scope: Scope): AttendanceDevice[] {
  const visible = scopeSqlFor('d.branch_id', scope);
  return all<AttendanceDevice>(
    `${DEVICE_SELECT} WHERE ${visible.sql} ORDER BY d.active DESC, d.name ASC`,
    ...visible.params,
  );
}

export function getDevice(deviceId: string, scope?: Scope): AttendanceDevice {
  const device = one<AttendanceDevice>(`${DEVICE_SELECT} WHERE d.id=?`, deviceId);
  if (!device) throw new AppError(404, 'جهاز البصمة غير موجود');
  if (scope && !inScope(scope, device.branch_id)) throw new AppError(404, 'جهاز البصمة غير موجود');
  return device;
}

export function createDevice(
  input: DeviceInput,
  actor: Actor,
): { device: AttendanceDevice; api_key: string } {
  writableBranch(actor, input.branch_id);
  const existing = one(
    'SELECT id FROM attendance_devices WHERE serial_number=?',
    input.serial_number,
  );
  if (existing) throw new AppError(409, 'الرقم التسلسلي للجهاز مسجل بالفعل');

  const deviceId = id();
  const apiKey = generateDeviceKey();
  const ts = now();
  run(
    `INSERT INTO attendance_devices(
       id, name, serial_number, model, ip_address, port, branch_id,
       api_key_hash, api_key_prefix, active, work_start, work_end,
       late_grace_minutes, overtime_after_minutes, created_at, updated_at
     ) VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)`,
    deviceId,
    input.name,
    input.serial_number,
    input.model || '',
    input.ip_address || '',
    input.port || 4370,
    input.branch_id,
    hashDeviceKey(apiKey),
    apiKey.slice(0, 12),
    input.work_start || '09:00',
    input.work_end || '17:00',
    input.late_grace_minutes ?? 10,
    input.overtime_after_minutes ?? 0,
    ts,
    ts,
  );
  audit(actor, 'إضافة جهاز بصمة', 'ATTENDANCE_DEVICE', deviceId, input.name);
  return { device: getDevice(deviceId), api_key: apiKey };
}

export function updateDevice(
  deviceId: string,
  input: DeviceInput,
  actor: Actor,
  scope?: Scope,
): AttendanceDevice {
  const current = getDevice(deviceId, scope);
  writableBranch(actor, input.branch_id);
  if (input.branch_id !== current.branch_id) {
    const badMapping = one(
      `SELECT m.id FROM device_user_mappings m
       JOIN employees e ON e.id=m.employee_id
       WHERE m.device_id=? AND e.branch_id<>? LIMIT 1`,
      deviceId,
      input.branch_id,
    );
    if (badMapping)
      throw new AppError(409, 'لا يمكن نقل الجهاز قبل حذف ارتباطات الموظفين من الفرع القديم');
  }
  const duplicate = one(
    'SELECT id FROM attendance_devices WHERE serial_number=? AND id<>?',
    input.serial_number,
    deviceId,
  );
  if (duplicate) throw new AppError(409, 'الرقم التسلسلي للجهاز مسجل بالفعل');

  run(
    `UPDATE attendance_devices
     SET name=?, serial_number=?, model=?, ip_address=?, port=?, branch_id=?,
         work_start=?, work_end=?, late_grace_minutes=?, overtime_after_minutes=?, updated_at=?
     WHERE id=?`,
    input.name,
    input.serial_number,
    input.model || '',
    input.ip_address || '',
    input.port || 4370,
    input.branch_id,
    input.work_start || '09:00',
    input.work_end || '17:00',
    input.late_grace_minutes ?? 10,
    input.overtime_after_minutes ?? 0,
    now(),
    deviceId,
  );
  audit(actor, 'تعديل جهاز بصمة', 'ATTENDANCE_DEVICE', deviceId, input.name);
  return getDevice(deviceId);
}

export function setDeviceActive(
  deviceId: string,
  active: boolean,
  actor: Actor,
  scope?: Scope,
): AttendanceDevice {
  const device = getDevice(deviceId, scope);
  writableBranch(actor, device.branch_id);
  run(
    'UPDATE attendance_devices SET active=?, updated_at=? WHERE id=?',
    active ? 1 : 0,
    now(),
    deviceId,
  );
  audit(
    actor,
    active ? 'تفعيل جهاز بصمة' : 'أرشفة جهاز بصمة',
    'ATTENDANCE_DEVICE',
    deviceId,
    device.name,
  );
  return getDevice(deviceId);
}

export function rotateDeviceKey(
  deviceId: string,
  actor: Actor,
  scope?: Scope,
): { api_key: string; device: AttendanceDevice } {
  const device = getDevice(deviceId, scope);
  writableBranch(actor, device.branch_id);
  const apiKey = generateDeviceKey();
  run(
    'UPDATE attendance_devices SET api_key_hash=?, api_key_prefix=?, updated_at=? WHERE id=?',
    hashDeviceKey(apiKey),
    apiKey.slice(0, 12),
    now(),
    deviceId,
  );
  audit(actor, 'تدوير مفتاح جهاز بصمة', 'ATTENDANCE_DEVICE', deviceId, device.name);
  return { api_key: apiKey, device: getDevice(deviceId) };
}

export function deleteDevice(deviceId: string, actor: Actor, scope?: Scope) {
  const device = getDevice(deviceId, scope);
  writableBranch(actor, device.branch_id);
  const punches = one<{ count: number }>(
    'SELECT COUNT(*) count FROM attendance_punches WHERE device_id=?',
    deviceId,
  );
  if (punches && punches.count > 0) {
    throw new AppError(409, 'الجهاز له بصمات مسجلة؛ أرشفه بدلاً من حذفه للحفاظ على السجل');
  }
  run('DELETE FROM attendance_devices WHERE id=?', deviceId);
  audit(actor, 'حذف جهاز بصمة', 'ATTENDANCE_DEVICE', deviceId, device.name);
}

// ── User mappings ────────────────────────────────────────────────────────────────────────

export function listMappings(deviceId: string, scope?: Scope): DeviceUserMapping[] {
  getDevice(deviceId, scope);
  return all<DeviceUserMapping>(
    `SELECT m.*, e.name AS employee_name, e.code AS employee_code
     FROM device_user_mappings m
     JOIN employees e ON e.id=m.employee_id
     WHERE m.device_id=?
     ORDER BY e.code ASC`,
    deviceId,
  );
}

export function createMapping(
  deviceId: string,
  input: { device_user_id: string; employee_id: string },
  actor: Actor,
  scope?: Scope,
): DeviceUserMapping {
  const device = getDevice(deviceId, scope);
  writableBranch(actor, device.branch_id);
  const employee = one<{ id: string; name: string; branch_id: string }>(
    'SELECT id, name, branch_id FROM employees WHERE id=?',
    input.employee_id,
  );
  if (!employee) throw new AppError(404, 'الموظف غير موجود');
  if (employee.branch_id !== device.branch_id)
    throw new AppError(400, 'فرع الموظف يجب أن يطابق فرع الجهاز');
  if (!inScope(scope ?? { ids: null }, employee.branch_id))
    throw new AppError(404, 'الموظف غير موجود');

  run(
    `INSERT INTO device_user_mappings(id, device_id, device_user_id, employee_id, created_at)
     VALUES(?,?,?,?,?)
     ON CONFLICT(device_id, device_user_id) DO UPDATE SET employee_id=excluded.employee_id`,
    id(),
    deviceId,
    input.device_user_id,
    input.employee_id,
    now(),
  );
  run(
    'UPDATE attendance_punches SET employee_id=? WHERE device_id=? AND device_user_id=?',
    input.employee_id,
    deviceId,
    input.device_user_id,
  );
  processDevicePunches(deviceId);
  audit(
    actor,
    'ربط مستخدم جهاز بموظف',
    'ATTENDANCE_DEVICE',
    deviceId,
    `${input.device_user_id} → ${employee.name}`,
  );
  const mapping = one<DeviceUserMapping>(
    `SELECT m.*, e.name AS employee_name, e.code AS employee_code
     FROM device_user_mappings m JOIN employees e ON e.id=m.employee_id
     WHERE m.device_id=? AND m.device_user_id=?`,
    deviceId,
    input.device_user_id,
  );
  return mapping!;
}

export function deleteMapping(
  deviceId: string,
  mappingId: string,
  actor: Actor,
  scope?: Scope,
): { ok: true } {
  const device = getDevice(deviceId, scope);
  writableBranch(actor, device.branch_id);
  const mapping = one<{ id: string; device_user_id: string }>(
    'SELECT id, device_user_id FROM device_user_mappings WHERE id=? AND device_id=?',
    mappingId,
    deviceId,
  );
  if (!mapping) throw new AppError(404, 'ارتباط المستخدم غير موجود');
  run('DELETE FROM device_user_mappings WHERE id=?', mappingId);
  run(
    'UPDATE attendance_punches SET employee_id=NULL WHERE device_id=? AND device_user_id=?',
    deviceId,
    mapping.device_user_id,
  );
  audit(actor, 'حذف ربط مستخدم جهاز', 'ATTENDANCE_DEVICE', deviceId, mapping.device_user_id);
  return { ok: true };
}

export function listUnmappedUsers(deviceId: string, scope?: Scope): UnmappedDeviceUser[] {
  getDevice(deviceId, scope);
  return all<UnmappedDeviceUser>(
    `SELECT device_user_id, COUNT(*) AS punches_count,
            MIN(punched_at) AS first_seen, MAX(punched_at) AS last_seen
     FROM attendance_punches
     WHERE device_id=? AND employee_id IS NULL
     GROUP BY device_user_id
     ORDER BY last_seen DESC`,
    deviceId,
  );
}

// ── Punches ──────────────────────────────────────────────────────────────────────────────

const NAIVE_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/;

/**
 * Accepts device-local `YYYY-MM-DD HH:mm[:ss]` or any ISO timestamp. ISO input is converted
 * to Cairo wall-clock time so attendance dates match the branch's operating day.
 */
export function normalizePunchTime(value: string): string {
  const trimmed = value.trim();
  const naive = NAIVE_RE.exec(trimmed);
  if (naive) return `${naive[1]}T${naive[2]}:${naive[3] ?? '00'}`;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) throw new AppError(400, `وقت البصمة غير صالح: ${value}`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${pick('year')}-${pick('month')}-${pick('day')}T${pick('hour')}:${pick('minute')}:${pick('second')}`;
}

function deviceFromKey(rawKey: string): AttendanceDevice {
  if (!rawKey) throw new AppError(401, 'مفتاح الجهاز مطلوب');
  const device = one<AttendanceDevice>(
    `${DEVICE_SELECT} WHERE d.api_key_hash=? AND d.active=1`,
    hashDeviceKey(rawKey),
  );
  if (!device) throw new AppError(401, 'مفتاح الجهاز غير صالح أو الجهاز مؤرشف');
  return device;
}

export function ingestWithApiKey(
  rawKey: string,
  payload: { punches?: PunchInput[]; csv?: string },
): IngestResult {
  const device = deviceFromKey(rawKey);
  return ingest(device, payload);
}

export function ingest(
  device: AttendanceDevice,
  payload: { punches?: PunchInput[]; csv?: string },
): IngestResult {
  if (payload.csv) return importCsv(device, payload.csv);
  return insertPunches(device, payload.punches || [], 'DEVICE');
}

export function insertPunches(
  device: AttendanceDevice,
  punches: PunchInput[],
  source: 'DEVICE' | 'IMPORT',
): IngestResult {
  const result: IngestResult = {
    accepted: 0,
    duplicates: 0,
    invalid: 0,
    unmapped: 0,
    attendance: 0,
  };

  const mappings = new Map(
    all<{ device_user_id: string; employee_id: string }>(
      'SELECT device_user_id, employee_id FROM device_user_mappings WHERE device_id=?',
      device.id,
    ).map((m) => [m.device_user_id, m.employee_id]),
  );

  transaction(() => {
    for (const punch of punches) {
      try {
        const deviceUserId = String(punch.device_user_id || '').trim();
        if (!deviceUserId) {
          result.invalid++;
          continue;
        }
        const punchedAt = normalizePunchTime(String(punch.punched_at));
        const employeeId = mappings.get(deviceUserId) || null;
        const punchType = punch.punch_type || 'AUTO';
        const verifyMode = punch.verify_mode || 'FINGERPRINT';
        const inserted = run(
          `INSERT OR IGNORE INTO attendance_punches(
             id, device_id, device_user_id, employee_id, punched_at, punch_type,
             verify_mode, raw, created_at
           ) VALUES(?,?,?,?,?,?,?,?,?)`,
          id(),
          device.id,
          deviceUserId,
          employeeId,
          punchedAt,
          punchType,
          verifyMode,
          punch.raw || '',
          now(),
        );
        if (Number(inserted.changes) > 0) {
          result.accepted++;
          if (!employeeId) result.unmapped++;
        } else {
          result.duplicates++;
        }
      } catch {
        result.invalid++;
      }
    }
    run('UPDATE attendance_devices SET last_seen_at=? WHERE id=?', now(), device.id);
  });

  result.attendance = processDevicePunches(device.id, source);
  return result;
}

export interface PunchQuery {
  date?: string;
  limit?: number;
}

export function listPunches(
  deviceId: string,
  query: PunchQuery = {},
  scope?: Scope,
): AttendancePunch[] {
  getDevice(deviceId, scope);
  const limit = Math.min(Math.max(query.limit || 200, 1), 1000);
  const dateClause = query.date ? 'AND substr(p.punched_at,1,10)=?' : '';
  const params: (string | number)[] = [deviceId];
  if (query.date) params.push(query.date);
  params.push(limit);
  return all<AttendancePunch>(
    `SELECT p.*, e.name AS employee_name
     FROM attendance_punches p
     LEFT JOIN employees e ON e.id=p.employee_id
     WHERE p.device_id=? ${dateClause}
     ORDER BY p.punched_at DESC
     LIMIT ?`,
    ...params,
  );
}

function timeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Aggregates raw punches into one attendance row per employee per day.
 * Manual rows are never overwritten; device/import rows are refreshed idempotently.
 */
export function processDevicePunches(
  deviceId: string,
  _source: 'DEVICE' | 'IMPORT' = 'DEVICE',
): number {
  const device = one<AttendanceDevice>('SELECT * FROM attendance_devices WHERE id=?', deviceId);
  if (!device) return 0;

  const groups = all<{ employee_id: string; date: string }>(
    `SELECT DISTINCT employee_id, substr(punched_at,1,10) AS date
     FROM attendance_punches
     WHERE device_id=? AND employee_id IS NOT NULL
     ORDER BY date ASC`,
    deviceId,
  );

  let processed = 0;
  const workStart = timeToMinutes(device.work_start) ?? 9 * 60;
  const workEnd = timeToMinutes(device.work_end) ?? 17 * 60;

  for (const group of groups) {
    const existing = one<EmployeeAttendance>(
      'SELECT * FROM employee_attendance WHERE employee_id=? AND date=?',
      group.employee_id,
      group.date,
    );
    if (existing?.source === 'MANUAL') continue;

    const punches = all<AttendancePunch>(
      `SELECT * FROM attendance_punches
       WHERE device_id=? AND employee_id=? AND substr(punched_at,1,10)=?
       ORDER BY punched_at ASC`,
      deviceId,
      group.employee_id,
      group.date,
    );
    if (!punches.length) continue;

    const explicitIn = punches.find((p) => p.punch_type === 'IN');
    const explicitOut = [...punches].reverse().find((p) => p.punch_type === 'OUT');
    const checkInPunch = explicitIn || punches[0];
    const checkOutPunch =
      explicitOut && explicitOut.id !== checkInPunch.id
        ? explicitOut
        : punches.length > 1
          ? punches[punches.length - 1]
          : null;
    if (checkOutPunch?.id === checkInPunch.id) continue;

    const checkIn = checkInPunch.punched_at.slice(11, 16);
    const checkOut = checkOutPunch ? checkOutPunch.punched_at.slice(11, 16) : null;
    const inMinutes = timeToMinutes(checkIn)!;
    const outMinutes = checkOut ? timeToMinutes(checkOut) : null;

    const lateMinutes = Math.max(0, inMinutes - (workStart + (device.late_grace_minutes || 0)));
    const overtimeHours =
      outMinutes !== null && outMinutes > workEnd + (device.overtime_after_minutes || 0)
        ? Math.round(((outMinutes - workEnd) / 60) * 100) / 100
        : 0;

    run(
      `INSERT INTO employee_attendance(
         id, employee_id, branch_id, date, check_in, check_out, status, late_minutes,
         overtime_hours, notes, created_at, source, device_id, check_in_punch_id, check_out_punch_id
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?, 'DEVICE',?,?,?)
       ON CONFLICT(employee_id, date) DO UPDATE SET
         check_in=excluded.check_in,
         check_out=excluded.check_out,
         status=excluded.status,
         late_minutes=excluded.late_minutes,
         overtime_hours=excluded.overtime_hours,
         source='DEVICE',
         device_id=excluded.device_id,
         check_in_punch_id=excluded.check_in_punch_id,
         check_out_punch_id=excluded.check_out_punch_id`,
      id(),
      group.employee_id,
      device.branch_id,
      group.date,
      checkIn,
      checkOut,
      lateMinutes > 0 ? 'LATE' : 'PRESENT',
      lateMinutes,
      overtimeHours,
      `تجميع آلي من جهاز ${device.name}`,
      now(),
      device.id,
      checkInPunch.id,
      checkOutPunch?.id ?? null,
    );

    const punchIds = [checkInPunch.id, checkOutPunch?.id].filter(Boolean) as string[];
    for (const punchId of punchIds) {
      run('UPDATE attendance_punches SET processed_at=? WHERE id=?', now(), punchId);
    }
    processed++;
  }

  return processed;
}

// ── CSV / ADMS import ────────────────────────────────────────────────────────────────────

function mapVerifyMode(value: string | undefined): VerifyMode {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === '2' || normalized === 'card') return 'CARD';
  if (normalized === '3' || normalized === 'password') return 'PASSWORD';
  if (normalized === '4' || normalized === 'face') return 'FACE';
  if (normalized === '1' || normalized === 'fingerprint' || normalized === 'fp') {
    return 'FINGERPRINT';
  }
  return normalized ? 'OTHER' : 'FINGERPRINT';
}

function mapPunchType(value: string | undefined): PunchType {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'in' || normalized === '0' || normalized === 'check-in') return 'IN';
  if (normalized === 'out' || normalized === '1' || normalized === 'check-out') return 'OUT';
  return 'AUTO';
}

export function parseCsv(csv: string): PunchInput[] {
  const lines = csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const first = lines[0].split(delimiter).map((c) => c.trim().toLowerCase());
  const hasHeader = first.some((c) =>
    ['device_user_id', 'pin', 'user_id', 'punched_at', 'datetime', 'punch_type'].includes(c),
  );

  const index = (names: string[], fallback: number) => {
    if (!hasHeader) return fallback;
    const found = names.map((n) => first.indexOf(n)).find((i) => i >= 0);
    return found === undefined ? fallback : found;
  };

  const userIndex = index(['device_user_id', 'pin', 'user_id'], 0);
  const timeIndex = index(['punched_at', 'datetime', 'time'], 1);
  const typeIndex = index(['punch_type', 'status'], 2);
  const verifyIndex = index(['verify_mode', 'verify', 'verification'], 3);

  const rows = hasHeader ? lines.slice(1) : lines;
  const punches: PunchInput[] = [];
  for (const line of rows) {
    const cols = line.split(delimiter).map((c) => c.trim());
    if (!cols[userIndex] || !cols[timeIndex]) continue;
    punches.push({
      device_user_id: cols[userIndex],
      punched_at: cols[timeIndex],
      punch_type: mapPunchType(cols[typeIndex]),
      verify_mode: mapVerifyMode(cols[verifyIndex]),
      raw: line,
    });
  }
  return punches;
}

export function importCsv(device: AttendanceDevice, csv: string, actor?: Actor): IngestResult {
  const punches = parseCsv(csv);
  const result = insertPunches(device, punches, 'IMPORT');
  if (actor) {
    audit(actor, 'استيراد بصمات من ملف', 'ATTENDANCE_DEVICE', device.id, `${result.accepted} بصمة`);
  }
  return result;
}

export function importCsvForDevice(
  deviceId: string,
  csv: string,
  actor: Actor,
  scope?: Scope,
): IngestResult {
  const device = getDevice(deviceId, scope);
  writableBranch(actor, device.branch_id);
  return importCsv(device, csv, actor);
}

// ── Simulator ────────────────────────────────────────────────────────────────────────────

export interface SimulateInput {
  employee_id: string;
  date: string;
  check_in?: string;
  check_out?: string;
  device_user_id?: string;
}

/**
 * Creates two punches from a device for a mapped employee. Useful while no physical device
 * is installed and for end-to-end tests of the ingestion path.
 */
export function simulatePunches(
  deviceId: string,
  input: SimulateInput,
  actor: Actor,
  scope?: Scope,
): IngestResult & { device_user_id: string } {
  const device = getDevice(deviceId, scope);
  writableBranch(actor, device.branch_id);
  const employee = one<{ id: string; code: string; branch_id: string }>(
    'SELECT id, code, branch_id FROM employees WHERE id=?',
    input.employee_id,
  );
  if (!employee) throw new AppError(404, 'الموظف غير موجود');
  if (employee.branch_id !== device.branch_id)
    throw new AppError(400, 'فرع الموظف يجب أن يطابق فرع الجهاز');

  const deviceUserId = input.device_user_id || employee.code;
  const existing = one(
    'SELECT id FROM device_user_mappings WHERE device_id=? AND device_user_id=?',
    deviceId,
    deviceUserId,
  );
  if (!existing) {
    run(
      'INSERT INTO device_user_mappings(id, device_id, device_user_id, employee_id, created_at) VALUES(?,?,?,?,?)',
      id(),
      deviceId,
      deviceUserId,
      employee.id,
      now(),
    );
  }
  run(
    'UPDATE attendance_punches SET employee_id=? WHERE device_id=? AND device_user_id=?',
    employee.id,
    deviceId,
    deviceUserId,
  );

  const punches: PunchInput[] = [
    {
      device_user_id: deviceUserId,
      punched_at: `${input.date} ${input.check_in || device.work_start}:00`,
      punch_type: 'IN',
      verify_mode: 'FINGERPRINT',
      raw: 'SIMULATOR',
    },
  ];
  if (input.check_out) {
    punches.push({
      device_user_id: deviceUserId,
      punched_at: `${input.date} ${input.check_out}:00`,
      punch_type: 'OUT',
      verify_mode: 'FINGERPRINT',
      raw: 'SIMULATOR',
    });
  }

  const result = insertPunches(device, punches, 'DEVICE');
  audit(
    actor,
    'محاكاة بصمة جهاز',
    'ATTENDANCE_DEVICE',
    deviceId,
    `${employee.code}: ${input.date}`,
  );
  return { ...result, device_user_id: deviceUserId };
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────

function scopeSqlFor(column: string, scope: Scope): { sql: string; params: string[] } {
  if (scope.ids === null) return { sql: '1=1', params: [] };
  if (!scope.ids.length) return { sql: '0=1', params: [] };
  return {
    sql: `${column} IN (${scope.ids.map(() => '?').join(',')})`,
    params: scope.ids,
  };
}
