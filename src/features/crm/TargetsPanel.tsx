import { Plus } from 'lucide-react';
import { Button, Empty, money } from '../../lib';
import type { SalesTarget } from '../../types';

export function TargetsPanel({
  targets,
  month,
  canManage,
  onMonthChange,
  onAdd,
}: {
  targets: SalesTarget[];
  month: string;
  canManage: boolean;
  onMonthChange: (month: string) => void;
  onAdd: () => void;
}) {
  return (
    <div>
      <div className="crm-toolbar">
        <label className="crm-toolbar-field">
          <span>عرض مستهدفات شهر</span>
          <input
            type="month"
            value={month}
            onChange={(event) => onMonthChange(event.target.value)}
          />
        </label>
        {canManage && (
          <Button onClick={onAdd}>
            <Plus size={16} /> إضافة مستهدف بيعي
          </Button>
        )}
      </div>

      <div className="target-grid">
        {targets.length === 0 ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <Empty
              title="لا توجد مستهدفات لهذا الشهر"
              description="حدّد المستهدفات ونسب العمولات لفريق المبيعات ليتم احتسابها من التحصيلات الفعلية."
            />
          </div>
        ) : (
          targets.map((target) => {
            const percentage = target.achieved_pct || 0;
            return (
              <div key={target.id} className="target-card">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <div>
                    <strong style={{ fontSize: '16px', display: 'block' }}>
                      {target.user_name}
                    </strong>
                    <span style={{ fontSize: '12px', color: 'var(--slate-500)' }}>
                      نسبة العمولة: {target.commission_bps / 100}%
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: '4px',
                      background: percentage >= 100 ? '#dcfce7' : '#eff6ff',
                      color: percentage >= 100 ? '#15803d' : '#1e40af',
                    }}
                  >
                    {percentage}% محقق
                  </span>
                </div>

                <div className="target-progress-bar">
                  <div
                    className="target-progress-fill"
                    style={{
                      width: `${Math.min(percentage, 100)}%`,
                      background: percentage >= 100 ? '#16a34a' : 'var(--indigo-600)',
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
                    <strong>{money(target.achieved_amount || 0)} ج.م</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--slate-500)' }}>المستهدف: </span>
                    <span>{money(target.target_amount)} ج.م</span>
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
                    {money(target.earned_commission || 0)} ج.م
                  </strong>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
