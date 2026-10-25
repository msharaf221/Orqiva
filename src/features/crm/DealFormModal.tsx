import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Modal, money, toCents, useAction, useData } from '../../lib';
import { useBranch } from '../../branch';
import type { CrmAssignee, CrmDeal, CrmStage, Party } from '../../types';
import { crmApi, crmUrls, type DealInput } from './api';

export function DealFormModal({
  deal,
  stages,
  scopeId,
  onClose,
  onSaved,
}: {
  deal?: CrmDeal;
  stages: CrmStage[];
  scopeId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { branches, defaultBranchId } = useBranch();
  const { busy, act } = useAction();
  const editing = Boolean(deal);
  const [branchId, setBranchId] = useState(deal?.branch_id || defaultBranchId);
  const assignees = useData<CrmAssignee[]>(crmUrls.assignees(scopeId));
  const parties = useData<Party[]>('/parties?type=CUSTOMER');

  useEffect(() => {
    if (!branchId && defaultBranchId) setBranchId(defaultBranchId);
  }, [branchId, defaultBranchId]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const probability = Number(form.get('probability') || '50');
    const payload: DealInput = {
      title: String(form.get('title') || '').trim(),
      contact_name: String(form.get('contact_name') || '').trim(),
      contact_phone: String(form.get('contact_phone') || ''),
      contact_email: String(form.get('contact_email') || ''),
      party_id: String(form.get('party_id') || ''),
      expected_revenue: toCents(form.get('expected_revenue')),
      probability: Number.isFinite(probability) ? probability : 50,
      expected_close_date: String(form.get('expected_close_date') || ''),
      assigned_to_user_id: String(form.get('assigned_to_user_id') || ''),
      notes: String(form.get('notes') || ''),
    };

    void act(
      async () => {
        if (deal) {
          await crmApi.updateDeal(deal.id, payload, scopeId);
        } else {
          await crmApi.createDeal(
            {
              ...payload,
              branch_id: branchId,
              stage_id: String(form.get('stage_id') || stages[0]?.id || ''),
            },
            scopeId,
          );
        }
        onSaved();
      },
      editing ? 'تم حفظ تعديلات الصفقة' : 'تم إنشاء الصفقة وإضافتها إلى مسار المبيعات',
    );
  };

  return (
    <Modal
      size="lg"
      showMaximize
      title={editing ? `تعديل الصفقة ${deal?.code}` : 'إنشاء صفقة مبيعات جديدة'}
      description="سجّل بيانات الفرصة البيعية، وقيمتها المتوقعة، ومسؤول المتابعة."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <div className="grid two" style={{ marginBottom: '12px' }}>
            <Field label="عنوان الصفقة">
              <input
                name="title"
                placeholder="مثال: توريد معدات لشركة الأمل..."
                required
                autoFocus
                defaultValue={deal?.title}
              />
            </Field>
            {editing ? (
              <Field label="الفرع" hint="لا يمكن نقل الصفقة بين الفروع بعد إنشائها.">
                <input value={deal?.branch_name || ''} disabled />
              </Field>
            ) : (
              <Field label="الفرع">
                <select
                  name="branch_id"
                  required
                  value={branchId}
                  onChange={(event) => setBranchId(event.target.value)}
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          {!editing && (
            <div className="grid two" style={{ marginBottom: '12px' }}>
              <Field label="المرحلة في المسار">
                <select name="stage_id" required defaultValue={stages[0]?.id || ''}>
                  {stages
                    .filter((stage) => !stage.is_won && !stage.is_lost)
                    .map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name} ({stage.probability}%)
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="العميل المسجل" hint="اتركه فارغاً لتحويل جهة الاتصال إلى عميل لاحقاً.">
                <select name="party_id" defaultValue={deal?.party_id || ''}>
                  <option value="">جهة اتصال جديدة (غير مسجلة)</option>
                  {(parties.data || []).map((party) => (
                    <option key={party.id} value={party.id}>
                      {party.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {editing && (
            <Field label="العميل المسجل">
              <select name="party_id" defaultValue={deal?.party_id || ''}>
                <option value="">جهة اتصال جديدة (غير مسجلة)</option>
                {(parties.data || []).map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="grid three" style={{ marginBottom: '12px' }}>
            <Field label="اسم جهة الاتصال / العميل">
              <input
                name="contact_name"
                placeholder="أ/ أحمد إبراهيم"
                required
                defaultValue={deal?.contact_name}
              />
            </Field>
            <Field label="رقم الهاتف">
              <input
                name="contact_phone"
                placeholder="010..."
                type="tel"
                defaultValue={deal?.contact_phone || ''}
              />
            </Field>
            <Field label="البريد الإلكتروني">
              <input
                name="contact_email"
                placeholder="client@domain.com"
                type="email"
                defaultValue={deal?.contact_email || ''}
              />
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
                defaultValue={deal ? money(deal.expected_revenue, 2).replace(/,/g, '') : undefined}
              />
            </Field>
            <Field label="احتمالية الإغلاق (%)">
              <input
                name="probability"
                type="number"
                min="0"
                max="100"
                defaultValue={deal?.probability ?? 50}
                required
              />
            </Field>
            <Field label="تاريخ الإغلاق المتوقع">
              <input
                name="expected_close_date"
                type="date"
                defaultValue={deal?.expected_close_date || ''}
              />
            </Field>
          </div>

          <div className="grid two" style={{ marginBottom: '12px' }}>
            <Field label="المسؤول عن الصفقة">
              <select name="assigned_to_user_id" defaultValue={deal?.assigned_to_user_id || ''}>
                <option value="">بدون تعيين محدد</option>
                {(assignees.data || []).map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.role_name})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ملاحظات تفصيلية">
              <input
                name="notes"
                placeholder="احتياجات العميل، المنافسين، شروط التوريد..."
                defaultValue={deal?.notes || ''}
              />
            </Field>
          </div>
        </div>

        <div className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" busy={busy}>
            {editing ? 'حفظ التعديلات' : 'حفظ الصفقة'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
