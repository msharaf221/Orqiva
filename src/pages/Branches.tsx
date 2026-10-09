import { useState, type FormEvent } from 'react';
import { Boxes, Building2, Plus, Store } from 'lucide-react';
import {
  api,
  Button,
  count,
  ErrorState,
  Field,
  formatDate,
  Loading,
  Modal,
  money,
  PageHeader,
  Stat,
  toCents,
  today,
  useAction,
  useData,
} from '../lib';
import type { Branch, BranchKind, BranchProduct, StockMatrix } from '../types';

export const kindLabels: Record<BranchKind, string> = {
  HQ: 'المركز الرئيسي',
  STORE: 'فرع بيع',
  WAREHOUSE: 'مخزن',
  ONLINE: 'قناة إلكترونية',
};

type StaffRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: number;
  assigned: number;
};

export function Branches() {
  const list = useData<Branch[]>('/branches?include_archived=1');
  const [adding, setAdding] = useState(false),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const branches = list.data ?? [];
  const open = branches.filter((b) => b.active);
  const selected = branches.find((b) => b.id === selectedId) ?? null;
  return (
    <>
      <PageHeader
        eyebrow="المجموعة والفروع"
        title="الفروع"
        description="كل فرع له مخزونه وقائمة منتجاته وأسعاره وموظفوه، وكل الفروع تحت مالك واحد."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus size={18} /> فرع جديد
          </Button>
        }
      />
      <div className="stats-grid three">
        <Stat
          label="الفروع النشطة"
          value={count(open.length)}
          unit="فرع"
          icon={<Store size={20} />}
          foot={`${branches.length - open.length} فرع مؤرشف`}
        />
        <Stat
          label="قيمة المخزون في كل الفروع"
          value={money(branches.reduce((s, b) => s + (b.stock_value ?? 0), 0))}
          icon={<Boxes size={20} />}
          tone="blue"
          foot="بسعر التكلفة المرجعي"
        />
        <Stat
          label="إجمالي الوحدات"
          value={count(branches.reduce((s, b) => s + (b.stock_units ?? 0), 0))}
          unit="وحدة"
          icon={<Building2 size={20} />}
          tone="amber"
          foot="موزعة على الفروع"
        />
      </div>
      {list.error ? (
        <ErrorState message={list.error} retry={list.reload} />
      ) : list.loading && !list.data ? (
        <Loading />
      ) : (
        <div className="branch-grid">
          {branches.map((b) => (
            <article key={b.id} className={'card branch-card' + (b.active ? '' : ' archived')}>
              <div className="branch-card-head">
                <span className="branch-code num">{b.code}</span>
                <span className={'badge ' + (b.active ? 'paid' : 'cancelled')}>
                  <i /> {b.active ? 'نشط' : 'مؤرشف'}
                </span>
              </div>
              <h3>{b.name}</h3>
              <p className="muted">
                {kindLabels[b.kind]} · بدأ التشغيل {formatDate(b.opened_on)}
                {b.closed_on ? ` · أُغلق ${formatDate(b.closed_on, true)}` : ''}
              </p>
              <div className="branch-card-stats">
                <span>
                  <b className="num">{count(b.stock_units ?? 0)}</b> وحدة
                </span>
                <span>
                  <b className="num">{money(b.stock_value ?? 0)}</b> ج.م مخزون
                </span>
                <span>
                  <b className="num">{b.users?.length ?? 0}</b> موظف
                </span>
              </div>
              <Button variant="secondary" onClick={() => setSelectedId(b.id)}>
                إدارة الفرع
              </Button>
            </article>
          ))}
        </div>
      )}
      {selected && (
        <BranchWorkspace
          key={selected.id}
          branchId={selected.id}
          onChanged={list.reload}
          onClose={() => setSelectedId(null)}
        />
      )}
      <StockMatrixCard />
      {adding && (
        <BranchForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            list.reload();
          }}
        />
      )}
    </>
  );
}

function BranchForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { busy, act } = useAction();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void act(async () => {
      await api('/branches', 'POST', {
        code: String(f.get('code')).trim().toUpperCase(),
        name: f.get('name'),
        kind: f.get('kind'),
        phone: f.get('phone'),
        address: f.get('address'),
        opened_on: f.get('opened_on'),
      });
      onSaved();
    }, 'تمت إضافة الفرع. يرث قائمة المنتجات الحالية، ويمكنك تعديلها من صفحة الفرع.');
  };
  return (
    <Modal
      title="فرع جديد"
      description="الفرع يبدأ بكل المنتجات النشطة، وتحدد منها ما يبيعه."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <Field label="كود الفرع *" hint="حروف إنجليزية أو أرقام، من ٢ إلى ٨ خانات. مثال: NSR">
            <input
              name="code"
              required
              minLength={2}
              maxLength={8}
              pattern="[A-Za-z0-9]{2,8}"
              dir="ltr"
              placeholder="NSR"
            />
          </Field>
          <Field label="اسم الفرع *">
            <input name="name" required maxLength={100} placeholder="مثال: فرع مدينة نصر" />
          </Field>
          <Field label="نوع الفرع">
            <select name="kind" defaultValue="STORE">
              <option value="STORE">فرع بيع</option>
              <option value="WAREHOUSE">مخزن</option>
              <option value="ONLINE">قناة إلكترونية</option>
            </select>
          </Field>
          <Field
            label="تاريخ بدء التشغيل *"
            hint="المصروفات المشتركة لا تُحمّل على الفرع قبل هذا التاريخ."
          >
            <input type="date" name="opened_on" required defaultValue={today()} />
          </Field>
          <Field label="الهاتف">
            <input name="phone" dir="ltr" maxLength={40} />
          </Field>
          <Field label="العنوان">
            <input name="address" maxLength={300} />
          </Field>
        </div>
        <div className="modal-footer">
          <Button busy={busy} type="submit">
            إضافة الفرع
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function BranchWorkspace({
  branchId,
  onChanged,
  onClose,
}: {
  branchId: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const branch = useData<Branch>('/branches/' + branchId);
  const [tab, setTab] = useState<'products' | 'staff' | 'settings'>('products');
  if (branch.error) return <ErrorState message={branch.error} retry={branch.reload} />;
  if (!branch.data) return <Loading />;
  const b = branch.data;
  return (
    <section className="card branch-workspace">
      <div className="card-heading">
        <div>
          <h2>
            {b.name} <span className="branch-code num">{b.code}</span>
          </h2>
          <p>
            {kindLabels[b.kind]} · {b.active ? 'نشط' : 'مؤرشف'}
          </p>
        </div>
        <Button variant="secondary" onClick={onClose}>
          إغلاق
        </Button>
      </div>
      <div className="tabs branch-tabs">
        <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>
          المنتجات والأسعار
        </button>
        <button className={tab === 'staff' ? 'active' : ''} onClick={() => setTab('staff')}>
          الموظفون
        </button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
          الإعدادات والأرشفة
        </button>
      </div>
      {tab === 'products' && <AssortmentTab branchId={branchId} branchActive={!!b.active} />}
      {tab === 'staff' && <StaffTab branchId={branchId} onChanged={onChanged} />}
      {tab === 'settings' && (
        <SettingsTab
          branch={b}
          onChanged={() => {
            branch.reload();
            onChanged();
          }}
        />
      )}
    </section>
  );
}

type Draft = { listed: boolean; price: string; min: string };

function AssortmentTab({ branchId, branchActive }: { branchId: string; branchActive: boolean }) {
  const rows = useData<BranchProduct[]>(`/branches/${branchId}/assortment`);
  const [draft, setDraft] = useState<Record<string, Draft>>({}),
    [query, setQuery] = useState('');
  const { busy, act } = useAction();
  const current = (r: BranchProduct): Draft =>
    draft[r.product_id] ?? {
      listed: !!r.active,
      price: r.sale_price != null ? String(r.sale_price / 100) : '',
      min: r.min_stock != null ? String(r.min_stock) : '',
    };
  const change = (r: BranchProduct, patch: Partial<Draft>) =>
    setDraft((d) => ({ ...d, [r.product_id]: { ...current(r), ...patch } }));
  const dirtyIds = Object.keys(draft);
  const save = () =>
    void act(async () => {
      for (const productId of dirtyIds) {
        const c = draft[productId];
        await api(`/branches/${branchId}/products/${productId}`, 'PUT', {
          active: c.listed,
          sale_price: c.price.trim() === '' ? null : toCents(c.price),
          min_stock: c.min.trim() === '' ? null : Number(c.min),
        });
      }
      setDraft({});
      rows.reload();
    }, 'تم حفظ قائمة المنتجات وأسعار الفرع');
  if (rows.error) return <ErrorState message={rows.error} retry={rows.reload} />;
  if (!rows.data) return <Loading />;
  const visible = rows.data.filter(
    (r) => !query || (r.name + ' ' + r.sku).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="branch-assortment">
      <div className="table-toolbar">
        <p className="muted">
          المنتجات غير المفعّلة هنا لا تُباع ولا تُشترى في هذا الفرع. السعر وحد إعادة الطلب الفارغان
          يأخذان القيم العامة للمنتج.
        </p>
        <div className="table-filters">
          <input
            className="filter-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث في المنتجات..."
            aria-label="بحث في المنتجات"
          />
          <Button onClick={save} busy={busy} disabled={!dirtyIds.length || !branchActive}>
            حفظ التعديلات {dirtyIds.length ? `(${dirtyIds.length})` : ''}
          </Button>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>المنتج</th>
              <th>المخزون هنا</th>
              <th>متاح في الفرع</th>
              <th>سعر الفرع (ج.م)</th>
              <th>حد إعادة الطلب</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const c = current(r);
              const locked = !branchActive || !r.product_active;
              return (
                <tr key={r.product_id} className={r.product_active ? '' : 'muted'}>
                  <td>
                    <strong>{r.name}</strong>
                    <small className="cell-sub">
                      {r.sku}
                      {r.product_active ? '' : ' · مؤرشف'}
                    </small>
                  </td>
                  <td className="num">
                    {r.stock} <small>{r.unit}</small>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`متاح في الفرع: ${r.name}`}
                      checked={c.listed}
                      disabled={locked}
                      onChange={(e) => change(r, { listed: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      className="inline-number"
                      aria-label={`سعر الفرع: ${r.name}`}
                      type="number"
                      min="0"
                      step="0.01"
                      dir="ltr"
                      disabled={locked || !c.listed}
                      placeholder={String(r.base_sale_price / 100)}
                      value={c.price}
                      onChange={(e) => change(r, { price: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="inline-number"
                      aria-label={`حد إعادة الطلب: ${r.name}`}
                      type="number"
                      min="0"
                      dir="ltr"
                      disabled={locked || !c.listed}
                      placeholder={String(r.base_min_stock)}
                      value={c.min}
                      onChange={(e) => change(r, { min: e.target.value })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StaffTab({ branchId, onChanged }: { branchId: string; onChanged: () => void }) {
  const staff = useData<StaffRow[]>(`/branches/${branchId}/staff`);
  const [selected, setSelected] = useState<string[] | null>(null);
  const { busy, act } = useAction();
  if (staff.error) return <ErrorState message={staff.error} retry={staff.reload} />;
  if (!staff.data) return <Loading />;
  const assigned = selected ?? staff.data.filter((s) => s.assigned).map((s) => s.id);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const base = prev ?? assigned;
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    });
  const save = () =>
    void act(async () => {
      await api(`/branches/${branchId}/staff`, 'PUT', { user_ids: assigned });
      setSelected(null);
      staff.reload();
      onChanged();
    }, 'تم تحديث صلاحيات الفرع');
  return (
    <div className="branch-staff">
      <p className="muted">
        الموظف يرى ويعمل في الفروع المرتبطة به فقط. المدير يرى كل الفروع دائماً.
      </p>
      <div className="staff-grid">
        {staff.data.map((s) => (
          <label key={s.id} className={'staff-pick' + (s.active ? '' : ' archived')}>
            <input
              type="checkbox"
              checked={assigned.includes(s.id)}
              disabled={s.role === 'ADMIN'}
              onChange={() => toggle(s.id)}
            />
            <span>
              <strong>{s.name}</strong>
              <small>
                {s.role === 'ADMIN' ? 'مدير النظام · كل الفروع' : s.email}
                {!s.active ? ' · معطّل' : ''}
              </small>
            </span>
          </label>
        ))}
      </div>
      <div className="modal-footer">
        <Button onClick={save} busy={busy} disabled={selected === null}>
          حفظ الصلاحيات
        </Button>
      </div>
    </div>
  );
}

function SettingsTab({ branch, onChanged }: { branch: Branch; onChanged: () => void }) {
  const { busy, act } = useAction();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void act(async () => {
      await api(`/branches/${branch.id}`, 'PUT', {
        name: f.get('name'),
        kind: f.get('kind'),
        phone: f.get('phone'),
        address: f.get('address'),
      });
      onChanged();
    }, 'تم حفظ بيانات الفرع');
  };
  const toggleActive = () =>
    void act(
      async () => {
        await api(`/branches/${branch.id}/active`, 'PATCH', { active: !branch.active });
        onChanged();
      },
      branch.active ? 'تمت أرشفة الفرع' : 'تمت إعادة فتح الفرع',
    );
  return (
    <div className="branch-settings">
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="اسم الفرع *">
            <input name="name" required maxLength={100} defaultValue={branch.name} />
          </Field>
          <Field label="نوع الفرع">
            <select name="kind" defaultValue={branch.kind}>
              <option value="HQ">المركز الرئيسي</option>
              <option value="STORE">فرع بيع</option>
              <option value="WAREHOUSE">مخزن</option>
              <option value="ONLINE">قناة إلكترونية</option>
            </select>
          </Field>
          <Field label="الهاتف">
            <input name="phone" dir="ltr" maxLength={40} defaultValue={branch.phone} />
          </Field>
          <Field label="العنوان">
            <input name="address" maxLength={300} defaultValue={branch.address} />
          </Field>
        </div>
        <div className="modal-footer">
          <Button busy={busy} type="submit">
            حفظ البيانات
          </Button>
        </div>
      </form>
      <div className="info-banner archive-note">
        <Store size={18} />
        <span>
          {branch.active
            ? 'الأرشفة تغلق الفرع من تاريخ اليوم: يبقى سجله كاملاً، لكن لا تُسجَّل فيه عمليات جديدة، ولا يُحمَّل عليه من المصروفات المشتركة بعد ذلك. تتطلب أن يكون مخزونه صفراً، وألا توجد فيه مسودات أو تحويلات في الطريق.'
            : 'إعادة الفتح تعيد الفرع للعمل وتزيل تاريخ الإغلاق.'}
        </span>
      </div>
      <div className="modal-footer">
        <Button variant={branch.active ? 'danger' : 'secondary'} busy={busy} onClick={toggleActive}>
          {branch.active ? 'أرشفة الفرع' : 'إعادة فتح الفرع'}
        </Button>
      </div>
    </div>
  );
}

function StockMatrixCard() {
  const matrix = useData<StockMatrix>('/stock/matrix');
  if (matrix.error) return <ErrorState message={matrix.error} retry={matrix.reload} />;
  if (!matrix.data) return <Loading />;
  const { branches, rows } = matrix.data;
  return (
    <section className="card matrix-card">
      <div className="card-heading">
        <div>
          <h2>
            <Boxes size={18} /> مصفوفة المخزون عبر الفروع
          </h2>
          <p>الكميات الحالية لكل منتج في كل فرع</p>
        </div>
      </div>
      <div className="table-scroll">
        <table className="matrix-table">
          <thead>
            <tr>
              <th>المنتج</th>
              {branches.map((b) => (
                <th key={b.id} title={b.name}>
                  {b.code}
                  {!b.active ? ' (مؤرشف)' : ''}
                </th>
              ))}
              <th>الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.product_id}>
                <td>
                  <strong>{r.name}</strong>
                  <small className="cell-sub">{r.sku}</small>
                </td>
                {branches.map((b) => {
                  const qty = r.by_branch[b.id] ?? 0;
                  return (
                    <td key={b.id} className={'num ' + (qty ? '' : 'muted')}>
                      {qty || '—'}
                    </td>
                  );
                })}
                <td className="num amount">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
