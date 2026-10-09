import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Download,
  Package,
  AlertTriangle,
  Pencil,
  Archive,
  RotateCcw,
  SlidersHorizontal,
  ArrowUpRight,
  Users,
  Truck,
  MapPin,
  Phone,
  Boxes,
  Wallet,
} from 'lucide-react';
import {
  api,
  useData,
  useAction,
  useSession,
  PageHeader,
  Button,
  Field,
  SearchBox,
  Modal,
  Loading,
  ErrorState,
  Empty,
  Stat,
  Pagination,
  Confirm,
  Initials,
  money,
  count,
  toCents,
  downloadCSV,
  formatDate,
  Status,
} from '../lib';
import { useBranch, withBranch } from '../branch';
import type { Product, Party, PartyType, Movement, Document } from '../types';
export function Products() {
  const { user } = useSession();
  const [params] = useSearchParams();
  const { activeId } = useBranch();
  const data = useData<Product[]>(withBranch('/products', activeId));
  const [query, setQuery] = useState(params.get('q') || '');
  const [category, setCategory] = useState('all');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [archive, setArchive] = useState<Product | null>(null);
  const { busy, act } = useAction();
  useEffect(() => {
    setQuery(params.get('q') || '');
  }, [params]);
  useEffect(() => setPage(1), [query, category, archived]);
  const products = data.data || [];
  const active = products.filter((p) => p.active);
  const filtered = products.filter(
    (p) =>
      (archived ? !p.active : p.active) &&
      (category === 'all' || p.category === category) &&
      (p.name + ' ' + p.sku).toLowerCase().includes(query.toLowerCase()),
  );
  const categories = [...new Set(active.map((p) => p.category))];
  const exportData = () =>
    downloadCSV(
      'المنتجات',
      ['الكود', 'المنتج', 'الفئة', 'سعر البيع', 'التكلفة', 'المخزون', 'الحد الأدنى'],
      filtered.map((p) => [
        p.sku,
        p.name,
        p.category,
        p.sale_price / 100,
        p.cost_price / 100,
        p.stock,
        p.min_stock,
      ]),
    );
  return (
    <>
      <PageHeader
        eyebrow="كتالوج أعمالك"
        title="المنتجات"
        description="كل منتجاتك وأسعارك، منظمة وجاهزة لكل عملية بيع."
        actions={
          <>
            <Button variant="secondary" onClick={exportData}>
              <Download size={16} /> تصدير
            </Button>
            {user.role === 'ADMIN' && (
              <Button onClick={() => setEditing('new')}>
                <Plus size={18} /> إضافة منتج
              </Button>
            )}
          </>
        }
      />
      <div className="stats-grid three">
        <Stat
          label="المنتجات النشطة"
          value={count(active.length)}
          unit="منتج"
          icon={<Package size={20} />}
          foot="في كتالوج منتجاتك"
        />
        <Stat
          label="قيمة المخزون الحالية"
          value={money(products.reduce((s, p) => s + p.stock * p.cost_price, 0))}
          icon={<Boxes size={20} />}
          tone="blue"
          foot="حسب التكلفة المرجعية للمنتج"
        />
        <Stat
          label="منتجات منخفضة المخزون"
          value={count(active.filter((p) => p.stock <= p.min_stock).length)}
          unit="منتج"
          icon={<AlertTriangle size={20} />}
          tone="amber"
          foot="تحتاج انتباهك وإعادة طلب"
        />
      </div>
      <section className="card">
        <div className="table-toolbar">
          <div className="tabs">
            <button className={!archived ? 'active' : ''} onClick={() => setArchived(false)}>
              كل المنتجات <span className="num">{active.length}</span>
            </button>
            <button className={archived ? 'active' : ''} onClick={() => setArchived(true)}>
              الأرشيف
            </button>
          </div>
          <div className="table-filters">
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder="بحث بالاسم أو كود المنتج..."
            />
            <select
              className="filter-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="فئة المنتج"
            >
              <option value="all">كل الفئات</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        {data.error ? (
          <ErrorState message={data.error} retry={data.reload} />
        ) : data.loading ? (
          <Loading />
        ) : !filtered.length ? (
          <Empty />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>المنتج</th>
                    <th>كود المنتج</th>
                    <th>الفئة</th>
                    <th>سعر البيع</th>
                    <th>سعر التكلفة</th>
                    <th>المخزون</th>
                    <th>الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice((page - 1) * 8, page * 8).map((p, i) => (
                    <tr key={p.id}>
                      <td>
                        <div className="product-cell">
                          <span className={'product-icon product-tone-' + (i % 4)}>
                            <Package size={21} />
                          </span>
                          <div>
                            <strong>{p.name}</strong>
                            <small>الوحدة: {p.unit}</small>
                          </div>
                        </div>
                      </td>
                      <td className="num muted">{p.sku}</td>
                      <td>
                        <span className="category-tag">{p.category}</span>
                      </td>
                      <td className="num amount">{money(p.sale_price, 2)}</td>
                      <td className="num muted">{money(p.cost_price, 2)}</td>
                      <td>
                        <span className={'stock-badge ' + (p.stock <= p.min_stock ? 'low' : '')}>
                          <i />
                          {p.stock} {p.unit}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          {user.role === 'ADMIN' && (
                            <>
                              <button
                                className="icon-btn"
                                title="تعديل المنتج"
                                aria-label={'تعديل ' + p.name}
                                onClick={() => setEditing(p)}
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                className="icon-btn"
                                title={p.active ? 'أرشفة' : 'إعادة تفعيل'}
                                aria-label={p.active ? 'أرشفة ' + p.name : 'إعادة تفعيل ' + p.name}
                                onClick={() => setArchive(p)}
                              >
                                {p.active ? <Archive size={16} /> : <RotateCcw size={16} />}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} setPage={setPage} total={filtered.length} />
          </>
        )}
      </section>
      {editing && (
        <ProductForm
          product={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            data.reload();
          }}
        />
      )}
      {archive && (
        <Confirm
          title={archive.active ? 'أرشفة المنتج' : 'إعادة تفعيل المنتج'}
          description={
            archive.active
              ? `سيختفي «${archive.name}» من الفواتير الجديدة. ستظل السجلات والمخزون السابق محفوظين.`
              : `سيعود «${archive.name}» إلى قائمة المنتجات المتاحة.`
          }
          busy={busy}
          onClose={() => setArchive(null)}
          onConfirm={() =>
            void act(async () => {
              await api(`/products/${archive.id}/active`, 'PATCH', { active: !archive.active });
              setArchive(null);
              data.reload();
            }, 'تم تحديث حالة المنتج')
          }
        />
      )}
    </>
  );
}
function ProductForm({
  product,
  onClose,
  onSaved,
}: {
  product?: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const { branches, defaultBranchId } = useBranch();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      name: f.get('name'),
      sku: f.get('sku'),
      category: f.get('category'),
      unit: f.get('unit'),
      sale_price: toCents(f.get('sale_price')),
      cost_price: toCents(f.get('cost_price')),
      min_stock: Number(f.get('min_stock')),
      ...(!product ? { stock: Number(f.get('stock')), branch_id: String(f.get('branch_id')) } : {}),
    };
    void act(
      async () => {
        await api('/products' + (product ? '/' + product.id : ''), product ? 'PUT' : 'POST', body);
        onSaved();
      },
      product ? 'تم تحديث بيانات المنتج' : 'تمت إضافة المنتج بنجاح',
    );
  };
  return (
    <Modal
      title={product ? 'تعديل المنتج' : 'إضافة منتج جديد'}
      description="أضف التفاصيل الأساسية. يمكنك تسوية المخزون لاحقاً من صفحة المخزون."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <Field label="اسم المنتج *">
            <input
              name="name"
              required
              maxLength={200}
              defaultValue={product?.name}
              placeholder="مثال: شاشة Dell مقاس 24 بوصة"
            />
          </Field>
          <div className="form-row">
            <Field label="كود المنتج (SKU) *">
              <input
                dir="ltr"
                name="sku"
                required
                maxLength={50}
                defaultValue={product?.sku}
                placeholder="TEC-001"
              />
            </Field>
            <Field label="الفئة *">
              <input
                name="category"
                required
                maxLength={80}
                defaultValue={product?.category || 'عام'}
                list="categories"
              />
              <datalist id="categories">
                <option>إلكترونيات</option>
                <option>أثاث مكتبي</option>
                <option>مستلزمات مكتبية</option>
              </datalist>
            </Field>
          </div>
          <div className="form-row">
            <Field label="سعر البيع (ج.م) *">
              <input
                name="sale_price"
                type="number"
                min="0"
                max="10000000"
                step=".01"
                required
                defaultValue={(product?.sale_price || 0) / 100}
              />
            </Field>
            <Field label="سعر التكلفة المرجعي (ج.م) *">
              <input
                name="cost_price"
                type="number"
                min="0"
                max="10000000"
                step=".01"
                required
                defaultValue={(product?.cost_price || 0) / 100}
              />
            </Field>
          </div>
          <div className="form-row">
            <Field label="وحدة القياس *">
              <input name="unit" required maxLength={30} defaultValue={product?.unit || 'قطعة'} />
            </Field>
            <Field label="حد التنبيه للمخزون *">
              <input
                name="min_stock"
                required
                type="number"
                min="0"
                max="1000000"
                defaultValue={product?.min_stock ?? 5}
              />
            </Field>
          </div>
          {!product && (
            <>
              <Field
                label="الرصيد الافتتاحي للمخزون"
                hint="يسجل تلقائياً كحركة افتتاحية في سجل المخزون."
              >
                <input name="stock" required type="number" min="0" max="1000000" defaultValue={0} />
              </Field>
              <Field
                label="الفرع الذي يُسجَّل فيه الرصيد"
                hint="الفروع الأخرى تبدأ بصفر، وتحوّل إليها بالتحويلات."
              >
                <select name="branch_id" required defaultValue={defaultBranchId}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          <div className="info-banner">
            <Package size={18} />
            <span>التكلفة المرجعية تستخدم في تقدير الربح، ولا تتغير تلقائياً مع المشتريات.</span>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="submit" busy={busy}>
            {product ? 'حفظ التعديلات' : 'إضافة المنتج'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function Inventory() {
  const { user } = useSession();
  const [params] = useSearchParams();
  const { activeId, isGroup, active, branches, defaultBranchId } = useBranch();
  const [adjustBranch, setAdjustBranch] = useState(defaultBranchId);
  const products = useData<Product[]>(withBranch('/products', activeId)),
    movements = useData<Movement[]>(withBranch('/movements', activeId));
  const [query, setQuery] = useState(params.get('q') || ''),
    [low, setLow] = useState(params.get('low') === '1'),
    [tab, setTab] = useState('levels'),
    [page, setPage] = useState(1),
    [adjust, setAdjust] = useState<Product | null>(null);
  const { busy, act } = useAction();
  useEffect(() => {
    setQuery(params.get('q') || '');
    setLow(params.get('low') === '1');
  }, [params]);
  useEffect(() => setPage(1), [query, low, tab]);
  const filtered = (products.data || []).filter(
    (p) =>
      p.active &&
      (!low || p.stock <= p.min_stock) &&
      (p.name + p.sku).toLowerCase().includes(query.toLowerCase()),
  );
  const moves = (movements.data || []).filter((m) =>
    (m.product_name + m.sku + m.reason + (m.number || ''))
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (adjust)
      void act(async () => {
        await api(`/products/${adjust.id}/adjust`, 'POST', {
          branch_id: isGroup ? adjustBranch : activeId,
          quantity: Number(f.get('quantity')),
          reason: f.get('reason'),
        });
        setAdjust(null);
        products.reload();
        movements.reload();
      }, 'تم تسجيل تسوية المخزون');
  };
  return (
    <>
      <PageHeader
        eyebrow="كل قطعة محسوبة"
        title="إدارة المخزون"
        description="راقب الكميات، تتبّع كل حركة، واستبق نفاد المنتجات."
        actions={
          <Button
            variant="secondary"
            onClick={() =>
              tab === 'levels'
                ? downloadCSV(
                    'المخزون',
                    ['الكود', 'المنتج', 'المتاح', 'الحد الأدنى', 'قيمة التكلفة'],
                    filtered.map((p) => [
                      p.sku,
                      p.name,
                      p.stock,
                      p.min_stock,
                      (p.stock * p.cost_price) / 100,
                    ]),
                  )
                : downloadCSV(
                    'حركات-المخزون',
                    ['التاريخ', 'المنتج', 'الكمية', 'السبب', 'المرجع'],
                    moves.map((m) => [
                      m.created_at,
                      m.product_name,
                      m.quantity,
                      m.reason,
                      m.number || '',
                    ]),
                  )
            }
          >
            <Download size={16} /> تصدير {tab === 'levels' ? 'المخزون' : 'الحركات'}
          </Button>
        }
      />
      {(products.data || []).some((p) => p.active && p.stock <= p.min_stock) && (
        <div className="warning-banner">
          <AlertTriangle size={20} />
          <div>
            <strong>بعض المنتجات تحتاج إعادة طلب</strong>
            <span>راجع المنتجات تحت الحد الأدنى للحفاظ على استمرارية أعمالك.</span>
          </div>
          <button
            onClick={() => {
              setLow(true);
              setTab('levels');
            }}
          >
            عرض المنتجات <ArrowUpRight size={15} />
          </button>
        </div>
      )}
      <section className="card">
        <div className="table-toolbar">
          <div className="tabs">
            <button className={tab === 'levels' ? 'active' : ''} onClick={() => setTab('levels')}>
              أرصدة المخزون
            </button>
            <button
              className={tab === 'movements' ? 'active' : ''}
              onClick={() => setTab('movements')}
            >
              سجل الحركات
            </button>
          </div>
          <div className="table-filters">
            <SearchBox value={query} onChange={setQuery} placeholder="بحث في المخزون..." />
            {tab === 'levels' && (
              <button
                className={'filter-toggle ' + (low ? 'selected' : '')}
                onClick={() => setLow(!low)}
              >
                <SlidersHorizontal size={15} /> منخفض المخزون
              </button>
            )}
          </div>
        </div>
        {products.error || movements.error ? (
          <ErrorState
            message={products.error || movements.error}
            retry={() => {
              products.reload();
              movements.reload();
            }}
          />
        ) : products.loading || movements.loading ? (
          <Loading />
        ) : tab === 'levels' ? (
          <>
            {!filtered.length ? (
              <Empty />
            ) : (
              <>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>المنتج</th>
                        <th>الكود</th>
                        <th>المتاح حالياً</th>
                        <th>الحد الأدنى</th>
                        <th>قيمة المخزون</th>
                        <th>الحالة</th>
                        {user.role === 'ADMIN' && <th>تسوية</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice((page - 1) * 8, page * 8).map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div className="product-cell">
                              <span className="product-icon">
                                <Package size={20} />
                              </span>
                              <strong>{p.name}</strong>
                            </div>
                          </td>
                          <td className="num muted">{p.sku}</td>
                          <td className="num amount">
                            {p.stock} <small>{p.unit}</small>
                          </td>
                          <td className="num muted">{p.min_stock}</td>
                          <td className="num amount">
                            {money(p.stock * p.cost_price)} <small>ج.م</small>
                          </td>
                          <td>
                            <span
                              className={
                                'badge ' +
                                (p.stock === 0
                                  ? 'overdue'
                                  : p.stock <= p.min_stock
                                    ? 'pending'
                                    : 'paid')
                              }
                            >
                              <i />
                              {p.stock === 0
                                ? 'نفد المخزون'
                                : p.stock <= p.min_stock
                                  ? 'منخفض'
                                  : 'متوفر'}
                            </span>
                          </td>
                          {user.role === 'ADMIN' && (
                            <td>
                              <button
                                className="btn-small"
                                onClick={() => {
                                  setAdjustBranch(isGroup ? defaultBranchId : activeId);
                                  setAdjust(p);
                                }}
                              >
                                <SlidersHorizontal size={14} /> تسوية
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={page} setPage={setPage} total={filtered.length} />
              </>
            )}
          </>
        ) : (
          <>
            {!moves.length ? (
              <Empty />
            ) : (
              <>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>المنتج</th>
                        <th>الحركة</th>
                        <th>السبب</th>
                        <th>المرجع</th>
                        <th>بواسطة</th>
                        <th>تاريخ التسجيل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {moves.slice((page - 1) * 8, page * 8).map((m) => (
                        <tr key={m.id}>
                          <td>
                            <strong>{m.product_name}</strong>
                            <small className="cell-sub num">{m.sku}</small>
                          </td>
                          <td>
                            <span
                              className={
                                'movement-amount ' + (m.quantity > 0 ? 'positive' : 'negative')
                              }
                              dir="ltr"
                            >
                              {m.quantity > 0 ? '+' : ''}
                              {m.quantity}
                            </span>
                          </td>
                          <td>{m.reason}</td>
                          <td className="num muted">{m.number || '—'}</td>
                          <td>{m.user_name}</td>
                          <td className="muted">{formatDate(m.created_at, true)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={page} setPage={setPage} total={moves.length} />
                <p className="table-bottom-note">
                  يعرض آخر ١٠٠٠ حركة حسب وقت التسجيل، وليس تاريخ الفاتورة.
                </p>
              </>
            )}
          </>
        )}
      </section>
      {adjust && (
        <Modal
          title="تسوية المخزون"
          description={`${adjust.name}${isGroup ? '' : ' · ' + (active?.name ?? '')}`}
          onClose={() => setAdjust(null)}
        >
          <form onSubmit={submit}>
            <div className="modal-body form-grid">
              {isGroup && (
                <Field label="الفرع الذي تُسوّى فيه الكمية *">
                  <select
                    required
                    value={adjustBranch}
                    onChange={(e) => setAdjustBranch(e.target.value)}
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="adjust-current">
                <span>{isGroup ? 'إجمالي المخزون في كل الفروع' : 'المخزون الحالي'}</span>
                <strong className="num">
                  {adjust.stock} <small>{adjust.unit}</small>
                </strong>
              </div>
              <Field
                label="الكمية المضافة أو المخصومة *"
                hint="استخدم قيمة موجبة للإضافة وسالبة للخصم، مثل 10 أو -5."
              >
                <input
                  name="quantity"
                  required
                  type="number"
                  min={-adjust.stock}
                  max={1000000 - adjust.stock}
                  defaultValue={1}
                />
              </Field>
              <Field label="سبب التسوية *">
                <textarea
                  name="reason"
                  required
                  minLength={3}
                  maxLength={300}
                  placeholder="مثال: تسوية الجرد الفعلي"
                />
              </Field>
            </div>
            <div className="modal-footer">
              <Button busy={busy} type="submit">
                تسجيل التسوية
              </Button>
              <Button type="button" variant="secondary" onClick={() => setAdjust(null)}>
                إلغاء
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function Parties({ type }: { type: PartyType }) {
  const customer = type === 'CUSTOMER';
  const { user } = useSession();
  const [params] = useSearchParams();
  const data = useData<Party[]>('/parties?type=' + type);
  const [query, setQuery] = useState(params.get('q') || ''),
    [page, setPage] = useState(1),
    [archived, setArchived] = useState(false),
    [editing, setEditing] = useState<Party | 'new' | null>(null),
    [selected, setSelected] = useState<Party | null>(null),
    [archive, setArchive] = useState<Party | null>(null);
  const { busy, act } = useAction();
  const editable = customer || user.role === 'ADMIN';
  useEffect(() => setQuery(params.get('q') || ''), [params]);
  useEffect(() => setPage(1), [query, archived]);
  const parties = data.data || [];
  const filtered = parties.filter(
    (p) =>
      (archived ? !p.active : p.active) &&
      (p.name + ' ' + p.phone + ' ' + p.email).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        eyebrow={customer ? 'علاقات تنمو معك' : 'شركاء نجاحك'}
        title={customer ? 'العملاء' : 'الموردون'}
        description={
          customer
            ? 'اعرف عملاءك أكثر. تابع حساباتهم ومستحقاتهم بسهولة.'
            : 'إدارة منظمة لمورديك، ووضوح أكبر في التزاماتك.'
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                downloadCSV(
                  customer ? 'العملاء' : 'الموردون',
                  ['الاسم', 'البريد', 'الهاتف', 'العنوان', 'المستحق'],
                  filtered.map((p) => [p.name, p.email, p.phone, p.address, p.balance / 100]),
                )
              }
            >
              <Download size={16} /> تصدير
            </Button>
            {editable && (
              <Button onClick={() => setEditing('new')}>
                <Plus size={18} /> إضافة {customer ? 'عميل' : 'مورد'}
              </Button>
            )}
          </>
        }
      />
      <div className="stats-grid three">
        <Stat
          label={customer ? 'إجمالي العملاء النشطين' : 'إجمالي الموردين النشطين'}
          value={count(parties.filter((p) => p.active).length)}
          unit={customer ? 'عميل' : 'مورد'}
          icon={customer ? <Users size={20} /> : <Truck size={20} />}
          foot="علاقات أعمالك في مكان واحد"
        />
        <Stat
          label={customer ? 'إجمالي مستحقاتك' : 'إجمالي التزاماتك'}
          value={money(parties.reduce((s, p) => s + p.balance, 0))}
          icon={<Wallet size={20} />}
          tone="blue"
          foot="رصيد الفواتير المعتمدة غير المسددة"
        />
        <Stat
          label={customer ? 'عملاء لديهم مستحقات' : 'موردون لديهم مستحقات'}
          value={count(parties.filter((p) => p.balance > 0).length)}
          unit="حساب"
          icon={<ReceiptIcon />}
          tone="amber"
          foot="حسابات بانتظار التسوية"
        />
      </div>
      <section className="card">
        <div className="table-toolbar">
          <div className="tabs">
            <button className={!archived ? 'active' : ''} onClick={() => setArchived(false)}>
              الحسابات النشطة
            </button>
            <button className={archived ? 'active' : ''} onClick={() => setArchived(true)}>
              الأرشيف
            </button>
          </div>
          <SearchBox value={query} onChange={setQuery} placeholder="بحث بالاسم أو الهاتف..." />
        </div>
        {data.error ? (
          <ErrorState message={data.error} retry={data.reload} />
        ) : data.loading ? (
          <Loading />
        ) : !filtered.length ? (
          <Empty />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{customer ? 'العميل' : 'المورد'}</th>
                    <th>رقم الهاتف</th>
                    <th>العنوان</th>
                    <th>الفواتير</th>
                    <th>الرصيد المستحق</th>
                    <th>الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice((page - 1) * 8, page * 8).map((p, i) => (
                    <tr key={p.id}>
                      <td>
                        <button className="person-cell plain-button" onClick={() => setSelected(p)}>
                          <Initials name={p.name} tone={i} />
                          <div>
                            <strong>{p.name}</strong>
                            <small className="cell-sub">{p.email || 'بريد غير مسجل'}</small>
                          </div>
                        </button>
                      </td>
                      <td className="num muted">{p.phone || '—'}</td>
                      <td className="muted address-cell">{p.address || '—'}</td>
                      <td className="num">{p.documents_count}</td>
                      <td className={'num amount ' + (p.balance > 0 ? 'amber-text' : '')}>
                        {money(p.balance, 2)} <small>ج.م</small>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="btn-small" onClick={() => setSelected(p)}>
                            كشف الحساب
                          </button>
                          {editable && (
                            <button
                              className="icon-btn"
                              onClick={() => setEditing(p)}
                              title="تعديل"
                              aria-label={'تعديل ' + p.name}
                            >
                              <Pencil size={15} />
                            </button>
                          )}
                          {user.role === 'ADMIN' && (
                            <button
                              className="icon-btn"
                              onClick={() => setArchive(p)}
                              title={p.active ? 'أرشفة' : 'تفعيل'}
                              aria-label={p.active ? 'أرشفة ' + p.name : 'تفعيل ' + p.name}
                            >
                              {p.active ? <Archive size={15} /> : <RotateCcw size={15} />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} setPage={setPage} total={filtered.length} />
          </>
        )}
      </section>
      {editing && (
        <PartyForm
          type={type}
          party={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            data.reload();
          }}
        />
      )}
      {selected && <PartyStatement party={selected} onClose={() => setSelected(null)} />}
      {archive && (
        <Confirm
          title={archive.active ? 'أرشفة الحساب' : 'إعادة تفعيل الحساب'}
          description="تبقى جميع المعاملات والمستحقات السابقة محفوظة، حتى بعد أرشفة الحساب."
          busy={busy}
          onClose={() => setArchive(null)}
          onConfirm={() =>
            void act(async () => {
              await api(`/parties/${archive.id}/active`, 'PATCH', { active: !archive.active });
              setArchive(null);
              data.reload();
            }, 'تم تحديث حالة الحساب')
          }
        />
      )}
    </>
  );
}
function ReceiptIcon() {
  return <Wallet size={20} />;
}
function PartyForm({
  type,
  party,
  onClose,
  onSaved,
}: {
  type: PartyType;
  party?: Party;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void act(async () => {
      await api('/parties' + (party ? '/' + party.id : ''), party ? 'PUT' : 'POST', {
        type,
        name: f.get('name'),
        email: f.get('email'),
        phone: f.get('phone'),
        address: f.get('address'),
        tax_number: f.get('tax_number'),
        notes: f.get('notes'),
      });
      onSaved();
    }, 'تم حفظ بيانات الحساب');
  };
  return (
    <Modal
      title={(party ? 'تعديل بيانات ' : 'إضافة ') + (type === 'CUSTOMER' ? 'عميل' : 'مورد')}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <Field label="اسم الحساب أو الشركة *">
            <input
              required
              name="name"
              maxLength={200}
              defaultValue={party?.name}
              placeholder="الاسم الكامل أو اسم الشركة"
            />
          </Field>
          <div className="form-row">
            <Field label="رقم الهاتف">
              <input
                name="phone"
                dir="ltr"
                type="tel"
                maxLength={40}
                defaultValue={party?.phone}
                placeholder="010 0000 0000"
              />
            </Field>
            <Field label="البريد الإلكتروني">
              <input
                name="email"
                dir="ltr"
                type="email"
                maxLength={200}
                defaultValue={party?.email}
                placeholder="name@example.com"
              />
            </Field>
          </div>
          <Field label="العنوان">
            <input
              name="address"
              maxLength={500}
              defaultValue={party?.address}
              placeholder="المدينة، المنطقة، الشارع"
            />
          </Field>
          <Field label="الرقم الضريبي">
            <input name="tax_number" maxLength={50} defaultValue={party?.tax_number} />
          </Field>
          <Field label="ملاحظات">
            <textarea
              name="notes"
              maxLength={2000}
              defaultValue={party?.notes}
              placeholder="أي تفاصيل إضافية عن الحساب..."
            />
          </Field>
        </div>
        <div className="modal-footer">
          <Button type="submit" busy={busy}>
            حفظ البيانات
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function PartyStatement({ party, onClose }: { party: Party; onClose: () => void }) {
  const data = useData<Document[]>(
    '/documents?type=' + (party.type === 'CUSTOMER' ? 'SALE' : 'PURCHASE'),
  );
  const docs = (data.data || []).filter((d) => d.party_id === party.id);
  return (
    <Modal wide title="كشف الحساب" description={party.name} onClose={onClose}>
      <div className="modal-body">
        <div className="statement-top">
          <div>
            <Initials name={party.name} />
            <h3>{party.name}</h3>
            <p>
              <Phone size={14} />
              {party.phone || 'لا يوجد هاتف'}
            </p>
            <p>
              <MapPin size={14} />
              {party.address || 'لا يوجد عنوان'}
            </p>
            {party.notes && <p>{party.notes}</p>}
          </div>
          <div className="statement-balance">
            <span>الرصيد المستحق الحالي</span>
            <strong className="num">
              {money(party.balance, 2)} <small>ج.م</small>
            </strong>
            <Button
              variant="secondary"
              onClick={() =>
                downloadCSV(
                  'كشف-حساب-' + party.name,
                  ['الفاتورة', 'التاريخ', 'الحالة', 'الإجمالي', 'المدفوع', 'المتبقي'],
                  docs.map((d) => [
                    d.number,
                    d.date,
                    d.status,
                    d.total / 100,
                    d.paid / 100,
                    d.status === 'POSTED' ? (d.total - d.paid) / 100 : 0,
                  ]),
                )
              }
            >
              <Download size={15} /> تصدير الكشف
            </Button>
          </div>
        </div>
        {data.loading ? (
          <Loading />
        ) : data.error ? (
          <ErrorState message={data.error} retry={data.reload} />
        ) : !docs.length ? (
          <Empty title="لا توجد معاملات بعد" />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>الفاتورة</th>
                  <th>التاريخ</th>
                  <th>الإجمالي</th>
                  <th>المدفوع</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link
                        className="invoice-number num"
                        onClick={onClose}
                        to={`/${d.type === 'SALE' ? 'sales' : 'purchases'}/${d.id}`}
                      >
                        {d.number}
                      </Link>
                    </td>
                    <td>{formatDate(d.date, true)}</td>
                    <td className="num">{money(d.total, 2)}</td>
                    <td className="num">{money(d.paid, 2)}</td>
                    <td>
                      <Status doc={d} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
