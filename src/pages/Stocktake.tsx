import { useEffect, useState, type FormEvent } from 'react';
import { ClipboardList, Plus, CheckCircle2, XCircle, Save, Send } from 'lucide-react';
import {
  api,
  useData,
  useAction,
  useSession,
  PageHeader,
  Button,
  Field,
  Modal,
  Loading,
  ErrorState,
  Empty,
  money,
  formatDate,
} from '../lib';
import { useBranch, withBranch } from '../branch';
import { can } from '../auth';
import type { StocktakeSession, StocktakeLine, StocktakeStatus } from '../types';

const STATUS_LABELS: Record<StocktakeStatus, string> = {
  DRAFT: 'قيد العد',
  SUBMITTED: 'بانتظار الاعتماد',
  APPROVED: 'معتمد',
  CANCELLED: 'ملغى',
};

function statusTone(status: StocktakeStatus): string {
  if (status === 'APPROVED') return 'paid';
  if (status === 'SUBMITTED') return 'pending';
  if (status === 'CANCELLED') return 'cancelled';
  return 'draft';
}

/**
 * Periodic stocktake (جرد دوري).
 *
 * Lists count sessions, lets a warehouse user open a session, record counted
 * quantities per line, then submits it for approval. Approval (a separate permission)
 * posts the variances into stock; before that nothing changes.
 */
