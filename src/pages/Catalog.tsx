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
  ShieldCheck,
  TrendingUp,
  History,
  Calculator,
  ShoppingBag,
  Calendar,
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
import type {
  Product,
  Party,
  PartyType,
  Movement,
  Document,
  CostMovement,
  ReorderSuggestion,
  StockValuationResponse,
  ExpiryAlertResponse,
  WarehouseLocation,
} from '../types';
import { can } from '../auth';
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
            {can(user, 'catalog:manage') && (
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
                      <td
                        className="num muted"
                        title={
                          p.avg_cost && p.avg_cost !== p.cost_price
                            ? `التكلفة المرجعية: ${money(p.cost_price, 2)} ج.م`
                            : undefined
                        }
                      >
                        {money(p.avg_cost ?? p.cost_price, 2)}
                        {p.avg_cost && p.avg_cost !== p.cost_price ? (
                          <small
                            className="cell-sub"
                            style={{ display: 'block', color: 'var(--brand-main)' }}
                          >
                            مرجح
                          </small>
                        ) : null}
                      </td>
                      <td>
                        <span className={'stock-badge ' + (p.stock <= p.min_stock ? 'low' : '')}>
                          <i />
                          {p.stock} {p.unit}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          {can(user, 'catalog:manage') && (
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
export function ProductForm({
  product,
  onClose,
  onSaved,
  defaultCategory,
  quick,
}: {
  /** Pre-fill the category (used by the POS quick-create flow). */
  defaultCategory?: string;
  /** Compact wording/layout for the till: emphasise name, SKU, price and opening stock. */
  quick?: boolean;
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
      track_batches: f.get('track_batches') === 'on' ? 1 : 0,
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
      title={product ? 'تعديل المنتج' : quick ? 'تعريف منتج جديد (بيع سريع)' : 'إضافة منتج جديد'}
      description={
        quick
          ? 'عرّف المنتج فوراً وأضفه للسلة دون مغادرة شاشة الكاشير.'
          : 'أضف التفاصيل الأساسية. يمكنك تسوية المخزون لاحقاً من صفحة المخزون.'
      }
      onClose={onClose}
      sheet={quick}
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
                defaultValue={product?.category || defaultCategory || 'عام'}
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
          <div className="form-field" style={{ margin: '12px 0 6px 0' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              <input
                type="checkbox"
                name="track_batches"
                defaultChecked={Boolean(product?.track_batches)}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <span>تتبع أرقام التشغيلات وتواريخ الصلاحية (FEFO)</span>
            </label>
            <span
              style={{
                fontSize: '12px',
                color: 'var(--slate-500)',
                display: 'block',
                marginTop: '4px',
              }}
            >
              يلزم إدخال رقم التشغيلة والصلاحية عند الشراء، ويطبّق الصرف الآلي للأقرب انتهاءً أولاً.
            </span>
          </div>
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

function CostHistoryModal({
  product,
  branchId,
  onClose,
}: {
  product: { id: string; name: string; sku: string };
  branchId?: string | null;
  onClose: () => void;
}) {
  const url = withBranch(`/inventory/cost-history/${product.id}`, branchId || 'all');
  const data = useData<CostMovement[]>(url);
  const rows = data.data || [];

  return (
    <Modal title={`سجل حركة وتطور تكلفة WAC: ${product.name} (${product.sku})`} onClose={onClose}>
      <div style={{ marginBottom: '16px', fontSize: '13px', color: 'var(--slate-600)' }}>
        تتبع دقيق لكل حركة شراء أو بيع أو تحويل أو تسوية أثرت على متوسط التكلفة المرجح (WAC) لهذا
        الصنف.
      </div>
      {data.loading ? (
        <Loading />
      ) : data.error ? (
        <ErrorState message={data.error} retry={data.reload} />
      ) : !rows.length ? (
        <Empty
          title="لا توجد حركات تكلفة سابقة"
          description="لم يتم تسجيل حركات WAC لهذا الصنف بعد في هذا النطاق."
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>التاريخ والوقت</th>
                <th>الفرع</th>
                <th>الكمية</th>
                <th>تكلفة الحركة</th>
                <th>المتوسط قبل</th>
                <th>المتوسط بعد</th>
                <th>السبب / المستند</th>
                <th>بواسطة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((cm) => (
                <tr key={cm.id}>
                  <td className="muted">{formatDate(cm.created_at, true)}</td>
                  <td>{cm.branch_name}</td>
                  <td>
                    <span
                      className={'movement-amount ' + (cm.delta_qty > 0 ? 'positive' : 'negative')}
                      dir="ltr"
                    >
                      {cm.delta_qty > 0 ? '+' : ''}
                      {cm.delta_qty}
                    </span>
                  </td>
                  <td className="num">{money(cm.unit_cost, 2)}</td>
                  <td className="num muted">{money(cm.avg_before, 2)}</td>
                  <td className="num amount">
                    <strong>{money(cm.avg_after, 2)}</strong>
                  </td>
                  <td>{cm.reason}</td>
                  <td>{cm.user_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function StockValuationView({
  data,
  query,
  category,
  stockFilter,
  onCategoryChange,
  onStockFilterChange,
  page,
  setPage,
  onInspectCost,
}: {
  data: ReturnType<typeof useData<StockValuationResponse>>;
  query: string;
  category: string;
  stockFilter: string;
  onCategoryChange: (c: string) => void;
  onStockFilterChange: (s: string) => void;
  page: number;
  setPage: (p: number) => void;
  onInspectCost: (p: { id: string; name: string; sku: string }) => void;
}) {
  if (data.loading) return <Loading />;
  if (data.error) return <ErrorState message={data.error} retry={data.reload} />;
  const report = data.data;
  if (!report) return <Empty title="لا توجد بيانات تقييم متاحة" />;

  const filteredRows = report.rows.filter((r) => {
    const matchesQuery = (r.name + ' ' + r.sku + ' ' + r.category)
      .toLowerCase()
      .includes(query.toLowerCase());
    const matchesCat = category === 'all' || r.category === category;
    const matchesStock =
      stockFilter === 'all' ||
      (stockFilter === 'in_stock' && r.quantity > 0) ||
      (stockFilter === 'out_of_stock' && r.quantity === 0) ||
      (stockFilter === 'negative' && r.quantity < 0);
    return matchesQuery && matchesCat && matchesStock;
  });

  const pagedRows = filteredRows.slice((page - 1) * 10, page * 10);

  return (
    <>
      {/* 1. Stat cards */}
      <div className="stock-valuation-stats">
        <Stat
          label="إجمالي قيمة المخزون (WAC)"
          value={money(report.summary.total_inventory_cost)}
          icon={<Boxes size={22} />}
          tone="indigo"
          foot={`${count(report.summary.total_products)} صنف مسجل`}
        />
        <Stat
          label="القيمة البيعية المتوقعة"
          value={money(report.summary.total_inventory_retail)}
          icon={<ShoppingBag size={22} />}
          tone="purple"
          foot="بالأسعار الحالية المعلنة"
        />
        <Stat
          label="الأرباح المتوقعة بالمخزون"
          value={money(report.summary.total_potential_profit)}
          icon={<TrendingUp size={22} />}
          tone="green"
          foot="هامش الربح الإجمالي المقدر"
        />
        <Stat
          label="متوسط هامش الربح"
          value={`${report.summary.overall_margin_percent}%`}
          icon={<Calculator size={22} />}
          tone="amber"
          foot={`${count(report.summary.total_quantity)} قطعة بالمخازن`}
        />
      </div>

      {/* 2. GL Reconciliation Card */}
      <div
        className={
          'gl-reconciliation-card ' + (report.gl_check.reconciled ? 'reconciled' : 'variance')
        }
      >
        <div className="rec-details">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ShieldCheck size={28} />
            <div>
              <strong style={{ fontSize: '15px' }}>المطابقة المحاسبية مع الأستاذ العام</strong>
              <div style={{ fontSize: '13px', marginTop: '2px' }}>
                {report.gl_check.reconciled
                  ? `قيمة المخزون الفعلي مطابقة بنسبة 100% بالقرش مع حساب المخزون (${report.gl_check.account_code} - ${report.gl_check.account_name})`
                  : `يوجد فارق محاسبي بين المخزون الفعلي ورصيد الحساب (${report.gl_check.account_code}) يتطلب المراجعة`}
              </div>
            </div>
          </div>
          <div className="rec-item">
            <span>رصيد المخزون الدفتري</span>
            <strong>{money(report.gl_check.gl_inventory_balance, 2)} ج.م</strong>
          </div>
          <div className="rec-item">
            <span>تقييم المخزون الفعلي (WAC)</span>
            <strong>{money(report.gl_check.stock_valuation_total, 2)} ج.م</strong>
          </div>
          <div className="rec-item">
            <span>الفارق</span>
            <strong style={{ color: report.gl_check.reconciled ? '#15803d' : '#b45309' }}>
              {money(report.gl_check.variance, 2)} ج.م
            </strong>
          </div>
        </div>
        <Link to="/ledger?tab=statement&account=1140" className="btn btn-secondary btn-small">
          كشف حساب المخزون <ArrowUpRight size={14} />
        </Link>
      </div>

      {/* 3. Valuation Toolbar */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          marginBottom: '16px',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', color: 'var(--slate-600)', fontWeight: 500 }}>
            التصنيف:
          </span>
          <select
            value={category}
            onChange={(e) => {
              onCategoryChange(e.target.value);
              setPage(1);
            }}
            className="filter-select"
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid var(--slate-300)',
              fontSize: '13px',
            }}
          >
            <option value="all">كافة التصنيفات</option>
            {report.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', color: 'var(--slate-600)', fontWeight: 500 }}>
            حالة الرصيد:
          </span>
          <select
            value={stockFilter}
            onChange={(e) => {
              onStockFilterChange(e.target.value);
              setPage(1);
            }}
            className="filter-select"
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid var(--slate-300)',
              fontSize: '13px',
            }}
          >
            <option value="all">كافة الحالات</option>
            <option value="in_stock">المتوفر فقط بالمخزن</option>
            <option value="out_of_stock">رصيد صفري (نفد)</option>
            <option value="negative">رصيد سالب (عجز)</option>
          </select>
        </div>

        <div style={{ marginRight: 'auto', fontSize: '13px', color: 'var(--slate-500)' }}>
          عرض {filteredRows.length} من {report.rows.length} صنف
        </div>
      </div>

      {/* 4. Table */}
      {!filteredRows.length ? (
        <Empty title="لا توجد أصناف مطابقة" description="جرب تغيير خيارات التصفية أو البحث." />
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th>الكود</th>
                  <th>الفئة</th>
                  <th>الكمية المتاحة</th>
                  <th>متوسط التكلفة WAC</th>
                  <th>إجمالي التكلفة</th>
                  <th>سعر البيع</th>
                  <th>القيمة البيعية</th>
                  <th>الربح المتوقع</th>
                  <th>هامش الربح</th>
                  <th>سجل WAC</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((r) => {
                  const marginClass =
                    r.margin_percent >= 30
                      ? 'high'
                      : r.margin_percent >= 15
                        ? 'normal'
                        : r.margin_percent > 0
                          ? 'low'
                          : 'loss';
                  return (
                    <tr key={r.product_id + (r.branch_id || '')}>
                      <td>
                        <strong>{r.name}</strong>
                      </td>
                      <td className="num muted">{r.sku}</td>
                      <td>
                        <span className="category-tag">{r.category}</span>
                      </td>
                      <td className="num amount">
                        <strong>{r.quantity}</strong> <small>{r.unit}</small>
                      </td>
                      <td className="num">{money(r.unit_cost, 2)}</td>
                      <td className="num amount">
                        <strong>{money(r.total_cost, 2)}</strong>
                      </td>
                      <td className="num muted">{money(r.sale_price, 2)}</td>
                      <td className="num amount">{money(r.total_retail, 2)}</td>
                      <td
                        className="num"
                        style={{ color: r.potential_profit >= 0 ? '#15803d' : '#b91c1c' }}
                      >
                        {money(r.potential_profit, 2)}
                      </td>
                      <td>
                        <span className={'margin-pill ' + marginClass} dir="ltr">
                          {r.margin_percent}%
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="cost-evolution-btn"
                          title="عرض سجل تطور تكلفة الصنف"
                          onClick={() =>
                            onInspectCost({ id: r.product_id, name: r.name, sku: r.sku })
                          }
                        >
                          <History size={13} /> حركة التكلفة
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} setPage={setPage} total={filteredRows.length} size={10} />
        </>
      )}
    </>
  );
}

function BatchesExpiryView({
  activeId,
  isGroup,
  query,
}: {
  activeId: string;
  isGroup: boolean;
  query: string;
}) {
  const alertsData = useData<ExpiryAlertResponse>(withBranch('/inventory/expiry-alerts', activeId));
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'expired' | 'critical' | 'warning' | 'healthy'
  >('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [page, setPage] = useState(1);

  if (alertsData.loading) return <Loading />;
  if (alertsData.error) return <ErrorState message={alertsData.error} retry={alertsData.reload} />;

  const data = alertsData.data;
  if (!data) return <Empty title="لا توجد بيانات صلاحية وتشغيلات متاحة" />;

  const summary = data.summary;
  const filtered = data.batches.filter((b) => {
    const matchesQuery = (b.product_name + ' ' + b.sku + ' ' + b.batch_number)
      .toLowerCase()
      .includes(query.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || b.category === categoryFilter;
    const matchesStatus = statusFilter === 'all' || b.status?.toLowerCase() === statusFilter;
    return matchesQuery && matchesCategory && matchesStatus;
  });

  const exportBatches = () => {
    downloadCSV(
      'تشغيلات-المخزون-والصلاحيات',
      [
        'الكود',
        'المنتج',
        'الفئة',
        'الفرع',
        'رقم التشغيلة',
        'تاريخ الإنتاج',
        'تاريخ الصلاحية',
        'الأيام المتبقية',
        'الكمية',
        'التكلفة (ج.م)',
        'الحالة',
      ],
      filtered.map((b) => [
        b.sku || '',
        b.product_name || '',
        b.category || '',
        b.branch_name || '',
        b.batch_number,
        b.production_date || '—',
        b.expiry_date,
        b.days_to_expiry !== undefined ? b.days_to_expiry : '',
        b.quantity,
        b.cost_price / 100,
        b.status === 'EXPIRED'
          ? 'منتهية الصلاحية'
          : b.status === 'CRITICAL'
            ? 'حرجة (< 30 يوم)'
            : b.status === 'WARNING'
              ? 'تحذيرية (< 90 يوم)'
              : 'صالحة',
      ]),
    );
  };

  return (
    <>
      <div className="batches-stats">
        <Stat
          label="إجمالي التشغيلات النشطة"
          value={count(summary.total_batches)}
          icon={<Boxes size={22} />}
          tone="indigo"
          foot={`${summary.total_quantity} قطعة بالمخازن · ${money(summary.total_value)}`}
        />
        <Stat
          label="منتهية الصلاحية (معزولة)"
          value={count(summary.expired_count)}
          icon={<AlertTriangle size={22} color="#dc2626" />}
          tone="red"
          foot={`${summary.expired_quantity} قطعة · ${money(summary.expired_value)}`}
        />
        <Stat
          label="حرجة (أقل من 30 يوماً)"
          value={count(summary.critical_count)}
          icon={<AlertTriangle size={22} color="#ea580c" />}
          tone="amber"
          foot={`${summary.critical_quantity} قطعة · ${money(summary.critical_value)}`}
        />
        <Stat
          label="تحذيرية (30 إلى 90 يوماً)"
          value={count(summary.warning_count)}
          icon={<Calendar size={22} color="#ca8a04" />}
          tone="purple"
          foot={`${summary.warning_quantity} قطعة · ${money(summary.warning_value)}`}
        />
      </div>

      <div className="table-toolbar" style={{ margin: '12px 0' }}>
        <div className="filter-group" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as any);
              setPage(1);
            }}
          >
            <option value="all">كل الحالات ({data.batches.length})</option>
            <option value="expired">منتهية الصلاحية ({summary.expired_count})</option>
            <option value="critical">حرجة &lt; 30 يوم ({summary.critical_count})</option>
            <option value="warning">تحذيرية 30-90 يوم ({summary.warning_count})</option>
            <option value="healthy">صالحة ومستقرة ({summary.healthy_count})</option>
          </select>

          {data.categories.length > 0 && (
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">كل التصنيفات</option>
              {data.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}

          <Button variant="secondary" onClick={exportBatches}>
            <Download size={15} /> تصدير تشغيلات المخزون
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty
          title="لا توجد تشغيلات تطابق معايير البحث"
          description="لم يتم العثور على دفعات مسجلة بهذه الفلاتر."
        />
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>الصنف والكود</th>
                  {isGroup && <th>الفرع</th>}
                  <th>رقم التشغيلة</th>
                  <th>تاريخ الإنتاج</th>
                  <th>تاريخ الانتهاء</th>
                  <th>الأيام المتبقية</th>
                  <th>الكمية المتاحة</th>
                  <th>تكلفة الشراء</th>
                  <th>الحالة والسياسة</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice((page - 1) * 15, page * 15).map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.product_name}</strong>
                      <small className="cell-sub muted">
                        {b.sku} · {b.category}
                      </small>
                    </td>
                    {isGroup && <td>{b.branch_name || b.branch_code}</td>}
                    <td>
                      <span className="batch-number-tag">{b.batch_number}</span>
                    </td>
                    <td className="muted">
                      {b.production_date ? formatDate(b.production_date) : '—'}
                    </td>
                    <td>
                      <strong className="num">{formatDate(b.expiry_date)}</strong>
                    </td>
                    <td>
                      {b.days_to_expiry !== undefined && (
                        <span
                          className={`num ${
                            b.days_to_expiry < 0
                              ? 'negative'
                              : b.days_to_expiry <= 30
                                ? 'warning'
                                : 'muted'
                          }`}
                        >
                          {b.days_to_expiry < 0
                            ? `منتهية منذ ${Math.abs(b.days_to_expiry)} يوم`
                            : `${b.days_to_expiry} يوم`}
                        </span>
                      )}
                    </td>
                    <td className="num amount">
                      <strong>{b.quantity}</strong> <small>{b.unit}</small>
                    </td>
                    <td className="num">{money(b.cost_price)}</td>
                    <td>
                      {b.status === 'EXPIRED' && (
                        <span className="batch-status-pill expired">منتهية (معزولة)</span>
                      )}
                      {b.status === 'CRITICAL' && (
                        <span className="batch-status-pill critical">حرجة (&lt; 30 يوم)</span>
                      )}
                      {b.status === 'WARNING' && (
                        <span className="batch-status-pill warning">تحذيرية (&lt; 90 يوم)</span>
                      )}
                      {b.status === 'HEALTHY' && (
                        <span className="batch-status-pill healthy">صالحة (FEFO)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} setPage={setPage} total={filtered.length} size={15} />
          <p className="table-bottom-note">
            تطبق سياسة الصرف الذكية (FEFO: الأقرب انتهاءً يخرج أولاً) تلقائياً عند البيع، وتعزل
            التشغيلات المنتهية وتمنع من الصرف.
          </p>
        </>
      )}
    </>
  );
}

function WarehouseLocationsView({ activeId, query }: { activeId: string; query: string }) {
  const { user } = useSession();
  const { branches, defaultBranchId } = useBranch();
  const data = useData<WarehouseLocation[]>(withBranch('/warehouse-locations', activeId));
  const [editing, setEditing] = useState<WarehouseLocation | 'new' | null>(null);
  const [page, setPage] = useState(1);
  const { busy, act } = useAction();

  if (data.loading) return <Loading />;
  if (data.error) return <ErrorState message={data.error} retry={data.reload} />;

  const locations = data.data || [];
  const filtered = locations.filter((loc) => {
    const q = query.toLowerCase();
    return (
      loc.code.toLowerCase().includes(q) ||
      loc.name.toLowerCase().includes(q) ||
      (loc.aisle || '').toLowerCase().includes(q) ||
      (loc.rack || '').toLowerCase().includes(q)
    );
  });

  const saveLocation = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = {
      code: f.get('code'),
      name: f.get('name'),
      branch_id: f.get('branch_id'),
      aisle: f.get('aisle') || undefined,
      rack: f.get('rack') || undefined,
      shelf: f.get('shelf') || undefined,
      bin: f.get('bin') || undefined,
      notes: f.get('notes') || undefined,
      active: f.get('active') === 'on',
    };

    void act(async () => {
      if (editing === 'new') {
        await api('/warehouse-locations', 'POST', payload);
      } else if (editing) {
        await api(`/warehouse-locations/${editing.id}`, 'PUT', payload);
      }
      setEditing(null);
      data.reload();
    }, 'تم حفظ موقع التخزين بنجاح');
  };

  const toggleActive = (loc: WarehouseLocation) => {
    void act(async () => {
      await api(`/warehouse-locations/${loc.id}`, 'PUT', { active: !loc.active });
      data.reload();
    }, 'تم تغيير حالة الموقع');
  };

  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <p className="muted" style={{ margin: 0 }}>
          تنظيم المستودع حسب الممرات والستاندات والأرفف والصناديق (Aisle / Rack / Shelf / Bin)
          لتسريع الجرد والالتقاط.
        </p>
        {can(user, 'inventory:adjust') && (
          <Button onClick={() => setEditing('new')}>
            <Plus size={16} /> إضافة موقع تخزين
          </Button>
        )}
      </div>

      {!filtered.length ? (
        <Empty
          title="لا توجد مواقع تخزين معرفة"
          description="أضف مواقع التخزين لتنظيم وترتيب أصناف المستودع."
        />
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>رمز الموقع</th>
                  <th>الاسم / الوصف</th>
                  <th>الفرع</th>
                  <th>الممر (Aisle)</th>
                  <th>الستاند (Rack)</th>
                  <th>الرف (Shelf)</th>
                  <th>الصندوق (Bin)</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice((page - 1) * 15, page * 15).map((loc) => (
                  <tr key={loc.id}>
                    <td>
                      <strong className="num" dir="ltr">
                        {loc.code}
                      </strong>
                    </td>
                    <td>{loc.name}</td>
                    <td>{loc.branch_name || '—'}</td>
                    <td className="num">{loc.aisle || '—'}</td>
                    <td className="num">{loc.rack || '—'}</td>
                    <td className="num">{loc.shelf || '—'}</td>
                    <td className="num">{loc.bin || '—'}</td>
                    <td>
                      <span className={`badge ${loc.active ? 'paid' : 'cancelled'}`}>
                        <i />
                        {loc.active ? 'نشط' : 'معطل'}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="btn-small" onClick={() => setEditing(loc)}>
                          تعديل
                        </button>
                        <button className="btn-small" onClick={() => toggleActive(loc)}>
                          {loc.active ? 'تعطيل' : 'تفعيل'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} setPage={setPage} total={filtered.length} size={15} />
        </>
      )}

      {editing && (
        <Modal
          title={
            editing === 'new' ? 'إضافة موقع تخزين جديد' : `تعديل موقع التخزين: ${editing.code}`
          }
          onClose={() => setEditing(null)}
        >
          <form onSubmit={saveLocation}>
            <div className="modal-body form-grid">
              <div className="form-row">
                <Field label="رمز الموقع (Unique Code) *">
                  <input
                    required
                    name="code"
                    dir="ltr"
                    maxLength={50}
                    defaultValue={editing !== 'new' ? editing.code : ''}
                    placeholder="مثال: A-01-R2-B4"
                  />
                </Field>
                <Field label="اسم الموقع أو الوصف *">
                  <input
                    required
                    name="name"
                    maxLength={100}
                    defaultValue={editing !== 'new' ? editing.name : ''}
                    placeholder="مثال: ستاند قطع الغيار 2"
                  />
                </Field>
              </div>
              <Field label="الفرع / المستودع *">
                <select
                  name="branch_id"
                  defaultValue={editing !== 'new' ? editing.branch_id : defaultBranchId}
                  required
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="form-row">
                <Field label="الممر (Aisle)">
                  <input
                    name="aisle"
                    maxLength={20}
                    defaultValue={editing !== 'new' ? editing.aisle || '' : ''}
                    placeholder="A"
                  />
                </Field>
                <Field label="الستاند (Rack)">
                  <input
                    name="rack"
                    maxLength={20}
                    defaultValue={editing !== 'new' ? editing.rack || '' : ''}
                    placeholder="01"
                  />
                </Field>
                <Field label="الرف (Shelf)">
                  <input
                    name="shelf"
                    maxLength={20}
                    defaultValue={editing !== 'new' ? editing.shelf || '' : ''}
                    placeholder="02"
                  />
                </Field>
                <Field label="الصندوق (Bin)">
                  <input
                    name="bin"
                    maxLength={20}
                    defaultValue={editing !== 'new' ? editing.bin || '' : ''}
                    placeholder="B"
                  />
                </Field>
              </div>
              <Field label="ملاحظات">
                <textarea
                  name="notes"
                  maxLength={500}
                  defaultValue={editing !== 'new' ? editing.notes || '' : ''}
                />
              </Field>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={editing !== 'new' ? Boolean(editing.active) : true}
                />
                موقع نشط وجاهز للتخزين
              </label>
            </div>
            <div className="modal-footer">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                إلغاء
              </Button>
              <Button type="submit" busy={busy}>
                حفظ الموقع
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function Inventory() {
  const { user } = useSession();
  const [params] = useSearchParams();
  const { activeId, isGroup, active, branches, defaultBranchId } = useBranch();
  const [adjustBranch, setAdjustBranch] = useState(defaultBranchId);
  const products = useData<Product[]>(withBranch('/products', activeId)),
    movements = useData<Movement[]>(withBranch('/movements', activeId)),
    reorder = useData<ReorderSuggestion[]>(withBranch('/inventory/reorder', activeId)),
    costMovements = useData<CostMovement[]>(
      can(user, 'inventory:view') ? withBranch('/cost-movements', activeId) : null,
    ),
    valuation = useData<StockValuationResponse>(
      can(user, 'inventory:view') ? withBranch('/inventory/valuation', activeId) : null,
    );
  const [query, setQuery] = useState(params.get('q') || ''),
    [low, setLow] = useState(params.get('low') === '1'),
    [tab, setTab] = useState(params.get('tab') || 'levels'),
    [valCategory, setValCategory] = useState('all'),
    [valStockFilter, setValStockFilter] = useState('all'),
    [costHistoryProduct, setCostHistoryProduct] = useState<{
      id: string;
      name: string;
      sku: string;
    } | null>(null),
    [page, setPage] = useState(1),
    [adjust, setAdjust] = useState<Product | null>(null);
  const { busy, act } = useAction();
  useEffect(() => {
    setQuery(params.get('q') || '');
    setLow(params.get('low') === '1');
    if (params.get('tab')) setTab(params.get('tab')!);
  }, [params]);
  useEffect(() => setPage(1), [query, low, tab, valCategory, valStockFilter]);
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
  const costMoves = (costMovements.data || []).filter((cm) =>
    (cm.product_name + cm.sku + cm.reason + (cm.document_id || '') + (cm.branch_name || ''))
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
                : tab === 'valuation' && valuation.data
                  ? downloadCSV(
                      'تقييم-المخزون-WAC',
                      [
                        'الكود',
                        'المنتج',
                        'الفئة',
                        'الكمية المتاحة',
                        'الوحدة',
                        'متوسط التكلفة WAC',
                        'إجمالي التكلفة',
                        'سعر البيع',
                        'إجمالي القيمة البيعية',
                        'الربح المتوقع',
                        'هامش الربح %',
                      ],
                      valuation.data.rows.map((r) => [
                        r.sku,
                        r.name,
                        r.category,
                        r.quantity,
                        r.unit,
                        r.unit_cost / 100,
                        r.total_cost / 100,
                        r.sale_price / 100,
                        r.total_retail / 100,
                        r.potential_profit / 100,
                        r.margin_percent + '%',
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
            <Download size={16} /> تصدير{' '}
            {tab === 'levels' ? 'المخزون' : tab === 'valuation' ? 'تقييم المخزون' : 'الحركات'}
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
            {can(user, 'inventory:view') && (
              <button
                className={tab === 'valuation' ? 'active' : ''}
                onClick={() => setTab('valuation')}
              >
                تقييم المخزون (WAC والمطابقة)
              </button>
            )}
            <button className={tab === 'batches' ? 'active' : ''} onClick={() => setTab('batches')}>
              التشغيلات والصلاحيات (FEFO)
            </button>
            <button
              className={tab === 'locations' ? 'active' : ''}
              onClick={() => setTab('locations')}
            >
              أماكن التخزين (Bins & Racks)
            </button>
            <button
              className={tab === 'movements' ? 'active' : ''}
              onClick={() => setTab('movements')}
            >
              سجل الحركات
            </button>
            {can(user, 'inventory:view') && (
              <button
                className={tab === 'cost_movements' ? 'active' : ''}
                onClick={() => setTab('cost_movements')}
              >
                سجل حركات التكلفة (WAC)
              </button>
            )}
            {can(user, 'inventory:view') && (
              <button
                className={tab === 'reorder' ? 'active' : ''}
                onClick={() => setTab('reorder')}
              >
                اقتراحات إعادة الطلب
              </button>
            )}
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
        ) : tab === 'valuation' ? (
          <StockValuationView
            data={valuation}
            query={query}
            category={valCategory}
            stockFilter={valStockFilter}
            onCategoryChange={setValCategory}
            onStockFilterChange={setValStockFilter}
            page={page}
            setPage={setPage}
            onInspectCost={setCostHistoryProduct}
          />
        ) : tab === 'batches' ? (
          <BatchesExpiryView activeId={activeId} isGroup={isGroup} query={query} />
        ) : tab === 'locations' ? (
          <WarehouseLocationsView activeId={activeId} query={query} />
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
                        {can(user, 'inventory:adjust') && <th>تسوية</th>}
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
                            {money(p.stock * (p.avg_cost ?? p.cost_price))} <small>ج.م</small>
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
                          {can(user, 'inventory:adjust') && (
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
        ) : tab === 'reorder' ? (
          <>
            {!reorder.data?.length ? (
              <Empty
                title="لا توجد أصناف تحتاج إعادة طلب"
                description="كل المنتجات أعلى من حد إعادة الطلب في هذا النطاق."
              />
            ) : (
              <>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>المنتج</th>
                        {isGroup && <th>الفرع</th>}
                        <th>المتاح</th>
                        <th>حد الطلب</th>
                        <th>الكمية المقترحة</th>
                        <th>التكلفة التقديرية</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reorder.data.map((r) => (
                        <tr key={r.branch_id + ':' + r.product_id}>
                          <td>
                            <strong>{r.name}</strong>
                            <small className="cell-sub num">{r.sku}</small>
                          </td>
                          {isGroup && <td>{r.branch_name}</td>}
                          <td className="num amount">
                            {r.stock} <small>{r.unit}</small>
                          </td>
                          <td className="num muted">{r.min_stock}</td>
                          <td className="num amount">
                            <strong>{r.suggested_qty}</strong>
                          </td>
                          <td className="num amount">
                            {money(r.estimated_cost)} <small>ج.م</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="table-bottom-note">
                  الاقتراح يرفع المخزون إلى ضعف حد إعادة الطلب. التكلفة التقديرية بالمتوسط المرجح
                  للفرع.
                </p>
              </>
            )}
          </>
        ) : tab === 'cost_movements' ? (
          <>
            {!costMoves.length ? (
              <Empty />
            ) : (
              <>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>المنتج</th>
                        {isGroup && <th>الفرع</th>}
                        <th>التغير</th>
                        <th>تكلفة الحركة</th>
                        <th>المتوسط قبل</th>
                        <th>المتوسط بعد</th>
                        <th>السبب</th>
                        <th>بواسطة</th>
                        <th>تاريخ التسجيل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {costMoves.slice((page - 1) * 8, page * 8).map((cm) => (
                        <tr key={cm.id}>
                          <td>
                            <strong>{cm.product_name}</strong>
                            <small className="cell-sub num">{cm.sku}</small>
                          </td>
                          {isGroup && <td>{cm.branch_name}</td>}
                          <td>
                            <span
                              className={
                                'movement-amount ' + (cm.delta_qty > 0 ? 'positive' : 'negative')
                              }
                              dir="ltr"
                            >
                              {cm.delta_qty > 0 ? '+' : ''}
                              {cm.delta_qty}
                            </span>
                          </td>
                          <td className="num">{money(cm.unit_cost, 2)}</td>
                          <td className="num muted">{money(cm.avg_before, 2)}</td>
                          <td className="num amount">
                            <strong>{money(cm.avg_after, 2)}</strong>
                          </td>
                          <td>{cm.reason}</td>
                          <td>{cm.user_name}</td>
                          <td className="muted">{formatDate(cm.created_at, true)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={page} setPage={setPage} total={costMoves.length} />
                <p className="table-bottom-note">
                  سجل تطور التكلفة المتوسطة المرجحة (WAC) مع كل حركة شراء أو بيع أو تحويل أو تسوية.
                </p>
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
      {costHistoryProduct && (
        <CostHistoryModal
          product={costHistoryProduct}
          branchId={activeId}
          onClose={() => setCostHistoryProduct(null)}
        />
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
  const editable = customer
    ? can(user, 'parties:manage')
    : can(user, 'parties:manage') && can(user, 'documents:create_purchase');
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
                          {editable && (
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
