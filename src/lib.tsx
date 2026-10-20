import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from 'react';
import {
  Check,
  X,
  AlertCircle,
  LoaderCircle,
  Search,
  ChevronLeft,
  ChevronRight,
  Inbox,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import type { User, Company, Document } from './types';
import { api, SessionExpiredError } from './api';
export { api } from './api';
export const money = (value: number, decimals = 0) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value / 100);
export const count = (value: number) => new Intl.NumberFormat('en-US').format(value);
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const dayOffset = (days: number, base = today()) =>
  new Date(Date.parse(base) + days * 86400000).toISOString().slice(0, 10);
export const formatDate = (date: string, short = false) =>
  new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: short ? 'short' : 'long',
    ...(short ? {} : { year: 'numeric' }),
    timeZone: 'Africa/Cairo',
  }).format(new Date(date));
export const toCents = (value: FormDataEntryValue | null) => Math.round(Number(value) * 100);
export const methods = { CASH: 'نقداً', BANK: 'تحويل بنكي', CARD: 'بطاقة بنكية' };

/**
 * Debounces a rapidly-changing value (e.g. a search box) so downstream filtering/requests
 * only run after the user pauses typing. Returns the settled value.
 */
export function useDebounced<T>(value: T, delay = 220): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return settled;
}

/** Persists a small UI preference (density, auto-print, ...) under a namespaced key. */
export function usePref<T>(key: string, initial: T) {
  const storageKey = 'orqiva.pref.' + key;
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === null ? initial : (JSON.parse(stored) as T);
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* Private browsing may refuse storage; the value still works for this visit. */
      }
    },
    [storageKey],
  );
  return [value, update] as const;
}

export function useData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(Boolean(url)),
    [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      setError('');
      return;
    }
    let alive = true;
    setLoading(true);
    setError('');
    api<T>(url)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : 'تعذر تحميل البيانات');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [url, version]);
  return { data, error, loading, reload };
}
type SessionContextType = {
  user: User;
  company: Company | null;
  refreshCompany: () => void;
  logout: () => Promise<void>;
};
export const SessionContext = createContext<SessionContextType | null>(null);
export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('Session is required');
  return context;
}
type ToastMessage = { id: number; text: string; type: 'success' | 'error' };
const ToastContext = createContext<(text: string, type?: 'success' | 'error') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const notify = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5500);
  }, []);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + t.type}>
            {t.type === 'success' ? <Check size={19} /> : <AlertCircle size={19} />}
            <span>{t.text}</span>
            <button
              className="icon-btn"
              onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}
              aria-label="إغلاق"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
