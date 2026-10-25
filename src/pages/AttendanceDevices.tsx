import { useEffect, useState, type FormEvent } from 'react';
import {
  Fingerprint,
  Plus,
  RefreshCw,
  KeyRound,
  Pencil,
  Archive,
  RotateCcw,
  Trash2,
  Upload,
  PlayCircle,
  Link2,
  Unlink,
  Clock3,
  Download,
  AlertTriangle,
  Radio,
  Users,
  CalendarDays,
  CheckCircle2,
  Cpu,
} from 'lucide-react';
import {
  api,
  useData,
  useAction,
  useSession,
  useToast,
  PageHeader,
  Button,
  Field,
  SearchBox,
  Modal,
  Loading,
  ErrorState,
  Empty,
  Stat,
  Confirm,
  today,
  formatDate,
} from '../lib';
import { useBranch, withBranch } from '../branch';
import { can } from '../auth';
import type {
  AttendanceDevice,
  AttendancePunch,
  DeviceUserMapping,
  Employee,
  UnmappedDeviceUser,
} from '../types';

type Tab = 'devices' | 'mappings' | 'punches' | 'import' | 'simulator';

export function AttendanceDevices() {
  const { user } = useSession();
  const { activeId, branches, defaultBranchId } = useBranch();
  const devices = useData<AttendanceDevice[]>(withBranch('/attendance-devices', activeId));
  const [selectedId, setSelectedId] = useState('');
  const [tab, setTab] = useState<Tab>('devices');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AttendanceDevice | null>(null);
  const [rotating, setRotating] = useState<AttendanceDevice | null>(null);
  const [deleting, setDeleting] = useState<AttendanceDevice | null>(null);
  const [apiKey, setApiKey] = useState<{ device: string; key: string } | null>(null);
  const { busy, act } = useAction();

  const list = devices.data || [];
  const selected = list.find((d) => d.id === selectedId) || null;

  useEffect(() => {
    if (!list.length) {
      setSelectedId('');
      return;
    }
    if (!list.some((d) => d.id === selectedId)) setSelectedId(list[0].id);
  }, [list, selectedId]);

  const activeDevices = list.filter((d) => d.active).length;
  const totalPunches = list.reduce((sum, d) => sum + (d.punches_count || 0), 0);
  const totalMappings = list.reduce((sum, d) => sum + (d.mappings_count || 0), 0);
  const canManage = can(user, 'attendance_devices:manage');

  const toggleActive = (device: AttendanceDevice) => {
    void act(
      async () => {
        await api(`/attendance-devices/${device.id}/active`, 'PATCH', { active: !device.active });
        devices.reload();
      },
      device.active ? 'تم أرشفة الجهاز' : 'تم تفعيل الجهاز',
    );
  };

  const confirmDelete = () => {
    if (!deleting) return;
    void act(async () => {
      await api(`/attendance-devices/${deleting.id}`, 'DELETE');
      setDeleting(null);
      devices.reload();
    }, 'تم حذف الجهاز');
  };

  return (
    <>
      <PageHeader
        eyebrow="بصمة واحدة، سجل حضور دقيق"
        title="أجهزة الحضور والبصمة"
        description="اربط أجهزة البصمة بالفروع، وحدّد هوية كل موظف على الجهاز، واستورد البصمات الخام أو حاكِها قبل تركيب الجهاز الفعلي."
        actions={
          canManage ? (
            <Button onClick={() => setAdding(true)}>
              <Plus size={16} /> جهاز جديد
            </Button>
          ) : undefined
        }
      />

      <div className="stats-grid" style={{ marginBottom: '16px' }}>
        <Stat
          label="أجهزة مسجلة"
          value={String(list.length)}
          unit="جهاز"
          icon={<Cpu size={20} />}
          tone="blue"
          foot={`${activeDevices} نشط`}
        />
        <Stat
          label="بصمات خام محفوظة"
          value={String(totalPunches)}
          unit="بصمة"
          icon={<Fingerprint size={20} />}
          tone="purple"
          foot="قابلة لإعادة المعالجة"
        />
        <Stat
          label="ارتباطات الموظفين"
          value={String(totalMappings)}
          unit="ربط"
          icon={<Link2 size={20} />}
          tone="green"
          foot="معرّف الجهاز ← الموظف"
        />
      </div>

      <div className="table-toolbar">
        <div className="tabs">
          <button className={tab === 'devices' ? 'active' : ''} onClick={() => setTab('devices')}>
            <span>الأجهزة</span>
          </button>
          <button
            className={tab === 'mappings' ? 'active' : ''}
            onClick={() => setTab('mappings')}
            disabled={!selected}
          >
            <span>ارتباط الموظفين</span>
          </button>
          <button
            className={tab === 'punches' ? 'active' : ''}
            onClick={() => setTab('punches')}
            disabled={!selected}
          >
            <span>البصمات الخام</span>
          </button>
          <button
            className={tab === 'import' ? 'active' : ''}
            onClick={() => setTab('import')}
            disabled={!selected}
          >
            <span>استيراد ملف</span>
          </button>
          <button
            className={tab === 'simulator' ? 'active' : ''}
            onClick={() => setTab('simulator')}
            disabled={!selected}
          >
            <span>محاكاة بصمة</span>
          </button>
        </div>
        {tab !== 'devices' && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: '12px' }}>
              الجهاز:
            </span>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              style={{ minWidth: '220px' }}
            >
              {list.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.branch_name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {devices.loading ? (
        <Loading />
      ) : devices.error ? (
        <ErrorState message={devices.error} retry={devices.reload} />
      ) : tab === 'devices' ? (
        <section className="card table-card">
          {list.length === 0 ? (
            <Empty
              title="لا توجد أجهزة بصمة مسجلة"
              description="أضف جهازاً ولو لم يكن موصولاً بعد؛ ستحصل على مفتاح API جاهز لربطه لاحقاً."
              action={
                canManage ? (
                  <Button onClick={() => setAdding(true)}>
                    <Plus size={16} /> إضافة أول جهاز
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>الجهاز</th>
                  <th>الفرع</th>
                  <th>الرقم التسلسلي</th>
                  <th>العنوان</th>
                  <th>الدوام</th>
                  <th>البصمات / الربط</th>
                  <th>آخر اتصال</th>
                  <th>الحالة</th>
                  <th>الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {list.map((device) => (
                  <tr key={device.id} className={device.id === selectedId ? 'selected' : ''}>
                    <td>
                      <strong>{device.name}</strong>
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                        {device.model || 'طراز غير محدد'}
                      </div>
                    </td>
                    <td>{device.branch_name}</td>
                    <td className="num" dir="ltr">
                      {device.serial_number}
                    </td>
                    <td dir="ltr" className="num">
                      {device.ip_address ? `${device.ip_address}:${device.port}` : '—'}
                    </td>
                    <td className="num">
                      {device.work_start} — {device.work_end}
                    </td>
                    <td className="num">
                      {device.punches_count || 0} / {device.mappings_count || 0}
                    </td>
                    <td>{device.last_seen_at ? formatDate(device.last_seen_at) : 'لم يتصل بعد'}</td>
                    <td>
                      <span className={'badge ' + (device.active ? 'paid' : 'cancelled')}>
                        {device.active ? 'نشط' : 'مؤرشف'}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="icon-btn"
                          title="اختيار الجهاز"
                          onClick={() => {
                            setSelectedId(device.id);
                            setTab('mappings');
                          }}
                        >
                          <Fingerprint size={16} />
                        </button>
                        {canManage && (
                          <>
                            <button
                              className="icon-btn"
                              title="تدوير مفتاح الجهاز"
                              onClick={() => setRotating(device)}
                            >
                              <KeyRound size={16} />
                            </button>
                            <button
                              className="icon-btn"
                              title="تعديل الجهاز"
                              onClick={() => setEditing(device)}
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              className="icon-btn"
                              title={device.active ? 'أرشفة' : 'تفعيل'}
                              onClick={() => toggleActive(device)}
                            >
                              {device.active ? <Archive size={16} /> : <RotateCcw size={16} />}
                            </button>
                            <button
                              className="icon-btn danger"
                              title="حذف"
                              onClick={() => setDeleting(device)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : selected ? (
        tab === 'mappings' ? (
          <MappingsTab device={selected} canManage={canManage} />
        ) : tab === 'punches' ? (
          <PunchesTab device={selected} canManage={canManage} />
        ) : tab === 'import' ? (
          <ImportTab device={selected} canManage={canManage} />
        ) : (
          <SimulatorTab device={selected} canManage={canManage} />
        )
      ) : (
        <Empty title="اختر جهازاً أولاً" description="اختر جهازاً من القائمة أعلاه." />
      )}

      {(adding || editing) && (
        <DeviceModal
          device={editing}
          branches={branches}
          defaultBranchId={defaultBranchId}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={(key) => {
            setAdding(false);
            setEditing(null);
            devices.reload();
            if (key) setApiKey({ device: editing?.name || 'الجهاز الجديد', key });
          }}
        />
      )}

      {rotating && (
        <Confirm
          title="تدوير مفتاح الجهاز"
          description={`سيتم إلغاء المفتاح الحالي لجهاز «${rotating.name}» فوراً. أي جهاز يستخدم المفتاح القديم سيتوقف عن الإرسال حتى تحديث المفتاح.`}
          busy={busy}
          onClose={() => setRotating(null)}
          onConfirm={() =>
            void act(async () => {
              const result = await api<{ api_key: string; device: AttendanceDevice }>(
                `/attendance-devices/${rotating.id}/rotate-key`,
                'POST',
              );
              setApiKey({ device: rotating.name, key: result.api_key });
              setRotating(null);
              devices.reload();
            }, 'تم تدوير مفتاح الجهاز')
          }
        />
      )}

      {deleting && (
        <Confirm
          title="حذف الجهاز"
          description={`سيتم حذف «${deleting.name}» نهائياً. لا يمكن الحذف إذا كانت هناك بصمات مسجلة؛ استخدم الأرشفة بدلاً من ذلك.`}
          busy={busy}
          onClose={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
      )}

      {apiKey && (
        <ApiKeyModal device={apiKey.device} apiKey={apiKey.key} onClose={() => setApiKey(null)} />
      )}
    </>
  );
}

function DeviceModal({
  device,
  branches,
  defaultBranchId,
  onClose,
  onSaved,
}: {
  device: AttendanceDevice | null;
  branches: Array<{ id: string; name: string }>;
  defaultBranchId: string;
  onClose: () => void;
  onSaved: (apiKey?: string) => void;
}) {
  const { busy, act } = useAction();
  const [branchId, setBranchId] = useState(device?.branch_id || defaultBranchId);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = {
      name: String(f.get('name')).trim(),
      serial_number: String(f.get('serial_number')).trim(),
      model: String(f.get('model') || '').trim() || undefined,
      ip_address: String(f.get('ip_address') || '').trim() || undefined,
      port: Number(f.get('port')) || undefined,
      branch_id: branchId,
      work_start: String(f.get('work_start') || '09:00'),
      work_end: String(f.get('work_end') || '17:00'),
      late_grace_minutes: Number(f.get('late_grace_minutes') || 0),
      overtime_after_minutes: Number(f.get('overtime_after_minutes') || 0),
    };
    void act(
      async () => {
        if (device) {
          await api(`/attendance-devices/${device.id}`, 'PUT', payload);
          onSaved();
        } else {
          const result = await api<{ device: AttendanceDevice; api_key: string }>(
            '/attendance-devices',
            'POST',
            payload,
          );
          onSaved(result.api_key);
        }
      },
      device ? 'تم تحديث بيانات الجهاز' : 'تم تسجيل الجهاز وإصدار مفتاح API',
    );
  };

  return (
    <Modal
      size="md"
      title={device ? `تعديل جهاز: ${device.name}` : 'تسجيل جهاز بصمة جديد'}
      description="البيانات التعريفية فقط. ربط الجهاز فعلياً يتم عبر مفتاح API أو استيراد ملف البصمات."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <div className="grid two">
            <Field label="اسم الجهاز *">
              <input name="name" required maxLength={100} defaultValue={device?.name} />
            </Field>
            <Field label="الفرع *">
              <select
                name="branch_id"
                required
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid two">
            <Field label="الرقم التسلسلي *" hint="كما يظهر على شاشة الجهاز أو ملصقه.">
              <input
                name="serial_number"
                required
                dir="ltr"
                maxLength={100}
                defaultValue={device?.serial_number}
              />
            </Field>
            <Field label="الطراز">
              <input name="model" dir="ltr" maxLength={100} defaultValue={device?.model} />
            </Field>
          </div>
          <div className="grid three">
            <Field label="عنوان IP">
              <input
                name="ip_address"
                dir="ltr"
                maxLength={100}
                placeholder="192.168.1.201"
                defaultValue={device?.ip_address}
              />
            </Field>
            <Field label="المنفذ">
              <input
                name="port"
                type="number"
                min="1"
                max="65535"
                defaultValue={device?.port || 4370}
              />
            </Field>
            <Field label="فترة السماح للتأخير (دقيقة)">
              <input
                name="late_grace_minutes"
                type="number"
                min="0"
                max="240"
                defaultValue={device?.late_grace_minutes ?? 10}
              />
            </Field>
          </div>
          <div className="grid three">
            <Field label="بداية الدوام">
              <input name="work_start" type="time" defaultValue={device?.work_start || '09:00'} />
            </Field>
            <Field label="نهاية الدوام">
              <input name="work_end" type="time" defaultValue={device?.work_end || '17:00'} />
            </Field>
            <Field label="احتساب الإضافي بعد (دقيقة)">
              <input
                name="overtime_after_minutes"
                type="number"
                min="0"
                max="240"
                defaultValue={device?.overtime_after_minutes ?? 0}
              />
            </Field>
          </div>
          <div className="info-banner">
            <Radio size={19} />
            <span>
              يمكن للجهاز أو برنامج الوسيط إرسال البصمات إلى{' '}
              <code dir="ltr">POST /api/attendance-devices/ingest</code> باستخدام الترويسة{' '}
              <code dir="ltr">X-Device-Key</code>. ويدعم ZKTeco ADMS وملفات ATTLOG عبر الاستيراد.
            </span>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="submit" busy={busy}>
            {device ? 'حفظ التعديلات' : 'تسجيل الجهاز'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ApiKeyModal({
  device,
  apiKey,
  onClose,
}: {
  device: string;
  apiKey: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const copy = () => {
    void navigator.clipboard
      ?.writeText(apiKey)
      .then(() => toast('تم نسخ مفتاح الجهاز'))
      .catch(() => toast('تعذر النسخ التلقائي؛ انسخ المفتاح يدوياً', 'error'));
  };
  return (
    <Modal
      size="md"
      title="مفتاح API للجهاز"
      description={`احفظ هذا المفتاح الآن لجهاز «${device}». لن يظهر مرة أخرى بعد الإغلاق.`}
      onClose={onClose}
    >
      <div className="modal-body form-grid">
        <div className="info-banner">
          <KeyRound size={20} />
          <span>
            أرسل المفتاح في ترويسة <code dir="ltr">X-Device-Key</code> مع كل دفعة بصمات.
          </span>
        </div>
        <div
          style={{
            background: 'var(--bg-subtle, #f8faf6)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '14px',
            fontFamily: 'monospace',
            direction: 'ltr',
            wordBreak: 'break-all',
          }}
        >
          {apiKey}
        </div>
        <div className="info-banner">
          <AlertTriangle size={19} />
          <span>إذا فُقد المفتاح، استخدم «تدوير المفتاح» من قائمة الجهاز لإصدار مفتاح جديد.</span>
        </div>
      </div>
      <div className="modal-footer">
        <Button onClick={copy}>
          <Download size={16} /> نسخ المفتاح
        </Button>
        <Button variant="secondary" onClick={onClose}>
          تم الحفظ
        </Button>
      </div>
    </Modal>
  );
}

function MappingsTab({ device, canManage }: { device: AttendanceDevice; canManage: boolean }) {
  const mappings = useData<DeviceUserMapping[]>(`/attendance-devices/${device.id}/mappings`);
  const unmapped = useData<UnmappedDeviceUser[]>(`/attendance-devices/${device.id}/unmapped`);
  const employees = useData<Employee[]>(withBranch('/employees', device.branch_id));
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<DeviceUserMapping | null>(null);
  const { busy, act } = useAction();
  const [search, setSearch] = useState('');

  const rows = (mappings.data || []).filter((m) => {
    const q = search.trim();
    if (!q) return true;
    return (
      m.device_user_id.includes(q) ||
      (m.employee_name || '').includes(q) ||
      (m.employee_code || '').includes(q)
    );
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void act(async () => {
      await api(`/attendance-devices/${device.id}/mappings`, 'POST', {
        device_user_id: String(f.get('device_user_id')).trim(),
        employee_id: String(f.get('employee_id')),
      });
      setAdding(false);
      mappings.reload();
      unmapped.reload();
    }, 'تم ربط مستخدم الجهاز بالموظف');
  };

  return (
    <>
      <section className="card table-card">
        <div className="card-heading" style={{ padding: '16px' }}>
          <div>
            <h2>ارتباط الموظفين — {device.name}</h2>
            <p>
              كل بصمة تحمل معرّف مستخدم على الجهاز. اربط هذا المعرّف بالموظف ليُسجَّل الحضور
              تلقائياً.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <SearchBox value={search} onChange={setSearch} placeholder="بحث بالاسم أو المعرّف..." />
            {canManage && (
              <Button onClick={() => setAdding(true)}>
                <Plus size={16} /> ربط موظف
              </Button>
            )}
          </div>
        </div>
        {mappings.loading ? (
          <Loading />
        ) : mappings.error ? (
          <ErrorState message={mappings.error} retry={mappings.reload} />
        ) : rows.length === 0 ? (
          <Empty
            title="لا توجد ارتباطات"
            description="أضف ارتباطاً يدوياً أو استورد بصمات ثم اربط المعرّفات الظاهرة في قسم «مستخدمون غير مرتبطين»."
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>معرّف الجهاز</th>
                <th>الموظف</th>
                <th>الكود</th>
                <th>تاريخ الربط</th>
                <th>الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="num" dir="ltr">
                    {m.device_user_id}
                  </td>
                  <td>
                    <strong>{m.employee_name}</strong>
                  </td>
                  <td className="num">{m.employee_code}</td>
                  <td>{formatDate(m.created_at)}</td>
                  <td>
                    {canManage && (
                      <button
                        className="icon-btn danger"
                        title="فك الارتباط"
                        onClick={() => setDeleting(m)}
                      >
                        <Unlink size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card" style={{ marginTop: '16px', padding: '16px' }}>
        <div className="card-heading" style={{ padding: 0 }}>
          <div>
            <h2>مستخدمون غير مرتبطين على الجهاز</h2>
            <p>معرّفات ظهرت في البصمات ولم تُربط بأي موظف بعد.</p>
          </div>
          <Button variant="secondary" onClick={() => unmapped.reload()}>
            <RefreshCw size={15} /> تحديث
          </Button>
        </div>
        {unmapped.loading ? (
          <Loading />
        ) : (unmapped.data || []).length === 0 ? (
          <p className="muted" style={{ margin: '12px 0 0' }}>
            لا توجد معرّفات غير مرتبطة حالياً.
          </p>
        ) : (
          <div className="table-scroll" style={{ marginTop: '12px' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>معرّف الجهاز</th>
                  <th>عدد البصمات</th>
                  <th>أول ظهور</th>
                  <th>آخر ظهور</th>
                  <th>الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {(unmapped.data || []).map((u) => (
                  <tr key={u.device_user_id}>
                    <td className="num" dir="ltr">
                      {u.device_user_id}
                    </td>
                    <td className="num">{u.punches_count}</td>
                    <td>{formatDate(u.first_seen)}</td>
                    <td>{formatDate(u.last_seen)}</td>
                    <td>
                      {canManage && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setAdding(true);
                          }}
                        >
                          <Link2 size={14} /> ربط
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {adding && (
        <Modal
          size="md"
          title="ربط مستخدم جهاز بموظف"
          description={`الجهاز: ${device.name} · الفرع: ${device.branch_name}`}
          onClose={() => setAdding(false)}
        >
          <form onSubmit={submit}>
            <div className="modal-body form-grid">
              <Field label="معرّف المستخدم على الجهاز *" hint="الرقم/الكود الذي تسجله البصمة.">
                <input
                  name="device_user_id"
                  required
                  dir="ltr"
                  maxLength={100}
                  list="unmapped-device-users"
                  placeholder="مثال: 1001"
                />
                <datalist id="unmapped-device-users">
                  {(unmapped.data || []).map((u) => (
                    <option key={u.device_user_id} value={u.device_user_id} />
                  ))}
                </datalist>
              </Field>
              <Field label="الموظف *">
                <select name="employee_id" required>
                  {(employees.data || []).map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.code} — {emp.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="info-banner">
                <Users size={19} />
                <span>
                  لا يظهر في القائمة إلا موظفو فرع الجهاز. نقل الموظف لفرع آخر يتطلب فك الارتباط
                  أولاً.
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <Button type="submit" busy={busy}>
                حفظ الارتباط
              </Button>
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                إلغاء
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Confirm
          title="فك ارتباط المستخدم"
          description={`سيتم فصل «${deleting.device_user_id}» عن الموظف. ستبقى البصمات محفوظة ويمكن إعادة ربطها لاحقاً.`}
          busy={busy}
          onClose={() => setDeleting(null)}
          onConfirm={() =>
            void act(async () => {
              await api(`/attendance-devices/${device.id}/mappings/${deleting.id}`, 'DELETE');
              setDeleting(null);
              mappings.reload();
              unmapped.reload();
            }, 'تم فك الارتباط')
          }
        />
      )}
    </>
  );
}

function PunchesTab({ device, canManage }: { device: AttendanceDevice; canManage: boolean }) {
  const [date, setDate] = useState('');
  const punches = useData<AttendancePunch[]>(
    `/attendance-devices/${device.id}/punches${date ? `?date=${date}` : ''}`,
  );
  const { busy, act } = useAction();
  const toast = useToast();

  const process = () => {
    void act(async () => {
      const result = await api<{ processed: number }>(
        `/attendance-devices/${device.id}/process`,
        'POST',
      );
      punches.reload();
      toast(`تمت معالجة ${result.processed} يوم حضور`);
    }, 'تمت معالجة البصمات');
  };

  return (
    <section className="card table-card">
      <div className="card-heading" style={{ padding: '16px' }}>
        <div>
          <h2>البصمات الخام — {device.name}</h2>
          <p>تُحفظ كل بصمة كما وصلت من الجهاز قبل تجميعها في سجل الحضور اليومي.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="تصفية بالتاريخ"
          />
          <Button variant="secondary" onClick={() => punches.reload()} busy={punches.loading}>
            <RefreshCw size={15} /> تحديث
          </Button>
          {canManage && (
            <Button onClick={process} busy={busy}>
              <PlayCircle size={16} /> إعادة المعالجة
            </Button>
          )}
        </div>
      </div>
      {punches.loading ? (
        <Loading />
      ) : punches.error ? (
        <ErrorState message={punches.error} retry={punches.reload} />
      ) : (punches.data || []).length === 0 ? (
        <Empty
          title="لا توجد بصمات"
          description="استخدم المحاكاة أو استورد ملفاً، أو انتظر أول دفعة من الجهاز."
        />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>الوقت</th>
              <th>معرّف الجهاز</th>
              <th>الموظف</th>
              <th>النوع</th>
              <th>وسيلة التحقق</th>
              <th>المعالجة</th>
            </tr>
          </thead>
          <tbody>
            {(punches.data || []).map((p) => (
              <tr key={p.id}>
                <td className="num" dir="ltr">
                  {p.punched_at.replace('T', ' ')}
                </td>
                <td className="num" dir="ltr">
                  {p.device_user_id}
                </td>
                <td>{p.employee_name || <span className="muted">غير مرتبط</span>}</td>
                <td>
                  <span className="badge neutral">
                    {p.punch_type === 'IN' ? 'حضور' : p.punch_type === 'OUT' ? 'انصراف' : 'تلقائي'}
                  </span>
                </td>
                <td>{verifyLabel(p.verify_mode)}</td>
                <td>
                  {p.processed_at ? (
                    <span className="badge paid">
                      <CheckCircle2 size={12} /> تمت
                    </span>
                  ) : (
                    <span className="badge draft">بانتظار التجميع</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ImportTab({ device, canManage }: { device: AttendanceDevice; canManage: boolean }) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const { busy, act } = useAction();
  const toast = useToast();

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void act(async () => {
      const result = await api<{
        accepted: number;
        duplicates: number;
        invalid: number;
        unmapped: number;
        attendance: number;
      }>(`/attendance-devices/${device.id}/import`, 'POST', { csv });
      toast(
        `تم استيراد ${result.accepted} بصمة؛ مكررة ${result.duplicates}، غير صالحة ${result.invalid}، غير مرتبطة ${result.unmapped}`,
      );
      setCsv('');
      setFileName('');
    }, 'تمت معالجة الملف');
  };

  return (
    <section className="card settings-card">
      <div className="card-heading">
        <div>
          <h2>استيراد بصمات من ملف — {device.name}</h2>
          <p>
            يدعم ملفات CSV/TSV وملفات ATTLOG النصية. الأعمدة: معرّف المستخدم، الوقت، النوع
            (اختياري)، وسيلة التحقق (اختياري).
          </p>
        </div>
        <Upload size={21} />
      </div>
      <form onSubmit={submit} className="form-card-body form-grid">
        <Field label="ملف البصمات" hint="UTF-8 أو UTF-8 مع BOM. الحد الأقصى 5 ميجابايت.">
          <input
            type="file"
            accept=".csv,.txt,.tsv,.log,text/plain,text/csv"
            onChange={(e) => void readFile(e.target.files?.[0])}
            disabled={!canManage || busy}
          />
        </Field>
        {fileName && (
          <div className="info-banner">
            <CalendarDays size={18} />
            <span>الملف المختار: {fileName}</span>
          </div>
        )}
        <Field label="محتوى الملف" hint="يمكنك لصق المحتوى مباشرة إذا لم يكن الملف متاحاً.">
          <textarea
            rows={10}
            dir="ltr"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={'1001,2026-10-25 09:02:11,IN,1\n1001,2026-10-25 17:10:44,OUT,1'}
            disabled={!canManage || busy}
          />
        </Field>
        <div className="info-banner">
          <Clock3 size={19} />
          <span>
            التوقيت يُحفظ كما هو على الجهاز (توقيت الفرع). البصمات المكررة تُتجاهل تلقائياً،
            والمعرّفات غير المرتبطة تُحفظ للمراجعة.
          </span>
        </div>
        <div className="modal-footer" style={{ paddingInline: 0 }}>
          <Button type="submit" busy={busy} disabled={!canManage || !csv.trim()}>
            <Upload size={16} /> استيراد البصمات
          </Button>
        </div>
      </form>
    </section>
  );
}

function SimulatorTab({ device, canManage }: { device: AttendanceDevice; canManage: boolean }) {
  const employees = useData<Employee[]>(withBranch('/employees', device.branch_id));
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(today());
  const [checkIn, setCheckIn] = useState(device.work_start || '09:00');
  const [checkOut, setCheckOut] = useState(device.work_end || '17:00');
  const { busy, act } = useAction();

  useEffect(() => {
    if (!employeeId && employees.data?.length) setEmployeeId(employees.data[0].id);
  }, [employees.data, employeeId]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void act(async () => {
      const result = await api<{
        accepted: number;
        attendance: number;
        device_user_id: string;
      }>(`/attendance-devices/${device.id}/simulate`, 'POST', {
        employee_id: employeeId,
        date,
        check_in: checkIn,
        check_out: checkOut || undefined,
      });
      setCheckIn(device.work_start || '09:00');
      setCheckOut(device.work_end || '17:00');
      void result;
    }, 'تمت محاكاة البصمة وتحديث سجل الحضور');
  };

  return (
    <section className="card settings-card">
      <div className="card-heading">
        <div>
          <h2>محاكاة بصمة — {device.name}</h2>
          <p>
            تُنشئ بصمة حضور وبصمة انصراف لموظف مرتبط، وتمر بنفس مسار الاستقبال والتجميع. استخدمها
            للاختبار قبل تركيب الجهاز.
          </p>
        </div>
        <Fingerprint size={22} />
      </div>
      {employees.loading ? (
        <Loading />
      ) : employees.error ? (
        <ErrorState message={employees.error} retry={employees.reload} />
      ) : (
        <form onSubmit={submit} className="form-card-body form-grid">
          <div className="grid two">
            <Field label="الموظف *">
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                required
                disabled={!canManage || busy}
              >
                {(employees.data || []).map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.code} — {emp.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="التاريخ *">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                disabled={!canManage || busy}
              />
            </Field>
          </div>
          <div className="grid two">
            <Field label="وقت الحضور">
              <input
                type="time"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                disabled={!canManage || busy}
              />
            </Field>
            <Field label="وقت الانصراف" hint="اتركه فارغاً لبصمة حضور فقط.">
              <input
                type="time"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                disabled={!canManage || busy}
              />
            </Field>
          </div>
          <div className="info-banner">
            <Fingerprint size={19} />
            <span>
              سيتم إنشاء ارتباط تلقائي بمعرّف الجهاز <b dir="ltr">{employeeId || '—'}</b> إذا لم يكن
              موجوداً، ثم تُحتسب دقائق التأخير والإضافي حسب إعدادات الجهاز.
            </span>
          </div>
          <div className="modal-footer" style={{ paddingInline: 0 }}>
            <Button type="submit" busy={busy} disabled={!canManage || !employeeId}>
              <PlayCircle size={16} /> تشغيل المحاكاة
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function verifyLabel(mode: AttendancePunch['verify_mode']) {
  switch (mode) {
    case 'FINGERPRINT':
      return 'بصمة إصبع';
    case 'CARD':
      return 'بطاقة';
    case 'PASSWORD':
      return 'كلمة مرور';
    case 'FACE':
      return 'وجه';
    default:
      return 'أخرى';
  }
}
