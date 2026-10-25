import { Activity, DollarSign, Kanban, Target, TrendingUp } from 'lucide-react';
import { Stat, money } from '../../lib';
import type { CrmOverview, SalesTarget } from '../../types';

export function CrmStats({
  overview,
  targets,
  month,
}: {
  overview: CrmOverview | null;
  targets: SalesTarget[];
  month: string;
}) {
  const data = overview ?? {
    open_deals: 0,
    open_value: 0,
    weighted_value: 0,
    won_value: 0,
    won_deals: 0,
    lost_deals: 0,
    win_rate: 0,
    average_deal: 0,
    pending_activities: 0,
    overdue_activities: 0,
  };
  const commission = targets.reduce((sum, target) => sum + (target.earned_commission || 0), 0);

  return (
    <div className="stats-grid four">
      <Stat
        label="الصفقات المفتوحة في المسار"
        value={String(data.open_deals)}
        unit="صفقة"
        icon={<Kanban size={20} />}
        tone="blue"
        foot={`متوسط قيمة الصفقة ${money(data.average_deal)} ج.م`}
      />
      <Stat
        label="قيمة الصفقات المفتوحة"
        value={money(data.open_value)}
        unit="ج.م"
        icon={<DollarSign size={20} />}
        tone="purple"
        foot="إجمالي الإيراد المتوقع في الـ Pipeline"
      />
      <Stat
        label="التوقع المرجح (Weighted)"
        value={money(data.weighted_value)}
        unit="ج.م"
        icon={<Target size={20} />}
        tone="amber"
        foot={`محسوب باحتمالية كل مرحلة — عمولات ${month}: ${money(commission)} ج.م`}
      />
      <Stat
        label="الصفقات المغلقة بنجاح"
        value={money(data.won_value)}
        unit="ج.م"
        icon={<TrendingUp size={20} />}
        tone="green"
        foot={`${data.won_deals} رابحة من ${data.won_deals + data.lost_deals} — نسبة الفوز ${data.win_rate}%`}
      />
      {data.overdue_activities > 0 && (
        <div className="crm-alert" role="status">
          <Activity size={17} />
          <span>
            لديك <strong>{data.overdue_activities}</strong> متابعة متأخرة و
            <strong> {data.pending_activities}</strong> متابعة قيد الانتظار. راجع تبويب الأنشطة
            لتفادي فقدان الصفقات.
          </span>
        </div>
      )}
    </div>
  );
}
