/**
 * Phase 3 — generic attendance-device integration.
 *
 * No physical device exists yet, so the contract is exercised through the same public
 * ingestion API a future ZKTeco/ADMS bridge will use:
 *  - device registration returns a one-time API key and stores only its hash;
 *  - key rotation invalidates the old key immediately;
 *  - raw punches are stored before mapping, then retroactively linked and aggregated;
 *  - duplicates are ignored, invalid rows are counted, and timestamps are normalized;
 *  - CSV/ATTLOG imports and the simulator share the ingestion path;
 *  - manual attendance rows are never overwritten by a device sync;
 *  - branch scope and least privilege are enforced on the management API.
 */

import { createHash } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PASSWORD, header, resetBusinessData, seedUsers, signIn } from './helpers';
import { app } from '../server/app';
import { all, one, run } from '../server/db';

type Agent = Awaited<ReturnType<typeof signIn>>;

let admin: Agent;

beforeAll(async () => {
  await seedUsers();
  admin = await signIn('admin@test.local');
});

beforeEach(() => {
  resetBusinessData();
  run("DELETE FROM users WHERE id NOT IN ('admin','staff')");
});

async function openBranch(code: string): Promise<string> {
  const res = await admin
    .post('/api/branches')
    .set(header)
    .send({
      code,
      name: `فرع ${code}`,
      kind: 'STORE',
      phone: '',
      address: '',
      opened_on: '2026-01-01',
    })
    .expect(201);
  return res.body.id as string;
}

async function createEmployee(branchId: string, code: string, name = `موظف ${code}`) {
  const res = await admin
    .post('/api/employees')
    .set(header)
    .send({
      code,
      name,
      job_title: 'محاسب',
      branch_id: branchId,
      basic_salary: 1_000_000,
      hire_date: '2026-01-01',
    })
    .expect(201);
  return res.body.id as string;
}

async function createUser(email: string, role: string, branchIds: string[]): Promise<Agent> {
  await admin
    .post('/api/users')
    .set(header)
    .send({ name: email.split('@')[0], email, password: PASSWORD, role, branch_ids: branchIds })
    .expect(201);
  return signIn(email);
}

interface DeviceResponse {
  device: {
    id: string;
    name: string;
    branch_id: string;
    api_key_prefix: string;
    active: number;
    work_start: string;
    work_end: string;
    punches_count?: number;
    mappings_count?: number;
  };
  api_key: string;
}

async function createDevice(
  branchId: string,
  serial: string,
  overrides: Record<string, unknown> = {},
): Promise<DeviceResponse> {
  const res = await admin
    .post('/api/attendance-devices')
    .set(header)
    .send({
      name: `جهاز ${serial}`,
      serial_number: serial,
      branch_id: branchId,
      work_start: '09:00',
      work_end: '17:00',
      late_grace_minutes: 10,
      overtime_after_minutes: 0,
      ...overrides,
    })
    .expect(201);
  return res.body as DeviceResponse;
}

function ingest(key: string, punches: unknown[]) {
  return request(app)
    .post('/api/attendance-devices/ingest')
    .set('X-Device-Key', key)
    .send({ punches });
}

function punch(deviceUserId: string, punchedAt: string, extra: Record<string, unknown> = {}) {
  return { device_user_id: deviceUserId, punched_at: punchedAt, ...extra };
}

function mapUser(deviceId: string, deviceUserId: string, employeeId: string) {
  return admin
    .post(`/api/attendance-devices/${deviceId}/mappings`)
    .set(header)
    .send({ device_user_id: deviceUserId, employee_id: employeeId });
}

