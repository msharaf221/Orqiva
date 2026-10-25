import { Calendar, Clock, FileText, Mail, PhoneCall } from 'lucide-react';
import type { ActivityPriority, ActivityStatus, ActivityType, DealStatus } from '../../types';

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  CALL: 'مكالمة',
  MEETING: 'اجتماع',
  TASK: 'مهمة',
  EMAIL: 'بريد',
  NOTE: 'ملاحظة',
};

export const PRIORITY_LABELS: Record<ActivityPriority, string> = {
  LOW: 'منخفضة',
  NORMAL: 'عادية',
  HIGH: 'عالية',
  URGENT: 'عاجلة',
};

export const PRIORITY_TONES: Record<ActivityPriority, { background: string; color: string }> = {
  LOW: { background: '#f1f5f9', color: '#475569' },
  NORMAL: { background: '#eff6ff', color: '#1e40af' },
  HIGH: { background: '#fef3c7', color: '#b45309' },
  URGENT: { background: '#fee2e2', color: '#b91c1c' },
};

export const DEAL_STATUS_TONES: Record<DealStatus, { background: string; color: string }> = {
  OPEN: { background: '#eff6ff', color: '#1e40af' },
  WON: { background: '#dcfce7', color: '#15803d' },
  LOST: { background: '#fee2e2', color: '#b91c1c' },
};

export const ACTIVITY_STATUS_TONES: Record<ActivityStatus, { background: string; color: string }> =
  {
    PENDING: { background: '#fef3c7', color: '#b45309' },
    COMPLETED: { background: '#dcfce7', color: '#15803d' },
    CANCELLED: { background: '#f1f5f9', color: '#64748b' },
  };

export function ActivityIcon({ type, size = 15 }: { type: ActivityType; size?: number }) {
  if (type === 'CALL') return <PhoneCall size={size} color="var(--indigo-600)" />;
  if (type === 'MEETING') return <Calendar size={size} color="var(--amber-600)" />;
  if (type === 'TASK') return <Clock size={size} color="var(--emerald-600)" />;
  if (type === 'EMAIL') return <Mail size={size} color="var(--blue-600)" />;
  return <FileText size={size} color="var(--slate-600)" />;
}

export function DealStatusBadge({
  status,
  probability,
}: {
  status: DealStatus;
  probability: number;
}) {
  const tone = DEAL_STATUS_TONES[status];
  return (
    <span
      style={{
        fontSize: '11px',
        padding: '3px 8px',
        borderRadius: '4px',
        fontWeight: 700,
        ...tone,
      }}
    >
      {status === 'WON' ? 'رابحة' : status === 'LOST' ? 'خاسرة' : `${probability}%`}
    </span>
  );
}

export function ActivityStatusBadge({ status }: { status: ActivityStatus }) {
  const tone = ACTIVITY_STATUS_TONES[status];
  return (
    <span
      style={{
        fontSize: '11.5px',
        fontWeight: 700,
        padding: '3px 8px',
        borderRadius: '4px',
        ...tone,
      }}
    >
      {status === 'COMPLETED' ? 'تم الإنجاز' : status === 'CANCELLED' ? 'ملغاة' : 'قيد الانتظار'}
    </span>
  );
}
