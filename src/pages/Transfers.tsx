import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRightLeft, Package, Plus, Send, Sparkles } from 'lucide-react';
import {
  api,
  Button,
  count,
  Empty,
  ErrorState,
  Field,
  formatDate,
  Loading,
  Modal,
  PageHeader,
  Stat,
  today,
  useAction,
  useData,
} from '../lib';
import { useBranch, withBranch } from '../branch';
import type { Branch, Product, Transfer, TransferStatus, TransferSuggestion } from '../types';

const statusLabels: Record<TransferStatus, { label: string; cls: string }> = {
  DRAFT: { label: 'مسودة', cls: 'draft' },
  IN_TRANSIT: { label: 'في الطريق', cls: 'pending' },
  RECEIVED: { label: 'مستلم', cls: 'paid' },
  CANCELLED: { label: 'ملغى', cls: 'cancelled' },
};

type EditorState =
  | { mode: 'new'; prefill?: { from: string; to: string; product_id: string; quantity: number } }
  | { mode: 'edit'; transfer: Transfer };

export function Transfers() {
  const { activeId, branches, isGroup } = useBranch();
  const [status, setStatus] = useState<'ALL' | TransferStatus>('ALL'),
    [editor, setEditor] = useState<EditorState | null>(null),
    [viewing, setViewing] = useState<string | null>(null);
  const transfers = useData<Transfer[]>(
    withBranch('/transfers' + (status === 'ALL' ? '' : '?status=' + status), activeId),
  );
  const suggestions = useData<TransferSuggestion[]>(withBranch('/transfers/suggestions', activeId));
  const rows = transfers.data ?? [];
  const inTransit = rows.filter((t) => t.status === 'IN_TRANSIT');
  const pieces = (t: Transfer) => (t.lines ?? []).reduce((s, l) => s + l.quantity_sent, 0);
  return (
    <>
      <PageHeader
        eyebrow="الحركة بين الفروع"
        title="التحويلات بين الفروع"
        description="انقل المخزون بين فروعك بتتبّع كامل: مسودة، ثم شحن يضعه في الطريق، ثم استلام يسجل ما وصل فعلاً."
        actions={
          <Button onClick={() => setEditor({ mode: 'new' })} disabled={branches.length < 2}>
            <Plus size={18} /> تحويل جديد
          </Button>
        }
      />
      <div className="stats-grid three">
        <Stat
          label="تحويلات في الطريق"
          value={count(inTransit.length)}
          unit="تحويل"
          icon={<Send size={20} />}
          tone="amber"
          foot="بانتظار الاستلام في الفرع المستلم"
        />
        <Stat
          label="اقتراحات إعادة التوزيع"
          value={count(suggestions.data?.length ?? 0)}
          unit="اقتراح"
          icon={<Sparkles size={20} />}
          tone="blue"
          foot="تعبئة النواقص من فائض الفروع الأخرى"
        />
        <Stat
          label="الوحدات في الطريق"
          value={count(inTransit.reduce((s, t) => s + pieces(t), 0))}
          unit="وحدة"
          icon={<ArrowRightLeft size={20} />}
          foot="الكمية المشحونة ولم تُستلم بعد"
        />
      </div>
      {!!suggestions.data?.length && (
        <section className="card suggestion-card">
          <div className="card-heading">
            <div>
              <h2>
                <Sparkles size={18} /> اقتراحات إعادة التوزيع
              </h2>
              <p>
                الفروع التي وصلت لحد إعادة الطلب تُكمَّل من فائض الفروع الأخرى. كل اقتراح تحويل جاهز
                بضغطة.
              </p>
            </div>
          </div>
          <div className="suggestion-list">
            {suggestions.data.slice(0, 8).map((s) => (
              <div
                key={s.product_id + s.from_branch_id + s.to_branch_id}
                className="suggestion-row"
              >
                <div>
                  <strong>{s.name}</strong>
                  <small className="cell-sub">
                    {s.from_branch_name} <ArrowLeft size={12} /> {s.to_branch_name}
                  </small>
                </div>
                <span className="num amount">
                  {count(s.quantity)} <small>وحدة</small>
                </span>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setEditor({
                      mode: 'new',
                      prefill: {
                        from: s.from_branch_id,
                        to: s.to_branch_id,
                        product_id: s.product_id,
                        quantity: s.quantity,
                      },
                    })
                  }
                >
                  إنشاء تحويل
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="card">
        <div className="table-toolbar">
          <h2>سجل التحويلات {isGroup ? '' : '· الفرع الحالي'}</h2>
          <div className="tabs">
            {(
              [
                ['ALL', 'الكل'],
                ['DRAFT', 'مسودات'],
                ['IN_TRANSIT', 'في الطريق'],
                ['RECEIVED', 'مستلمة'],
                ['CANCELLED', 'ملغاة'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={status === value ? 'active' : ''}
                onClick={() => setStatus(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {transfers.error ? (
          <ErrorState message={transfers.error} retry={transfers.reload} />
        ) : transfers.loading && !transfers.data ? (
          <Loading />
        ) : !rows.length ? (
          <Empty
            title="لا توجد تحويلات"
            description={
              branches.length < 2
                ? 'تحتاج إلى فرعين على الأقل لإنشاء تحويل بينهما.'
                : 'أنشئ تحويلاً من مخزون فرعك إلى فرع آخر، أو اتبع الاقتراحات أعلاه.'
            }
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>من ← إلى</th>
                  <th>التاريخ</th>
                  <th>الكمية</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="clickable-row" onClick={() => setViewing(t.id)}>
                    <td>
                      <strong className="num">{t.number}</strong>
                    </td>
                    <td>
                      {t.from_branch_name} <ArrowLeft size={12} /> {t.to_branch_name}
                    </td>
                    <td className="muted">{formatDate(t.date, true)}</td>
                    <td className="num">{count(pieces(t))}</td>
                    <td>
                      <span className={'badge ' + statusLabels[t.status].cls}>
                        <i /> {statusLabels[t.status].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editor && (
        <TransferEditor
          state={editor}
          onClose={() => setEditor(null)}
          onSaved={(t) => {
            setEditor(null);
            transfers.reload();
            suggestions.reload();
            setViewing(t.id);
          }}
        />
      )}
      {viewing && (
        <TransferDetail
          id={viewing}
          onEdit={(t) => {
            setViewing(null);
            setEditor({ mode: 'edit', transfer: t });
          }}
          onClose={() => setViewing(null)}
          onChanged={() => {
            transfers.reload();
            suggestions.reload();
          }}
        />
      )}
    </>
  );
}

type EditorLine = { key: string; product_id: string; quantity: string };

function TransferEditor({
  state,
  onClose,
  onSaved,
}: {
  state: EditorState;
  onClose: () => void;
  onSaved: (t: Transfer) => void;
}) {
  const { branches } = useBranch();
  const existing = state.mode === 'edit' ? state.transfer : undefined;
  const prefill = state.mode === 'new' ? state.prefill : undefined;
  const [fromId, setFromId] = useState(
      existing?.from_branch_id ?? prefill?.from ?? branches[0]?.id ?? '',
    ),
    [toId, setToId] = useState(
      existing?.to_branch_id ??
        prefill?.to ??
        branches.find(
          (b) => b.id !== (existing?.from_branch_id ?? prefill?.from ?? branches[0]?.id),
        )?.id ??
        '',
    );
  const [lines, setLines] = useState<EditorLine[]>(
    existing?.lines?.map((l) => ({
      key: l.id,
      product_id: l.product_id,
      quantity: String(l.quantity_sent),
    })) ??
      (prefill
        ? [
            {
              key: crypto.randomUUID(),
              product_id: prefill.product_id,
              quantity: String(prefill.quantity),
            },
          ]
        : [{ key: crypto.randomUUID(), product_id: '', quantity: '1' }]),
  );
  const products = useData<Product[]>(withBranch('/products', fromId));
  const { busy, act } = useAction();
  const from = branches.find((b) => b.id === fromId);
  const to = branches.find((b) => b.id === toId);
  const changeLine = (key: string, patch: Partial<EditorLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ship = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'ship';
    void act(async () => {
      const body = {
        from_branch_id: fromId,
        to_branch_id: toId,
        date: f.get('date'),
        notes: f.get('notes'),
        lines: lines.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity) })),
      };
      const saved = existing
        ? await api<Transfer>(`/transfers/${existing.id}`, 'PUT', body)
        : await api<Transfer>('/transfers', 'POST', body);
      if (ship) {
        try {
          const shipped = await api<Transfer>(`/transfers/${saved.id}/ship`, 'POST', {});
          onSaved(shipped);
          return;
        } catch (error) {
          onSaved(saved);
          throw new Error(
            'تم حفظ المسودة لكن تعذر شحنها: ' + (error instanceof Error ? error.message : ''),
          );
        }
      }
      onSaved(saved);
    }, 'تم حفظ التحويل');
  };
  if (branches.length < 2)
    return (
      <Modal title="التحويلات بين الفروع" onClose={onClose}>
        <Empty
          title="تحتاج إلى فرعين على الأقل"
          description="اطلب من مدير النظام إضافة فرع آخر أو ربطك بفرع إضافي."
        />
      </Modal>
    );
  const ready = !products.loading && !products.error;
  return (
    <Modal
      size="xl"
      showMaximize
      title={existing ? 'تعديل التحويل ' + existing.number : 'تحويل مخزون بين فرعين'}
      description="يخرج المخزون من الفرع المرسِل عند الشحن، ويدخل الفرع المستلم بعد الاستلام."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <div className="form-row">
            <Field label="من الفرع (المرسِل) *">
              <select
                required
                value={fromId}
                onChange={(e) => {
                  setFromId(e.target.value);
                  setLines([{ key: crypto.randomUUID(), product_id: '', quantity: '1' }]);
                  if (toId === e.target.value)
                    setToId(branches.find((b) => b.id !== e.target.value)?.id ?? '');
                }}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="إلى الفرع (المستلم) *">
              <select required value={toId} onChange={(e) => setToId(e.target.value)}>
                {branches
                  .filter((b) => b.id !== fromId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <div className="form-row">
            <Field label="تاريخ التحويل *">
              <input type="date" name="date" required defaultValue={existing?.date || today()} />
            </Field>
            <Field label="ملاحظات">
              <input name="notes" maxLength={1000} defaultValue={existing?.notes ?? ''} />
            </Field>
          </div>
          <section className="transfer-lines">
            <div className="transfer-lines-head">
              <span>
                <Package size={16} /> المنتجات
              </span>
              <Button
                variant="secondary"
                type="button"
                onClick={() =>
                  setLines((ls) => [
                    ...ls,
                    { key: crypto.randomUUID(), product_id: '', quantity: '1' },
                  ])
                }
              >
                <Plus size={15} /> منتج
              </Button>
            </div>
            {!ready && <Loading />}
            {ready &&
              lines.map((line) => {
                const product = products.data?.find((p) => p.id === line.product_id);
                return (
                  <div className="transfer-line" key={line.key}>
                    <select
                      aria-label="المنتج"
                      required
                      value={line.product_id}
                      onChange={(e) => changeLine(line.key, { product_id: e.target.value })}
                    >
                      <option value="" disabled>
                        اختر منتجاً من {from?.name ?? 'الفرع المرسِل'}
                      </option>
                      {(products.data ?? [])
                        .filter((p) => p.active && p.available && p.stock > 0)
                        .map((p) => (
                          <option
                            key={p.id}
                            value={p.id}
                            disabled={lines.some(
                              (l) => l.product_id === p.id && l.key !== line.key,
                            )}
                          >
                            {p.name} — متاح {p.stock}
                          </option>
                        ))}
                    </select>
                    <input
                      aria-label="الكمية"
                      type="number"
                      min={1}
                      max={product?.stock ?? 1000000}
                      required
                      value={line.quantity}
                      onChange={(e) => changeLine(line.key, { quantity: e.target.value })}
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="حذف البند"
                      disabled={lines.length === 1}
                      onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            {ready &&
              !(products.data ?? []).some((p) => p.active && p.available && p.stock > 0) && (
                <p className="muted">لا يوجد مخزون متاح للتحويل في {from?.name}.</p>
              )}
          </section>
          <p className="muted">{to ? `${to.name} يجب أن يكون متاحاً له كل منتج تحوّله.` : ''}</p>
        </div>
        <div className="modal-footer">
          <Button type="submit" value="draft" variant="secondary" busy={busy} disabled={!ready}>
            حفظ كمسودة
          </Button>
          <Button type="submit" value="ship" busy={busy} disabled={!ready}>
            <Send size={16} /> حفظ وشحن
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TransferDetail({
  id,
  onEdit,
  onClose,
  onChanged,
}: {
  id: string;
  onEdit: (t: Transfer) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const transfer = useData<Transfer>('/transfers/' + id);
  const { branches } = useBranch();
  const [received, setReceived] = useState<Record<string, string>>({});
  const { busy, act } = useAction();
  if (transfer.error)
    return (
      <Modal title="التحويل" onClose={onClose}>
        <ErrorState message={transfer.error} retry={transfer.reload} />
      </Modal>
    );
  if (!transfer.data)
    return (
      <Modal title="التحويل" onClose={onClose}>
        <Loading />
      </Modal>
    );
  const t = transfer.data;
  const lines = t.lines ?? [];
  const canFrom = branches.some((b: Branch) => b.id === t.from_branch_id);
  const canTo = branches.some((b: Branch) => b.id === t.to_branch_id);
  const after = (step: { action: 'ship' | 'receive' | 'cancel'; toast: string; body?: unknown }) =>
    void act(async () => {
      await api(`/transfers/${t.id}/${step.action}`, 'POST', step.body ?? {});
      onChanged();
      transfer.reload();
    }, step.toast);
  const value = lines.reduce((s, l) => s + l.quantity_sent * l.unit_cost, 0);
  const shortage = lines.reduce(
    (s, l) => s + Math.max(0, l.quantity_sent - (l.quantity_received ?? 0)),
    0,
  );
  return (
    <Modal
      size="xl"
      showMaximize
      title={`${t.number} · ${statusLabels[t.status].label}`}
      description={`${t.from_branch_name} ← ${t.to_branch_name} · ${formatDate(t.date)}`}
      onClose={onClose}
    >
      <div className="modal-body">
        {t.notes && <p className="muted">{t.notes}</p>}
        <div className="transfer-timeline">
          <span>
            <b>أُنشئ</b> {formatDate(t.created_at.slice(0, 10), true)}
          </span>
          {t.shipped_at && (
            <span>
              <b>شُحن</b> {formatDate(t.shipped_at.slice(0, 10), true)}
            </span>
          )}
          {t.received_at && (
            <span>
              <b>استُلم</b> {formatDate(t.received_at.slice(0, 10), true)}
            </span>
          )}
          {t.cancelled_at && (
            <span>
              <b>أُلغي</b> {formatDate(t.cancelled_at.slice(0, 10), true)}
            </span>
          )}
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>المنتج</th>
                <th>المرسل</th>
                <th>المستلم</th>
                <th>التكلفة</th>
                <th>القيمة</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    <strong>{l.name}</strong>
                    <small className="cell-sub">{l.sku}</small>
                  </td>
                  <td className="num">{l.quantity_sent}</td>
                  <td className="num">
                    {t.status === 'IN_TRANSIT' && canTo ? (
                      <input
                        className="inline-number"
                        aria-label={`المستلم: ${l.name}`}
                        type="number"
                        min={0}
                        max={l.quantity_sent}
                        value={received[l.product_id] ?? String(l.quantity_sent)}
                        onChange={(e) =>
                          setReceived((r) => ({ ...r, [l.product_id]: e.target.value }))
                        }
                      />
                    ) : (
                      (l.quantity_received ?? '—')
                    )}
                  </td>
                  <td className="num">
                    {l.unit_cost ? (l.unit_cost / 100).toFixed(2) : '—'} <small>ج.م</small>
                  </td>
                  <td className="num amount">
                    {((l.quantity_sent * l.unit_cost) / 100).toFixed(2)} <small>ج.م</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="transfer-summary">
          <span>
            قيمة البضاعة: <b className="num">{money2(value)}</b> ج.م
          </span>
          {t.status === 'RECEIVED' && shortage > 0 && (
            <span className="negative">
              عجز مسجّل: <b className="num">{count(shortage)}</b> وحدة
            </span>
          )}
        </div>
        {t.status === 'IN_TRANSIT' && (
          <p className="muted">
            عند الاستلام، أدخل الكمية التي وصلت فعلاً. الفرق يُسجَّل كعجز على التحويل ولا يُضاف إلى
            المخزون.
          </p>
        )}
      </div>
      <div className="modal-footer">
        {t.status === 'DRAFT' && canFrom && (
          <>
            <Button
              busy={busy}
              onClick={() =>
                after({ action: 'ship', toast: 'تم شحن التحويل، وصارت البضاعة في الطريق' })
              }
            >
              <Send size={16} /> شحن الآن
            </Button>
            <Button variant="secondary" onClick={() => onEdit(t)} disabled={busy}>
              تعديل
            </Button>
            <Button
              variant="danger"
              busy={busy}
              onClick={() => after({ action: 'cancel', toast: 'تم إلغاء المسودة' })}
            >
              إلغاء التحويل
            </Button>
          </>
        )}
        {t.status === 'IN_TRANSIT' && canTo && (
          <Button
            busy={busy}
            onClick={() =>
              after({
                action: 'receive',
                toast: 'تم الاستلام وأُضيف المخزون إلى الفرع',
                body: {
                  lines: lines.map((l) => ({
                    product_id: l.product_id,
                    quantity_received: Number(received[l.product_id] ?? l.quantity_sent),
                  })),
                },
              })
            }
          >
            تأكيد الاستلام
          </Button>
        )}
        {t.status === 'IN_TRANSIT' && canFrom && (
          <Button
            variant="danger"
            busy={busy}
            onClick={() =>
              after({ action: 'cancel', toast: 'أُلغي التحويل وعادت البضاعة إلى الفرع المرسِل' })
            }
          >
            إلغاء وإرجاع البضاعة
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          إغلاق
        </Button>
      </div>
    </Modal>
  );
}

function money2(piastres: number) {
  return (piastres / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
