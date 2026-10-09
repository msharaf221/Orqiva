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
import type { Document, DocType, Product, Party } from '../types';
export function Documents({ type }: { type: DocType }) {
  const sale = type === 'SALE';
  const path = sale ? '/sales' : '/purchases';
  const { user } = useSession();
  const [params] = useSearchParams();
  const data = useData<Document[]>('/documents?type=' + type);
  const [query, setQuery] = useState(''),
    [status, setStatus] = useState(params.get('status') || 'all'),
    [page, setPage] = useState(1);
  const allowed = sale || user.role === 'ADMIN';
  useEffect(() => setStatus(params.get('status') || 'all'), [params]);
  useEffect(() => setPage(1), [query, status]);
  const documents = data.data || [];
  const posted = documents.filter((d) => d.status === 'POSTED');
  const filtered = documents.filter(
    (d) =>
      (d.number + ' ' + d.party_name).toLowerCase().includes(query.toLowerCase()) &&
      (status === 'all' ||
        (status === 'draft' && d.status === 'DRAFT') ||
        (status === 'cancelled' && d.status === 'CANCELLED') ||
        (status === 'paid' && d.status === 'POSTED' && d.paid >= d.total) ||
        (status === 'unpaid' && d.status === 'POSTED' && d.paid < d.total) ||
        (status === 'overdue' &&
          d.status === 'POSTED' &&
          d.paid < d.total &&
          d.due_date < today())),
  );
  return (
    <>
      <PageHeader
        eyebrow={sale ? 'من أول فاتورة، إلى النمو' : 'توريدات تدعم أعمالك'}
        title={sale ? 'فواتير المبيعات' : 'فواتير المشتريات'}
        description={
          sale
            ? 'أنشئ فواتيرك، تابع التحصيل، وحافظ على وضوح حساباتك.'
            : 'أدر مشترياتك ومستحقات الموردين، مع تحديث المخزون تلقائياً.'
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                downloadCSV(
                  sale ? 'المبيعات' : 'المشتريات',
                  [
                    'رقم الفاتورة',
                    sale ? 'العميل' : 'المورد',
                    'التاريخ',
                    'الاستحقاق',
                    'الحالة',
                    'الإجمالي',
                    'المدفوع',
                    'المستحق',
                  ],
                  filtered.map((d) => [
                    d.number,
                    d.party_name,
                    d.date,
                    d.due_date,
                    d.status,
                    d.total / 100,
                    d.paid / 100,
                    d.status === 'POSTED' ? (d.total - d.paid) / 100 : 0,
                  ]),
                )
              }
            >
              <Download size={16} /> تصدير
            </Button>
            {allowed && (
              <Link to={path + '/new'} className="btn btn-primary">
                <Plus size={18} /> فاتورة جديدة
              </Link>
            )}
          </>
        }
      />
      <div className="stats-grid three">
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
      </div>
      <section className="card">
        <div className="table-toolbar">
          <div className="tabs">
            <button className={status === 'all' ? 'active' : ''} onClick={() => setStatus('all')}>
              كل الفواتير <span className="num">{documents.length}</span>
            </button>
            <button
              className={status === 'draft' ? 'active' : ''}
              onClick={() => setStatus('draft')}
            >
              المسودات
            </button>
            <button
              className={status === 'unpaid' ? 'active' : ''}
              onClick={() => setStatus('unpaid')}
            >
              غير المسددة
            </button>
          </div>
          <div className="table-filters">
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder="بحث برقم الفاتورة أو الحساب..."
            />
            <select
              className="filter-select"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="حالة الفاتورة"
            >
              <option value="all">كل الحالات</option>
              <option value="draft">مسودة</option>
              <option value="paid">مدفوعة</option>
              <option value="unpaid">غير مسددة</option>
              <option value="overdue">متأخرة</option>
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
            action={
              allowed ? (
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
                    <th>رقم الفاتورة</th>
                    <th>{sale ? 'العميل' : 'المورد'}</th>
                    <th>التاريخ</th>
                    <th>الاستحقاق</th>
                    <th>الإجمالي</th>
                    <th>المتبقي</th>
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
                      <td>
                        <div className="person-cell">
                          <Initials name={d.party_name} tone={i} />
                          <span>{d.party_name}</span>
                        </div>
                      </td>
                      <td className="muted no-wrap">{formatDate(d.date, true)}</td>
                      <td className="muted no-wrap">{formatDate(d.due_date, true)}</td>
                      <td className="num amount">{money(d.total, 2)}</td>
                      <td className="num muted">
                        {d.status === 'POSTED' ? money(d.total - d.paid, 2) : '—'}
                      </td>
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
  const products = useData<Product[]>('/products'),
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
  if (!sale && user.role !== 'ADMIN') return <Empty title="هذه الصفحة متاحة لمدير النظام" />;
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
                              ?.filter((p) => p.active)
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
  const { company, user } = useSession();
  const data = useData<Document>('/documents/' + id);
  const { busy, act } = useAction();
  const [confirm, setConfirm] = useState<'post' | 'cancel' | null>(null),
    [payment, setPayment] = useState(false);
  const doc = data.data;
  if (data.error) return <ErrorState message={data.error} retry={data.reload} />;
  if (!doc || data.loading) return <Loading />;
  const sale = doc.type === 'SALE',
    path = sale ? '/sales' : '/purchases',
    editable = sale || user.role === 'ADMIN';
  return (
    <>
      <div className="no-print">
        <PageHeader
          eyebrow={sale ? 'المبيعات / تفاصيل الفاتورة' : 'المشتريات / تفاصيل الفاتورة'}
          title={doc.number}
          description={`${sale ? 'فاتورة مبيعات' : 'فاتورة مشتريات'} · ${doc.party_name}`}
          actions={
            <>
              <Link className="btn btn-secondary" to={path}>
                <ArrowRight size={16} /> رجوع
              </Link>
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer size={16} /> طباعة
              </Button>
              {doc.status === 'DRAFT' && editable && (
                <>
                  <Link to={path + '/' + doc.id + '/edit'} className="btn btn-secondary">
                    <Pencil size={16} /> تعديل
                  </Link>
                  <Button onClick={() => setConfirm('post')}>
                    <Check size={17} /> اعتماد الفاتورة
                  </Button>
                </>
              )}
              {doc.status === 'POSTED' && doc.paid < doc.total && editable && (
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
            <span>هذه الفاتورة مسودة. لم يتم تحديث المخزون أو احتساب أي مستحقات بعد.</span>
          </div>
        )}
      </div>
      <div className="document-detail-grid">
        <section className="card invoice-paper" id="invoice-print">
          <div className="invoice-header">
            <div>
              <div className="invoice-brand" dir="ltr">
                orqiva<span>.</span>
              </div>
              <h2>{company?.name}</h2>
              <p>{company?.address}</p>
              <p dir="ltr">
                {company?.phone} · {company?.email}
              </p>
              {company?.tax_number && <p>الرقم الضريبي: {company.tax_number}</p>}
            </div>
            <div className="invoice-title">
              <span>{sale ? 'فاتورة مبيعات' : 'فاتورة مشتريات'}</span>
              <h2 className="num">{doc.number}</h2>
              <Status doc={doc} />
            </div>
          </div>
          <div className="invoice-parties">
            <div>
              <span className="eyebrow">{sale ? 'فاتورة إلى' : 'المورد'}</span>
              <h3>{doc.party_name}</h3>
              <p>{doc.party_address}</p>
              <p dir="ltr">{doc.party_phone}</p>
              {doc.party_tax_number && <p>الرقم الضريبي: {doc.party_tax_number}</p>}
            </div>
            <div className="invoice-dates">
              <div>
                <span>تاريخ الفاتورة</span>
                <strong>{formatDate(doc.date)}</strong>
              </div>
              <div>
                <span>تاريخ الاستحقاق</span>
                <strong>{formatDate(doc.due_date)}</strong>
              </div>
              <div>
                <span>العملة</span>
                <strong>جنيه مصري (EGP)</strong>
              </div>
            </div>
          </div>
          <div className="table-scroll">
            <table className="invoice-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الوصف</th>
                  <th>الكمية</th>
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
                      <small className="cell-sub num">{l.sku}</small>
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
              <h4>ملاحظات</h4>
              <p>{doc.notes || company?.invoice_note || 'شكراً لتعاملكم معنا.'}</p>
              {doc.notes && <p>{company?.invoice_note}</p>}
            </div>
            <div className="invoice-totals">
              <div>
                <span>الإجمالي قبل الضريبة</span>
                <strong className="num">{money(doc.subtotal, 2)}</strong>
              </div>
              <div>
                <span>الخصم</span>
                <span className="num">{money(doc.discount, 2)}</span>
              </div>
              <div>
                <span>القيمة المضافة ({doc.tax_rate / 100}%)</span>
                <span className="num">{money(doc.tax, 2)}</span>
              </div>
              <div className="grand-total">
                <span>الإجمالي</span>
                <strong className="num">
                  {money(doc.total, 2)} <small>ج.م</small>
                </strong>
              </div>
              <div>
                <span>المدفوع</span>
                <span className="num">{money(doc.paid, 2)}</span>
              </div>
              {doc.status === 'POSTED' && (
                <div className="balance-row">
                  <span>المتبقي</span>
                  <strong className="num">
                    {money(doc.total - doc.paid, 2)} <small>ج.م</small>
                  </strong>
                </div>
              )}
            </div>
          </div>
          <div className="invoice-signoff">
            <span>فاتورة صادرة من نظام أوركيفا</span>
            <span>وثيقة داخلية — ليست فاتورة إلكترونية معتمدة لدى الضرائب</span>
          </div>
        </section>
        <aside className="document-side no-print">
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
          <section className="card detail-status">
            <h3>حالة المستند</h3>
            <Status doc={doc} />
            <p>
              {doc.status === 'DRAFT'
                ? 'مسودة قابلة للتعديل.'
                : doc.status === 'CANCELLED'
                  ? 'هذا المستند ملغى ولا يؤثر على حساباتك.'
                  : 'فاتورة معتمدة. تم تحديث المخزون وسجل المستحقات.'}
            </p>
            {user.role === 'ADMIN' && doc.status !== 'CANCELLED' && (
              <>
                <div className="divider" />
                <Button
                  variant="ghost"
                  className="danger-text"
                  disabled={doc.paid > 0}
                  onClick={() => setConfirm('cancel')}
                >
                  <Ban size={16} /> إلغاء الفاتورة
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
      {confirm && (
        <Confirm
          title={confirm === 'post' ? 'اعتماد الفاتورة' : 'إلغاء الفاتورة'}
          description={
            confirm === 'post'
              ? `سيتم تثبيت الفاتورة ${doc.number} وتحديث المخزون. لن تتمكن من تعديلها بعد الاعتماد.`
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
              confirm === 'post' ? 'تم اعتماد الفاتورة' : 'تم إلغاء الفاتورة',
            )
          }
        />
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
  const [requestKey] = useState(() => crypto.randomUUID());
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void act(async () => {
      await api(
        `/documents/${doc.id}/payments`,
        'POST',
        {
          amount: toCents(f.get('amount')),
          method: f.get('method'),
          date: f.get('date'),
          reference: f.get('reference'),
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
