import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Download, ArrowUpRight, ArrowDownLeft, CreditCard, ArrowLeft } from 'lucide-react';
import {
  useData,
  useSession,
  PageHeader,
  Button,
  SearchBox,
  Modal,
  Loading,
  ErrorState,
  Empty,
  Stat,
  Pagination,
  money,
  count,
  formatDate,
  downloadCSV,
  methods,
} from '../../lib';
import type { Payment, Document } from '../../types';
import { useBranch, withBranch } from '../../branch';
import { PaymentForm } from '../Documents';

export function Payments() {
  const { user } = useSession();
  const { activeId } = useBranch();
  const data = useData<Payment[]>(withBranch('/payments', activeId));
  const [query, setQuery] = useState(''),
    [type, setType] = useState('all'),
    [page, setPage] = useState(1),
    [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Document | null>(null);
  useEffect(() => setPage(1), [query, type]);
  const payments = data.data || [];
  const filtered = payments.filter(
    (p) =>
      (type === 'all' || p.type === type) &&
      (p.number + ' ' + p.party_name + ' ' + p.reference)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const incoming = payments.filter((p) => p.type === 'SALE').reduce((s, p) => s + p.amount, 0),
    outgoing = payments.filter((p) => p.type === 'PURCHASE').reduce((s, p) => s + p.amount, 0);
  return (
    <>
      <PageHeader
        eyebrow="حركة أموالك، بوضوح"
        title="المدفوعات والمقبوضات"
        description="سجل موحّد لكل دفعة، مرتبط مباشرة بفواتيرك وحساباتك."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                downloadCSV(
                  'المدفوعات',
                  ['الفاتورة', 'الحساب', 'النوع', 'التاريخ', 'المبلغ', 'الطريقة', 'المرجع'],
                  filtered.map((p) => [
                    p.number || '',
                    p.party_name || '',
                    p.type === 'SALE' ? 'قبض' : 'دفع',
                    p.date,
                    p.amount / 100,
                    methods[p.method],
                    p.reference,
                  ]),
                )
              }
            >
              <Download size={16} /> تصدير
            </Button>
            <Button onClick={() => setSelecting(true)}>
              <Plus size={18} /> تسجيل دفعة
            </Button>
          </>
        }
      />
      <div className="stats-grid three">
        <Stat
          label="إجمالي المقبوضات"
          value={money(incoming)}
          icon={<ArrowDownLeft size={20} />}
          foot="دفعات العملاء · جميع الفترات"
        />
        <Stat
          label="إجمالي المدفوعات للموردين"
          value={money(outgoing)}
          icon={<ArrowUpRight size={20} />}
          tone="amber"
          foot="لا يشمل المصروفات التشغيلية"
        />
        <Stat
          label="عدد العمليات"
          value={count(payments.length)}
          unit="عملية"
          icon={<CreditCard size={20} />}
          tone="blue"
          foot="كل الدفعات المسجلة"
        />
      </div>
      <section className="card">
        <div className="table-toolbar">
          <div className="tabs">
            <button className={type === 'all' ? 'active' : ''} onClick={() => setType('all')}>
              كل العمليات
            </button>
            <button className={type === 'SALE' ? 'active' : ''} onClick={() => setType('SALE')}>
              المقبوضات
            </button>
            <button
              className={type === 'PURCHASE' ? 'active' : ''}
              onClick={() => setType('PURCHASE')}
            >
              المدفوعات
            </button>
          </div>
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="بحث بالحساب أو رقم الفاتورة..."
          />
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
                    <th>الحساب</th>
                    <th>الفاتورة</th>
                    <th>نوع العملية</th>
                    <th>التاريخ</th>
                    <th>المبلغ</th>
                    <th>الطريقة</th>
                    <th>المرجع</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice((page - 1) * 8, page * 8).map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.party_name}</strong>
                      </td>
                      <td>
                        <Link
                          className="invoice-number num"
                          to={`/${p.type === 'SALE' ? 'sales' : 'purchases'}/${p.document_id}`}
                        >
                          {p.number}
                        </Link>
                      </td>
                      <td>
                        <span className={'badge ' + (p.type === 'SALE' ? 'paid' : 'pending')}>
                          {p.type === 'SALE' ? (
                            <ArrowDownLeft size={12} />
                          ) : (
                            <ArrowUpRight size={12} />
                          )}{' '}
                          {p.type === 'SALE' ? 'قبض من عميل' : 'دفع لمورد'}
                        </span>
                      </td>
                      <td className="muted">{formatDate(p.date, true)}</td>
                      <td className="num amount">
                        {money(p.amount, 2)} <small>ج.م</small>
                      </td>
                      <td>
                        <div>{methods[p.method]}</div>
                        {p.account_name && <small className="cell-sub">{p.account_name}</small>}
                      </td>
                      <td className="num muted">{p.reference || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} setPage={setPage} total={filtered.length} />
          </>
        )}
      </section>
      {selecting && (
        <SelectPaymentDoc
          admin={user.role === 'ADMIN'}
          onClose={() => setSelecting(false)}
          onSelect={(d) => {
            setSelecting(false);
            setSelected(d);
          }}
        />
      )}
      {selected && (
        <PaymentForm
          doc={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            data.reload();
          }}
        />
      )}
    </>
  );
}
function SelectPaymentDoc({
  admin,
  onClose,
  onSelect,
}: {
  admin: boolean;
  onClose: () => void;
  onSelect: (d: Document) => void;
}) {
  const [type, setType] = useState('SALE');
  const { activeId } = useBranch();
  const data = useData<Document[]>(withBranch('/documents?type=' + type, activeId));
  const [query, setQuery] = useState('');
  const docs = (data.data || []).filter(
    (d) =>
      d.status === 'POSTED' &&
      d.paid < d.total &&
      (d.number + d.party_name).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Modal
      title="اختر الفاتورة لتسجيل دفعة"
      description="تظهر الفواتير المعتمدة التي لها رصيد مستحق فقط."
      onClose={onClose}
    >
      <div className="modal-body form-grid">
        {admin && (
          <div className="tabs">
            <button className={type === 'SALE' ? 'active' : ''} onClick={() => setType('SALE')}>
              قبض من عميل
            </button>
            <button
              className={type === 'PURCHASE' ? 'active' : ''}
              onClick={() => setType('PURCHASE')}
            >
              دفع لمورد
            </button>
          </div>
        )}
        <SearchBox value={query} onChange={setQuery} placeholder="رقم الفاتورة أو اسم الحساب..." />
        {data.loading ? (
          <Loading />
        ) : data.error ? (
          <ErrorState message={data.error} retry={data.reload} />
        ) : !docs.length ? (
          <Empty title="لا توجد فواتير مستحقة" />
        ) : (
          <div className="payment-doc-list">
            {docs.map((d) => (
              <button key={d.id} onClick={() => onSelect(d)}>
                <div>
                  <strong className="num">{d.number}</strong>
                  <span>{d.party_name}</span>
                </div>
                <b className="num">
                  {money(d.total - d.paid, 2)} <small>ج.م</small>
                </b>
                <ArrowLeft size={16} />
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
