import { CheckCircle2, XCircle } from 'lucide-react';
import { Button, Empty, formatDate, today } from '../../lib';
import type { CrmActivity } from '../../types';
import {
  ACTIVITY_LABELS,
  ActivityIcon,
  ActivityStatusBadge,
  PRIORITY_LABELS,
  PRIORITY_TONES,
} from './ui';

export function ActivitiesTable({
  activities,
  canManage,
  busyId,
  onOpenDeal,
  onComplete,
  onCancel,
}: {
  activities: CrmActivity[];
  canManage: boolean;
  busyId: string | null;
  onOpenDeal: (dealId: string) => void;
  onComplete: (activity: CrmActivity) => void;
  onCancel: (activity: CrmActivity) => void;
}) {
  if (!activities.length) {
    return (
      <div className="card">
        <Empty
          title="لا توجد أنشطة متابعة"
          description="جدول اتصالاً أو اجتماعاً أو مهمة لمتابعة الصفقات والعملاء."
        />
      </div>
    );
  }

  return (
    <div className="card table-card">
      <table className="table">
        <thead>
          <tr>
            <th>النوع</th>
            <th>عنوان المتابعة</th>
            <th>الصفقة / العميل</th>
            <th>تاريخ التنفيذ</th>
            <th>الأولوية</th>
            <th>المسؤول</th>
            <th>الحالة</th>
            <th>الإجراء</th>
          </tr>
        </thead>
        <tbody>
          {activities.map((activity) => {
            const overdue = activity.status === 'PENDING' && activity.due_date < today();
            return (
              <tr key={activity.id} className={overdue ? 'crm-row-overdue' : undefined}>
                <td>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontWeight: 600,
                    }}
                  >
                    <ActivityIcon type={activity.type} />
                    {ACTIVITY_LABELS[activity.type]}
                  </span>
                </td>
                <td>
                  <strong>{activity.title}</strong>
                  {activity.outcome_notes && (
                    <div style={{ fontSize: '11.5px', color: 'var(--slate-500)' }}>
                      {activity.outcome_notes}
                    </div>
                  )}
                </td>
                <td>
                  {activity.deal_id ? (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => onOpenDeal(activity.deal_id!)}
                    >
                      {activity.deal_title || 'فتح الصفقة'}
                    </button>
                  ) : (
                    activity.customer_name || 'عام'
                  )}
                </td>
                <td style={overdue ? { color: '#b91c1c', fontWeight: 700 } : undefined}>
                  {formatDate(activity.due_date)} {activity.due_time || ''}
                  {overdue && <div style={{ fontSize: '11px' }}>متأخرة</div>}
                </td>
                <td>
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: '4px',
                      ...PRIORITY_TONES[activity.priority],
                    }}
                  >
                    {PRIORITY_LABELS[activity.priority]}
                  </span>
                </td>
                <td>{activity.assigned_to_name || 'عام'}</td>
                <td>
                  <ActivityStatusBadge status={activity.status} />
                </td>
                <td>
                  {canManage && activity.status === 'PENDING' && (
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      <Button
                        variant="ghost"
                        busy={busyId === activity.id}
                        onClick={() => onComplete(activity)}
                      >
                        <CheckCircle2 size={15} /> تم
                      </Button>
                      <Button
                        variant="ghost"
                        busy={busyId === activity.id}
                        onClick={() => onCancel(activity)}
                      >
                        <XCircle size={15} /> إلغاء
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