describe('generic attendance devices', () => {
  it('registers a device with a one-time key, stores only its hash, and rotates the key', async () => {
    const created = await createDevice('main', 'ZK-001', { model: 'ZKTeco K40' });
    expect(created.api_key).toMatch(/^orq_dev_/);
    expect(created.device.api_key_prefix).toBe(created.api_key.slice(0, 12));
    expect(created.device).not.toHaveProperty('api_key_hash');
    expect(created.device).not.toHaveProperty('api_key');

    const stored = one<{ api_key_hash: string }>(
      'SELECT api_key_hash FROM attendance_devices WHERE id=?',
      created.device.id,
    )!;
    expect(stored.api_key_hash).toBe(createHash('sha256').update(created.api_key).digest('hex'));
    expect(stored.api_key_hash).not.toBe(created.api_key);

    // Serial numbers identify hardware and must be unique.
    await admin
      .post('/api/attendance-devices')
      .set(header)
      .send({ name: 'مكرر', serial_number: 'ZK-001', branch_id: 'main' })
      .expect(409);

    const rotated = await admin
      .post(`/api/attendance-devices/${created.device.id}/rotate-key`)
      .set(header)
      .send({})
      .expect(200);
    expect(rotated.body.api_key).not.toBe(created.api_key);

    await ingest(created.api_key, [punch('1', '2026-06-01 09:00:00')]).expect(401);
    const fresh = await ingest(rotated.body.api_key, [punch('1', '2026-06-01 09:00:00')]).expect(
      200,
    );
    expect(fresh.body.accepted).toBe(1);

    const list = await admin.get('/api/attendance-devices').set(header).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      id: created.device.id,
      branch_name: 'المركز الرئيسي',
      punches_count: 1,
      mappings_count: 0,
    });
  });

  it('accepts unmapped punches with a device key, then links and aggregates them after mapping', async () => {
    const employeeId = await createEmployee('main', 'EMP-100', 'أحمد البصمة');
    const { device, api_key } = await createDevice('main', 'ZK-002');

    const first = await ingest(api_key, [
      punch('1001', '2026-06-01 08:55:00', { punch_type: 'IN', verify_mode: 'FINGERPRINT' }),
      punch('1001', '2026-06-01 17:30:00', { punch_type: 'OUT' }),
      punch('1001', '2026-06-01 08:55:00', { punch_type: 'IN' }),
    ]).expect(200);
    expect(first.body).toMatchObject({
      accepted: 2,
      duplicates: 1,
      invalid: 0,
      unmapped: 2,
      attendance: 0,
    });

    const raw = await admin
      .get(`/api/attendance-devices/${device.id}/punches`)
      .set(header)
      .expect(200);
    expect(raw.body).toHaveLength(2);
    expect(raw.body[0].employee_id).toBeNull();
    expect(raw.body[0].punched_at).toBe('2026-06-01T17:30:00');

    const unmapped = await admin
      .get(`/api/attendance-devices/${device.id}/unmapped`)
      .set(header)
      .expect(200);
    expect(unmapped.body).toEqual([
      expect.objectContaining({ device_user_id: '1001', punches_count: 2 }),
    ]);

    const mapping = await mapUser(device.id, '1001', employeeId).expect(201);
    expect(mapping.body).toMatchObject({
      device_id: device.id,
      device_user_id: '1001',
      employee_id: employeeId,
      employee_code: 'EMP-100',
    });

    // Mapping links the raw punches retroactively and aggregates the day immediately.
    const linked = all<{ employee_id: string | null; processed_at: string | null }>(
      'SELECT employee_id, processed_at FROM attendance_punches WHERE device_id=? ORDER BY punched_at',
      device.id,
    );
    expect(linked.every((p) => p.employee_id === employeeId)).toBe(true);
    expect(linked.every((p) => p.processed_at !== null)).toBe(true);

    const attendance = one<{
      check_in: string;
      check_out: string;
      status: string;
      late_minutes: number;
      overtime_hours: number;
      source: string;
      device_id: string;
    }>(
      "SELECT check_in, check_out, status, late_minutes, overtime_hours, source, device_id FROM employee_attendance WHERE employee_id=? AND date='2026-06-01'",
      employeeId,
    )!;
    expect(attendance).toMatchObject({
      check_in: '08:55',
      check_out: '17:30',
      status: 'PRESENT',
      late_minutes: 0,
      overtime_hours: 0.5,
      source: 'DEVICE',
      device_id: device.id,
    });

    // Replaying the same batch after mapping is still a no-op for the raw store.
    const replay = await ingest(api_key, [
      punch('1001', '2026-06-01 08:55:00', { punch_type: 'IN' }),
    ]).expect(200);
    expect(replay.body).toMatchObject({ accepted: 0, duplicates: 1, attendance: 1 });

    const listed = await admin.get('/api/attendance-devices').set(header).expect(200);
    expect(listed.body[0]).toMatchObject({ punches_count: 2, mappings_count: 1 });
  });

  it('normalizes device-local and ISO timestamps, and counts invalid rows without failing the batch', async () => {
    const { device, api_key } = await createDevice('main', 'ZK-003');

    const result = await ingest(api_key, [
      punch('1', '2026-01-15 08:55'),
      punch('1', '2026-01-15T06:56:00.000Z'), // Cairo is UTC+2 in January.
      punch('1', 'not-a-timestamp'),
    ]).expect(200);
    expect(result.body).toMatchObject({ accepted: 2, invalid: 1, duplicates: 0 });

    const punches = all<{ punched_at: string }>(
      'SELECT punched_at FROM attendance_punches WHERE device_id=? ORDER BY punched_at',
      device.id,
    );
    expect(punches.map((p) => p.punched_at)).toEqual([
      '2026-01-15T08:55:00',
      '2026-01-15T08:56:00',
    ]);
  });

  it('imports CSV and ZKTeco ATTLOG through both the API and the public text endpoint', async () => {
    const employeeId = await createEmployee('main', 'EMP-200');
    const { device, api_key } = await createDevice('main', 'ZK-004');
    await mapUser(device.id, '1001', employeeId).expect(201);

    const csv = [
      '\uFEFFdevice_user_id,punched_at,punch_type,verify_mode',
      '1001,2026-06-02 09:01:00,IN,1',
      '1001,2026-06-02 18:02:00,OUT,2',
    ].join('\n');
    const imported = await admin
      .post(`/api/attendance-devices/${device.id}/import`)
      .set(header)
      .send({ csv })
      .expect(200);
    expect(imported.body).toMatchObject({ accepted: 2, duplicates: 0, invalid: 0 });

    const rows = all<{ punch_type: string; verify_mode: string }>(
      'SELECT punch_type, verify_mode FROM attendance_punches WHERE device_id=? ORDER BY punched_at',
      device.id,
    );
    expect(rows).toEqual([
      { punch_type: 'IN', verify_mode: 'FINGERPRINT' },
      { punch_type: 'OUT', verify_mode: 'CARD' },
    ]);

    // ZKTeco ATTLOG: PIN, datetime, status (0=in/1=out), verify (1=fingerprint).
    const attlog = '1001\t2026-06-03 09:10:00\t0\t1\n1001\t2026-06-03 17:40:00\t1\t1\n';
    const publicImport = await request(app)
      .post('/api/attendance-devices/ingest/csv')
      .set('X-Device-Key', api_key)
      .set('Content-Type', 'text/plain')
      .send(attlog)
      .expect(200);
    expect(publicImport.body).toMatchObject({ accepted: 2, duplicates: 0, invalid: 0 });

    const attendance = one<{ check_in: string; check_out: string; source: string }>(
      "SELECT check_in, check_out, source FROM employee_attendance WHERE employee_id=? AND date='2026-06-03'",
      employeeId,
    )!;
    expect(attendance).toMatchObject({ check_in: '09:10', check_out: '17:40', source: 'DEVICE' });
  });

  it('simulates a full day and computes late minutes and overtime from device policy', async () => {
    const employeeId = await createEmployee('main', 'EMP-300');
    const { device } = await createDevice('main', 'ZK-005');

    const simulated = await admin
      .post(`/api/attendance-devices/${device.id}/simulate`)
      .set(header)
      .send({
        employee_id: employeeId,
        date: '2026-06-04',
        check_in: '09:15',
        check_out: '18:00',
      })
      .expect(200);
    expect(simulated.body).toMatchObject({
      accepted: 2,
      attendance: 1,
      device_user_id: 'EMP-300',
    });

    const attendance = one<{
      check_in: string;
      check_out: string;
      late_minutes: number;
      overtime_hours: number;
      source: string;
    }>(
      "SELECT check_in, check_out, late_minutes, overtime_hours, source FROM employee_attendance WHERE employee_id=? AND date='2026-06-04'",
      employeeId,
    )!;
    expect(attendance).toEqual({
      check_in: '09:15',
      check_out: '18:00',
      late_minutes: 5,
      overtime_hours: 1,
      source: 'DEVICE',
    });

    // The simulator auto-creates the mapping, so a second run only duplicates punches.
    const replay = await admin
      .post(`/api/attendance-devices/${device.id}/simulate`)
      .set(header)
      .send({ employee_id: employeeId, date: '2026-06-04', check_in: '09:15', check_out: '18:00' })
      .expect(200);
    expect(replay.body.duplicates).toBe(2);
    expect(
      one<{ n: number }>(
        'SELECT COUNT(*) n FROM device_user_mappings WHERE device_id=?',
        device.id,
      )!.n,
    ).toBe(1);
  });

  it('never overwrites manual attendance and gives manual edits ownership of the row', async () => {
    const employeeId = await createEmployee('main', 'EMP-400');
    const { device, api_key } = await createDevice('main', 'ZK-006');
    await mapUser(device.id, '4001', employeeId).expect(201);

    // A pre-existing manual row wins over the device aggregation.
    await admin
      .post('/api/hr/attendance')
      .set(header)
      .send({
        employee_id: employeeId,
        branch_id: 'main',
        date: '2026-06-05',
        check_in: '08:00',
        check_out: '16:00',
        notes: 'تسجيل يدوي',
      })
      .expect(201);
    const first = await ingest(api_key, [
      punch('4001', '2026-06-05 09:30:00', { punch_type: 'IN' }),
      punch('4001', '2026-06-05 18:30:00', { punch_type: 'OUT' }),
    ]).expect(200);
    expect(first.body.attendance).toBe(0);
    expect(
      one<{ check_in: string; source: string }>(
        "SELECT check_in, source FROM employee_attendance WHERE employee_id=? AND date='2026-06-05'",
        employeeId,
      ),
    ).toMatchObject({ check_in: '08:00', source: 'MANUAL' });

    // Device day first, then a manual correction: the correction clears device provenance.
    const second = await ingest(api_key, [
      punch('4001', '2026-06-06 09:00:00', { punch_type: 'IN' }),
      punch('4001', '2026-06-06 17:00:00', { punch_type: 'OUT' }),
    ]).expect(200);
    expect(second.body.attendance).toBe(1);
    const deviceRow = one<{ source: string; device_id: string | null }>(
      "SELECT source, device_id FROM employee_attendance WHERE employee_id=? AND date='2026-06-06'",
      employeeId,
    )!;
    expect(deviceRow.source).toBe('DEVICE');
    expect(deviceRow.device_id).toBe(device.id);

    const corrected = await admin
      .post('/api/hr/attendance')
      .set(header)
      .send({
        employee_id: employeeId,
        branch_id: 'main',
        date: '2026-06-06',
        check_in: '10:00',
        check_out: '19:00',
        notes: 'تصحيح يدوي',
      })
      .expect(201);
    expect(corrected.body).toMatchObject({
      check_in: '10:00',
      source: 'MANUAL',
      device_id: null,
      check_in_punch_id: null,
      check_out_punch_id: null,
    });

    // A later sync must still leave the manual correction alone.
    const later = await ingest(api_key, [
      punch('4001', '2026-06-06 11:00:00', { punch_type: 'IN' }),
    ]).expect(200);
    expect(later.body.attendance).toBe(0);
    expect(
      one<{ check_in: string; source: string }>(
        "SELECT check_in, source FROM employee_attendance WHERE employee_id=? AND date='2026-06-06'",
        employeeId,
      ),
    ).toMatchObject({ check_in: '10:00', source: 'MANUAL' });
  });

  it('enforces branch scope and least privilege on the management API', async () => {
    const br2 = await openBranch('BR2');
    const mainEmployee = await createEmployee('main', 'EMP-500');
    const br2Employee = await createEmployee(br2, 'EMP-501');
    const mainDevice = await createDevice('main', 'ZK-MAIN');
    const br2Device = await createDevice(br2, 'ZK-BR2');

    const accountant = await createUser('accountant@test.local', 'ACCOUNTANT', ['main']);
    const manager = await createUser('manager@test.local', 'BRANCH_MANAGER', ['main']);
    const staff = await signIn('staff@test.local');

    // Accountants manage attendance, but only inside their assigned branch.
    const scoped = await accountant.get('/api/attendance-devices').set(header).expect(200);
    expect(scoped.body.map((d: { id: string }) => d.id)).toEqual([mainDevice.device.id]);
    await accountant.get(`/api/attendance-devices/${br2Device.device.id}`).set(header).expect(404);

    // Branch managers may inspect their branch but not configure devices.
    await manager.get('/api/attendance-devices').set(header).expect(200);
    await manager
      .post('/api/attendance-devices')
      .set(header)
      .send({ name: 'غير مسموح', serial_number: 'NOPE', branch_id: 'main' })
      .expect(403);
    await manager
      .post(`/api/attendance-devices/${mainDevice.device.id}/mappings`)
      .set(header)
      .send({ device_user_id: '1', employee_id: mainEmployee })
      .expect(403);

    // Sales staff have no attendance-device permission at all.
    await staff.get('/api/attendance-devices').set(header).expect(403);

    // Cross-branch mappings are rejected even for administrators.
    await mapUser(mainDevice.device.id, '500', br2Employee).expect(400);
    await mapUser(mainDevice.device.id, '500', mainEmployee).expect(201);
    // Moving a device that has mappings from the old branch is blocked until they are removed.
    await admin
      .put(`/api/attendance-devices/${mainDevice.device.id}`)
      .set(header)
      .send({
        name: mainDevice.device.name,
        serial_number: 'ZK-MAIN',
        branch_id: br2,
        work_start: '09:00',
        work_end: '17:00',
        late_grace_minutes: 10,
        overtime_after_minutes: 0,
      })
      .expect(409);

    // Admin group view sees both branches.
    const allDevices = await admin.get('/api/attendance-devices').set(header).expect(200);
    expect(allDevices.body.map((d: { id: string }) => d.id).sort()).toEqual(
      [mainDevice.device.id, br2Device.device.id].sort(),
    );
  });

  it('refuses to delete a device with punches and archives it instead', async () => {
    const { device, api_key } = await createDevice('main', 'ZK-007');
    await ingest(api_key, [punch('1', '2026-06-07 09:00:00')]).expect(200);

    await admin.delete(`/api/attendance-devices/${device.id}`).set(header).expect(409);

    const archived = await admin
      .patch(`/api/attendance-devices/${device.id}/active`)
      .set(header)
      .send({ active: false })
      .expect(200);
    expect(archived.body.active).toBe(0);
    await ingest(api_key, [punch('1', '2026-06-07 10:00:00')]).expect(401);

    await admin
      .patch(`/api/attendance-devices/${device.id}/active`)
      .set(header)
      .send({ active: true })
      .expect(200);
    await ingest(api_key, [punch('1', '2026-06-07 10:00:00')]).expect(200);
  });
});
