import { type FormEvent } from 'react';
import { Button, Modal, useAction } from '../../lib';
import type { CrmActivity } from '../../types';
import { crmApi } from './api';

export function CompleteActivityModal({
  activity,
  scopeId,
  onClose,
  onSaved,
}: {
  activity: CrmActivity;
  scopeId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void act(async () => {
      await crmApi.completeActivity(activity.id, String(form.get('outcome_notes') || ''), scopeId);
      onSaved();
    }, 'تم إنجاز المتابعة وتحديث سجل الصفقة');
  };

  return (
    <Modal size="sm" title="إنجاز المتابعة" description={activity.title} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <label className="field">
            <span>ملخص النتيجة</span>
            <textarea
              name="outcome_notes"
              rows={4}
              placeholder="ماذا تم في المكالمة أو الاجتماع؟ وما الخطوة التالية؟"
              defaultValue={activity.outcome_notes || ''}
              autoFocus
            />
          </label>
        </div>
        <div className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" busy={busy}>
            تأكيد الإنجاز
          </Button>
        </div>
      </form>
    </Modal>
  );
}
