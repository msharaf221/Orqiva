import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Modal, today, useAction, useData } from '../../lib';
import { useBranch } from '../../branch';
import type { ActivityType, CrmAssignee, CrmDeal } from '../../types';
import { crmApi, crmUrls, type ActivityInput } from './api';

export function ActivityFormModal({
  deals,
  defaultDealId,
  scopeId,
  onClose,
  onSaved,
}: {
  deals: CrmDeal[];
  defaultDealId?: string;
  scopeId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { branches, defaultBranchId } = useBranch();
  const { busy, act } = useAction();
  const [dealId, setDealId] = useState(defaultDealId || '');
  const [branchId, setBranchId] = useState(defaultBranchId);
  const assignees = useData<CrmAssignee[]>(crmUrls.assignees(scopeId));

  useEffect(() => {
    if (!branchId && defaultBranchId) setBranchId(defaultBranchId);
  }, [branchId, defaultBranchId]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: ActivityInput = {
      deal_id: dealId || undefined,
      branch_id: dealId ? undefined : branchId,
      type: String(form.get('type') || 'CALL') as ActivityType,
      title: String(form.get('title') || '').trim(),
      due_date: String(form.get('due_date') || today()),
      due_time: String(form.get('due_time') || ''),
      assigned_to_user_id: String(form.get('assigned_to_user_id') || ''),
      priority: String(form.get('priority') || 'NORMAL') as ActivityInput['priority'],
      outcome_notes: String(form.get('outcome_notes') || ''),
    };

    void act(async () => {
      await crmApi.createActivity(payload, scopeId);
      onSaved();
    }, 'تم تسجيل نشاط المتابعة بنجاح');
  };

  return (
    <Modal
      size="md"
      showMaximize
      title="تسجيل نشاط متابعة جديد"
      description="جدول مكالمة أو اجتماعاً أو مهمة، واربطها بصفقة أو اتركها عامة."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <div className="grid two" style={{ marginBottom: '12px' }}>
            <Field label="نوع النشاط">
              <select name="type" required defaultValue="CALL">
                <option value="CALL">مكالمة هاتفية</option>
                <option value="MEETING">اجتماع / زيارة</option>
                <option value="TASK">مهمة عمل</option>
                <option value="EMAIL">رسالة بريد</option>
                <option value="NOTE">ملاحظة داخلية</option>
              </select>
            </Field>
            <Field label="الصفقة المرتبطة">
              <select
                name="deal_id"
                value={dealId}
                onChange={(event) => setDealId(event.target.value)}
              >
                <option value="">عام / غير مرتبطة بصفقة</option>
                {deals.map((deal) => (
                  <option key={deal.id} value={deal.id}>
                    {deal.code} - {deal.title} ({deal.contact_name})
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {!dealId && (
            <Field label="الفرع">
              <select
                name="branch_id"
                value={branchId}
                onChange={(event) => setBranchId(event.target.value)}
                required
              >
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="موضوع / عنوان النشاط">
            <input
              name="title"
              placeholder="مثال: الاتصال لمناقشة بنود عرض السعر الفني"
              required
              autoFocus
            />
          </Field>

          <div className="grid three" style={{ marginBottom: '12px', marginTop: '12px' }}>
            <Field label="تاريخ التنفيذ المستهدف">
              <input name="due_date" type="date" defaultValue={today()} required />
            </Field>
            <Field label="وقت التنفيذ">
              <input name="due_time" type="time" defaultValue="11:00" />
            </Field>
            <Field label="الأولوية">
              <select name="priority" defaultValue="NORMAL">
                <option value="LOW">منخفضة</option>
                <option value="NORMAL">عادية</option>
                <option value="HIGH">عالية</option>
                <option value="URGENT">عاجلة</option>
              </select>
            </Field>
          </div>

          <div className="grid two" style={{ marginBottom: '12px' }}>
            <Field label="المسؤول عن التنفيذ">
              <select name="assigned_to_user_id" defaultValue="">
                <option value="">بدون تعيين محدد</option>
                {(assignees.data || []).map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ملاحظات وتفاصيل">
              <input name="outcome_notes" placeholder="ملاحظات استرشادية قبل التواصل..." />
            </Field>
          </div>
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
