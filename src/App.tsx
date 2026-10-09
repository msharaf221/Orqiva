import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  Boxes,
  Users,
  Truck,
  ReceiptText,
  ShoppingBag,
  Wallet,
  ArrowLeftRight,
  ChartNoAxesCombined,
  Settings,
  Search,
  Bell,
  ChevronDown,
  ChevronLeft,
  LogOut,
  Menu,
  Command,
  ArrowLeft,
  ArrowRightLeft,
  Store,
  HandCoins,
  Eye,
  EyeOff,
  ShieldCheck,
  Sparkles,
  CircleHelp,
  ArrowUpRight,
} from 'lucide-react';
import { BranchProvider, BranchSwitcher, useBranch, withBranch } from './branch';
import {
  api,
  Button,
  Field,
  Loading,
  SessionContext,
  useAction,
  useData,
  useSession,
  useToast,
  Modal,
  SearchBox,
  money,
  today,
  dayOffset,
} from './lib';
import type { User, Company, Product, Party, Document, Dashboard as DashboardData } from './types';
import { ApiError } from './api';
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Products = lazy(() => import('./pages/Catalog').then((m) => ({ default: m.Products })));
const Inventory = lazy(() => import('./pages/Catalog').then((m) => ({ default: m.Inventory })));
const Parties = lazy(() => import('./pages/Catalog').then((m) => ({ default: m.Parties })));
const Documents = lazy(() => import('./pages/Documents').then((m) => ({ default: m.Documents })));
const DocumentEditor = lazy(() =>
  import('./pages/Documents').then((m) => ({ default: m.DocumentEditor })),
);
const DocumentDetail = lazy(() =>
  import('./pages/Documents').then((m) => ({ default: m.DocumentDetail })),
);
const Expenses = lazy(() => import('./pages/Finance').then((m) => ({ default: m.Expenses })));
const Payments = lazy(() => import('./pages/Finance').then((m) => ({ default: m.Payments })));
const Reports = lazy(() => import('./pages/Finance').then((m) => ({ default: m.Reports })));
const SettingsPage = lazy(() =>
  import('./pages/Finance').then((m) => ({ default: m.SettingsPage })),
);
const ActivityPage = lazy(() =>
  import('./pages/Finance').then((m) => ({ default: m.ActivityPage })),
);
const Branches = lazy(() => import('./pages/Branches').then((m) => ({ default: m.Branches })));
const Transfers = lazy(() => import('./pages/Transfers').then((m) => ({ default: m.Transfers })));
const Distributions = lazy(() =>
  import('./pages/Distributions').then((m) => ({ default: m.Distributions })),
);
export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={'brand ' + (light ? 'brand-light' : '')} dir="ltr">
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <path d="M9 10h12c8 0 12 4 12 10s-4 10-12 10H9V10Z" stroke="currentColor" strokeWidth="5" />
        <path d="M18 10v20m9-3 8 8" stroke="currentColor" strokeWidth="5" />
      </svg>
      <span>
        orqiva<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const { busy, act } = useAction();
  const [show, setShow] = useState(false);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void act(async () => {
      await api<User>('/auth/login', 'POST', {
        email: f.get('email'),
        password: f.get('password'),
      });
      // Verify the browser actually retained the HttpOnly cookie before loading protected screens.
      try {
        onLogin(await api<User>('/auth/me'));
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          throw new Error(
            'تعذر حفظ جلسة الدخول في المتصفح. افتح المعاينة في تبويب مستقل أو اسمح بملفات تعريف الارتباط لهذا الموقع.',
          );
        }
        throw error;
      }
    });
  };
  return (
    <div className="login-page">
      <div className="login-story">
        <Brand light />
        <div className="login-story-main">
          <span className="login-tag">
            <span /> مساحة عمل أذكى. فرص أكبر.
          </span>
          <h1>
            كل أعمالك.
            <br />
            في مكان <em>واحد.</em>
          </h1>
          <p>
            رؤية أوضح لأرقامك، وتنظيم أفضل ليومك.
            <br />
            مع أوركيفا، ركّز على الخطوة القادمة لأعمالك.
          </p>
          <div className="login-visual">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit orbit-three" />
            <div className="visual-core">
              <Brand light />
            </div>
            <div className="floating-pill pill-one">
              <Package size={19} /> مخزون تحت السيطرة <span className="pill-dot" />
            </div>
            <div className="floating-pill pill-two">
              <ChartNoAxesCombined size={19} /> قرارات مبنية على الأرقام <ArrowUpRight size={18} />
            </div>
            <div className="floating-pill pill-three">
              <ReceiptText size={19} /> من أول فاتورة، للنمو
            </div>
          </div>
        </div>
        <div className="login-story-footer">
          <span>صُنع لتبسيط الأعمال</span>
          <span className="num">ORQIVA BUSINESS SUITE</span>
        </div>
      </div>
      <div className="login-form-side">
        <div className="login-lang">
          العربية <span>AR</span>
        </div>
        <form className="login-form" onSubmit={submit}>
          <div className="login-icon">
            <Sparkles size={25} />
          </div>
          <span className="eyebrow">خطوتك التالية تبدأ هنا</span>
          <h2>أهلاً بعودتك</h2>
          <p>سجّل دخولك، وخلّينا نبدأ يوماً مثمراً.</p>
          <Field label="البريد الإلكتروني">
            <input
              name="email"
              type="email"
              required
              autoComplete="username"
              dir="ltr"
              placeholder="name@company.com"
              defaultValue={import.meta.env.DEV ? 'admin@orqiva.com' : ''}
            />
          </Field>
          <Field label="كلمة المرور">
            <div className="password-field">
              <input
                name="password"
                type={show ? 'text' : 'password'}
                required
                autoComplete="current-password"
                minLength={1}
                dir="ltr"
                placeholder="أدخل كلمة المرور"
                defaultValue={
                  import.meta.env.DEV && import.meta.env.VITE_DEMO_LOGIN === 'true'
                    ? 'Orqiva@2026'
                    : ''
                }
              />
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShow(!show)}
                aria-label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>
          <div className="login-session">
            <ShieldCheck size={16} /> جلسة آمنة لمدة ٨ ساعات
          </div>
          <Button busy={busy} type="submit" className="login-submit">
            الدخول إلى مساحة العمل <ArrowLeft size={18} />
          </Button>
          {import.meta.env.DEV && import.meta.env.VITE_DEMO_LOGIN === 'true' && (
            <div className="demo-note">
              <b>مساحة تجريبية جاهزة للاستكشاف</b>
              <span>بيانات الدخول مُعبأة لتجربة النظام. كل التغييرات تُحفظ فعلياً.</span>
            </div>
          )}
          <div className="login-help">
            <CircleHelp size={15} /> تحتاج مساعدة بالدخول؟ تواصل مع مدير نظامك.
          </div>
        </form>
        <div className="login-copyright">
          © {new Date().getFullYear()} أوركيفا. مساحة واحدة، إمكانيات أكثر.
        </div>
      </div>
    </div>
  );
}
export function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true);
  const toast = useToast();
  useEffect(() => {
    api<User>('/auth/me')
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoading(false));
    const expired = () => {
      setUser(null);
      toast('انتهت جلستك. يرجى تسجيل الدخول مجدداً.', 'error');
    };
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, [toast]);
  if (loading)
    return (
      <div className="boot">
        <Brand />
        <Loading />
      </div>
    );
  if (!user) return <Login onLogin={setUser} />;
  return <Authenticated user={user} onLogout={() => setUser(null)} />;
}
function Authenticated({ user, onLogout }: { user: User; onLogout: () => void }) {
  const company = useData<Company>('/company');
  return (
    <SessionContext.Provider
      value={{
        user,
        company: company.data,
        refreshCompany: company.reload,
        logout: async () => {
          await api('/auth/logout', 'POST');
          onLogout();
        },
      }}
    >
      <BranchProvider>
        <Layout />
      </BranchProvider>
    </SessionContext.Provider>
  );
}
type NavItem = { to: string; label: string; icon: typeof Package; adminOnly?: boolean };
const navigation: { label: string; items: NavItem[] }[] = [
  { label: 'نظرة عامة', items: [{ to: '/', label: 'لوحة التحكم', icon: LayoutDashboard }] },
  {
    label: 'إدارة الأعمال',
    items: [
      { to: '/sales', label: 'المبيعات', icon: ReceiptText },
      { to: '/purchases', label: 'المشتريات', icon: ShoppingBag },
      { to: '/products', label: 'المنتجات', icon: Package },
      { to: '/inventory', label: 'المخزون', icon: Boxes },
      { to: '/transfers', label: 'التحويلات بين الفروع', icon: ArrowRightLeft },
      { to: '/customers', label: 'العملاء', icon: Users },
      { to: '/suppliers', label: 'الموردون', icon: Truck },
      { to: '/branches', label: 'الفروع', icon: Store, adminOnly: true },
    ],
  },
  {
    label: 'الإدارة المالية',
    items: [
      { to: '/expenses', label: 'المصروفات', icon: Wallet },
      { to: '/payments', label: 'المدفوعات', icon: ArrowLeftRight },
      { to: '/reports', label: 'التقارير والتحليلات', icon: ChartNoAxesCombined },
      { to: '/distributions', label: 'التوزيعات والشركاء', icon: HandCoins, adminOnly: true },
    ],
  },
];
function Layout() {
  const { user, company, logout } = useSession();
  const { branches, loading: branchesLoading } = useBranch();
  const [mobile, setMobile] = useState(false),
    [search, setSearch] = useState(false),
    [notifications, setNotifications] = useState(false),
    [help, setHelp] = useState(false),
    [account, setAccount] = useState(false);
  const location = useLocation();
  const { act, busy } = useAction();
  const heading =
    navigation
      .flatMap((g) => g.items)
      .find((i) => (i.to === '/' ? location.pathname === '/' : location.pathname.startsWith(i.to)))
      ?.label || (location.pathname === '/activity' ? 'سجل النشاط' : 'الإعدادات');
  useEffect(() => {
    setMobile(false);
    setAccount(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearch((s) => !s);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  return (
    <div className="app-shell">
      {mobile && <div className="sidebar-shade" onClick={() => setMobile(false)} />}
      <aside className={'sidebar ' + (mobile ? 'open' : '')}>
        <Link to="/" className="sidebar-brand" aria-label="أوركيفا الرئيسية">
          <Brand light />
        </Link>
        <div className="workspace">
          <span className="workspace-avatar">أ</span>
          <div>
            <strong>{company?.name || 'مساحة العمل'}</strong>
            <BranchSwitcher />
          </div>
        </div>
        <nav>
          {navigation.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items
                .filter((item) => !item.adminOnly || user.role === 'ADMIN')
                .map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => 'nav-item ' + (isActive ? 'active' : '')}
                  >
                    <item.icon size={19} strokeWidth={1.65} />
                    <span>{item.label}</span>
                    {item.to === '/' && <span className="nav-active-dot" />}
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <NavLink
            to="/settings"
            className={({ isActive }) => 'nav-item ' + (isActive ? 'active' : '')}
          >
            <Settings size={19} />
            <span>إعدادات النظام</span>
          </NavLink>
          <button className="nav-item help-btn" onClick={() => setHelp(true)}>
            <CircleHelp size={19} />
            <span>دليل الاستخدام</span>
            <ArrowUpRight size={16} />
          </button>
          <div className="sidebar-note">
            <div>
              <span className="live-dot" /> أعمالك متصلة
            </div>
            <span>كل خطوة، في مكانها الصحيح.</span>
            <span className="sidebar-note-art">✳</span>
          </div>
          <div className="account-wrap">
            <button className="account" onClick={() => setAccount(!account)}>
              <span className="user-avatar">
                {user.name
                  .split(' ')
                  .slice(0, 2)
                  .map((w) => w[0])
                  .join('')}
              </span>
              <div>
                <strong>{user.name}</strong>
                <span>{user.role === 'ADMIN' ? 'مدير النظام' : 'موظف مبيعات'}</span>
              </div>
              <ChevronDown size={15} />
            </button>
            {account && (
              <div className="account-menu">
                <Link to="/settings">إدارة الحساب</Link>
                <button disabled={busy} onClick={() => void act(logout)}>
                  <LogOut size={15} />
                  تسجيل الخروج
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-btn mobile-menu"
              onClick={() => setMobile(true)}
              aria-label="فتح القائمة"
            >
              <Menu size={22} />
            </button>
            <span>مساحة العمل</span>
            <ChevronLeft size={13} />
            <strong>{heading}</strong>
          </div>
          <div className="topbar-actions">
            <button className="global-search" onClick={() => setSearch(true)}>
              <Search size={16} />
              <span>ابحث في مساحة العمل...</span>
              <kbd>
                <Command size={11} /> K
              </kbd>
            </button>
            <span className="top-divider" />
            <button
              className="icon-btn notification-button"
              onClick={() => setNotifications(true)}
              aria-label="عرض التنبيهات"
            >
              <Bell size={20} />
            </button>
            <span className="mini-avatar">{user.name[0]}</span>
          </div>
        </header>
        <main className="main-content">
          {!branchesLoading && user.role !== 'ADMIN' && !branches.length && (
            <div className="warning-banner branch-warning">
              لم تُربط بأي فرع بعد. اطلب من مدير النظام إضافتك إلى فرعك لتبدأ العمل.
            </div>
          )}
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/products" element={<Products />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/customers" element={<Parties type="CUSTOMER" key="customers" />} />
              <Route path="/suppliers" element={<Parties type="SUPPLIER" key="suppliers" />} />
              <Route path="/sales" element={<Documents type="SALE" key="sales" />} />
              <Route path="/purchases" element={<Documents type="PURCHASE" key="purchases" />} />
              <Route path="/sales/new" element={<DocumentEditor type="SALE" key="sale-new" />} />
              <Route
                path="/purchases/new"
                element={<DocumentEditor type="PURCHASE" key="purchase-new" />}
              />
              <Route path="/sales/:id/edit" element={<DocumentEditor type="SALE" />} />
              <Route path="/purchases/:id/edit" element={<DocumentEditor type="PURCHASE" />} />
              <Route path="/sales/:id" element={<DocumentDetail />} />
              <Route path="/purchases/:id" element={<DocumentDetail />} />
              <Route path="/transfers" element={<Transfers />} />
              <Route
                path="/branches"
                element={user.role === 'ADMIN' ? <Branches /> : <Navigate to="/" />}
              />
              <Route
                path="/distributions"
                element={user.role === 'ADMIN' ? <Distributions /> : <Navigate to="/" />}
              />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/payments" element={<Payments />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route
                path="/activity"
                element={user.role === 'ADMIN' ? <ActivityPage /> : <Navigate to="/" />}
              />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
          <footer className="page-footer">
            <span>
              أوركيفا <span className="footer-dot">·</span> كل أعمالك، بوضوح.
            </span>
            <span className="footer-secure">
              <ShieldCheck size={13} /> اتصال بمساحة العمل <span className="num">v1.0</span>
            </span>
          </footer>
        </main>
      </div>
      {search && <GlobalSearch onClose={() => setSearch(false)} />}{' '}
      {notifications && <Notifications onClose={() => setNotifications(false)} />}{' '}
      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  );
}
function GlobalSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ name: string; sub: string; url: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  useEffect(() => {
    Promise.all([
      api<Product[]>('/products'),
      api<Party[]>('/parties?type=CUSTOMER'),
      api<Party[]>('/parties?type=SUPPLIER'),
      api<Document[]>('/documents?type=SALE'),
      api<Document[]>('/documents?type=PURCHASE'),
    ])
      .then(([products, customers, suppliers, sales, purchases]) =>
        setResults([
          ...products.map((p) => ({
            name: p.name,
            sub: p.sku + ' · منتج',
            url: '/products?q=' + encodeURIComponent(p.sku),
          })),
          ...customers.map((p) => ({
            name: p.name,
            sub: p.phone + ' · عميل',
            url: '/customers?q=' + encodeURIComponent(p.name),
          })),
          ...suppliers.map((p) => ({
            name: p.name,
            sub: p.phone + ' · مورد',
            url: '/suppliers?q=' + encodeURIComponent(p.name),
          })),
          ...[...sales, ...purchases].map((d) => ({
            name: d.number,
            sub: d.party_name + ' · ' + money(d.total) + ' ج.م',
            url: `/${d.type === 'SALE' ? 'sales' : 'purchases'}/${d.id}`,
          })),
        ]),
      )
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  const found = query.trim()
    ? results
        .filter((r) => (r.name + ' ' + r.sub).toLowerCase().includes(query.toLowerCase()))
        .slice(0, 12)
    : [];
  return (
    <Modal title="بحث في مساحة العمل" onClose={onClose}>
      <div className="modal-body">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="اسم العميل، كود المنتج أو رقم الفاتورة..."
        />
        <div className="search-results">
          {loading ? (
            <Loading />
          ) : error ? (
            <p>{error}</p>
          ) : (
            found.map((r) => (
              <button
                key={r.url}
                onClick={() => {
                  navigate(r.url);
                  onClose();
                }}
              >
                <span className="search-result-icon">
                  <Search size={17} />
                </span>
                <span>
                  <strong>{r.name}</strong>
                  <small>{r.sub}</small>
                </span>
                <ChevronLeft size={16} />
              </button>
            ))
          )}
          {!loading && !found.length && (
            <div className="search-hint">
              {query ? 'لا توجد نتائج مطابقة لبحثك.' : 'ابدأ بالكتابة للوصول إلى بياناتك بسرعة.'}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
function Notifications({ onClose }: { onClose: () => void }) {
  const { activeId } = useBranch();
  const data = useData<DashboardData>(
    withBranch(`/dashboard?from=${dayOffset(-29)}&to=${today()}`, activeId),
  );
  return (
    <Modal
      title="مركز التنبيهات"
      description="كل ما يحتاج انتباهك، في مكان واحد."
      onClose={onClose}
    >
      <div className="modal-body">
        {data.loading ? (
          <Loading />
        ) : (
          <>
            {data.data?.overdueCount ? (
              <Link onClick={onClose} className="notification-item" to="/sales?status=overdue">
                <span className="notification-icon amber">
                  <ReceiptText />
                </span>
                <div>
                  <b>{data.data.overdueCount} فواتير تجاوزت تاريخ الاستحقاق</b>
                  <p>تابع تحصيل المستحقات من عملائك.</p>
                </div>
                <ChevronLeft size={16} />
              </Link>
            ) : null}
            {data.data?.lowStock.map((p) => (
              <Link
                onClick={onClose}
                className="notification-item"
                to={'/inventory?q=' + encodeURIComponent(p.sku)}
                key={(p.branch_id ?? '') + p.id}
              >
                <span className="notification-icon">
                  <Package />
                </span>
                <div>
                  <b>{p.name}</b>
                  <p>
                    المتبقي {p.stock} {p.unit} · الحد الأدنى {p.min_stock}
                    {p.branch_name ? ` · ${p.branch_name}` : ''}
                  </p>
                </div>
                <ChevronLeft size={16} />
              </Link>
            ))}
            {data.error && <p>{data.error}</p>}
            {data.data && !data.data.overdueCount && !data.data.lowStock.length && (
              <p>كل شيء على ما يرام. لا توجد تنبيهات حالياً.</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
function Help({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="أهلاً بك في أوركيفا"
      description="دليلك السريع لبدء إدارة أعمالك."
      onClose={onClose}
    >
      <div className="modal-body help-content">
        {[
          [
            '١',
            'جهّز مساحة عملك',
            'أضف بيانات شركتك من الإعدادات، ثم المنتجات والعملاء والموردين.',
          ],
          [
            '٢',
            'أنشئ فاتورتك الأولى',
            'ابدأ من المبيعات أو المشتريات. المسودة لا تؤثر على المخزون أو التقارير حتى اعتمادها.',
          ],
          [
            '٣',
            'اعتمد وسجّل الدفع',
            'اعتماد البيع يخصم المخزون، واعتماد الشراء يضيفه. سجّل دفعة كاملة أو جزئية من تفاصيل الفاتورة.',
          ],
          [
            '٤',
            'تابع الصورة الكاملة',
            'راجع حركة المخزون والتقارير والمصروفات. يمكنك تصدير الجداول أو طباعة الفواتير.',
          ],
        ].map(([n, t, d]) => (
          <div className="help-step" key={n}>
            <span>{n}</span>
            <div>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          </div>
        ))}
        <div className="info-banner">
          <ShieldCheck size={19} />
          <span>
            جميع التغييرات المالية محفوظة في سجل النشاط. لا يمكن إلغاء فاتورة لها دفعات مسجلة.
          </span>
        </div>
      </div>
    </Modal>
  );
}
