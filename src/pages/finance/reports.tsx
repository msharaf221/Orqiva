import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Download,
  Wallet,
  ReceiptText,
  TrendingUp,
  CalendarDays,
  ShieldCheck,
  Banknote,
  ArrowLeft,
  Filter,
} from 'lucide-react';
import {
  useData,
  PageHeader,
  Button,
  Field,
  Loading,
  ErrorState,
  Empty,
  Stat,
  money,
  today,
  dayOffset,
  downloadCSV,
} from '../../lib';
import { useBranch, withBranch } from '../../branch';
import { RevenueChart } from '../Dashboard';
import type { Dashboard as DashboardData } from '../../types';

export function Reports() {
  const [period, setPeriod] = useState({ from: dayOffset(-29), to: today() });
  const { activeId } = useBranch();
  const data = useData<DashboardData>(
    withBranch(`/dashboard?from=${period.from}&to=${period.to}`, activeId),
  );
  const report = data.data;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPeriod({ from: String(f.get('from')), to: String(f.get('to')) });
  };
  const metrics = report
    ? ([
        ['صافي المبيعات', report.sales],
        ['تكلفة البضاعة التقديرية', report.sales - report.grossProfit],
        ['مجمل الربح التقديري', report.grossProfit],
        ['المصروفات التشغيلية', report.expenses],
        ['صافي الربح التقديري', report.netProfit],
        ['المقبوضات', report.collected],
        ['مدفوعات الموردين', report.disbursed],
        ['صافي التدفق النقدي', report.cashFlow],
      ] as [string, number][])
    : [];
  return (
    <>
      <PageHeader
        eyebrow="قرارات مبنية على الأرقام"
        title="التقارير والتحليلات"
        description="من الأرقام اليومية إلى الصورة الأكبر. افهم أداء أعمالك واتخذ الخطوة التالية."
        actions={
          <Button
            variant="secondary"
            disabled={!report || data.loading}
            onClick={() =>
              downloadCSV(
                'تقرير-الأعمال-' + period.from,
                ['المؤشر', 'القيمة بالجنيه'],
                [
                  ['من', period.from],
                  ['إلى', period.to],
                  ...metrics.map(([label, value]) => [label, value / 100]),
                ],
              )
            }
          >
            <Download size={16} /> تصدير التقرير
          </Button>
        }
      />
      <form className="card report-filter" onSubmit={submit}>
        <div>
          <CalendarDays size={20} />
          <h3>الفترة الزمنية</h3>
        </div>
        <Field label="من">
          <input name="from" type="date" required defaultValue={period.from} />
        </Field>
        <Field label="إلى">
          <input name="to" type="date" required defaultValue={period.to} />
        </Field>
        <Button type="submit" busy={data.loading}>
          <Filter size={16} /> عرض التقرير
        </Button>
        <span>حد أقصى ٣٦٦ يوماً</span>
      </form>
      {data.error ? (
        <ErrorState message={data.error} retry={data.reload} />
      ) : data.loading ? (
        <Loading />
      ) : (
        report && (
          <>
            <div className="stats-grid">
              <Stat
                label="صافي المبيعات"
                value={money(report.sales)}
                icon={<ReceiptText size={20} />}
                foot="بعد الخصم، قبل الضريبة"
              />
              <Stat
                label="مجمل الربح التقديري"
                value={money(report.grossProfit)}
                icon={<TrendingUp size={20} />}
                tone="blue"
                foot="المبيعات ناقص التكلفة المرجعية"
              />
              <Stat
                label="المصروفات"
                value={money(report.expenses)}
                icon={<Wallet size={20} />}
                tone="amber"
              />
              <Stat
                label="صافي الربح التقديري"
                value={money(report.netProfit)}
                icon={<Banknote size={20} />}
                tone="purple"
                foot="بعد المصروفات التشغيلية"
              />
            </div>
            <section className="card report-chart">
              <div className="card-heading">
                <div>
                  <h2>اتجاه المبيعات والمشتريات</h2>
                  <p>القيم قبل الضريبة وبعد الخصومات</p>
                </div>
                <div className="chart-legend">
                  <span>
                    <i className="legend-sales" /> المبيعات
                  </span>
                  <span>
                    <i className="legend-purchases" /> المشتريات
                  </span>
                </div>
              </div>
              <RevenueChart data={report.series} />
            </section>
            <div className="report-grid">
              <section className="card">
                <div className="card-heading">
                  <h2>ملخص الأداء المالي</h2>
                  <span className="category-tag">ج.م</span>
                </div>
                <div className="financial-summary">
                  {metrics.map(([label, value], i) => (
                    <div className={i === 4 || i === 7 ? 'summary-emphasis' : ''} key={label}>
                      <span>{label}</span>
                      <strong className={'num ' + (value < 0 ? 'negative' : '')}>
                        {money(value, 2)}
                      </strong>
                    </div>
                  ))}
                </div>
              </section>
              <section className="card">
                <div className="card-heading">
                  <div>
                    <h2>توزيع المصروفات</h2>
                    <p>أين تُنفق أموال أعمالك؟</p>
                  </div>
                  <Wallet size={20} />
                </div>
                <div className="expense-breakdown">
                  {report.expenseCategories.length ? (
                    report.expenseCategories.map((c, i) => (
                      <div key={c.category}>
                        <div>
                          <span>
                            <i
                              style={{
                                background: ['#347969', '#98b88b', '#ddbc81', '#8b97b1', '#b6a2c9'][
                                  i % 5
                                ],
                              }}
                            />
                            {c.category}
                          </span>
                          <strong className="num">
                            {money(c.amount)} <small>ج.م</small>
                          </strong>
                        </div>
                        <div className="progress-track">
                          <span
                            style={{
                              width: `${(c.amount / report.expenses) * 100}%`,
                              background: ['#347969', '#98b88b', '#ddbc81', '#8b97b1', '#b6a2c9'][
                                i % 5
                              ],
                            }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <Empty title="لا توجد مصروفات في الفترة" />
                  )}
                </div>
              </section>
            </div>
            <section className="card top-products">
              <div className="card-heading">
                <div>
                  <h2>المنتجات الأعلى مبيعاً</h2>
                  <p>حسب قيمة بنود المبيعات، قبل خصم الفاتورة والضريبة</p>
                </div>
                <Link to="/products" className="text-link">
                  كل المنتجات <ArrowLeft size={15} />
                </Link>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>الترتيب</th>
                      <th>المنتج</th>
                      <th>الكود</th>
                      <th>الكمية المباعة</th>
                      <th>قيمة المبيعات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.topProducts.map((p, i) => (
                      <tr key={p.sku}>
                        <td>
                          <span className={'rank ' + (i === 0 ? 'first' : '')}>{i + 1}</span>
                        </td>
                        <td>
                          <strong>{p.name}</strong>
                        </td>
                        <td className="num muted">{p.sku}</td>
                        <td className="num">{p.quantity}</td>
                        <td className="num amount">
                          {money(p.revenue, 2)} <small>ج.م</small>
                        </td>
                      </tr>
                    ))}
                    {!report.topProducts.length && (
                      <tr>
                        <td colSpan={5} className="table-empty">
                          لا توجد مبيعات معتمدة في الفترة.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            <div className="info-banner report-disclaimer">
              <ShieldCheck size={20} />
              <span>
                هذا ملخص إداري، وليس قوائم مالية محاسبية معتمدة. للحصول على القوائم المالية الرسمية
                (قائمة الدخل، الميزانية العمومية) أو{' '}
                <strong>إقرار ضريبة القيمة المضافة (نموذج 10)</strong> وسجلات الفواتير الضريبية،
                يرجى الانتقال إلى{' '}
                <Link
                  to="/ledger?tab=vat-return"
                  style={{ textDecoration: 'underline', fontWeight: 600 }}
                >
                  دفتر الأستاذ العام والضرائب{' '}
                  <ArrowLeft size={14} style={{ display: 'inline', verticalAlign: 'middle' }} />
                </Link>
                .
              </span>
            </div>
          </>
        )
      )}
    </>
  );
}
