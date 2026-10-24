import { useState } from 'react';
import { CheckCircle2, FileText, Pencil, Plus, UserCheck, XCircle } from 'lucide-react';
import { Button, Loading, Modal, formatDate, money, useAction, useData } from '../../lib';
import type { CrmActivity, CrmDeal, CrmStage } from '../../types';
import { crmApi, crmUrls } from './api';
import { CompleteActivityModal } from './CompleteActivityModal';
import { DealFormModal } from './DealFormModal';
import { ActivityFormModal } from './ActivityFormModal';
import { LostStageModal } from './LostStageModal';
import {
  ACTIVITY_LABELS,
  ActivityIcon,
  ActivityStatusBadge,
  PRIORITY_LABELS,
  PRIORITY_TONES,
} from './ui';

export function DealDetailModal({
  dealId,
  scopeId,
  stages,
  canManage,
  onClose,
  onChanged,
}: {
  dealId: string;
  scopeId?: string;
  stages: CrmStage[];
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data: deal, loading, error, reload } = useData<CrmDeal>(crmUrls.deal(dealId, scopeId));
  const { busy, act } = useAction();
  const [editing, setEditing] = useState(false);
  const [addingActivity, setAddingActivity] = useState(false);
  const [completing, setCompleting] = useState<CrmActivity | null>(null);
  const [lostStage, setLostStage] = useState<CrmStage | null>(null);

  const changed = () => {
    reload();
    onChanged();
  };

  const move = (stageId: string, lostReason?: string) => {
    if (!deal) return;
    void act(async () => {
      await crmApi.changeStage(deal.id, stageId, scopeId, lostReason);
      changed();
    }, 'تم تحديث مرحلة الصفقة');
  };

  const selectStage = (stageId: string) => {
    const stage = stages.find((item) => item.id === stageId);
    if (!stage) return;
    if (stage.is_lost) {
      setLostStage(stage);
      return;
    }
    move(stageId);
  };

  const convertCustomer = () => {
    if (!deal) return;
    void act(async () => {
      await crmApi.convertToCustomer(deal.id, scopeId);
      changed();
    }, 'تم تحويل جهة الاتصال إلى عميل معتمد');
  };

  const convertQuotation = () => {
    if (!deal) return;
    void act(async () => {
      await crmApi.convertToQuotation(deal.id, scopeId);
      changed();
    }, 'تم إنشاء مسودة عرض سعر رسمي');
  };

  const cancelActivity = (activity: CrmActivity) => {
    void act(async () => {
      await crmApi.updateActivity(activity.id, { status: 'CANCELLED' }, scopeId);
      changed();
    }, 'تم إلغاء المتابعة');
  };

  return (
    <Modal
      size="xl"
      showMaximize
      title={deal ? `صفقة: ${deal.title}` : 'تفاصيل الصفقة'}
      description={
        deal
          ? `كود: ${deal.code} | الفرع: ${deal.branch_name || '—'} | أنشئت في: ${formatDate(deal.created_at)}`
          : 'جارٍ تحميل بيانات الصفقة...'
      }
      onClose={onClose}
    >
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {loading && !deal ? (
          <Loading />
        ) : error ? (
          <div className="crm-error">
            <span>{error}</span>
            <Button variant="secondary" onClick={reload}>
              إعادة المحاولة
            </Button>
          </div>
        ) : deal ? (
          <>
            <div className="crm-detail-summary">
              <div>
                <span className="crm-detail-label">القيمة المتوقعة</span>
                <strong className="crm-detail-value">{money(deal.expected_revenue)} ج.م</strong>
                <span className="crm-detail-meta">
                  {deal.status === 'WON'
                    ? 'صفقة رابحة'
                    : deal.status === 'LOST'
                      ? `صفقة خاسرة${deal.lost_reason ? ` — ${deal.lost_reason}` : ''}`
                      : `${deal.probability}% احتمالية`}
                </span>
              </div>
              <div className="crm-detail-stage">
                <span className="crm-detail-label">المرحلة</span>
                {canManage ? (
                  <select
                    value={deal.stage_id}
                    onChange={(event) => selectStage(event.target.value)}
                    disabled={busy}
                    aria-label="مرحلة الصفقة"
                  >
                    {stages.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name} ({stage.probability}%)
                      </option>
                    ))}
                  </select>
                ) : (
                  <strong>{deal.stage_name}</strong>
                )}
                {canManage && (
                  <Button variant="ghost" onClick={() => setEditing(true)}>
                    <Pencil size={15} /> تعديل البيانات
                  </Button>
                )}
              </div>
            </div>

            <div className="crm-actions-bar">
              <span className="crm-actions-title">إجراءات التحويل السريع:</span>
              {!deal.party_id ? (
                canManage && (
                  <Button variant="secondary" onClick={convertCustomer} busy={busy}>
                    <UserCheck size={16} /> تحويل إلى عميل معتمد
                  </Button>
                )
              ) : (
                <span className="crm-pill success">
                  <CheckCircle2 size={15} /> مرتبط بالعميل: {deal.customer_name}
                </span>
              )}

              {!deal.quotation_id ? (
                canManage && (
                  <Button variant="primary" onClick={convertQuotation} busy={busy}>
                    <FileText size={16} /> تحويل إلى عرض سعر رسمي
                  </Button>
                )
              ) : (
                <span className="crm-pill info">
                  <FileText size={15} /> عرض سعر: {deal.quotation_number}
                </span>
              )}

              {canManage && (
                <Button variant="ghost" onClick={() => setAddingActivity(true)}>
                  <Plus size={16} /> جدولة متابعة
                </Button>
              )}
            </div>

            <div className="grid two">
              <div className="card" style={{ padding: '14px' }}>
                <h4 className="crm-card-title">بيانات التواصل</h4>
                <div className="crm-detail-list">
                  <div>
                    <span>جهة الاتصال: </span>
                    <strong>{deal.contact_name}</strong>
                  </div>
                  {deal.contact_phone && (
                    <div>
                      <span>الهاتف: </span>
                      <a href={`tel:${deal.contact_phone}`} dir="ltr">
                        {deal.contact_phone}
                      </a>
                    </div>
                  )}
                  {deal.contact_email && (
                    <div>
                      <span>البريد: </span>
                      <a href={`mailto:${deal.contact_email}`} dir="ltr">
                        {deal.contact_email}
                      </a>
                    </div>
                  )}
                  <div>
                    <span>المسؤول: </span>
                    <span>{deal.assigned_to_name || 'غير محدد'}</span>
                  </div>
                </div>
              </div>

              <div className="card" style={{ padding: '14px' }}>
                <h4 className="crm-card-title">التوقعات والفرع</h4>
                <div className="crm-detail-list">
                  <div>
                    <span>الفرع: </span>
                    <span>{deal.branch_name || 'الفرع الرئيسي'}</span>
                  </div>
                  <div>
                    <span>احتمالية الفوز: </span>
                    <strong>{deal.probability}%</strong>
                  </div>
                  <div>
                    <span>تاريخ الإغلاق المتوقع: </span>
                    <span>
                      {deal.expected_close_date ? formatDate(deal.expected_close_date) : 'غير محدد'}
                    </span>
                  </div>
                  {deal.closed_at && (
                    <div>
                      <span>تاريخ الإغلاق الفعلي: </span>
                      <span>{formatDate(deal.closed_at)}</span>
                    </div>
                  )}
                  {deal.notes && (
                    <div>
                      <span>ملاحظات: </span>
                      <p style={{ margin: '4px 0 0 0', color: 'var(--slate-700)' }}>{deal.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="card" style={{ padding: '14px' }}>
              <div className="crm-card-header">
                <h4 className="crm-card-title">سجل الأنشطة والمتابعات</h4>
                {canManage && (
                  <Button variant="ghost" onClick={() => setAddingActivity(true)}>
                    <Plus size={15} /> إضافة نشاط
                  </Button>
                )}
              </div>
              {!deal.activities?.length ? (
                <p style={{ color: 'var(--slate-500)', fontSize: '13px', margin: 0 }}>
                  لا توجد أنشطة مسجلة لهذه الصفقة بعد.
                </p>
              ) : (
                <div className="crm-timeline">
                  {deal.activities.map((activity) => (
                    <div key={activity.id} className="crm-timeline-item">
                      <div className="crm-timeline-icon">
                        <ActivityIcon type={activity.type} size={16} />
                      </div>
                      <div className="crm-timeline-body">
                        <div className="crm-timeline-top">
                          <strong>{activity.title}</strong>
                          <ActivityStatusBadge status={activity.status} />
                        </div>
                        <div className="crm-timeline-meta">
                          <span>
                            {ACTIVITY_LABELS[activity.type]} • {formatDate(activity.due_date)}
                            {activity.due_time ? ` ${activity.due_time}` : ''}
                          </span>
                          <span
                            style={{
                              ...PRIORITY_TONES[activity.priority],
                              padding: '1px 6px',
                              borderRadius: '4px',
                              fontWeight: 700,
                            }}
                          >
                            {PRIORITY_LABELS[activity.priority]}
                          </span>
                          <span>{activity.assigned_to_name || 'عام'}</span>
                        </div>
                        {activity.outcome_notes && (
                          <p className="crm-timeline-notes">{activity.outcome_notes}</p>
                        )}
                        {canManage && activity.status === 'PENDING' && (
                          <div className="crm-timeline-actions">
                            <Button variant="ghost" onClick={() => setCompleting(activity)}>
                              <CheckCircle2 size={14} /> إنجاز
                            </Button>
                            <Button variant="ghost" onClick={() => cancelActivity(activity)}>
                              <XCircle size={14} /> إلغاء
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>

      <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onClose}>
          إغلاق
        </Button>
      </div>

      {deal && editing && (
        <DealFormModal
          deal={deal}
          stages={stages}
          scopeId={scopeId}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            changed();
          }}
        />
      )}

      {deal && addingActivity && (
        <ActivityFormModal
          deals={[deal]}
          defaultDealId={deal.id}
          scopeId={scopeId}
          onClose={() => setAddingActivity(false)}
          onSaved={() => {
            setAddingActivity(false);
            changed();
          }}
        />
      )}

      {deal && lostStage && (
        <LostStageModal
          deal={deal}
          stage={lostStage}
          scopeId={scopeId}
          onClose={() => setLostStage(null)}
          onSaved={() => {
            setLostStage(null);
            changed();
          }}
        />
      )}

      {deal && completing && (
        <CompleteActivityModal
          activity={completing}
          scopeId={scopeId}
          onClose={() => setCompleting(null)}
          onSaved={() => {
            setCompleting(null);
            changed();
          }}
        />
      )}
    </Modal>
  );
}
