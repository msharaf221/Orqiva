import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Download,
  ReceiptText,
  Wallet,
  Clock3,
  ArrowLeft,
  ArrowRight,
  Trash2,
  Save,
  Check,
  Printer,
  Pencil,
  Ban,
  CreditCard,
  Package,
  CircleCheck,
  FileText,
  RotateCcw,
} from 'lucide-react';
import {
  api,
  useData,
  useSession,
  useAction,
  useToast,
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
  toCents,
  today,
  dayOffset,
  formatDate,
  Status,
  downloadCSV,
  methods,
} from '../lib';
import { GROUP, useBranch, withBranch } from '../branch';
import type { Document, DocType, Product, Party, ReturnableLine, CashAccount } from '../types';
import { can } from '../auth';
import {
  BarcodeSvg,
  QrCodeSvg,
  StatusStamp,
  triggerThermalPrint,
  generateInvoiceQrData,
  ThermalReceiptPaper,
} from '../receipt-components';
export function Documents({ type }: { type: DocType }) {
  const sale = type === 'SALE';
  const path = sale ? '/sales' : '/purchases';
  const returnType: DocType = sale ? 'SALE_RETURN' : 'PURCHASE_RETURN';
  const { user } = useSession();
  const [params] = useSearchParams();
  const { activeId, isGroup } = useBranch();
  const [kind, setKind] = useState<'invoices' | 'returns'>('invoices');
  const currentType = kind === 'returns' ? returnType : type;
  const data = useData<Document[]>(withBranch('/documents?type=' + currentType, activeId));
  const [query, setQuery] = useState(''),
    [status, setStatus] = useState(params.get('status') || 'all'),
    [page, setPage] = useState(1);
  const allowed = sale ? can(user, 'documents:view') : can(user, 'documents:create_purchase');
  useEffect(() => setStatus(params.get('status') || 'all'), [params]);
  useEffect(() => setPage(1), [query, status, kind]);
  const documents = data.data || [];
  const posted = documents.filter((d) => d.status === 'POSTED');
  const filtered = documents.filter((d) => {
    const text = (
      d.number +
      ' ' +
      d.party_name +
      (d.original_document_number ? ' ' + d.original_document_number : '')
    ).toLowerCase();
    if (!text.includes(query.toLowerCase())) return false;
    if (status === 'all') return true;
    if (status === 'draft') return d.status === 'DRAFT';
    if (status === 'cancelled') return d.status === 'CANCELLED';
    if (kind === 'returns') {
      if (status === 'posted') return d.status === 'POSTED';
      return true;
    }
    if (status === 'paid') return d.status === 'POSTED' && d.paid >= d.total;
    if (status === 'unpaid') return d.status === 'POSTED' && d.paid < d.total;
    if (status === 'overdue')
      return d.status === 'POSTED' && d.paid < d.total && d.due_date < today();
    return true;
  });
  return (
    <>
      <PageHeader
        eyebrow={
          kind === 'returns'
            ? sale
              ? 'إدارة المرتجعات وإشعارات الدائن'
              : 'إدارة مرتجعات المشتريات وإشعارات المدين'
            : sale
              ? 'من أول فاتورة، إلى النمو'
              : 'توريدات تدعم أعمالك'
        }
        title={
          kind === 'returns'
            ? sale
              ? 'مرتجعات المبيعات (إشعارات دائن)'
              : 'مرتجعات المشتريات (إشعارات مدين)'
            : sale
              ? 'فواتير المبيعات'
              : 'فواتير المشتريات'
        }
        description={
          kind === 'returns'
            ? sale
              ? 'سجل المرتجعات الصادرة للعملاء مع تسوية أرصدة الحسابات وتحديث المخزون وتكلفة البضاعة المباعة.'
              : 'سجل مرتجعات المشتريات للموردين واسترداد قيمتها وتخفيض المخزون.'
            : sale
              ? 'أنشئ فواتيرك، تابع التحصيل، وحافظ على وضوح حساباتك.'
              : 'أدر مشترياتك ومستحقات الموردين، مع تحديث المخزون تلقائياً.'
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                downloadCSV(
                  kind === 'returns'
                    ? sale
                      ? 'مرتجعات-المبيعات'
                      : 'مرتجعات-المشتريات'
                    : sale
                      ? 'المبيعات'
                      : 'المشتريات',
                  kind === 'returns'
                    ? [
                        'رقم الإشعار',
                        'الفاتورة الأصلية',
                        sale ? 'العميل' : 'المورد',
                        'التاريخ',
                        'الحالة',
                        'الإجمالي',
                      ]
                    : [
                        'رقم الفاتورة',
                        sale ? 'العميل' : 'المورد',
                        'التاريخ',
                        'الاستحقاق',
                        'الحالة',
                        'الإجمالي',
                        'المدفوع',
                        'المستحق',
                      ],
                  filtered.map((d) =>
                    kind === 'returns'
                      ? [
                          d.number,
                          d.original_document_number || '—',
                          d.party_name,
                          d.date,
                          d.status,
                          d.total / 100,
                        ]
                      : [
                          d.number,
                          d.party_name,
                          d.date,
                          d.due_date,
                          d.status,
                          d.total / 100,
                          d.paid / 100,
                          d.status === 'POSTED' ? (d.total - d.paid) / 100 : 0,
                        ],
                  ),
                )
              }
            >
              <Download size={16} /> تصدير
            </Button>
            {kind === 'invoices' && allowed && (
              <Link to={path + '/new'} className="btn btn-primary">
                <Plus size={18} /> فاتورة جديدة
              </Link>
            )}
          </>
        }
      />
      <div className="stats-grid three">
        {kind === 'returns' ? (
          <>
            <Stat
              label={sale ? 'إجمالي إشعارات الدائن المعتمدة' : 'إجمالي إشعارات المدين المعتمدة'}
              value={money(posted.reduce((s, d) => s + d.total, 0))}
              icon={<RotateCcw size={20} />}
              foot="إجمالي قيمة المرتجعات شامل الضريبة"
            />
            <Stat
              label="الإشعارات المعتمدة"
              value={posted.length.toString()}
              icon={<ReceiptText size={20} />}
              tone="blue"
              foot="مرتجعات مسجلة في المخزون والحسابات"
            />
            <Stat
              label="مسودات قيد المراجعة"
              value={documents.filter((d) => d.status === 'DRAFT').length.toString()}
              icon={<Clock3 size={20} />}
              tone="amber"
              foot="إشعارات بانتظار الاعتماد"
            />
          </>
        ) : (
          <>
            <Stat
              label={sale ? 'إجمالي المبيعات المعتمدة' : 'إجمالي المشتريات المعتمدة'}
              value={money(posted.reduce((s, d) => s + d.total, 0))}
              icon={<ReceiptText size={20} />}
              foot="جميع الفترات · شامل الضريبة"
            />
            <Stat
              label={sale ? 'المبالغ المحصّلة' : 'المبالغ المسدّدة'}
              value={money(posted.reduce((s, d) => s + d.paid, 0))}
              icon={<Wallet size={20} />}
              tone="blue"
              foot="الدفعات المسجلة على الفواتير"
            />
            <Stat
              label="الرصيد المستحق"
              value={money(posted.reduce((s, d) => s + d.total - d.paid, 0))}
              icon={<Clock3 size={20} />}
              tone="amber"
              foot="فواتير معتمدة بانتظار التسوية"
            />
          </>
        )}
      </div>
      <section className="card">
        <div className="table-toolbar">
          <div className="tabs">
            <button
              className={kind === 'invoices' ? 'active' : ''}
              onClick={() => {
                setKind('invoices');
                setStatus('all');
              }}
            >
              {sale ? 'فواتير المبيعات' : 'فواتير المشتريات'}
            </button>
            <button
              className={kind === 'returns' ? 'active' : ''}
              onClick={() => {
                setKind('returns');
                setStatus('all');
              }}
            >
              <RotateCcw size={13} />
              {sale ? 'مرتجعات المبيعات (إشعارات دائن)' : 'مرتجعات المشتريات (إشعارات مدين)'}
            </button>
          </div>
          <div className="table-filters">
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder={
                kind === 'returns'
                  ? 'بحث برقم الإشعار أو الفاتورة أو الطرف...'
                  : 'بحث برقم الفاتورة أو الحساب...'
              }
            />
            <select
              className="filter-select"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="حالة المستند"
            >
              <option value="all">كل الحالات</option>
              <option value="draft">مسودة</option>
              {kind === 'returns' ? (
                <option value="posted">معتمد</option>
              ) : (
                <>
                  <option value="paid">مدفوعة</option>
                  <option value="unpaid">غير مسددة</option>
                  <option value="overdue">متأخرة</option>
                </>
              )}
              <option value="cancelled">ملغاة</option>
            </select>
          </div>
        </div>
        {data.error ? (
          <ErrorState message={data.error} retry={data.reload} />
        ) : data.loading ? (
          <Loading />
        ) : !filtered.length ? (
          <Empty
            title={kind === 'returns' ? 'لا توجد إشعارات مرتجع' : undefined}
            description={
              kind === 'returns'
                ? sale
                  ? 'يتم إصدار إشعار دائن من داخل تفاصيل أي فاتورة مبيعات معتمدة.'
                  : 'يتم إصدار إشعار مدين من داخل تفاصيل أي فاتورة مشتريات معتمدة.'
                : undefined
            }
            action={
              kind === 'invoices' && allowed ? (
                <Link to={path + '/new'} className="btn btn-primary">
                  <Plus size={16} /> إنشاء فاتورة
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{kind === 'returns' ? 'رقم الإشعار' : 'رقم الفاتورة'}</th>
                    {kind === 'returns' && <th>الفاتورة الأصلية</th>}
                    <th>{sale ? 'العميل' : 'المورد'}</th>
                    <th>التاريخ</th>
                    {kind === 'invoices' && <th>الاستحقاق</th>}
                    <th>{kind === 'returns' ? 'قيمة المرتجع' : 'الإجمالي'}</th>
                    {kind === 'invoices' && <th>المتبقي</th>}
                    <th>الحالة</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice((page - 1) * 8, page * 8).map((d, i) => (
                    <tr key={d.id}>
                      <td>
                        <Link className="invoice-number num" to={path + '/' + d.id}>
                          {d.number}
                        </Link>
                      </td>
                      {kind === 'returns' && (
                        <td>
                          {d.original_document_id ? (
                            <Link
                              className="num"
                              style={{ textDecoration: 'underline' }}
                              to={path + '/' + d.original_document_id}
                            >
                              {d.original_document_number || 'الفاتورة الأصلية'}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                      )}
                      <td>
                        <div className="person-cell">
                          <Initials name={d.party_name} tone={i} />
                          <span>
                            {d.party_name}
                            {isGroup && <small className="cell-sub">{d.branch_name}</small>}
                          </span>
                        </div>
                      </td>
                      <td className="muted no-wrap">{formatDate(d.date, true)}</td>
                      {kind === 'invoices' && (
                        <td className="muted no-wrap">{formatDate(d.due_date, true)}</td>
                      )}
                      <td className="num amount">{money(d.total, 2)}</td>
                      {kind === 'invoices' && (
                        <td className="num muted">
                          {d.status === 'POSTED' ? money(d.total - d.paid, 2) : '—'}
                        </td>
                      )}
                      <td>
                        <Status doc={d} />
                      </td>
                      <td>
                        <Link className="btn-small" to={path + '/' + d.id}>
                          التفاصيل <ArrowLeft size={13} />
                        </Link>
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
    </>
  );
}
export function DocumentEditor({ type }: { type: DocType }) {
  const { id } = useParams();
  return id ? <EditLoader type={type} id={id} /> : <Editor type={type} />;
}
function EditLoader({ type, id }: { type: DocType; id: string }) {
  const data = useData<Document>('/documents/' + id);
  if (data.error) return <ErrorState message={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  if (data.data.type !== type || data.data.status !== 'DRAFT')
    return (
      <Empty
        title="لا يمكن تعديل هذه الفاتورة"
        description="التعديل متاح للمسودات فقط."
        action={
          <Link
            className="btn btn-secondary"
            to={(data.data.type === 'SALE' ? '/sales/' : '/purchases/') + id}
          >
            العودة للفاتورة
          </Link>
        }
      />
    );
  return <Editor key={id} type={type} existing={data.data} />;
}
type EditorLine = { key: string; product_id: string; quantity: string; price: string };
function Editor({ type, existing }: { type: DocType; existing?: Document }) {
  const sale = type === 'SALE';
  const path = sale ? '/sales' : '/purchases';
  const { company, user } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const { busy, act } = useAction();
  const { activeId, branches, defaultBranchId } = useBranch();
  const [branchId, setBranchId] = useState(
    existing?.branch_id ?? (activeId !== GROUP ? activeId : defaultBranchId),
  );
  const products = useData<Product[]>(withBranch('/products', branchId)),
    parties = useData<Party[]>('/parties?type=' + (sale ? 'CUSTOMER' : 'SUPPLIER'));
  const [lines, setLines] = useState<EditorLine[]>(
    existing?.lines?.map((l) => ({
      key: l.id,
      product_id: l.product_id,
      quantity: String(l.quantity),
      price: String(l.unit_price / 100),
    })) || [{ key: crypto.randomUUID(), product_id: '', quantity: '1', price: '0' }],
  );
  const [taxRate, setTaxRate] = useState(
      String((existing?.tax_rate ?? company?.tax_rate ?? 1400) / 100),
    ),
    [discount, setDiscount] = useState(String((existing?.discount || 0) / 100));
  useEffect(() => {
    if (!existing && company) setTaxRate(String(company.tax_rate / 100));
  }, [existing, company]);
  const subtotal = lines.reduce(
      (s, l) => s + Number(l.quantity) * Math.round(Number(l.price) * 100),
      0,
    ),
    discountCents = Math.round(Number(discount) * 100),
    tax = Math.round((Math.max(0, subtotal - discountCents) * Number(taxRate)) / 100),
    total = subtotal - discountCents + tax;
  const changeLine = (key: string, patch: Partial<EditorLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const changeBranch = (next: string) => {
    setBranchId(next);
    // Lines were priced and stocked for the previous branch; start them again for the new one.
    if (!existing)
      setLines([{ key: crypto.randomUUID(), product_id: '', quantity: '1', price: '0' }]);
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const publish = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'post';
    void act(async () => {
      const doc = await api<Document>(
        '/documents' + (existing ? '/' + existing.id : ''),
        existing ? 'PUT' : 'POST',
        {
          type,
          branch_id: branchId,
          party_id: form.get('party_id'),
          date: form.get('date'),
          due_date: form.get('due_date'),
          notes: form.get('notes'),
          discount: discountCents,
          tax_rate: Math.round(Number(taxRate) * 100),
          lines: lines.map((l) => ({
            product_id: l.product_id,
            quantity: Number(l.quantity),
            unit_price: Math.round(Number(l.price) * 100),
          })),
        },
      );
      if (publish) {
        try {
          await api('/documents/' + doc.id + '/post', 'POST');
          toast('تم حفظ واعتماد الفاتورة وتحديث المخزون');
        } catch (e) {
          navigate(path + '/' + doc.id);
          throw new Error(
            'تم حفظ المسودة، لكن تعذر اعتمادها: ' + (e instanceof Error ? e.message : ''),
          );
        }
      } else toast('تم حفظ الفاتورة كمسودة');
      navigate(path + '/' + doc.id);
    });
  };
  if (!sale && !can(user, 'documents:create_purchase'))
    return <Empty title="هذه الصفحة متاحة لمدير النظام أو من لديه صلاحية المشتريات" />;
  if (products.error || parties.error)
    return (
      <ErrorState
        message={products.error || parties.error}
        retry={() => {
          products.reload();
          parties.reload();
        }}
      />
    );
  if (products.loading || parties.loading) return <Loading />;
  return (
    <>
      <PageHeader
        eyebrow={sale ? 'المبيعات / فاتورة' : 'المشتريات / فاتورة'}
        title={
          existing
            ? 'تعديل ' + existing.number
            : sale
              ? 'فاتورة مبيعات جديدة'
              : 'فاتورة مشتريات جديدة'
        }
        description="املأ التفاصيل واحفظ مسودة، أو اعتمد الفاتورة لتحديث سجلاتك."
        actions={
          <Link to={existing ? path + '/' + existing.id : path} className="btn btn-secondary">
            <ArrowRight size={16} /> رجوع
          </Link>
        }
      />
      <form onSubmit={submit} className="document-editor">
        <div className="editor-main">
          <section className="card form-card">
            <div className="card-heading">
              <h2>
                <FileText size={18} /> بيانات الفاتورة
              </h2>
              <span className="badge draft">
                <i /> مسودة
              </span>
            </div>
            <div className="form-card-body">
              <div className="form-row">
                <Field
                  label="الفرع *"
                  hint={
                    sale
                      ? 'تُسحب البضاعة من مخزون هذا الفرع، ولا تُباع فيه إلا المنتجات المتاحة له.'
                      : 'تُستلم البضاعة في مخزون هذا الفرع.'
                  }
                >
                  <select
                    required
                    value={branchId}
                    onChange={(e) => changeBranch(e.target.value)}
                    aria-label="فرع الفاتورة"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="form-row">
                <Field label={sale ? 'العميل *' : 'المورد *'}>
                  <select required name="party_id" defaultValue={existing?.party_id || ''}>
                    <option value="" disabled>
                      اختر {sale ? 'العميل' : 'المورد'}
                    </option>
                    {parties.data
                      ?.filter((p) => p.active)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="رقم الفاتورة">
                  <input
                    disabled
                    value={existing?.number || 'يُنشأ تلقائياً عند الحفظ'}
                    dir={existing ? 'ltr' : 'rtl'}
                  />
                </Field>
              </div>
              <div className="form-row">
                <Field label="تاريخ الفاتورة *">
                  <input
                    type="date"
                    name="date"
                    required
                    defaultValue={existing?.date || today()}
                  />
                </Field>
                <Field label="تاريخ الاستحقاق *">
                  <input
                    type="date"
                    name="due_date"
                    required
                    defaultValue={existing?.due_date || dayOffset(14)}
                  />
                </Field>
              </div>
              {!parties.data?.some((p) => p.active) && (
                <div className="warning-banner">
                  أضف {sale ? 'عميلاً' : 'مورداً'} أولاً من{' '}
                  <Link to={sale ? '/customers' : '/suppliers'}>صفحة الحسابات</Link>.
                </div>
              )}
            </div>
          </section>
          <section className="card editor-lines">
            <div className="card-heading">
              <div>
                <h2>
                  <Package size={18} /> بنود الفاتورة
                </h2>
                <p>أسعار الوحدات بالجنيه المصري، قبل الضريبة</p>
              </div>
              <span className="count-chip num">{lines.length} بنود</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th className="line-product">المنتج</th>
                    <th>الكمية</th>
                    <th>سعر الوحدة</th>
                    <th>الإجمالي</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const product = products.data?.find((p) => p.id === line.product_id);
                    return (
                      <tr key={line.key}>
                        <td>
                          <select
                            aria-label="المنتج"
                            required
                            value={line.product_id}
                            onChange={(e) => {
                              const p = products.data?.find((p) => p.id === e.target.value);
                              changeLine(line.key, {
                                product_id: e.target.value,
                                price: String(
                                  (sale ? p?.sale_price || 0 : p?.cost_price || 0) / 100,
                                ),
                              });
                            }}
                          >
                            <option value="" disabled>
                              اختر منتجاً
                            </option>
                            {products.data
                              ?.filter((p) => p.active && p.available)
                              .map((p) => (
                                <option
                                  key={p.id}
                                  value={p.id}
                                  disabled={lines.some(
                                    (l) => l.product_id === p.id && l.key !== line.key,
                                  )}
                                >
                                  {p.name}
                                </option>
                              ))}
                          </select>
                          {product && (
                            <small
                              className={
                                'cell-sub ' +
                                (sale && Number(line.quantity) > product.stock
                                  ? 'negative'
                                  : 'muted')
                              }
                            >
                              المتاح: {product.stock} {product.unit} · {product.sku}
                            </small>
                          )}
                        </td>
                        <td>
                          <input
                            aria-label="الكمية"
                            required
                            type="number"
                            min="1"
                            max="1000000"
                            value={line.quantity}
                            onChange={(e) => changeLine(line.key, { quantity: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            aria-label="سعر الوحدة"
                            required
                            type="number"
                            step=".01"
                            min="0"
                            max="10000000"
                            value={line.price}
                            onChange={(e) => changeLine(line.key, { price: e.target.value })}
                          />
                        </td>
                        <td className="num amount">
                          {money(Number(line.quantity) * Math.round(Number(line.price) * 100), 2)}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="icon-btn danger-text"
                            disabled={lines.length <= 1}
                            onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                            aria-label="حذف البند"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="add-line">
              <button
                type="button"
                className="text-link"
                disabled={lines.length >= 100}
                onClick={() =>
                  setLines((ls) => [
                    ...ls,
                    { key: crypto.randomUUID(), product_id: '', quantity: '1', price: '0' },
                  ])
                }
              >
                <Plus size={17} /> إضافة بند جديد
              </button>
            </div>
          </section>
          <section className="card form-card">
            <div className="form-card-body">
              <Field label="ملاحظات الفاتورة">
                <textarea
                  name="notes"
                  maxLength={2000}
                  defaultValue={existing?.notes}
                  placeholder="شروط الدفع أو أي تفاصيل إضافية..."
                  rows={3}
                />
              </Field>
            </div>
          </section>
        </div>
        <aside className="editor-summary card">
          <div className="card-heading">
            <h2>ملخص الفاتورة</h2>
          </div>
          <div className="summary-body">
            <div className="summary-row">
              <span>الإجمالي قبل الضريبة</span>
              <strong className="num">{money(subtotal, 2)}</strong>
            </div>
            <Field label="الخصم (ج.م)">
              <input
                type="number"
                min="0"
                max={subtotal / 100}
                step=".01"
                required
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </Field>
            <Field label="ضريبة القيمة المضافة (%)">
              <input
                type="number"
                min="0"
                max="100"
                step=".01"
                required
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
              />
            </Field>
            <div className="summary-row">
              <span>قيمة الضريبة</span>
              <span className="num">{money(tax, 2)}</span>
            </div>
            <div className="summary-total">
              <span>الإجمالي المستحق</span>
              <strong className="num">
                {money(total, 2)} <small>ج.م</small>
              </strong>
            </div>
            <Button type="submit" value="post" busy={busy}>
              <Check size={18} /> حفظ واعتماد الفاتورة
            </Button>
            <Button type="submit" variant="secondary" value="draft" busy={busy}>
              <Save size={16} /> حفظ كمسودة
            </Button>
            <p className="summary-hint">
              <CircleCheck size={15} />{' '}
              {sale
                ? 'اعتماد الفاتورة يخصم الكميات من المخزون.'
                : 'اعتماد الفاتورة يضيف الكميات إلى المخزون.'}{' '}
              المسودة لا تؤثر على الحسابات.
            </p>
          </div>
        </aside>
      </form>
    </>
  );
}
export function DocumentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { company, user } = useSession();
  const data = useData<Document>('/documents/' + id);
  const { busy, act } = useAction();
  const [confirm, setConfirm] = useState<'post' | 'cancel' | null>(null),
    [payment, setPayment] = useState(false),
    [returnModal, setReturnModal] = useState(false),
    [thermalModal, setThermalModal] = useState(false);
  const doc = data.data;

  const isSale = doc ? doc.type === 'SALE' || doc.type === 'SALE_RETURN' : true;
  const isReturn = doc ? doc.type === 'SALE_RETURN' || doc.type === 'PURCHASE_RETURN' : false;
  const path = isSale ? '/sales' : '/purchases';
  const editable = isSale
    ? can(user, 'documents:create_sale')
    : can(user, 'documents:create_purchase');

  const linkedReturnsData = useData<Document[]>(
    doc && !isReturn ? '/documents?original_document_id=' + doc.id : null,
  );
  const linkedReturns = linkedReturnsData.data || [];

  if (data.error) return <ErrorState message={data.error} retry={data.reload} />;
  if (!doc || data.loading) return <Loading />;

  const statusKey =
    doc.status === 'DRAFT'
      ? 'draft'
      : doc.status === 'CANCELLED'
        ? 'cancelled'
        : isReturn
          ? 'paid'
          : doc.paid >= doc.total
            ? 'paid'
            : doc.due_date < today()
              ? 'overdue'
              : doc.paid > 0
                ? 'partial'
                : 'pending';

  const qrData = generateInvoiceQrData({
    sellerName: company?.name || 'مؤسسة أوركيفا',
    taxNumber: company?.tax_number,
    invoiceNumber: doc.number,
    invoiceDate: doc.date,
    total: doc.total,
    tax: doc.tax,
  });

  const docTypeLabel =
    doc.type === 'SALE'
      ? 'فاتورة مبيعات'
      : doc.type === 'PURCHASE'
        ? 'فاتورة مشتريات'
        : doc.type === 'SALE_RETURN'
          ? 'إشعار دائن (مرتجع مبيعات)'
          : 'إشعار مدين (مرتجع مشتريات)';

  const eyebrow = isSale
    ? isReturn
      ? 'المبيعات / إشعار دائن'
      : 'المبيعات / تفاصيل الفاتورة'
    : isReturn
      ? 'المشتريات / إشعار مدين'
      : 'المشتريات / تفاصيل الفاتورة';

  return (
    <>
      <div className="no-print">
        <PageHeader
          eyebrow={eyebrow}
          title={doc.number}
          description={`${docTypeLabel} · ${doc.party_name}`}
          actions={
            <>
              <Link className="btn btn-secondary" to={path}>
                <ArrowRight size={16} /> رجوع
              </Link>
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer size={16} /> طباعة A4
              </Button>
              {isSale && !isReturn && (
                <Button variant="secondary" onClick={() => setThermalModal(true)}>
                  <ReceiptText size={16} /> إيصال حراري (POS)
                </Button>
              )}
              {isReturn && doc.original_document_id && (
                <Link to={path + '/' + doc.original_document_id} className="btn btn-secondary">
                  <ArrowRight size={16} /> الفاتورة الأصلية ({doc.original_document_number})
                </Link>
              )}
              {doc.status === 'DRAFT' && editable && (
                <>
                  {!isReturn && (
                    <Link to={path + '/' + doc.id + '/edit'} className="btn btn-secondary">
                      <Pencil size={16} /> تعديل
                    </Link>
                  )}
                  <Button onClick={() => setConfirm('post')}>
                    <Check size={17} /> {isReturn ? 'اعتماد المرتجع' : 'اعتماد الفاتورة'}
                  </Button>
                </>
              )}
              {!isReturn && doc.status === 'POSTED' && editable && (
                <Button variant="secondary" onClick={() => setReturnModal(true)}>
                  <RotateCcw size={16} /> إصدار مرتجع
                </Button>
              )}
              {!isReturn && doc.status === 'POSTED' && doc.paid < doc.total && editable && (
                <Button onClick={() => setPayment(true)}>
                  <Plus size={17} /> تسجيل دفعة
                </Button>
              )}
            </>
          }
        />
        {doc.status === 'DRAFT' && (
          <div className="info-banner document-info">
            <FileText size={19} />
            <span>
              {isReturn
                ? 'هذا الإشعار مسودة. لن يتم تعديل المخزون أو تسوية الحساب حتى يتم اعتماده.'
                : 'هذه الفاتورة مسودة. لم يتم تحديث المخزون أو احتساب أي مستحقات بعد.'}
            </span>
          </div>
        )}
        {isReturn && (
          <div className="info-banner document-info" style={{ borderColor: 'var(--border)' }}>
            <RotateCcw size={19} />
            <span>
              مرتجع مرتبط بالفاتورة رقم{' '}
              <Link
                to={path + '/' + doc.original_document_id}
                style={{ fontWeight: 600, textDecoration: 'underline' }}
              >
                {doc.original_document_number || 'الفاتورة الأصلية'}
              </Link>{' '}
              —{' '}
              {doc.type === 'SALE_RETURN'
                ? 'إشعار دائن يخفض رصيد العميل ويعيد البضاعة للمخزون بتكلفة COGS الأصلية.'
                : 'إشعار مدين يخفض رصيد المورد ويسحب البضاعة من المخزون بسعر الشراء الأصلي.'}
            </span>
          </div>
        )}
        {!isReturn && linkedReturns.length > 0 && (
          <div
            className="card linked-returns-card no-print"
            style={{ marginBottom: '1.25rem', padding: '1rem' }}
          >
            <div className="card-heading" style={{ marginBottom: '0.75rem' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                <RotateCcw size={16} /> المرتجعات الصادرة عن هذه الفاتورة ({linkedReturns.length})
              </h3>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>رقم الإشعار</th>
                    <th>التاريخ</th>
                    <th>قيمة المرتجع</th>
                    <th>الحالة</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {linkedReturns.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link className="invoice-number num" to={path + '/' + r.id}>
                          {r.number}
                        </Link>
                      </td>
                      <td className="muted">{formatDate(r.date, true)}</td>
                      <td className="num amount">{money(r.total, 2)}</td>
                      <td>
                        <Status doc={r} />
                      </td>
                      <td>
                        <Link className="btn-small" to={path + '/' + r.id}>
                          عرض الإشعار <ArrowLeft size={13} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <div className="document-detail-grid">
        <section className="card invoice-paper" id="invoice-print">
          <div className="invoice-header">
            <div className="invoice-header-company">
              <div className="invoice-brand" dir="ltr">
                orqiva<span>.</span>
              </div>
              <h2>{company?.name}</h2>
              <p>{company?.address}</p>
              <p dir="ltr">
                {company?.phone} {company?.email ? `· ${company.email}` : ''}
              </p>
              {company?.tax_number && (
                <p className="tax-id-line">الرقم الضريبي: {company.tax_number}</p>
              )}
            </div>

            <div className="invoice-header-center">
              <StatusStamp status={statusKey} isReturn={isReturn} date={formatDate(doc.date)} />
            </div>

            <div className="invoice-title">
              <div className="invoice-qr-corner">
                <QrCodeSvg value={qrData} size={84} />
              </div>
              <span>{docTypeLabel}</span>
              <h2 className="num">{doc.number}</h2>
              <Status doc={doc} />
              {doc.original_document_number && (
                <div className="muted cell-sub" style={{ marginTop: '4px', fontSize: '11px' }}>
                  عن الفاتورة: <strong>{doc.original_document_number}</strong>
                </div>
              )}
            </div>
          </div>

          <div className="invoice-parties">
            <div className="party-box">
              <span className="eyebrow">
                {isSale
                  ? isReturn
                    ? 'إشعار دائن إلى'
                    : 'فاتورة إلى (العميل)'
                  : isReturn
                    ? 'إشعار مدين إلى'
                    : 'فاتورة من (المورد)'}
              </span>
              <h3>{doc.party_name}</h3>
              <p>{doc.party_address || '—'}</p>
              <p dir="ltr">{doc.party_phone || '—'}</p>
              {doc.party_tax_number && <p>الرقم الضريبي: {doc.party_tax_number}</p>}
              <p className="branch-tag">الفرع المُصدر: {doc.branch_name}</p>
            </div>
            <div className="invoice-dates">
              <div>
                <span>{isReturn ? 'تاريخ الإشعار' : 'تاريخ الفاتورة'}</span>
                <strong>{formatDate(doc.date)}</strong>
              </div>
              {!isReturn && (
                <div>
                  <span>تاريخ الاستحقاق</span>
                  <strong>{formatDate(doc.due_date)}</strong>
                </div>
              )}
              {isReturn && doc.original_document_number && (
                <div>
                  <span>الفاتورة الأصلية</span>
                  <strong className="num">{doc.original_document_number}</strong>
                </div>
              )}
              <div>
                <span>العملة المعتمدة</span>
                <strong>جنيه مصري (EGP)</strong>
              </div>
              <div>
                <span>حالة التحصيل</span>
                <strong className={doc.paid >= doc.total ? 'text-green' : 'text-amber'}>
                  {doc.paid >= doc.total
                    ? 'مدفوعة بالكامل'
                    : doc.paid > 0
                      ? 'مدفوعة جزئياً'
                      : 'مستحقة السداد'}
                </strong>
              </div>
            </div>
          </div>

          <div className="table-scroll">
            <table className="invoice-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الوصف والمنتج</th>
                  <th>{isReturn ? 'الكمية المرتجعة' : 'الكمية'}</th>
                  <th>سعر الوحدة</th>
                  <th>الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {doc.lines?.map((l, i) => (
                  <tr key={l.id}>
                    <td className="num muted">{i + 1}</td>
                    <td>
                      <strong>{l.name}</strong>
                      {l.sku && <small className="cell-sub num">{l.sku}</small>}
                    </td>
                    <td className="num">{l.quantity}</td>
                    <td className="num">{money(l.unit_price, 2)}</td>
                    <td className="num amount">{money(l.total, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="invoice-bottom">
            <div className="invoice-notes">
              <h4>الشروط والملاحظات</h4>
              <p>
                {doc.notes ||
                  company?.invoice_note ||
                  'شكراً لتعاملكم معنا. تسري على هذه الفاتورة الشروط والأحكام المعتمدة.'}
              </p>
              {doc.notes && company?.invoice_note && <p>{company.invoice_note}</p>}
              <div className="invoice-guarantee-note">
                البضاعة المباعة ترد وتستبدل خلال 14 يوماً وفقاً لقانون حماية المستهلك مع إحضار أصل
                الفاتورة بحالتها الأصلية.
              </div>
            </div>
            <div className="invoice-totals">
              <div>
                <span>الإجمالي قبل الضريبة</span>
                <strong className="num">{money(doc.subtotal, 2)}</strong>
              </div>
              {doc.discount > 0 && (
                <div className="invoice-discount-line">
                  <span>الخصم الممنوح</span>
                  <span className="num text-red">-{money(doc.discount, 2)}</span>
                </div>
              )}
              <div>
                <span>ضريبة القيمة المضافة ({doc.tax_rate / 100}%)</span>
                <span className="num">{money(doc.tax, 2)}</span>
              </div>
              <div className="grand-total">
                <span>{isReturn ? 'إجمالي المرتجع' : 'الإجمالي النهائي'}</span>
                <strong className="num">
                  {money(doc.total, 2)} <small>ج.م</small>
                </strong>
              </div>
              {!isReturn && (
                <>
                  <div>
                    <span>المبلغ المدفوع</span>
                    <span className="num font-semibold">{money(doc.paid, 2)}</span>
                  </div>
                  {doc.status === 'POSTED' && (
                    <div className="balance-row">
                      <span>المتبقي المستحق</span>
                      <strong className="num">
                        {money(doc.total - doc.paid, 2)} <small>ج.م</small>
                      </strong>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Official Signatures Row */}
          <div className="invoice-signatures-row">
            <div className="sig-block">
              <span>المحاسب المسئول</span>
              <div className="sig-space" />
              <small>التوقيع والاعتماد</small>
            </div>
            <div className="sig-block">
              <span>توقيع المستلم</span>
              <div className="sig-space" />
              <small>الاسم والتوقيع</small>
            </div>
            <div className="sig-block stamp-space-block">
              <span>ختم المنشأة الرسمي</span>
              <div className="sig-space stamp-box" />
            </div>
          </div>

          {/* Bottom Barcode & Signoff */}
          <div className="invoice-signoff">
            <div className="invoice-barcode-wrapper">
              <BarcodeSvg value={doc.number} height={34} fontSize={10} />
            </div>
            <span>
              {isReturn
                ? 'إشعار صادر ومعتمد من نظام أوركيفا السحابي'
                : 'فاتورة صادرة ومعتمدة من نظام أوركيفا السحابي'}
            </span>
            <small>وثيقة تجارية ومحاسبية مسجلة بالنظام</small>
          </div>
        </section>
        <aside className="document-side no-print">
          {!isReturn ? (
            <section className="card">
              <div className="card-heading">
                <h2>
                  <CreditCard size={18} /> سجل الدفعات
                </h2>
                <span className="count-chip num">{doc.payments?.length || 0}</span>
              </div>
              {doc.payments?.length ? (
                <div className="payment-list">
                  {doc.payments.map((p) => (
                    <div key={p.id} className="payment-item">
                      <div>
                        <span className="payment-check">
                          <Check size={15} />
                        </span>
                        <strong className="num">
                          {money(p.amount, 2)} <small>ج.م</small>
                        </strong>
                      </div>
                      <p>
                        {methods[p.method]} · {formatDate(p.date, true)}
                      </p>
                      {p.reference && <small>{p.reference}</small>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="side-empty">
                  <Wallet size={27} />
                  <p>لم تُسجّل دفعات بعد</p>
                  <span>ستظهر الدفعات هنا بعد تسجيلها.</span>
                </div>
              )}
            </section>
          ) : (
            <section className="card">
              <div className="card-heading">
                <h2>
                  <RotateCcw size={18} /> أثر الإشعار المحاسبي
                </h2>
              </div>
              <div
                style={{
                  fontSize: '12px',
                  lineHeight: 1.6,
                  color: 'var(--muted)',
                  padding: '4px 0',
                }}
              >
                {doc.status === 'POSTED' ? (
                  <p>
                    {isSale
                      ? `تم اعتماد هذا الإشعار وتخفيض مديونية العميل بمبلغ ${money(doc.total, 2)} وإعادة الأصناف إلى مخزون الفرع بتكلفة COGS الأصلية.`
                      : `تم اعتماد هذا الإشعار وتخفيض مستحقات المورد بمبلغ ${money(doc.total, 2)} وسحب الأصناف من مخزون الفرع بسعر الشراء الأصلي.`}
                  </p>
                ) : doc.status === 'CANCELLED' ? (
                  <p>هذا الإشعار ملغى ولا يؤثر على المخزون أو الحسابات.</p>
                ) : (
                  <p>هذا الإشعار مسودة. عند الاعتماد سيتم تعديل الحسابات والمخزون تلقائياً.</p>
                )}
              </div>
            </section>
          )}
          <section className="card detail-status">
            <h3>حالة المستند</h3>
            <Status doc={doc} />
            <p>
              {doc.status === 'DRAFT'
                ? isReturn
                  ? 'مسودة إشعار قابلة للمراجعة والاعتماد.'
                  : 'مسودة قابلة للتعديل.'
                : doc.status === 'CANCELLED'
                  ? 'هذا المستند ملغى ولا يؤثر على حساباتك.'
                  : isReturn
                    ? 'إشعار معتمد. تم تعديل المخزون ورصيد الحساب.'
                    : 'فاتورة معتمدة. تم تحديث المخزون وسجل المستحقات.'}
            </p>
            {can(user, 'documents:cancel') && doc.status !== 'CANCELLED' && (
              <>
                <div className="divider" />
                <Button
                  variant="ghost"
                  className="danger-text"
                  disabled={doc.paid > 0}
                  onClick={() => setConfirm('cancel')}
                >
                  <Ban size={16} /> {isReturn ? 'إلغاء الإشعار' : 'إلغاء الفاتورة'}
                </Button>
                {doc.paid > 0 && <small>لا يمكن إلغاء فاتورة لها دفعات مسجلة.</small>}
              </>
            )}
          </section>
        </aside>
      </div>
      {payment && (
        <PaymentForm
          doc={doc}
          onClose={() => setPayment(false)}
          onSaved={() => {
            setPayment(false);
            data.reload();
          }}
        />
      )}
      {returnModal && (
        <ReturnModal
          doc={doc}
          onClose={() => setReturnModal(false)}
          onCreated={(newDocId) => {
            setReturnModal(false);
            navigate(path + '/' + newDocId);
          }}
        />
      )}
      {confirm && (
        <Confirm
          title={
            confirm === 'post'
              ? isReturn
                ? 'اعتماد إشعار المرتجع'
                : 'اعتماد الفاتورة'
              : isReturn
                ? 'إلغاء إشعار المرتجع'
                : 'إلغاء الفاتورة'
          }
          description={
            confirm === 'post'
              ? isReturn
                ? `سيتم تثبيت إشعار المرتجع ${doc.number} وتعديل المخزون وحساب العميل/المورد. لن تتمكن من التراجع إلا بالإلغاء.`
                : `سيتم تثبيت الفاتورة ${doc.number} وتحديث المخزون. لن تتمكن من تعديلها بعد الاعتماد.`
              : 'سيتم إلغاء المستند وعكس حركة المخزون إن كان معتمداً. لا يمكن التراجع عن هذا الإجراء.'
          }
          busy={busy}
          onClose={() => setConfirm(null)}
          onConfirm={() =>
            void act(
              async () => {
                await api(`/documents/${doc.id}/${confirm}`, 'POST');
                setConfirm(null);
                data.reload();
              },
              confirm === 'post'
                ? isReturn
                  ? 'تم اعتماد إشعار المرتجع بنجاح'
                  : 'تم اعتماد الفاتورة'
                : isReturn
                  ? 'تم إلغاء إشعار المرتجع'
                  : 'تم إلغاء الفاتورة',
            )
          }
        />
      )}
      {thermalModal && (
        <Modal title="معاينة إيصال الكاشير الحراري (POS)" onClose={() => setThermalModal(false)}>
          <div className="modal-body pos-receipt-wrapper">
            <ThermalReceiptPaper
              result={{
                document: {
                  id: doc.id,
                  number: doc.number,
                  date: doc.date,
                  total: doc.total,
                  subtotal: doc.subtotal,
                  discount: doc.discount,
                  tax: doc.tax,
                  tax_rate: doc.tax_rate,
                  notes: doc.notes,
                },
                lines: doc.lines?.map((l) => ({
                  id: l.id,
                  name: l.name,
                  sku: l.sku,
                  quantity: l.quantity,
                  unit_price: l.unit_price,
                  total: l.total,
                })),
                payment: {
                  method: doc.payments?.[0]?.method || (doc.paid > 0 ? 'CASH' : 'CREDIT'),
                  amount_paid: doc.paid,
                  amount_tendered: doc.paid,
                  change_due: 0,
                },
              }}
              companyName={company?.name || 'مؤسسة أوركيفا'}
              taxNumber={company?.tax_number}
              branchName={doc.branch_name}
              cashierName={doc.created_by}
              customerName={doc.party_name}
            />
          </div>
          <div className="modal-footer">
            <Button onClick={triggerThermalPrint}>
              <Printer size={16} /> طباعة الإيصال الحراري (Ctrl+P)
            </Button>
            <Button variant="secondary" onClick={() => setThermalModal(false)}>
              إغلاق
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function PaymentForm({
  doc,
  onClose,
  onSaved,
}: {
  doc: Document;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const accountsData = useData<CashAccount[]>('/cash-accounts');
  const [requestKey] = useState(() => crypto.randomUUID());
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const accId = f.get('account_id') ? String(f.get('account_id')) : undefined;
    void act(async () => {
      await api(
        `/documents/${doc.id}/payments`,
        'POST',
        {
          amount: toCents(f.get('amount')),
          method: f.get('method'),
          date: f.get('date'),
          reference: f.get('reference'),
          account_id: accId,
        },
        requestKey,
      );
      onSaved();
    }, 'تم تسجيل الدفعة وتحديث الرصيد');
  };
  return (
    <Modal
      title={doc.type === 'SALE' ? 'تسجيل دفعة من العميل' : 'تسجيل دفعة للمورد'}
      description={doc.number + ' · ' + doc.party_name}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <div className="adjust-current">
            <span>الرصيد المستحق</span>
            <strong className="num">
              {money(doc.total - doc.paid, 2)} <small>ج.م</small>
            </strong>
          </div>
          <Field label="المبلغ المدفوع (ج.م) *">
            <input
              name="amount"
              type="number"
              required
              min="0.01"
              max={(doc.total - doc.paid) / 100}
              step=".01"
              defaultValue={(doc.total - doc.paid) / 100}
            />
          </Field>
          <div className="form-row">
            <Field label="طريقة الدفع *">
              <select name="method">
                {Object.entries(methods).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="تاريخ الدفع *">
              <input
                name="date"
                type="date"
                min={doc.date}
                required
                defaultValue={today() < doc.date ? doc.date : today()}
              />
            </Field>
          </div>
          <Field
            label="الحساب المالي / الخزينة"
            hint="الخزينة أو الحساب البنكي الذي تتم من خلاله الحركة (اختياري، يحدّد تلقائياً حسب الطريقة)"
          >
            <select name="account_id" defaultValue="">
              <option value="">تلقائي حسب طريقة الدفع</option>
              {(accountsData.data || [])
                .filter((a) => a.active)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} (
                    {a.type === 'CASH' ? 'خزينة' : a.type === 'BANK' ? 'حساب بنكي' : 'محفظة'}) —
                    الرصيد: {money(a.balance, 2)} ج.م
                  </option>
                ))}
            </select>
          </Field>
          <Field label="رقم المرجع (اختياري)">
            <input name="reference" maxLength={200} placeholder="رقم التحويل البنكي أو الإيصال" />
          </Field>
          <div className="info-banner">
            <CircleCheck size={18} />
            <span>
              سيتم حفظ الدفعة في السجل المالي. تأكد من المبلغ قبل التأكيد؛ الدفعات غير قابلة للحذف.
            </span>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="submit" busy={busy}>
            تأكيد تسجيل الدفعة
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ReturnModal({
  doc,
  onClose,
  onCreated,
}: {
  doc: Document;
  onClose: () => void;
  onCreated: (newDocId: string) => void;
}) {
  const isSale = doc.type === 'SALE';
  const data = useData<ReturnableLine[]>('/documents/' + doc.id + '/returnable');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const { busy, act } = useAction();
  const lines = data.data || [];

  const handleQtyChange = (productId: string, val: number, max: number) => {
    const clamped = Math.max(0, Math.min(val, max));
    setQuantities((prev) => ({ ...prev, [productId]: clamped }));
  };

  const returnAll = () => {
    const next: Record<string, number> = {};
    for (const l of lines) {
      if (l.returnable > 0) next[l.product_id] = l.returnable;
    }
    setQuantities(next);
  };

  const resetAll = () => {
    setQuantities({});
  };

  const totalReturnUnits = Object.values(quantities).reduce((s, q) => s + (q || 0), 0);
  const subtotal = lines.reduce((acc, l) => {
    const q = quantities[l.product_id] || 0;
    return acc + q * l.unit_price;
  }, 0);
  const tax = Math.round((subtotal * (doc.tax_rate || 0)) / 10000);
  const total = subtotal + tax;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (totalReturnUnits <= 0) return;

    const returnLines = lines
      .map((l) => ({
        product_id: l.product_id,
        quantity: quantities[l.product_id] || 0,
        unit_price: l.unit_price,
      }))
      .filter((l) => l.quantity > 0);

    void act(
      async () => {
        const created = await api<Document>('/documents', 'POST', {
          type: isSale ? 'SALE_RETURN' : 'PURCHASE_RETURN',
          branch_id: doc.branch_id,
          party_id: doc.party_id,
          original_document_id: doc.id,
          date: today(),
          due_date: today(),
          tax_rate: doc.tax_rate,
          discount: 0,
          notes: notes || `مرتجع عن الفاتورة ${doc.number}`,
          lines: returnLines,
        });
        onCreated(created.id);
      },
      isSale ? 'تم إنشاء إشعار الدائن كمسودة' : 'تم إنشاء إشعار المدين كمسودة',
    );
  };

  return (
    <Modal
      title={isSale ? 'إصدار إشعار دائن (مرتجع مبيعات)' : 'إصدار إشعار مدين (مرتجع مشتريات)'}
      description={`عن الفاتورة ${doc.number} · ${doc.party_name}`}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          {data.loading ? (
            <Loading />
          ) : data.error ? (
            <ErrorState message={data.error} retry={data.reload} />
          ) : !lines.some((l) => l.returnable > 0) ? (
            <div className="side-empty">
              <CircleCheck size={32} />
              <p>تم إرجاع كامل أصناف هذه الفاتورة</p>
              <span>لا توجد كميات متبقية قابلة للإرجاع.</span>
            </div>
          ) : (
            <>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  حدد الكميات المراد إرجاعها من كل بند:
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={returnAll}
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                  >
                    إرجاع كامل المتبقي
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={resetAll}
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                  >
                    تصفير
                  </Button>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>المنتج</th>
                      <th>الكمية بالفاتورة</th>
                      <th>المرتجع سابقاً</th>
                      <th>المتاح للإرجاع</th>
                      <th>سعر الوحدة</th>
                      <th style={{ width: '110px' }}>كمية الإرجاع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const cur = quantities[l.product_id] ?? 0;
                      return (
                        <tr key={l.product_id}>
                          <td>
                            <strong>{l.name}</strong>
                            <small className="cell-sub num">{l.sku}</small>
                          </td>
                          <td className="num">{l.quantity}</td>
                          <td className="num muted">{l.already_returned}</td>
                          <td
                            className="num"
                            style={{
                              fontWeight: 600,
                              color: l.returnable > 0 ? '#4c7345' : 'inherit',
                            }}
                          >
                            {l.returnable}
                          </td>
                          <td className="num">{money(l.unit_price, 2)}</td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              max={l.returnable}
                              step="1"
                              disabled={l.returnable === 0}
                              value={cur === 0 ? '' : cur}
                              onChange={(e) =>
                                handleQtyChange(
                                  l.product_id,
                                  parseInt(e.target.value) || 0,
                                  l.returnable,
                                )
                              }
                              placeholder="0"
                              style={{ width: '100%', textAlign: 'center', padding: '5px' }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div
                style={{
                  background: 'var(--bg-subtle, #f8faf6)',
                  padding: '12px 16px',
                  borderRadius: '6px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    إجمالي الوحدات المرتجعة:
                  </div>
                  <strong className="num">{totalReturnUnits} وحدة</strong>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>قبل الضريبة:</div>
                  <strong className="num">{money(subtotal, 2)} ج.م</strong>
                </div>
                {doc.tax_rate > 0 && (
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                      الضريبة ({doc.tax_rate / 100}%):
                    </div>
                    <strong className="num">{money(tax, 2)} ج.م</strong>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>صافي قيمة الإشعار:</div>
                  <strong className="num amount" style={{ fontSize: '15px' }}>
                    {money(total, 2)} ج.م
                  </strong>
                </div>
              </div>
              <Field label="ملاحظات أو سبب الإرجاع">
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={`مرتجع عن الفاتورة ${doc.number}`}
                />
              </Field>
            </>
          )}
        </div>
        <div className="modal-footer">
          <Button type="submit" busy={busy} disabled={totalReturnUnits <= 0}>
            {isSale ? 'إنشاء إشعار الدائن' : 'إنشاء إشعار المدين'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}
