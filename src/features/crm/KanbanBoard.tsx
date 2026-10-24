import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { Calendar, ChevronRight, User } from 'lucide-react';
import { formatDate, money } from '../../lib';
import type { CrmDeal, CrmStage } from '../../types';
import { DealStatusBadge } from './ui';

export function KanbanBoard({
  stages,
  deals,
  canManage,
  movingId,
  onOpen,
  onMove,
}: {
  stages: CrmStage[];
  deals: CrmDeal[];
  canManage: boolean;
  movingId: string | null;
  onOpen: (deal: CrmDeal) => void;
  onMove: (deal: CrmDeal, stageId: string) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const drop = (event: DragEvent<HTMLDivElement>, stageId: string) => {
    event.preventDefault();
    setOverStage(null);
    const dealId = event.dataTransfer.getData('text/plain');
    const deal = deals.find((d) => d.id === dealId);
    if (deal && deal.stage_id !== stageId) onMove(deal, stageId);
  };

  const open = (deal: CrmDeal) => {
    if (draggingId === deal.id) return;
    onOpen(deal);
  };

  return (
    <div className="crm-board-container">
      <div className="crm-board">
        {stages.map((stage) => {
          const stageDeals = deals.filter((deal) => deal.stage_id === stage.id);
          const stageTotal = stageDeals.reduce(
            (sum, deal) => sum + (deal.expected_revenue || 0),
            0,
          );
          return (
            <div key={stage.id} className="crm-column">
              <div
                className="crm-column-header"
                style={{ borderTop: `4px solid ${stage.color || 'var(--indigo-600)'}` }}
              >
                <div className="crm-column-title-row">
                  <span className="crm-column-title">
                    <span
                      className="crm-column-dot"
                      style={{ background: stage.color || 'var(--indigo-600)' }}
                    />
                    {stage.name}
                  </span>
                  <span className="crm-column-badge">{stageDeals.length}</span>
                </div>
                <div className="crm-column-summary">
                  <span>احتمالية: {stage.probability}%</span>
                  <strong>{money(stageTotal)} ج.م</strong>
                </div>
              </div>

              <div
                className={'crm-column-cards' + (overStage === stage.id ? ' drag-over' : '')}
                onDragOver={(event) => {
                  if (!canManage) return;
                  event.preventDefault();
                  setOverStage(stage.id);
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  setOverStage((current) => (current === stage.id ? null : current));
                }}
                onDrop={(event) => drop(event, stage.id)}
              >
                {stageDeals.length === 0 ? (
                  <div className="crm-column-empty">لا توجد صفقات في هذه المرحلة</div>
                ) : (
                  stageDeals.map((deal) => (
                    <article
                      key={deal.id}
                      className={
                        'crm-deal-card' +
                        (draggingId === deal.id ? ' dragging' : '') +
                        (movingId === deal.id ? ' moving' : '')
                      }
                      draggable={canManage && movingId !== deal.id}
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/plain', deal.id);
                        event.dataTransfer.effectAllowed = 'move';
                        setDraggingId(deal.id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setOverStage(null);
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`فتح تفاصيل الصفقة ${deal.code} — ${deal.title}`}
                      onClick={() => open(deal)}
                      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          open(deal);
                        }
                      }}
                    >
                      <div className="crm-deal-header">
                        <div>
                          <span className="crm-deal-code">{deal.code}</span>
                          <div className="crm-deal-title">{deal.title}</div>
                        </div>
                        <DealStatusBadge status={deal.status} probability={deal.probability} />
                      </div>

                      <div className="crm-deal-amount">{money(deal.expected_revenue)} ج.م</div>

                      <div className="crm-deal-meta">
                        <span className="crm-deal-meta-item">
                          <User size={13} />
                          {deal.contact_name}
                        </span>
                        {deal.expected_close_date && (
                          <span className="crm-deal-meta-item">
                            <Calendar size={13} />
                            {formatDate(deal.expected_close_date, true)}
                          </span>
                        )}
                      </div>

                      <div className="crm-deal-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpen(deal);
                          }}
                        >
                          التفاصيل والتحويل <ChevronRight size={13} />
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
