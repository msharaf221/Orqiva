import { type FormEvent } from 'react';
import { Button, Modal, useAction } from '../../lib';
import type { CrmDeal, CrmStage } from '../../types';
import { crmApi } from './api';

export function LostStageModal({
  deal,
  stage,
  scopeId,
  onClose,
  onSaved,
}: {
  deal: CrmDeal;
  stage: CrmStage;
  scopeId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = String(form.get('lost_reason') || '').trim();
    if (!reason) return;
    void act(async () => {
      await crmApi.changeStage(deal.id, stage.id, scopeId, reason);
      onSaved();
    }, 'تم إغلاق الصفقة وتسجيل سبب الخسارة');
  };

  return (
    <Modal
      size="sm"
      title={`إغلاق الصفقة كخاسرة — ${stage.name}`}
      description={`${deal.code} • ${deal.title}. سبب الخسارة إلزامي لتحليل أداء المسار.`}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <label className="field">
            <span>سبب الخسارة</span>
            <textarea
              name="lost_reason"
              rows={3}
              required
              minLength={3}
              placeholder="مثال: السعر أعلى من المنافس / توقف المشروع..."
              autoFocus
            />
          </label>
        </div>
        <div className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="danger" type="submit" busy={busy}>
            تأكيد الخسارة
          </Button>
        </div>
      </form>
    </Modal>
  );
}
