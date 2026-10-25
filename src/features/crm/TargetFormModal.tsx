import { type FormEvent } from 'react';
import { Button, Field, Modal, toCents, useAction, useData } from '../../lib';
import type { CrmAssignee } from '../../types';
import { crmApi, crmUrls } from './api';

export function TargetFormModal({
  month,
  scopeId,
  onClose,
  onSaved,
}: {
  month: string;
  scopeId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const assignees = useData<CrmAssignee[]>(crmUrls.assignees(scopeId));
  const users = assignees.data || [];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const commission = Number(form.get('commission_pct') || '2');
    void act(async () => {
      await crmApi.setTarget(
        {
          user_id: String(form.get('user_id') || ''),
          month: String(form.get('month') || month),
          target_amount: toCents(form.get('target_amount')),
          commission_bps: Math.round((Number.isFinite(commission) ? commission : 2) * 100),
          notes: String(form.get('notes') || ''),
        },
        scopeId,
      );
      onSaved();
    }, 'تم ضبط مستهدف المبيعات ونسبة العمولة');
  };

  return (
    <Modal
      size="md"
      showMaximize
      title="ضبط مستهدف مبيعات وعمولة"
      description="يُحتسب المحقق آلياً من التحصيلات الفعلية، وتُضاف العمولة إلى مسير الرواتب."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <div className="grid two" style={{ marginBottom: '12px' }}>
            <Field label="الموظف / مندوب المبيعات">
              <select name="user_id" required defaultValue={users[0]?.id || ''}>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.role_name})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="شهر المستهدف">
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
                required
              />
            </Field>
          </div>

          <Field label="ملاحظات">
            <input name="notes" placeholder="شروط تحقيق التارجت، حوافز إضافية..." />
          </Field>
        </div>

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