export function useAction() {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const pending = useRef(false);
  return {
    busy,
    act: async (fn: () => Promise<void>, message?: string) => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true);
      try {
        await fn();
        if (message) toast(message);
      } catch (e) {
        if (!(e instanceof SessionExpiredError))
          toast(e instanceof Error ? e.message : 'تعذر إتمام العملية', 'error');
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
  };
}
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{actions}</div>
    </div>
  );
}
export function Button({
  children,
  variant = 'primary',
  busy = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      className={`btn btn-${variant} ${props.className || ''}`}
    >
      {busy ? <LoaderCircle size={17} className="spin" /> : null}
      {children}
    </button>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = 'بحث...',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-box">
      <Search size={17} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value && (
        <button className="icon-btn" onClick={() => onChange('')} aria-label="مسح البحث">
          <X size={15} />
        </button>
      )}
    </div>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const elements = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]',
        ) || [],
      );
    elements()[0]?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key === 'Tab') {
        const list = elements(),
          first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('keydown', listener);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={'modal ' + (wide ? 'modal-wide' : '')}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button onClick={onClose} className="icon-btn" aria-label="إغلاق النافذة">
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Confirm({
  title,
  description,
  onConfirm,
  onClose,
  busy,
}: {
  title: string;
  description: string;
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="confirm-body">
        <div className="confirm-icon">
          <AlertCircle />
        </div>
        <p>{description}</p>
      </div>
      <div className="modal-footer">
        <Button variant="danger" busy={busy} onClick={onConfirm}>
          تأكيد العملية
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          تراجع
        </Button>
      </div>
    </Modal>
  );
}
export function Loading() {
  return (
    <div className="loading-state">
      <LoaderCircle className="spin" size={27} />
      <span>جاري تحميل بياناتك...</span>
    </div>
  );
}
export function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="empty-state">
      <AlertCircle size={32} />
      <h3>تعذر تحميل البيانات</h3>
      <p>{message}</p>
      <Button variant="secondary" onClick={retry}>
        إعادة المحاولة
      </Button>
    </div>
  );
}
export function Empty({
  title = 'لا توجد نتائج',
  description = 'جرّب تغيير البحث أو أضف أول سجل للبدء.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Inbox size={29} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Status({ doc }: { doc: Document }) {
  const isReturn = doc.type === 'SALE_RETURN' || doc.type === 'PURCHASE_RETURN';
  const status =
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
  const labels: Record<string, string> = {
    draft: 'مسودة',
    cancelled: 'ملغاة',
    paid: isReturn ? 'معتمد' : 'مدفوعة',
    overdue: 'متأخرة',
    partial: 'مدفوعة جزئياً',
    pending: 'بانتظار الدفع',
  };
  return (
    <span className={'badge ' + status}>
      <i />
      {labels[status]}
    </span>
  );
}
export function Stat({
  label,
  value,
  unit = 'ج.م',
  icon,
  foot,
  trend,
  tone = 'green',
}: {
  label: string;
  value: string;
  unit?: string;
  icon: ReactNode;
  foot?: string;
  trend?: number;
  tone?: string;
}) {
  return (
    <div className={'stat-card ' + tone}>
      <div className="stat-top">
        <span>{label}</span>
        <div className="stat-icon">{icon}</div>
      </div>
      <div className="stat-value num">
        {value}
        <small>{unit}</small>
      </div>
      <div className="stat-foot">
        {trend !== undefined ? (
          <span className={trend >= 0 ? 'trend positive' : 'trend negative'}>
            {trend >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            <b className="num">{Math.abs(trend)}%</b>
          </span>
        ) : (
          <span className="tiny-dot" />
        )}
        <span>{foot || 'خلال الفترة المحددة'}</span>
      </div>
    </div>
  );
}
export function Pagination({
  page,
  setPage,
  total,
  size = 8,
}: {
  page: number;
  setPage: (p: number) => void;
  total: number;
  size?: number;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pagination">
      <span>
        عرض{' '}
        <b className="num">
          {total ? (page - 1) * size + 1 : 0}–{Math.min(page * size, total)}
        </b>{' '}
        من <b className="num">{total}</b> نتيجة
      </span>
      <div>
        <button
          className="icon-btn"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
          aria-label="الصفحة السابقة"
        >
          <ChevronRight size={17} />
        </button>
        {Array.from({ length: pages }, (_, i) => i + 1)
          .filter((p) => p === 1 || p === pages || Math.abs(page - p) <= 1)
          .map((p, i, a) => (
            <span key={p}>
              {i > 0 && p - a[i - 1] > 1 && <span className="ellipsis">…</span>}
              <button
                className={'page-button ' + (page === p ? 'active' : '')}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            </span>
          ))}
        <button
          className="icon-btn"
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
          aria-label="الصفحة التالية"
        >
          <ChevronLeft size={17} />
        </button>
      </div>
    </div>
  );
}
export function downloadCSV(name: string, headers: string[], rows: (string | number)[][]) {
  const escape = (cell: string | number) => {
    let value = String(cell);
    if (/^[=+\-@\t\r]/.test(value)) value = "'" + value;
    return '"' + value.replace(/"/g, '""') + '"';
  };
  const csv = '\ufeff' + [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download =
    'orqiva-' +
    (name.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || today()) +
    '.csv';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function formValues(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  return new FormData(e.currentTarget);
}
export function Initials({ name, tone = 0 }: { name: string; tone?: number }) {
  return (
    <span className={'initials tone-' + (tone % 5)}>
      {name
        .replace(/^(شركة|مؤسسة|مجموعة|مكتب)\s/, '')
        .split(' ')
        .slice(0, 2)
        .map((w) => w[0])
        .join('')}
    </span>
  );
}
