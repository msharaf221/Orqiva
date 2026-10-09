import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Plus,
  ArrowUpRight,
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ReceiptText,
  Wallet,
  ShoppingBag,
  ChartNoAxesCombined,
  Package,
  Download,
  Sparkles,
  ChevronLeft,
  CircleCheck,
  TrendingUp,
} from 'lucide-react';
import {
  PageHeader,
  Stat,
  Button,
  useData,
  useSession,
  Loading,
  ErrorState,
  money,
  dayOffset,
  today,
  formatDate,
  Status,
  Initials,
  downloadCSV,
} from '../lib';
import type { Dashboard as DashboardData } from '../types';
export function RevenueChart({ data }: { data: DashboardData['series'] }) {
  return (
    <div className="revenue-chart" dir="ltr">
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: 600, height: 230 }}
        minWidth={0}
      >
        <AreaChart data={data} margin={{ top: 15, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="sales-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#217567" stopOpacity={0.19} />
              <stop offset="100%" stopColor="#217567" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#edf0ef" strokeDasharray="4 4" />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            minTickGap={35}
            tick={{ fill: '#939a9c', fontSize: 11 }}
            tickMargin={14}
            tickFormatter={(v) => formatDate(v, true)}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#939a9c', fontSize: 11 }}
            tickFormatter={(v) => (v >= 100000 ? `${Math.round(v / 100000)}k` : money(v))}
            width={46}
          />
          <Tooltip
            contentStyle={{
              border: '1px solid #e7ece9',
              borderRadius: 12,
              fontFamily: 'IBM Plex Sans Arabic',
              fontSize: 12,
              direction: 'rtl',
            }}
            labelFormatter={(v) => formatDate(String(v))}
            formatter={(value: number, name: string) => [
              money(value) + ' ج.م',
              name === 'sales' ? 'المبيعات' : 'المشتريات',
            ]}
          />
          <Area
            isAnimationActive={false}
            type="monotone"
            dataKey="sales"
            stroke="#247b6b"
            strokeWidth={2.5}
            fill="url(#sales-gradient)"
            activeDot={{ r: 5, stroke: '#fff', strokeWidth: 3 }}
          />
          <Area
            isAnimationActive={false}
            type="monotone"
            dataKey="purchases"
            stroke="#c3d7a4"
            strokeWidth={2}
            strokeDasharray="5 4"
            fill="none"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function Dashboard() {
  const { user } = useSession();
  const [days, setDays] = useState(30);
  const { data, loading, error, reload } = useData<DashboardData>(
    `/dashboard?from=${dayOffset(1 - days)}&to=${today()}`,
  );
  const exportReport = () => {
    if (data)
      downloadCSV(
        'ملخص-الأعمال',
        ['المؤشر', 'القيمة بالجنيه'],
        [
          ['المبيعات قبل الضريبة', data.sales / 100],
          ['المشتريات قبل الضريبة', data.purchases / 100],
          ['المصروفات', data.expenses / 100],
          ['الربح التقديري', data.netProfit / 100],
          ['مستحقات العملاء — حالياً', data.receivables / 100],
          ['مستحقات الموردين — حالياً', data.payables / 100],
        ],
      );
  };
  return (
    <>
      <PageHeader
        eyebrow="نظرة شاملة على أعمالك"
        title={`أهلاً، ${user.name.split(' ')[0]}`}
        description="كل ما تحتاج معرفته عن أداء أعمالك اليوم، في مكان واحد."
        actions={
          <>
            <Button variant="secondary" onClick={exportReport} disabled={!data}>
              <Download size={16} /> تصدير التقرير
            </Button>
            <Link to="/sales/new" className="btn btn-primary">
              <Plus size={18} /> فاتورة جديدة
            </Link>
          </>
        }
      />
      <div className="overview-toolbar">
        <div className="section-label">
          <span className="live-dot" /> ملخص الأعمال{' '}
          <span className="subtle-label">لنصنع يوماً مثمراً</span>
        </div>
        <div className="date-filter">
          <CalendarDays size={16} />
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="فترة لوحة التحكم"
          >
            <option value={7}>آخر ٧ أيام</option>
            <option value={30}>آخر ٣٠ يوماً</option>
            <option value={90}>آخر ٩٠ يوماً</option>
          </select>
          <ChevronDown size={13} />
        </div>
      </div>
      {error ? (
        <ErrorState message={error} retry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        data && (
          <>
            <div className={'stats-grid ' + (loading ? 'refreshing' : '')}>
              <Stat
                label="إجمالي المبيعات"
                value={money(data.sales)}
                icon={<ReceiptText size={20} />}
                trend={data.salesGrowth}
                foot="مقارنة بالفترة السابقة"
              />
              <Stat
                label="إجمالي المشتريات"
                value={money(data.purchases)}
                icon={<ShoppingBag size={20} />}
                tone="blue"
                foot="قيمة التوريدات قبل الضريبة"
              />
              <Stat
                label="المصروفات التشغيلية"
                value={money(data.expenses)}
                icon={<Wallet size={20} />}
                tone="amber"
                foot="خلال الفترة المحددة"
              />
              <Stat
                label="صافي الربح التقديري"
                value={money(data.netProfit)}
                icon={<ChartNoAxesCombined size={20} />}
                tone="purple"
                foot="بعد تكلفة البضاعة والمصروفات"
              />
            </div>
            <div className="dashboard-middle">
              <section className="card chart-card">
                <div className="card-heading">
                  <div>
                    <h2>أداء المبيعات والمشتريات</h2>
                    <p>نظرة أقرب على حركة أعمالك خلال الفترة</p>
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
                <div className="chart-summary">
                  <strong className="num">
                    {money(data.sales)} <small>ج.م</small>
                  </strong>
                  <span className="chart-summary-note">إجمالي المبيعات قبل الضريبة</span>
                </div>
                <RevenueChart data={data.series} />
              </section>
              <section className="card cash-card">
                <div className="card-heading">
                  <div>
                    <h2>السيولة والمستحقات</h2>
                    <p>تابع تدفق أموالك بثقة</p>
                  </div>
                  <ArrowLeftRightIcon />
                </div>
                <div className="cash-main">
                  <span>صافي التدفق النقدي للفترة</span>
                  <strong className="num">
                    {money(data.cashFlow)} <small>ج.م</small>
                  </strong>
                  <div className="cash-sparkline">
                    <div className="cash-flow-bars" aria-label="نسبة المقبوضات والمدفوعات">
                      <span style={{ flex: Math.max(1, data.collected) }} />
                      <span style={{ flex: Math.max(1, data.disbursed + data.expenses) }} />
                    </div>
                    <div className="cash-flow-labels">
                      <span>
                        مقبوضات <b>{money(data.collected)}</b>
                      </span>
                      <span>
                        مدفوعات ومصروفات <b>{money(data.disbursed + data.expenses)}</b>
                      </span>
                    </div>
                    <span>المقبوضات − المدفوعات − المصروفات</span>
                  </div>
                </div>
                <div className="cash-detail">
                  <div>
                    <span className="cash-icon incoming">
                      <ArrowUpRight size={18} />
                    </span>
                    <div>
                      <span>لك عند العملاء</span>
                      <strong className="num">
                        {money(data.receivables)} <small>ج.م</small>
                      </strong>
                    </div>
                    <Link to="/sales?status=unpaid" aria-label="عرض مستحقات العملاء">
                      <ChevronLeft size={18} />
                    </Link>
                  </div>
                  <div>
                    <span className="cash-icon outgoing">
                      <ArrowUpRight size={18} />
                    </span>
                    <div>
                      <span>عليك للموردين</span>
                      <strong className="num">
                        {money(data.payables)} <small>ج.م</small>
                      </strong>
                    </div>
                    <Link to="/purchases?status=unpaid" aria-label="عرض مستحقات الموردين">
                      <ChevronLeft size={18} />
                    </Link>
                  </div>
                </div>
                <div className="cash-footer">
                  <span className="tiny-dot" /> أرصدة المستحقات الحالية لجميع الفترات
                </div>
              </section>
            </div>
            <div className="dashboard-bottom">
              <section className="card recent-card">
                <div className="card-heading">
                  <div>
                    <h2>
                      أحدث فواتير المبيعات{' '}
                      <span className="count-chip num">{data.invoiceCount}</span>
                    </h2>
                    <p>آخر التحديثات على معاملاتك</p>
                  </div>
                  <Link className="text-link" to="/sales">
                    عرض الكل <ArrowLeft size={15} />
                  </Link>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>رقم الفاتورة</th>
                        <th>العميل</th>
                        <th>التاريخ</th>
                        <th>المبلغ</th>
                        <th>الحالة</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentDocuments.map((doc, i) => (
                        <tr key={doc.id}>
                          <td>
                            <Link className="invoice-number num" to={'/sales/' + doc.id}>
                              {doc.number}
                            </Link>
                          </td>
                          <td>
                            <div className="person-cell">
                              <Initials name={doc.party_name} tone={i} />
                              <span>{doc.party_name}</span>
                            </div>
                          </td>
                          <td className="muted no-wrap">{formatDate(doc.date, true)}</td>
                          <td className="num amount">
                            {money(doc.total)} <small>ج.م</small>
                          </td>
                          <td>
                            <Status doc={doc} />
                          </td>
                          <td>
                            <Link
                              className="icon-btn"
                              aria-label={'عرض ' + doc.number}
                              to={'/sales/' + doc.id}
                            >
                              <ChevronLeft size={16} />
                            </Link>
                          </td>
                        </tr>
                      ))}
                      {!data.recentDocuments.length && (
                        <tr>
                          <td colSpan={6} className="table-empty">
                            لا توجد فواتير في الفترة المحددة.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="table-bottom-note">
                  <CircleCheck size={14} /> بيانات محدثة من سجلات أعمالك
                </div>
              </section>
              <section className="card stock-card">
                <div className="card-heading">
                  <div>
                    <h2>
                      تنبيهات المخزون{' '}
                      <span className="count-chip amber-chip num">{data.lowStock.length}</span>
                    </h2>
                    <p>منتجات تحتاج إعادة طلب</p>
                  </div>
                  <span className="stock-alert-icon">
                    <Package size={19} />
                  </span>
                </div>
                <div className="low-stock-list">
                  {data.lowStock.slice(0, 3).map((p, i) => (
                    <Link
                      key={p.id}
                      to={'/inventory?q=' + encodeURIComponent(p.sku)}
                      className="stock-item"
                    >
                      <span className={'product-icon product-tone-' + i}>
                        <Package size={22} />
                      </span>
                      <div>
                        <strong>{p.name}</strong>
                        <span className="num">{p.sku}</span>
                      </div>
                      <span className="stock-remaining">
                        <b className="num">{p.stock}</b>
                        <small>متبقي</small>
                      </span>
                    </Link>
                  ))}
                  {!data.lowStock.length && (
                    <div className="stock-good">
                      <CircleCheck /> جميع مستويات المخزون جيدة
                    </div>
                  )}
                </div>
                <Link className="stock-bottom" to="/inventory?low=1">
                  إدارة المخزون <ArrowLeft size={15} />
                </Link>
              </section>
            </div>
            <div className="dashboard-last">
              <section className="quick-banner">
                <span className="quick-banner-icon">
                  <Sparkles size={25} />
                </span>
                <div>
                  <h3>خطوات صغيرة، إنجازات كبيرة.</h3>
                  <p>كل فاتورة جديدة هي خطوة نحو نمو أعمالك.</p>
                </div>
                <Link to="/customers" className="btn btn-secondary">
                  إدارة العملاء <ArrowLeft size={15} />
                </Link>
                <span className="banner-art">✳</span>
              </section>
              <Link to="/reports" className="insight-link">
                <span className="insight-icon">
                  <TrendingUp size={22} />
                </span>
                <div>
                  <h3>وراء كل رقم، فرصة.</h3>
                  <p>اكتشف المزيد في تقارير أعمالك</p>
                </div>
                <ArrowLeft size={18} />
              </Link>
            </div>
          </>
        )
      )}
    </>
  );
}
function ArrowLeftRightIcon() {
  return (
    <span className="cash-heading-icon">
      <Wallet size={19} />
    </span>
  );
}