export function StocktakePage() {
  const { user } = useSession();
  const { activeId, defaultBranchId, branches } = useBranch();
  const sessions = useData<StocktakeSession[]>(withBranch('/stocktakes', activeId));
  const [creating, setCreating] = useState(false);
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [open, setOpen] = useState<StocktakeSession | null>(null);
  const { busy, act } = useAction();

  const canApprove = can(user, 'inventory:stocktake_approve');

  const create = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void act(async () => {
      await api('/stocktakes', 'POST', { branch_id: branchId, notes: f.get('notes') });
      setCreating(false);
      sessions.reload();
    }, 'تم بدء جلسة جرد جديدة');
  };

  return (
    <>
      <PageHeader
        eyebrow="كل قطعة محسوبة"
        title="الجرد الدوري"
        description="اجرد مخزون الفرع فعلياً، واعتمد الفروقات لترحيلها إلى النظام بأثر رجعي موثّق."
        actions={
          can(user, 'inventory:adjust') ? (
            <Button
              onClick={() => {
                setBranchId(defaultBranchId);
                setCreating(true);
              }}
            >
              <Plus size={16} /> جرد جديد
            </Button>
          ) : undefined
        }
      />

      <section className="card">
        {sessions.loading ? (
          <Loading />
        ) : sessions.error ? (
          <ErrorState message={sessions.error} retry={sessions.reload} />
        ) : !sessions.data?.length ? (
          <Empty
            title="لا توجد جلسات جرد"
            description="ابدأ جلسة جرد جديدة لعدّ مخزون الفرع واعتماد الفروقات."
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>الفرع</th>
                  <th>الحالة</th>
                  <th>فروقات</th>
                  <th>قيمة الفرق</th>
                  <th>المسؤول</th>
                  <th>التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {sessions.data.map((s) => (
                  <tr
                    key={s.id}
                    className="clickable"
                    onClick={() => setOpen(s)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="num" dir="ltr">
                      {s.number}
                    </td>
                    <td>{s.branch_name}</td>
                    <td>
                      <span className={'badge ' + statusTone(s.status)}>
                        <i />
                        {STATUS_LABELS[s.status]}
                      </span>
                    </td>
                    <td className="num">{s.variance_lines}</td>
                    <td className="num amount">{money(s.variance_value ?? 0)} ج.م</td>
                    <td>{s.counted_by_name}</td>
                    <td className="muted">{formatDate(s.created_at, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creating && (
        <Modal title="بدء جلسة جرد دوري" onClose={() => setCreating(false)}>
          <form onSubmit={create}>
            <div className="modal-body form-grid">
              <Field label="الفرع الذي يُجرد *">
                <select required value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="ملاحظات الجرد">
                <textarea name="notes" maxLength={500} placeholder="مثال: جرد نهاية الربع الأول" />
              </Field>
              <p className="table-bottom-note">
                يتم تثبيت الكميات الحالية كمرجع عند بدء الجلسة، ولا يتغير المخزون إلا بعد اعتماد
                الفروقات.
              </p>
            </div>
            <div className="modal-footer">
              <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                إلغاء
              </Button>
              <Button type="submit" busy={busy}>
                <ClipboardList size={16} /> بدء الجرد
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {open && (
        <StocktakeDetailModal
          session={open}
          canApprove={canApprove}
          canCount={can(user, 'inventory:adjust')}
          onClose={() => {
            setOpen(null);
            sessions.reload();
          }}
        />
      )}
    </>
  );
}

function StocktakeDetailModal({
  session,
  canApprove,
  canCount,
  onClose,
}: {
  session: StocktakeSession;
  canApprove: boolean;
  canCount: boolean;
  onClose: () => void;
}) {
  const detail = useData<{ session: StocktakeSession; lines: StocktakeLine[] }>(
    `/stocktakes/${session.id}`,
  );
  const [counts, setCounts] = useState<Record<string, string>>({});
  const { busy, act } = useAction();

  useEffect(() => {
    if (!detail.data) return;
    const initial: Record<string, string> = {};
    for (const line of detail.data.lines) {
      initial[line.id] = line.counted_qty === null ? '' : String(line.counted_qty);
    }
    setCounts(initial);
  }, [detail.data]);

  const current = detail.data?.session ?? session;
  const editable = current.status === 'DRAFT' && canCount;

  const save = () =>
    void act(async () => {
      const countsPayload = Object.entries(counts).map(([line_id, value]) => ({
        line_id,
        counted_qty: value === '' ? null : Number(value),
      }));
      await api(`/stocktakes/${session.id}/counts`, 'PUT', { counts: countsPayload });
      detail.reload();
    }, 'تم حفظ الكميات');

  const submit = () =>
    void act(async () => {
      await api(`/stocktakes/${session.id}/submit`, 'POST', {});
      detail.reload();
    }, 'تم تسليم الجرد للمراجعة');

  const approve = () =>
    void act(async () => {
      await api(`/stocktakes/${session.id}/approve`, 'POST', {});
      detail.reload();
    }, 'تم اعتماد الجرد وترحيل الفروقات');

  const cancel = () =>
    void act(async () => {
      await api(`/stocktakes/${session.id}/cancel`, 'POST', {});
      detail.reload();
    }, 'تم إلغاء الجرد');

  const varianceOf = (line: StocktakeLine): number | null => {
    const value = counts[line.id];
    if (value === '' || value === undefined) return null;
    return Number(value) - line.expected_qty;
  };

  return (
    <Modal
      title={`جرد دوري ${current.number}`}
      description={`${current.branch_name} · ${STATUS_LABELS[current.status]}`}
      onClose={onClose}
    >
      <div className="modal-body">
        {detail.loading ? (
          <Loading />
        ) : detail.error ? (
          <ErrorState message={detail.error} retry={detail.reload} />
        ) : (
          <>
            <div className="table-scroll stocktake-lines">
              <table>
                <thead>
                  <tr>
                    <th>المنتج</th>
                    <th>الرصيد الدفتري</th>
                    <th>الكمية المعدودة</th>
                    <th>الفرق</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data?.lines.map((line) => {
                    const variance = varianceOf(line);
                    return (
                      <tr key={line.id}>
                        <td>
                          <strong>{line.product_name}</strong>
                          <small className="cell-sub num">{line.sku}</small>
                        </td>
                        <td className="num">{line.expected_qty}</td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            max="1000000"
                            dir="ltr"
                            className="stocktake-input"
                            value={counts[line.id] ?? ''}
                            disabled={!editable}
                            onChange={(e) =>
                              setCounts((prev) => ({ ...prev, [line.id]: e.target.value }))
                            }
                          />
                        </td>
                        <td>
                          {variance === null || variance === 0 ? (
                            <span className="muted">—</span>
                          ) : (
                            <span
                              className={
                                'movement-amount ' + (variance > 0 ? 'positive' : 'negative')
                              }
                              dir="ltr"
                            >
                              {variance > 0 ? '+' : ''}
                              {variance}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {current.notes && <p className="table-bottom-note">{current.notes}</p>}
            {current.status === 'APPROVED' && (
              <p className="table-bottom-note">
                اعتمده {current.approved_by_name || '—'} في{' '}
                {formatDate(current.approved_at || '', true)}.
              </p>
            )}
          </>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="secondary" onClick={onClose}>
          إغلاق
        </Button>
        {editable && (
          <>
            <Button variant="secondary" busy={busy} onClick={save}>
              <Save size={16} /> حفظ الكميات
            </Button>
            <Button busy={busy} onClick={submit}>
              <Send size={16} /> تسليم للمراجعة
            </Button>
          </>
        )}
        {current.status === 'SUBMITTED' && canApprove && (
          <Button busy={busy} onClick={approve}>
            <CheckCircle2 size={16} /> اعتماد وترحيل الفروقات
          </Button>
        )}
        {(current.status === 'DRAFT' || current.status === 'SUBMITTED') && canCount && (
          <Button variant="danger" busy={busy} onClick={cancel}>
            <XCircle size={16} /> إلغاء
          </Button>
        )}
      </div>
    </Modal>
  );
}
