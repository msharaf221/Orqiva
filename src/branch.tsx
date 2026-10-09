import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, useSession } from './lib';
import type { Branch } from './types';

/** `all` is the group view (administrators); otherwise the id of one open branch. */
export const GROUP = 'all';

interface BranchState {
  /** Open branches the user can work in. */
  branches: Branch[];
  loading: boolean;
  error: string;
  activeId: string;
  active: Branch | null;
  isGroup: boolean;
  /** Branch used to pre-select forms when the group view is active. */
  defaultBranchId: string;
  setActiveId: (id: string) => void;
  reload: () => void;
}

const BranchContext = createContext<BranchState | null>(null);

export function BranchProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const isAdmin = user.role === 'ADMIN';
  const storageKey = `orqiva.branch.${user.id}`;
  const [all, setAll] = useState<Branch[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [version, setVersion] = useState(0),
    [activeId, setActive] = useState<string>(() => {
      const remembered = (() => {
        try {
          return localStorage.getItem(storageKey);
        } catch {
          return null;
        }
      })();
      return remembered || (isAdmin ? GROUP : '');
    });
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<Branch[]>('/branches')
      .then((list) => {
        if (!alive) return;
        setAll(list);
        setError('');
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : 'تعذر تحميل الفروع');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [version]);
  const open = useMemo(() => all.filter((b) => b.active), [all]);
  // A remembered or stale selection falls back to something the user may actually open.
  useEffect(() => {
    if (loading) return;
    const valid = activeId === GROUP ? isAdmin : open.some((b) => b.id === activeId);
    if (!valid) setActive(isAdmin ? GROUP : (open[0]?.id ?? ''));
  }, [loading, open, activeId, isAdmin]);
  const setActiveId = useCallback(
    (id: string) => {
      setActive(id);
      try {
        localStorage.setItem(storageKey, id);
      } catch {
        /* Private browsing may refuse storage; the selection still works for this visit. */
      }
    },
    [storageKey],
  );
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const isGroup = activeId === GROUP;
  const value: BranchState = {
    branches: open,
    loading,
    error,
    activeId,
    active: open.find((b) => b.id === activeId) ?? null,
    isGroup,
    // Forms opened from the group view book to the HQ warehouse first, then to the first open branch.
    defaultBranchId: isGroup
      ? ((open.find((b) => b.kind === 'HQ') ?? open[0])?.id ?? '')
      : activeId,
    setActiveId,
    reload,
  };
  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranch(): BranchState {
  const context = useContext(BranchContext);
  if (!context) throw new Error('Branch context is required');
  return context;
}

/** Adds the selected branch to a read URL. The group view sends `all`, which the server resolves. */
export function withBranch(url: string, branchId: string): string {
  if (!branchId) return url;
  return url + (url.includes('?') ? '&' : '?') + 'branch_id=' + encodeURIComponent(branchId);
}

/** Switcher shown in the sidebar: the group view for administrators, or one branch at a time. */
export function BranchSwitcher() {
  const { user } = useSession();
  const { branches, activeId, setActiveId, loading } = useBranch();
  return (
    <label className="branch-switch">
      <span>مساحة العمل</span>
      <select
        value={activeId}
        disabled={loading || (!branches.length && user.role !== 'ADMIN')}
        onChange={(e) => setActiveId(e.target.value)}
        aria-label="الفرع النشط"
      >
        {user.role === 'ADMIN' && <option value={GROUP}>كل الفروع (المجموعة)</option>}
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
