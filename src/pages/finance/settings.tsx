import { useState, type FormEvent } from 'react';
import { can } from '../../auth';
import { Link } from 'react-router-dom';
import {
  Plus,
  ShieldCheck,
  Building2,
  Users,
  LockKeyhole,
  Save,
  Pencil,
  Activity,
  Shield,
  Trash2,
  ReceiptText,
} from 'lucide-react';
import {
  api,
  useData,
  useSession,
  useAction,
  PageHeader,
  Button,
  Field,
  Modal,
  Loading,
  ErrorState,
  Initials,
} from '../../lib';
import type { User, RoleDef, PermissionDef } from '../../types';
import { useBranch } from '../../branch';
import { PermissionsModal } from '../PermissionsModal';
import { EInvoicePanel } from './e-invoice';

export function SettingsPage() {
  const { user } = useSession();
  const [tab, setTab] = useState('company');
  return (
    <>
      <PageHeader
        eyebrow="مساحة عمل على مقاسك"
        title="الإعدادات"
        description="خصص بيانات شركتك، وأدر فريقك وأمان حسابك."
        actions={
          user.role === 'ADMIN' ? (
            <Link to="/activity" className="btn btn-secondary">
              <Activity size={16} /> سجل النشاط
            </Link>
          ) : undefined
        }
      />
      <div className="settings-layout">
        <nav className="card settings-nav">
          <button onClick={() => setTab('company')} className={tab === 'company' ? 'active' : ''}>
            <Building2 size={19} />
            <div>
              <strong>بيانات الشركة</strong>
              <small>الهوية وبيانات الفواتير</small>
            </div>
          </button>
          {can(user, 'users:manage') && (
            <button onClick={() => setTab('users')} className={tab === 'users' ? 'active' : ''}>
              <Users size={19} />
              <div>
                <strong>فريق العمل</strong>
                <small>المستخدمون والأفرع</small>
              </div>
            </button>
          )}
          {can(user, 'users:manage') && (
            <button onClick={() => setTab('roles')} className={tab === 'roles' ? 'active' : ''}>
              <Shield size={19} />
              <div>
                <strong>الأدوار والصلاحيات</strong>
                <small>تخصيص الصلاحيات والأدوار</small>
              </div>
            </button>
          )}
          {can(user, 'eta:view') && (
            <button
              onClick={() => setTab('einvoice')}
              className={tab === 'einvoice' ? 'active' : ''}
            >
              <ReceiptText size={19} />
              <div>
                <strong>الفاتورة الإلكترونية</strong>
                <small>حالة الإرسال لهيئة الضرائب</small>
              </div>
            </button>
          )}
          <button onClick={() => setTab('security')} className={tab === 'security' ? 'active' : ''}>
            <LockKeyhole size={19} />
            <div>
              <strong>أمان الحساب</strong>
              <small>كلمة المرور والجلسات</small>
            </div>
          </button>
          <div className="settings-nav-note">
            <ShieldCheck size={26} />
            <p>
              صلاحيات واضحة.
              <br />
              وبيانات في أمان.
            </p>
          </div>
        </nav>
        <div>
          {tab === 'company' ? (
            <CompanySettings />
          ) : tab === 'users' ? (
            <UserSettings />
          ) : tab === 'roles' ? (
            <RolesSettings />
          ) : tab === 'einvoice' ? (
            <EInvoicePanel />
          ) : (
            <SecuritySettings />
          )}
        </div>
      </div>
    </>
  );
}
function CompanySettings() {
  const { company, refreshCompany, user } = useSession();
  const { busy, act } = useAction();
  const admin = user.role === 'ADMIN';
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void act(async () => {
      await api('/company', 'PUT', {
        name: f.get('name'),
        email: f.get('email'),
        phone: f.get('phone'),
        address: f.get('address'),
        tax_number: f.get('tax_number'),
        tax_registration_number: f.get('tax_registration_number'),
        activity_code: f.get('activity_code'),
        tax_rate: Math.round(Number(f.get('tax_rate')) * 100),
        invoice_note: f.get('invoice_note'),
        eta_environment: f.get('eta_environment'),
      });
      refreshCompany();
    }, 'تم حفظ إعدادات الشركة');
  };
  if (!company) return <Loading />;
  return (
    <form onSubmit={submit} className="card settings-card">
      <div className="card-heading">
        <div>
          <h2>بيانات الشركة</h2>
          <p>تظهر هذه البيانات على الفواتير المطبوعة.</p>
        </div>
        <span className="settings-company-icon">
          <Building2 size={23} />
        </span>
      </div>
      <fieldset disabled={!admin || busy} className="form-card-body form-grid">
        <Field label="اسم الشركة *">
          <input name="name" required maxLength={200} defaultValue={company.name} />
        </Field>
        <div className="form-row">
          <Field label="البريد الإلكتروني">
            <input
              name="email"
              type="email"
              dir="ltr"
              maxLength={200}
              defaultValue={company.email}
            />
          </Field>
          <Field label="رقم الهاتف">
            <input name="phone" type="tel" dir="ltr" maxLength={40} defaultValue={company.phone} />
          </Field>
        </div>
        <Field label="العنوان">
          <input name="address" maxLength={500} defaultValue={company.address} />
        </Field>
        <div className="form-row">
          <Field label="الرقم الضريبي">
            <input name="tax_number" maxLength={50} defaultValue={company.tax_number} />
          </Field>
          <Field label="نسبة الضريبة الافتراضية (%)">
            <input
              name="tax_rate"
              type="number"
              min="0"
              max="100"
              step=".01"
              required
              defaultValue={company.tax_rate / 100}
            />
          </Field>
        </div>
        <div className="form-row">
          <Field
            label="رقم التسجيل الضريبي (ETA)"
            hint="يُستخدم في حمولة الفاتورة الإلكترونية UBL 2.1."
          >
            <input
              name="tax_registration_number"
              dir="ltr"
              maxLength={50}
              defaultValue={company.tax_registration_number}
            />
          </Field>
          <Field label="كود النشاط (ETA)" hint="كود النشاط الضريبي المسجّل لدى هيئة الضرائب.">
            <input
              name="activity_code"
              dir="ltr"
              maxLength={50}
              defaultValue={company.activity_code}
            />
          </Field>
        </div>
        <Field
          label="بيئة الفاتورة الإلكترونية"
          hint="تظل «تجريبية» حتى تركيب مفاتيح sandbox من هيئة الضرائب."
        >
          <select name="eta_environment" defaultValue={company.eta_environment || 'stub'}>
            <option value="stub">تجريبية (بدون إرسال فعلي)</option>
            <option value="preprod">اختبار مبدئي (Preprod)</option>
            <option value="production">إنتاج (Production)</option>
          </select>
        </Field>
        <Field
          label="العملة الأساسية"
          hint="هذه النسخة تعمل بالجنيه المصري لتجنب خلط العملات في التقارير."
        >
          <input disabled value="الجنيه المصري — EGP" />
        </Field>
        <Field label="ملاحظة أسفل الفاتورة">
          <textarea
            name="invoice_note"
            maxLength={1000}
            rows={3}
            defaultValue={company.invoice_note}
          />
        </Field>
      </fieldset>
      <div className="modal-footer">
        {admin ? (
          <Button type="submit" busy={busy}>
            <Save size={17} /> حفظ التغييرات
          </Button>
        ) : (
          <span className="muted">تعديل إعدادات الشركة متاح للمدير فقط.</span>
        )}
      </div>
    </form>
  );
}
function SecuritySettings() {
  const { user } = useSession();
  const { busy, act } = useAction();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    void act(async () => {
      if (f.get('password') !== f.get('confirm')) throw new Error('كلمتا المرور غير متطابقتين');
      await api('/auth/password', 'POST', {
        current: f.get('current'),
        password: f.get('password'),
      });
      form.reset();
    }, 'تم تغيير كلمة المرور وإنهاء الجلسات الأخرى');
  };
  return (
    <form onSubmit={submit} className="card settings-card">
      <div className="card-heading">
        <div>
          <h2>أمان الحساب</h2>
          <p>{user.email}</p>
        </div>
        <LockKeyhole size={21} />
      </div>
      <div className="form-card-body form-grid">
        <div className="info-banner">
          <ShieldCheck size={20} />
          <span>تغيير كلمة المرور يُنهي جلساتك على الأجهزة الأخرى، مع إبقاء جلستك الحالية.</span>
        </div>
        <Field label="كلمة المرور الحالية *">
          <input
            name="current"
            type="password"
            required
            maxLength={128}
            autoComplete="current-password"
          />
        </Field>
        <Field
          label="كلمة المرور الجديدة *"
          hint="١٠ أحرف على الأقل. استخدم كلمة مرور قوية وفريدة."
        >
          <input
            name="password"
            type="password"
            minLength={10}
            maxLength={128}
            required
            autoComplete="new-password"
          />
        </Field>
        <Field label="تأكيد كلمة المرور الجديدة *">
          <input
            name="confirm"
            type="password"
            minLength={10}
            maxLength={128}
            required
            autoComplete="new-password"
          />
        </Field>
      </div>
      <div className="modal-footer">
        <Button type="submit" busy={busy}>
          <LockKeyhole size={17} /> تحديث كلمة المرور
        </Button>
      </div>
    </form>
  );
}
function UserSettings() {
  const { user } = useSession();
  const { branches } = useBranch();
  const data = useData<User[]>('/users');
  const rolesData = useData<RoleDef[]>('/roles');
  const [adding, setAdding] = useState(false),
    [editing, setEditing] = useState<User | null>(null),
    [customizing, setCustomizing] = useState<User | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const { busy, act } = useAction();

  const activeRole = rolesData.data?.find((r) => r.id === selectedRoleId);
  const isSelectedAdmin = activeRole?.code === 'ADMIN';

  const openAdd = () => {
    setSelectedRoleId(
      rolesData.data?.find((r) => r.code === 'SALES')?.id || rolesData.data?.[0]?.id || '',
    );
    setAdding(true);
  };

  const openEdit = (u: User) => {
    setEditing(u);
    const matchedRole = rolesData.data?.find((r) => r.id === u.role_id || r.code === u.role);
    setSelectedRoleId(matchedRole?.id || rolesData.data?.[0]?.id || '');
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const chosenRoleId = String(f.get('role_id') || selectedRoleId);
    const chosenRoleObj = rolesData.data?.find((r) => r.id === chosenRoleId);

    void act(async () => {
      if (editing)
        await api('/users/' + editing.id, 'PATCH', {
          role: chosenRoleObj?.code,
          role_id: chosenRoleId,
          active: f.get('active') === '1',
          branch_ids: chosenRoleObj?.code === 'ADMIN' ? [] : f.getAll('branch_ids').map(String),
        });
      else
        await api('/users', 'POST', {
          name: f.get('name'),
          email: f.get('email'),
          password: f.get('password'),
          role: chosenRoleObj?.code || 'STAFF',
          role_id: chosenRoleId,
          branch_ids: chosenRoleObj?.code === 'ADMIN' ? [] : f.getAll('branch_ids').map(String),
        });
      setAdding(false);
      setEditing(null);
      data.reload();
    }, 'تم حفظ بيانات المستخدم');
  };
  return (
    <>
      <section className="card settings-card">
        <div className="card-heading">
          <div>
            <h2>فريق العمل</h2>
            <p>إدارة أعضاء الفريق وتعيين أدوارهم وفروعهم.</p>
          </div>
          <Button onClick={openAdd}>
            <Plus size={16} /> مستخدم جديد
          </Button>
        </div>
        {data.loading ? (
          <Loading />
        ) : data.error ? (
          <ErrorState message={data.error} retry={data.reload} />
        ) : (
          <div className="user-list">
            {data.data?.map((u, i) => (
              <div className="user-list-item" key={u.id}>
                <Initials name={u.name} tone={i} />
                <div>
                  <strong>
                    {u.name} {u.id === user.id && <small>(أنت)</small>}
                  </strong>
                  <span>{u.email}</span>
                </div>
                <span className={'badge ' + (u.active ? 'paid' : 'cancelled')}>
                  {u.active ? u.role_name || (u.role === 'ADMIN' ? 'مدير' : 'موظف') : 'معطل'}
                </span>
                <div className="user-item-actions">
                  <button
                    className="icon-btn"
                    disabled={u.id === user.id}
                    onClick={() => setCustomizing(u)}
                    title={'تخصيص الصلاحيات الفردية لـ ' + u.name}
                    aria-label={'تخصيص صلاحيات ' + u.name}
                  >
                    <Shield size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    disabled={u.id === user.id}
                    onClick={() => openEdit(u)}
                    aria-label={'تعديل صلاحيات ' + u.name}
                  >
                    <Pencil size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="permissions-note">
          <h3>نظام الصلاحيات المخصص (RBAC)</h3>
          <p>
            يدعم النظام أدواراً مخصصة مع صلاحيات دقيقة لكل شاشة وعملية. يمكنك تخصيص الأدوار من تبويب{' '}
            <b>"الأدوار والصلاحيات"</b> أعلاه.
          </p>
        </div>
      </section>
      {(adding || editing) && (
        <Modal
          title={editing ? 'تعديل صلاحيات المستخدم' : 'إضافة مستخدم جديد'}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        >
          <form onSubmit={submit}>
            <div className="modal-body form-grid">
              {editing ? (
                <div className="info-banner">
                  <Users size={19} />
                  <span>
                    {editing.name} · {editing.email}
                  </span>
                </div>
              ) : (
                <>
                  <Field label="الاسم *">
                    <input name="name" required maxLength={100} />
                  </Field>
                  <Field label="البريد الإلكتروني *">
                    <input name="email" type="email" required maxLength={200} dir="ltr" />
                  </Field>
                  <Field label="كلمة المرور الأولية *">
                    <input
                      name="password"
                      type="password"
                      required
                      minLength={10}
                      maxLength={128}
                      autoComplete="new-password"
                    />
                  </Field>
                </>
              )}

              <Field label="الدور والصلاحية *">
                <select
                  name="role_id"
                  value={selectedRoleId}
                  onChange={(e) => setSelectedRoleId(e.target.value)}
                >
                  {rolesData.data?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.code})
                    </option>
                  ))}
                </select>
              </Field>

              {!isSelectedAdmin && (
                <div className="field branch-field">
                  <span>الفروع المسموح بها لهذا المستخدم</span>
                  <div className="branch-checks">
                    {branches.map((b) => (
                      <label key={b.id} className="check-line">
                        <input
                          type="checkbox"
                          name="branch_ids"
                          value={b.id}
                          defaultChecked={editing ? editing.branch_ids?.includes(b.id) : true}
                        />
                        {b.name}
                      </label>
                    ))}
                  </div>
                  <small>
                    مدير النظام يرى كل الفروع تلقائياً. لباقي الأدوار، حدد الفروع المسموح بالعمل
                    عليها.
                  </small>
                </div>
              )}

              {editing && (
                <Field label="حالة الحساب">
                  <select name="active" defaultValue={editing.active ? '1' : '0'}>
                    <option value="1">نشط</option>
                    <option value="0">معطل</option>
                  </select>
                </Field>
              )}
              <small className="muted">تحديث الصلاحيات يُنهي الجلسات الحالية للمستخدم.</small>
            </div>
            <div className="modal-footer">
              <Button type="submit" busy={busy}>
                حفظ المستخدم
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setAdding(false);
                  setEditing(null);
                }}
              >
                إلغاء
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {customizing && (
        <PermissionsModal
          targetUser={customizing}
          onClose={() => setCustomizing(null)}
          onSaved={() => {
            setCustomizing(null);
            data.reload();
          }}
        />
      )}
    </>
  );
}

function RolesSettings() {
  const rolesData = useData<RoleDef[]>('/roles');
  const permsData = useData<PermissionDef[]>('/permissions');
  const [editingRole, setEditingRole] = useState<RoleDef | null>(null);
  const [addingRole, setAddingRole] = useState(false);
  const { act } = useAction();

  const handleDelete = (role: RoleDef) => {
    if (!window.confirm(`هل أنت متأكد من حذف الدور "${role.name}"؟`)) return;
    void act(async () => {
      await api(`/roles/${role.id}`, 'DELETE');
      rolesData.reload();
    }, 'تم حذف الدور بنجاح');
  };

  return (
    <>
      <section className="card settings-card">
        <div className="card-heading">
          <div>
            <h2>الأدوار والصلاحيات (RBAC)</h2>
            <p>أدوار مخصصة وصلاحيات دقيقة على مستوى كل عملية وشاشة في النظام.</p>
          </div>
          <Button onClick={() => setAddingRole(true)}>
            <Plus size={16} /> دور جديد
          </Button>
        </div>

        {rolesData.loading ? (
          <Loading />
        ) : rolesData.error ? (
          <ErrorState message={rolesData.error} retry={rolesData.reload} />
        ) : (
          <div className="role-cards-grid">
            {rolesData.data?.map((role) => (
              <div className="role-card" key={role.id}>
                <div className="role-card-header">
                  <div className="role-card-title">
                    <h3>{role.name}</h3>
                    <span className="role-code-badge">{role.code}</span>
                  </div>
                  <span className={'badge ' + (role.is_system ? 'neutral' : 'tag')}>
                    {role.is_system ? 'دور قياسي' : 'مخصص'}
                  </span>
                </div>
                <p className="role-card-desc">
                  {role.description || 'لا يوجد وصف محدد لهذا الدور'}
                </p>
                <div className="role-card-meta">
                  <span className="badge paid">{role.user_count || 0} مستخدم</span>
                  <span className="muted" style={{ fontSize: '11px' }}>
                    {role.code === 'ADMIN'
                      ? 'كافة الصلاحيات (شامل)'
                      : `${role.permissions.length} صلاحيات نشطة`}
                  </span>
                </div>
                <div className="role-perms-summary">
                  {role.permissions.slice(0, 4).map((p) => {
                    const def = permsData.data?.find((item) => item.id === p);
                    return (
                      <span className="perm-pill" key={p}>
                        {def?.name || p}
                      </span>
                    );
                  })}
                  {role.permissions.length > 4 && (
                    <span className="perm-pill more">+{role.permissions.length - 4} أخرى</span>
                  )}
                </div>
                <div className="role-card-actions">
                  <Button
                    variant="secondary"
                    onClick={() => setEditingRole(role)}
                    disabled={role.code === 'ADMIN'}
                  >
                    <Pencil size={14} /> تعديل
                  </Button>
                  {!role.is_system && (
                    <Button
                      variant="danger"
                      onClick={() => handleDelete(role)}
                      disabled={(role.user_count ?? 0) > 0}
                    >
                      <Trash2 size={14} /> حذف
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {(addingRole || editingRole) && (
        <RoleModal
          role={editingRole}
          permissions={permsData.data || []}
          onClose={() => {
            setAddingRole(false);
            setEditingRole(null);
          }}
          onSaved={() => {
            setAddingRole(false);
            setEditingRole(null);
            rolesData.reload();
          }}
        />
      )}
    </>
  );
}

function RoleModal({
  role,
  permissions,
  onClose,
  onSaved,
}: {
  role: RoleDef | null;
  permissions: PermissionDef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { act, busy } = useAction();
  const [selectedPerms, setSelectedPerms] = useState<string[]>(role?.permissions || []);

  const groups = Array.from(new Set(permissions.map((p) => p.group)));

  const togglePerm = (permId: string) => {
    setSelectedPerms((prev) =>
      prev.includes(permId) ? prev.filter((id) => id !== permId) : [...prev, permId],
    );
  };

  const toggleGroup = (groupName: string) => {
    const groupPermIds = permissions.filter((p) => p.group === groupName).map((p) => p.id);
    const allSelected = groupPermIds.every((id) => selectedPerms.includes(id));
    if (allSelected) {
      setSelectedPerms((prev) => prev.filter((id) => !groupPermIds.includes(id)));
    } else {
      setSelectedPerms((prev) => Array.from(new Set([...prev, ...groupPermIds])));
    }
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedPerms.length) {
      alert('يجب تحديد صلاحية واحدة على الأقل');
      return;
    }
    const f = new FormData(e.currentTarget);
    const name = String(f.get('name') || '').trim();
    const description = String(f.get('description') || '').trim();
    const code = String(f.get('code') || '').trim();

    void act(async () => {
      if (role) {
        await api(`/roles/${role.id}`, 'PUT', {
          name,
          description,
          permissions: selectedPerms,
        });
      } else {
        await api('/roles', 'POST', {
          name,
          code: code || undefined,
          description,
          permissions: selectedPerms,
        });
      }
      onSaved();
    }, 'تم حفظ الدور بنجاح');
  };

  return (
    <Modal title={role ? `تعديل الدور: ${role.name}` : 'إنشاء دور جديد'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <Field label="اسم الدور *">
            <input name="name" defaultValue={role?.name} required maxLength={100} />
          </Field>
          {!role && (
            <Field label="رمز الدور (اختياري)" hint="حروف إنجليزية كبيرة مثل ACCOUNTANT_LEAD">
              <input name="code" maxLength={50} dir="ltr" />
            </Field>
          )}
          <Field label="الوصف" hint="نبذة عن مهام هذا الدور ومسؤولياته">
            <input name="description" defaultValue={role?.description} maxLength={300} />
          </Field>

          <div style={{ marginTop: '12px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
              }}
            >
              <strong>صلاحيات الدور ({selectedPerms.length} محددة) *</strong>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="perm-group-toggle"
                  onClick={() => setSelectedPerms(permissions.map((p) => p.id))}
                >
                  تحديد الكل
                </button>
                <span className="muted">|</span>
                <button
                  type="button"
                  className="perm-group-toggle"
                  onClick={() => setSelectedPerms([])}
                >
                  إلغاء الكل
                </button>
              </div>
            </div>

            <div className="perms-group-grid">
              {groups.map((group) => {
                const groupPerms = permissions.filter((p) => p.group === group);
                const allSelected = groupPerms.every((p) => selectedPerms.includes(p.id));
                return (
                  <div className="perm-group-box" key={group}>
                    <div className="perm-group-header">
                      <strong>{group}</strong>
                      <button
                        type="button"
                        className="perm-group-toggle"
                        onClick={() => toggleGroup(group)}
                      >
                        {allSelected ? 'إلغاء المجموعة' : 'تحديد المجموعة'}
                      </button>
                    </div>
                    {groupPerms.map((perm) => (
                      <label className="perm-check-item" key={perm.id}>
                        <input
                          type="checkbox"
                          checked={selectedPerms.includes(perm.id)}
                          onChange={() => togglePerm(perm.id)}
                        />
                        <span>{perm.name}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="submit" busy={busy}>
            حفظ الدور
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}
