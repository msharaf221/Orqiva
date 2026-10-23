import { useState, type FormEvent, useMemo } from 'react';
import {
  Kanban,
  Plus,
  TrendingUp,
  Target,
  DollarSign,
  Calendar,
  PhoneCall,
  Mail,
  UserCheck,
  FileText,
  Clock,
  CheckCircle2,
  User,
  ChevronRight,
  List,
} from 'lucide-react';
import {
  api,
  useData,
  useAction,
  Button,
  Field,
  Modal,
  Empty,
  Stat,
  money,
  toCents,
  today,
  formatDate,
  PageHeader,
} from '../lib';
import type { CrmStage, CrmDeal, CrmActivity, SalesTarget, User as UserType } from '../types';
import { useBranch } from '../branch';

export function CreateDealModal({
  stages,
  onClose,
  onSaved,
}: {
  stages: CrmStage[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { active: currentBranch } = useBranch();
  const { busy, act } = useAction();
  const usersData = useData<UserType[]>('/auth/users');
  const users = usersData.data || [];

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const rev = toCents(f.get('expected_revenue'));
    const prob = Number(f.get('probability') || '50');

    const payload = {
      title: String(f.get('title')).trim(),
      contact_name: String(f.get('contact_name')).trim(),
      contact_phone: String(f.get('contact_phone') || '').trim() || undefined,
      contact_email: String(f.get('contact_email') || '').trim() || undefined,
      stage_id: String(f.get('stage_id')),
      expected_revenue: rev,
      probability: prob,
      expected_close_date: String(f.get('expected_close_date') || '').trim() || undefined,
      assigned_to_user_id: String(f.get('assigned_to_user_id') || '').trim() || undefined,
      branch_id: currentBranch?.id,
      notes: String(f.get('notes') || '').trim() || undefined,
    };

    void act(async () => {
      await api('/crm/deals', 'POST', payload);
      onSaved();
    }, 'تم إنشاء الصفقة وإضافتها إلى مسار المبيعات بنجاح');
  };

  return (
    <Modal
      size="lg"
      showMaximize
      title="إنشاء صفقة مبيعات جديدة"
      description="تسجيل فرصة بيعية جديدة في مسار الصفقات وتحديد القيمة المتوقعة ومسؤول المتابعة."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="grid two" style={{ marginBottom: '12px' }}>
          <Field label="عنوان الصفقة">
            <input name="title" placeholder="مثال: توريد معدات لشركة الأمل..." required autoFocus />
          </Field>
          <Field label="المرحلة في المسار">
            <select name="stage_id" required defaultValue={stages[0]?.id || ''}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.probability}%)
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid three" style={{ marginBottom: '12px' }}>
          <Field label="اسم جهة الاتصال / العميل">
            <input name="contact_name" placeholder="أ/ أحمد إبراهيم" required />
          </Field>
          <Field label="رقم الهاتف">
            <input name="contact_phone" placeholder="010..." type="tel" />
          </Field>
          <Field label="البريد الإلكتروني">
            <input name="contact_email" placeholder="client@domain.com" type="email" />
          </Field>
        </div>

        <div className="grid three" style={{ marginBottom: '12px' }}>
          <Field label="القيمة المتوقعة (ج.م)">
            <input
              name="expected_revenue"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              required
            />
          </Field>
          <Field label="احتمالية الإغلاق (%)">
            <input name="probability" type="number" min="0" max="100" defaultValue="50" required />
          </Field>
          <Field label="تاريخ الإغلاق المتوقع">
            <input name="expected_close_date" type="date" />
          </Field>
        </div>

        <div className="grid two" style={{ marginBottom: '12px' }}>
          <Field label="المسؤول عن الصفقة">
            <select name="assigned_to_user_id" defaultValue="">
              <option value="">بدون تعيين محدد</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
          </Field>
          <Field label="ملاحظات تفصيلية">
            <input name="notes" placeholder="احتياجات العميل، المنافسين، شروط التوريد..." />
          </Field>
        </div>

        <div className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" busy={busy}>
            حفظ الصفقة
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function CreateActivityModal({
  deals,
  defaultDealId,
  onClose,
  onSaved,
}: {
  deals: CrmDeal[];
  defaultDealId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const usersData = useData<UserType[]>('/auth/users');
  const users = usersData.data || [];

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = {
      deal_id: String(f.get('deal_id') || '').trim() || undefined,
      type: String(f.get('type') || 'CALL'),
      title: String(f.get('title')).trim(),
      due_date: String(f.get('due_date') || today()),
      due_time: String(f.get('due_time') || '').trim() || undefined,
      assigned_to_user_id: String(f.get('assigned_to_user_id') || '').trim() || undefined,
      outcome_notes: String(f.get('outcome_notes') || '').trim() || undefined,
    };

    void act(async () => {
      await api('/crm/activities', 'POST', payload);
      onSaved();
    }, 'تم تسجيل نشاط المتابعة بنجاح');
  };

  return (
    <Modal
      size="md"
      showMaximize
      title="تسجيل نشاط متابعة جديد"
      description="جدولة مكالمة هاتفية، اجتماع، مهمة أو تسجيل بريد وملاحظة خاصة بصفقة مبيعات."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="grid two" style={{ marginBottom: '12px' }}>
          <Field label="نوع النشاط">
            <select name="type" required defaultValue="CALL">
              <option value="CALL">مكالمة هاتفية (Call)</option>
              <option value="MEETING">اجتماع / زيارة (Meeting)</option>
              <option value="TASK">مهمة عمل (Task)</option>
              <option value="EMAIL">رسالة بريد (Email)</option>
              <option value="NOTE">ملاحظة داخلية (Note)</option>
            </select>
          </Field>
          <Field label="الصفقة المرتبطة">
            <select name="deal_id" defaultValue={defaultDealId || ''}>
              <option value="">عام / غير مرتبطة بصفقة</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} - {d.title} ({d.contact_name})
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="موضوع / عنوان النشاط">
          <input
            name="title"
            placeholder="مثال: الاتصال لمناقشة بنود عرض السعر الفني"
            required
            autoFocus
          />
        </Field>

        <div className="grid two" style={{ marginBottom: '12px', marginTop: '12px' }}>
          <Field label="تاريخ التنفيذ المستهدف">
            <input name="due_date" type="date" defaultValue={today()} required />
          </Field>
          <Field label="وقت التنفيذ">
            <input name="due_time" type="time" defaultValue="11:00" />
          </Field>
        </div>

        <div className="grid two" style={{ marginBottom: '12px' }}>
          <Field label="المسؤول عن التنفيذ">
            <select name="assigned_to_user_id" defaultValue="">
              <option value="">بدون تعيين محدد</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ملاحظات وتفاصيل">
            <input name="outcome_notes" placeholder="ملاحظات استرشادية قبل التواصل..." />
          </Field>
        </div>

        <div className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" busy={busy}>
            حفظ النشاط
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function CreateTargetModal({
  month,
  onClose,
  onSaved,
}: {
  month: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const usersData = useData<UserType[]>('/auth/users');
  const users = usersData.data || [];

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const targetAmt = toCents(f.get('target_amount'));
    const commPct = Number(f.get('commission_pct') || '2');
    const bps = Math.round(commPct * 100);

    const payload = {
      user_id: String(f.get('user_id')),
      month: String(f.get('month') || month),
      target_amount: targetAmt,
      commission_bps: bps,
      notes: String(f.get('notes') || '').trim() || undefined,
    };

    void act(async () => {
      await api('/crm/targets', 'POST', payload);
      onSaved();
    }, 'تم ضبط مستهدف المبيعات ونسبة العمولة بنجاح');
  };

  return (
    <Modal
      size="md"
      showMaximize
      title="ضبط مستهدف مبيعات وعمولة لموظف"
      description="تحديد التارجت الشهري ونسبة العمولة، وسيتم احتسابها آلياً من الفواتير المحصلة وتضمينها في مسير الرواتب."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="grid two" style={{ marginBottom: '12px' }}>
          <Field label="الموظف / مندوب المبيعات">
            <select name="user_id" required defaultValue={users[0]?.id || ''}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
          </Field>
          <Field label="شهر المستهدف (YYYY-MM)">
            <input name="month" type="month" defaultValue={month} required />
          </Field>
        </div>

        <div className="grid two" style={{ marginBottom: '12px' }}>
          <Field label="قيمة التارجت المستهدف (ج.م)">
            <input
              name="target_amount"
              type="number"
              step="0.01"
              min="1"
              placeholder="مثال: 100000"
              required
              autoFocus
            />
          </Field>
          <Field label="نسبة العمولة (%)">
            <input
              name="commission_pct"
              type="number"
              step="0.1"
              min="0"
              max="100"
              defaultValue="2.0"
              placeholder="2.0"
              required
            />
          </Field>
        </div>

        <Field label="ملاحظات">
          <input name="notes" placeholder="شروط تحقيق التارجت، حوافز إضافية..." />
        </Field>

        <div className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" busy={busy}>
            حفظ المستهدف
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function DealDetailModal({
  deal,
  stages,
  onClose,
  onReload,
}: {
  deal: CrmDeal;
  stages: CrmStage[];
  onClose: () => void;
  onReload: () => void;
}) {
  const { busy, act } = useAction();
  const [addingActivity, setAddingActivity] = useState(false);

  const convertToCustomer = () => {
    void act(async () => {
      await api(`/crm/deals/${deal.id}/convert-customer`, 'POST');
      onReload();
    }, 'تم تحويل جهة الاتصال إلى عميل معتمد في النظام');
  };

  const convertToQuotation = () => {
    void act(async () => {
      await api<{ quotation_id: string; number: string }>(
        `/crm/deals/${deal.id}/convert-quotation`,
        'POST',
      );
      onReload();
    }, 'تم إنشاء مسودة عرض سعر رسمي بنجاح برقم: ' + deal.code);
  };

  const updateStage = (stageId: string) => {
    void act(async () => {
      await api(`/crm/deals/${deal.id}/stage`, 'PATCH', { stage_id: stageId });
      onReload();
    }, 'تم تحديث مرحلة الصفقة بنجاح');
  };

  return (
    <Modal
      size="xl"
      showMaximize
      title={`صفقة: ${deal.title}`}
      description={`كود: ${deal.code} | أنشئت في: ${formatDate(deal.created_at)}`}
      onClose={onClose}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Deal Quick Bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--slate-50)',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--slate-200)',
          }}
        >
          <div>
            <span style={{ fontSize: '13px', color: 'var(--slate-500)', display: 'block' }}>
              القيمة المتوقعة
            </span>
            <strong style={{ fontSize: '20px', color: 'var(--indigo-600)' }}>
              {money(deal.expected_revenue)} ج.م
            </strong>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', fontWeight: 600 }}>المرحلة:</span>
            <select
              value={deal.stage_id}
              onChange={(e) => updateStage(e.target.value)}
              disabled={busy}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1.5px solid var(--slate-300)',
                fontWeight: 600,
              }}
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.probability}%)
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 1-Click Conversions Bar */}
        <div
          style={{
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap',
            padding: '12px',
            background: 'var(--indigo-50)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--indigo-100)',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--indigo-900)' }}>
            إجراءات التحويل السريع:
          </span>
          {!deal.party_id ? (
            <Button variant="secondary" onClick={convertToCustomer} busy={busy}>
              <UserCheck size={16} /> تحويل إلى عميل معتمد
            </Button>
          ) : (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '12.5px',
                color: '#15803d',
                fontWeight: 700,
                background: '#dcfce7',
                padding: '4px 10px',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <CheckCircle2 size={15} /> مرتبط بالعميل: {deal.customer_name}
            </span>
          )}

          {!deal.quotation_id ? (
            <Button variant="primary" onClick={convertToQuotation} busy={busy}>
              <FileText size={16} /> تحويل إلى عرض سعر رسمي (1-Click)
            </Button>
          ) : (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '12.5px',
                color: '#1e40af',
                fontWeight: 700,
                background: '#dbeafe',
                padding: '4px 10px',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <FileText size={15} /> تم إنشاء عرض سعر: {deal.quotation_number}
            </span>
          )}

          <Button variant="ghost" onClick={() => setAddingActivity(true)}>
            <Plus size={16} /> جدولة متابعة
          </Button>
        </div>

        {/* Details Grid */}
        <div className="grid two">
          <div className="card" style={{ padding: '14px' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: 'var(--slate-800)' }}>
              بيانات التواصل
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
              <div>
                <span style={{ color: 'var(--slate-500)' }}>جهة الاتصال: </span>
                <strong>{deal.contact_name}</strong>
              </div>
              {deal.contact_phone && (
                <div>
                  <span style={{ color: 'var(--slate-500)' }}>الهاتف: </span>
                  <a href={`tel:${deal.contact_phone}`}>{deal.contact_phone}</a>
                </div>
              )}
              {deal.contact_email && (
                <div>
                  <span style={{ color: 'var(--slate-500)' }}>البريد: </span>
                  <a href={`mailto:${deal.contact_email}`}>{deal.contact_email}</a>
                </div>
              )}
              <div>
                <span style={{ color: 'var(--slate-500)' }}>المسؤول: </span>
                <span>{deal.assigned_to_name || 'غير محدد'}</span>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '14px' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: 'var(--slate-800)' }}>
              توقعات الإغلاق والفرع
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
              <div>
                <span style={{ color: 'var(--slate-500)' }}>الفرع: </span>
                <span>{deal.branch_name || 'الفرع الرئيسي'}</span>
              </div>
              <div>
                <span style={{ color: 'var(--slate-500)' }}>احتمالية الفوز: </span>
                <strong>{deal.probability}%</strong>
              </div>
              <div>
                <span style={{ color: 'var(--slate-500)' }}>تاريخ الإغلاق المتوقع: </span>
                <span>
                  {deal.expected_close_date ? formatDate(deal.expected_close_date) : 'غير محدد'}
                </span>
              </div>
              {deal.notes && (
                <div>
                  <span style={{ color: 'var(--slate-500)' }}>ملاحظات: </span>
                  <p style={{ margin: '4px 0 0 0', color: 'var(--slate-700)' }}>{deal.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Activities for this deal */}
        <div className="card" style={{ padding: '14px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '10px',
            }}
          >
            <h4 style={{ margin: 0, fontSize: '14px' }}>سجل الأنشطة والمتابعات</h4>
            <Button variant="ghost" onClick={() => setAddingActivity(true)}>
              <Plus size={15} /> إضافة نشاط
            </Button>
          </div>
          {!deal.activities || deal.activities.length === 0 ? (
            <p style={{ color: 'var(--slate-500)', fontSize: '13px', margin: 0 }}>
              لا توجد أنشطة مسجلة لهذه الصفقة بعد. يمكنك جدولة مكالمة أو اجتماع للمتابعة.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {deal.activities.map((actItem) => (
                <div
                  key={actItem.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    background: 'var(--slate-50)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '13px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {actItem.type === 'CALL' && <PhoneCall size={16} color="var(--indigo-600)" />}
                    {actItem.type === 'MEETING' && <Calendar size={16} color="var(--amber-600)" />}
                    {actItem.type === 'TASK' && <Clock size={16} color="var(--emerald-600)" />}
                    {actItem.type === 'EMAIL' && <Mail size={16} color="var(--blue-600)" />}
                    {actItem.type === 'NOTE' && <FileText size={16} color="var(--slate-600)" />}
                    <div>
                      <strong>{actItem.title}</strong>
                      <span
                        style={{
                          fontSize: '11.5px',
                          color: 'var(--slate-500)',
                          display: 'block',
                        }}
                      >
                        الموعد: {formatDate(actItem.due_date)} {actItem.due_time || ''} | المسؤول:{' '}
                        {actItem.assigned_to_name || 'عام'}
                      </span>
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontWeight: 600,
                      background: actItem.status === 'COMPLETED' ? '#dcfce7' : '#fef3c7',
                      color: actItem.status === 'COMPLETED' ? '#15803d' : '#b45309',
                    }}
                  >
                    {actItem.status === 'COMPLETED' ? 'تم التنفيذ' : 'قيد الانتظار'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {addingActivity && (
        <CreateActivityModal
          deals={[deal]}
          defaultDealId={deal.id}
          onClose={() => setAddingActivity(false)}
          onSaved={() => {
            setAddingActivity(false);
            onReload();
          }}
        />
      )}
    </Modal>
  );
}

export function CRM() {
  const [tab, setTab] = useState<'pipeline' | 'deals_list' | 'activities' | 'targets'>('pipeline');
  const [selectedMonth, setSelectedMonth] = useState(today().slice(0, 7));
  const [addingDeal, setAddingDeal] = useState(false);
  const [addingActivity, setAddingActivity] = useState(false);
  const [addingTarget, setAddingTarget] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<CrmDeal | null>(null);

  const stagesData = useData<CrmStage[]>('/crm/stages');
  const dealsData = useData<CrmDeal[]>('/crm/deals');
  const activitiesData = useData<CrmActivity[]>('/crm/activities');
  const targetsData = useData<SalesTarget[]>(`/crm/targets?month=${selectedMonth}`);

  const stages = stagesData.data || [];
  const deals = dealsData.data || [];
  const activities = activitiesData.data || [];
  const targets = targetsData.data || [];

  const reloadAll = () => {
    stagesData.reload();
    dealsData.reload();
    activitiesData.reload();
    targetsData.reload();
  };

  // Group deals by stage
  const dealsByStage = useMemo(() => {
    const map = new Map<string, CrmDeal[]>();
    for (const s of stages) {
      map.set(s.id, []);
    }
    for (const d of deals) {
      const list = map.get(d.stage_id);
      if (list) {
        list.push(d);
      } else {
        map.set(d.stage_id, [d]);
      }
    }
    return map;
  }, [stages, deals]);

  // Aggregate stats
  const totalOpenDeals = deals.filter((d) => d.status === 'OPEN').length;
  const totalPipelineRevenue = deals
    .filter((d) => d.status === 'OPEN')
    .reduce((s, d) => s + (d.expected_revenue || 0), 0);
  const totalWonRevenue = deals
    .filter((d) => d.status === 'WON')
    .reduce((s, d) => s + (d.expected_revenue || 0), 0);
  const totalEarnedCommission = targets.reduce((s, t) => s + (t.earned_commission || 0), 0);

  return (
    <>
      <PageHeader
        eyebrow="إدارة الأعمال والمبيعات"
        title="إدارة علاقات العملاء (CRM)"
        description="متابعة مسار الصفقات (Kanban)، إدارة الأنشطة والمتابعات، وتحويل الصفقات إلى عروض أسعار وعملاء بنقرة واحدة."
        actions={
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button onClick={() => setAddingDeal(true)}>
              <Plus size={18} /> صفقة جديدة
            </Button>
            <Button variant="secondary" onClick={() => setAddingActivity(true)}>
              <Calendar size={18} /> نشاط متابعة
            </Button>
            <Button variant="secondary" onClick={() => setAddingTarget(true)}>
              <Target size={18} /> مستهدف بيعي
            </Button>
          </div>
        }
      />

      {/* KPI Stats Grid */}
      <div className="stats-grid four">
        <Stat
          label="الصفقات المفتوحة في المسار"
          value={String(totalOpenDeals)}
          unit="صفقة"
          icon={<Kanban size={20} />}
          tone="blue"
          foot={`من إجمالي ${deals.length} صفقة مسجلة`}
        />
        <Stat
          label="قيمة الصفقات المفتوحة"
          value={money(totalPipelineRevenue)}
          unit="ج.م"
          icon={<DollarSign size={20} />}
          tone="purple"
          foot="إجمالي الإيراد المتوقع في الـ Pipeline"
        />
        <Stat
          label="الصفقات المغلقة بنجاح (Won)"
          value={money(totalWonRevenue)}
          unit="ج.م"
          icon={<TrendingUp size={20} />}
          tone="green"
          foot={`${deals.filter((d) => d.status === 'WON').length} صفقة تم إغلاقها رابحة`}
        />
        <Stat
          label="العمولات البيعية المستحقة"
          value={money(totalEarnedCommission)}
          unit="ج.م"
          icon={<Target size={20} />}
          tone="amber"
          foot={`لشهر ${selectedMonth} (تضاف لمسير الرواتب)`}
        />
      </div>

      {/* Navigation Tabs */}
      <div className="tabs" style={{ marginTop: '16px', marginBottom: '16px' }}>
        <button className={tab === 'pipeline' ? 'active' : ''} onClick={() => setTab('pipeline')}>
          <Kanban size={16} />
          مسار الصفقات (Kanban)
          <span>{deals.length}</span>
        </button>
        <button
          className={tab === 'deals_list' ? 'active' : ''}
          onClick={() => setTab('deals_list')}
        >
          <List size={16} />
          قائمة الصفقات التفصيلية
        </button>
        <button
          className={tab === 'activities' ? 'active' : ''}
          onClick={() => setTab('activities')}
        >
          <Clock size={16} />
          الأنشطة والمتابعات
          <span>{activities.filter((a) => a.status === 'PENDING').length}</span>
        </button>
        <button className={tab === 'targets' ? 'active' : ''} onClick={() => setTab('targets')}>
          <Target size={16} />
          المستهدفات والعمولات
          <span>{targets.length}</span>
        </button>
      </div>

      {/* Tab 1: Kanban Board */}
      {tab === 'pipeline' && (
        <div className="crm-board-container">
          <div className="crm-board">
            {stages.map((stage) => {
              const stageDeals = dealsByStage.get(stage.id) || [];
              const stageTotal = stageDeals.reduce((s, d) => s + (d.expected_revenue || 0), 0);

              return (
                <div key={stage.id} className="crm-column">
                  <div
                    className="crm-column-header"
                    style={{ borderTop: `4px solid ${stage.color || 'var(--indigo-600)'}` }}
                  >
                    <div className="crm-column-title-row">
                      <span className="crm-column-title">
                        <span
                          className="crm-column-dot"
                          style={{ background: stage.color || 'var(--indigo-600)' }}
                        />
                        {stage.name}
                      </span>
                      <span className="crm-column-badge">{stageDeals.length}</span>
                    </div>
                    <div className="crm-column-summary">
                      <span>احتمالية: {stage.probability}%</span>
                      <strong>{money(stageTotal)} ج.م</strong>
                    </div>
                  </div>

                  <div className="crm-column-cards">
                    {stageDeals.length === 0 ? (
                      <div
                        style={{
                          textAlign: 'center',
                          padding: '24px 12px',
                          color: 'var(--slate-400)',
                          fontSize: '12.5px',
                        }}
                      >
                        لا توجد صفقات في هذه المرحلة
                      </div>
                    ) : (
                      stageDeals.map((deal) => (
                        <div
                          key={deal.id}
                          className="crm-deal-card"
                          onClick={() => setSelectedDeal(deal)}
                        >
                          <div className="crm-deal-header">
                            <div>
                              <span className="crm-deal-code">{deal.code}</span>
                              <div className="crm-deal-title">{deal.title}</div>
                            </div>
                            <span
                              style={{
                                fontSize: '11px',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontWeight: 700,
                                background:
                                  deal.status === 'WON'
                                    ? '#dcfce7'
                                    : deal.status === 'LOST'
                                      ? '#fee2e2'
                                      : '#eff6ff',
                                color:
                                  deal.status === 'WON'
                                    ? '#15803d'
                                    : deal.status === 'LOST'
                                      ? '#b91c1c'
                                      : '#1e40af',
                              }}
                            >
                              {deal.status === 'WON'
                                ? 'رابحة'
                                : deal.status === 'LOST'
                                  ? 'خاسرة'
                                  : `${deal.probability}%`}
                            </span>
                          </div>

                          <div className="crm-deal-amount">{money(deal.expected_revenue)} ج.م</div>

                          <div className="crm-deal-meta">
                            <span className="crm-deal-meta-item">
                              <User size={13} />
                              {deal.contact_name}
                            </span>
                            {deal.expected_close_date && (
                              <span className="crm-deal-meta-item">
                                <Calendar size={13} />
                                {formatDate(deal.expected_close_date, true)}
                              </span>
                            )}
                          </div>

                          <div className="crm-deal-actions">
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedDeal(deal);
                              }}
                            >
                              التفاصيل والتحويل <ChevronRight size={13} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 2: Deals Table List */}
      {tab === 'deals_list' && (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>كود الصفقة</th>
                <th>عنوان الصفقة</th>
                <th>جهة الاتصال</th>
                <th>المرحلة</th>
                <th>القيمة المتوقعة</th>
                <th>الاحتمالية</th>
                <th>تاريخ الإغلاق</th>
                <th>المسؤول</th>
                <th>الحالة</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {deals.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '30px' }}>
                    <Empty
                      title="لا توجد صفقات مسجلة"
                      description="ابدأ بإضافة صفقات جديدة لمسار المبيعات"
                    />
                  </td>
                </tr>
              ) : (
                deals.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <span className="branch-code">{d.code}</span>
                    </td>
                    <td>
                      <strong>{d.title}</strong>
                    </td>
                    <td>
                      <div>{d.contact_name}</div>
                      {d.contact_phone && (
                        <small style={{ color: 'var(--slate-500)' }}>{d.contact_phone}</small>
                      )}
                    </td>
                    <td>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontWeight: 600,
                        }}
                      >
                        <span
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: d.stage_color || 'var(--indigo-600)',
                          }}
                        />
                        {d.stage_name}
                      </span>
                    </td>
                    <td>
                      <strong>{money(d.expected_revenue)} ج.م</strong>
                    </td>
                    <td>{d.probability}%</td>
                    <td>{d.expected_close_date ? formatDate(d.expected_close_date) : '-'}</td>
                    <td>{d.assigned_to_name || 'عام'}</td>
                    <td>
                      <span
                        style={{
                          fontSize: '11.5px',
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: '4px',
                          background:
                            d.status === 'WON'
                              ? '#dcfce7'
                              : d.status === 'LOST'
                                ? '#fee2e2'
                                : '#eff6ff',
                          color:
                            d.status === 'WON'
                              ? '#15803d'
                              : d.status === 'LOST'
                                ? '#b91c1c'
                                : '#1e40af',
                        }}
                      >
                        {d.status === 'WON' ? 'رابحة' : d.status === 'LOST' ? 'خاسرة' : 'مفتوحة'}
                      </span>
                    </td>
                    <td>
                      <Button variant="ghost" onClick={() => setSelectedDeal(d)}>
                        عرض
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 3: Activities & Follow-ups */}
      {tab === 'activities' && (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>النوع</th>
                <th>عنوان المتابعة</th>
                <th>الصفقة / العميل</th>
                <th>تاريخ التنفيذ</th>
                <th>المسؤول</th>
                <th>الحالة</th>
                <th>الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {activities.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '30px' }}>
                    <Empty
                      title="لا توجد أنشطة متابعة"
                      description="قم بجدولة اتصالات واجتماعات جديدة لمتابعة الصفقات"
                    />
                  </td>
                </tr>
              ) : (
                activities.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontWeight: 600,
                        }}
                      >
                        {a.type === 'CALL' && <PhoneCall size={15} color="var(--indigo-600)" />}
                        {a.type === 'MEETING' && <Calendar size={15} color="var(--amber-600)" />}
                        {a.type === 'TASK' && <Clock size={15} color="var(--emerald-600)" />}
                        {a.type === 'EMAIL' && <Mail size={15} color="var(--blue-600)" />}
                        {a.type === 'NOTE' && <FileText size={15} color="var(--slate-600)" />}
                        {a.type === 'CALL'
                          ? 'مكالمة'
                          : a.type === 'MEETING'
                            ? 'اجتماع'
                            : a.type === 'TASK'
                              ? 'مهمة'
                              : a.type === 'EMAIL'
                                ? 'بريد'
                                : 'ملاحظة'}
                      </span>
                    </td>
                    <td>
                      <strong>{a.title}</strong>
                      {a.outcome_notes && (
                        <div style={{ fontSize: '11.5px', color: 'var(--slate-500)' }}>
                          {a.outcome_notes}
                        </div>
                      )}
                    </td>
                    <td>{a.deal_title ? `${a.deal_title}` : a.customer_name || 'عام'}</td>
                    <td>
                      {formatDate(a.due_date)} {a.due_time || ''}
                    </td>
                    <td>{a.assigned_to_name || 'عام'}</td>
                    <td>
                      <span
                        style={{
                          fontSize: '11.5px',
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: '4px',
                          background: a.status === 'COMPLETED' ? '#dcfce7' : '#fef3c7',
                          color: a.status === 'COMPLETED' ? '#15803d' : '#b45309',
                        }}
                      >
                        {a.status === 'COMPLETED' ? 'تم الإنجاز' : 'قيد الانتظار'}
                      </span>
                    </td>
                    <td>
                      {a.status !== 'COMPLETED' && (
                        <Button
                          variant="ghost"
                          onClick={async () => {
                            await api(`/crm/activities/${a.id}`, 'PATCH', { status: 'COMPLETED' });
                            activitiesData.reload();
                          }}
                        >
                          <CheckCircle2 size={15} /> تم
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 4: Sales Targets & Commissions */}
      {tab === 'targets' && (
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontWeight: 600 }}>عرض مستهدفات شهر:</span>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--slate-300)',
                }}
              />
            </div>
            <Button onClick={() => setAddingTarget(true)}>
              <Plus size={16} /> إضافة مستهدف بيعي
            </Button>
          </div>

          <div className="target-grid">
            {targets.length === 0 ? (
              <div style={{ gridColumn: '1 / -1' }}>
                <Empty
                  title="لا توجد مستهدفات لهذا الشهر"
                  description="قم بتحديد المستهدفات البيعية ونسب العمولات لفريق المبيعات ليتم حسابها تلقائياً."
                />
              </div>
            ) : (
              targets.map((t) => {
                const pct = t.achieved_pct || 0;
                const earned = t.earned_commission || 0;
                return (
                  <div key={t.id} className="target-card">
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: '16px', display: 'block' }}>
                          {t.user_name}
                        </strong>
                        <span style={{ fontSize: '12px', color: 'var(--slate-500)' }}>
                          نسبة العمولة: {t.commission_bps / 100}%
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '12px',
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: '4px',
                          background: pct >= 100 ? '#dcfce7' : '#eff6ff',
                          color: pct >= 100 ? '#15803d' : '#1e40af',
                        }}
                      >
                        {pct}% محقق
                      </span>
                    </div>

                    <div className="target-progress-bar">
                      <div
                        className="target-progress-fill"
                        style={{
                          width: `${Math.min(pct, 100)}%`,
                          background: pct >= 100 ? '#16a34a' : 'var(--indigo-600)',
                        }}
                      />
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '13px',
                      }}
                    >
                      <div>
                        <span style={{ color: 'var(--slate-500)' }}>المحقق: </span>
                        <strong>{money(t.achieved_amount || 0)} ج.م</strong>
                      </div>
                      <div>
                        <span style={{ color: 'var(--slate-500)' }}>المستهدف: </span>
                        <span>{money(t.target_amount)} ج.م</span>
                      </div>
                    </div>

                    <div
                      style={{
                        paddingTop: '10px',
                        borderTop: '1px solid var(--slate-100)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontSize: '13px', color: 'var(--slate-600)' }}>
                        العمولة المستحقة:
                      </span>
                      <strong style={{ fontSize: '16px', color: '#16a34a' }}>
                        {money(earned)} ج.م
                      </strong>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      {addingDeal && (
        <CreateDealModal
          stages={stages}
          onClose={() => setAddingDeal(false)}
          onSaved={() => {
            setAddingDeal(false);
            reloadAll();
          }}
        />
      )}

      {addingActivity && (
        <CreateActivityModal
          deals={deals}
          onClose={() => setAddingActivity(false)}
          onSaved={() => {
            setAddingActivity(false);
            reloadAll();
          }}
        />
      )}

      {addingTarget && (
        <CreateTargetModal
          month={selectedMonth}
          onClose={() => setAddingTarget(false)}
          onSaved={() => {
            setAddingTarget(false);
            reloadAll();
          }}
        />
      )}

      {selectedDeal && (
        <DealDetailModal
          deal={selectedDeal}
          stages={stages}
          onClose={() => setSelectedDeal(null)}
          onReload={() => {
            setSelectedDeal(null);
            reloadAll();
          }}
        />
      )}
    </>
  );
}
