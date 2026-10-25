import { Pencil } from 'lucide-react';
import { Button, Empty, formatDate, money } from '../../lib';
import type { CrmDeal } from '../../types';

export function DealsTable({
  deals,
  showBranch,
  canManage,
  onOpen,
  onEdit,
}: {
  deals: CrmDeal[];
  showBranch: boolean;
  canManage: boolean;
  onOpen: (deal: CrmDeal) => void;
  onEdit: (deal: CrmDeal) => void;
}) {
  if (!deals.length) {
    return (
      <div className="card">
        <Empty
          title="لا توجد صفقات مطابقة"
          description="ابدأ بإضافة صفقة جديدة أو غيّر عوامل التصفية."
        />
      </div>
    );
  }

  return (
    <div className="card table-card">
      <table className="table">
        <thead>
          <tr>
            <th>كود الصفقة</th>
            <th>عنوان الصفقة</th>
            <th>جهة الاتصال</th>
            <th>المرحلة</th>
            {showBranch && <th>الفرع</th>}
            <th>القيمة المتوقعة</th>
            <th>الاحتمالية</th>
            <th>تاريخ الإغلاق</th>
            <th>المسؤول</th>
            <th>الحالة</th>
            <th>الإجراءات</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.id}>
              <td>
                <span className="branch-code">{deal.code}</span>
              </td>
              <td>
                <strong>{deal.title}</strong>
              </td>
              <td>
                <div>{deal.contact_name}</div>
                {deal.contact_phone && (
                  <small style={{ color: 'var(--slate-500)' }}>{deal.contact_phone}</small>
                )}
              </td>
              <td>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontWeight: 600,
                  }}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: deal.stage_color || 'var(--indigo-600)',
                    }}
                  />
                  {deal.stage_name}
                </span>
              </td>
              {showBranch && <td>{deal.branch_name || '—'}</td>}
              <td>
                <strong>{money(deal.expected_revenue)} ج.م</strong>
              </td>
              <td>{deal.probability}%</td>
              <td>{deal.expected_close_date ? formatDate(deal.expected_close_date) : '—'}</td>
              <td>{deal.assigned_to_name || 'عام'}</td>
              <td>
                <span
                  style={{
                    fontSize: '11.5px',
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: '4px',
                    background:
                      deal.status === 'WON'
                        ? '#dcfce7'
                        : deal.status === 'LOST'
                          ? '#fee2e2'
                          : '#eff6ff',
                    color:
                      deal.status === 'WON'
                        ? '#15803d'
                        : deal.status === 'LOST'
                          ? '#b91c1c'
                          : '#1e40af',
                  }}
                >
                  {deal.status === 'WON' ? 'رابحة' : deal.status === 'LOST' ? 'خاسرة' : 'مفتوحة'}
                </span>
              </td>
              <td>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  <Button variant="ghost" onClick={() => onOpen(deal)}>
                    عرض
                  </Button>
                  {canManage && (
                    <Button variant="ghost" onClick={() => onEdit(deal)} aria-label="تعديل">
                      <Pencil size={14} /> تعديل
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
