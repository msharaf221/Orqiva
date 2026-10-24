import { useEffect, useState, useMemo } from 'react';
import {
  Shield,
  Check,
  X,
  RotateCcw,
  Search,
  ReceiptText,
  ShoppingBag,
  Store,
  Boxes,
  Wallet,
  Users,
  SlidersHorizontal,
} from 'lucide-react';
import { api, Button, Modal, Loading, useAction, useToast, Initials } from '../lib';
import type { User, Role, PermissionKey } from '../types';

interface PermissionCatalogItem {
  key: PermissionKey;
  category: string;
  label: string;
  description: string;
}

interface UserPermissionsResponse {
  role: Role;
  effective: PermissionKey[];
  overrides: Record<string, boolean>;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'مدير النظام',
  BRANCH_MANAGER: 'مدير فرع',
  GENERAL_ACCOUNTANT: 'محاسب عام',
  TREASURY_ACCOUNTANT: 'محاسب خزنة',
  CASHIER: 'كاشير نقطة بيع',
  STAFF: 'موظف مبيعات',
};

const CATEGORY_ICONS: Record<string, typeof ReceiptText> = {
  المبيعات: ReceiptText,
  المشتريات: ShoppingBag,
  'نقطة البيع (POS)': Store,
  'المخزون والتحويلات': Boxes,
  'المالية والمصروفات': Wallet,
  'العملاء والموردون': Users,
  'الإدارة والنظام': Shield,
};

/**
 * Default (seeded) permissions per system role — mirrors database/migrations/007|008|010.
 * Used only for visual indication of which permissions are role defaults vs overrides.
 */
const ROLE_DEFAULT_MAP: Record<string, PermissionKey[]> = {
  ADMIN: [], // Admin has every permission
  BRANCH_MANAGER: [
    'documents:view',
    'documents:create_sale',
    'documents:create_purchase',
    'documents:post',
    'documents:cancel',
    'inventory:view',
    'inventory:adjust',
    'transfers:manage',
    'parties:view',
    'parties:manage',
    'finance:view',
    'finance:payments',
    'finance:expenses',
    'reports:view',
    'pos:access',
    'pos:shift_open',
    'pos:shift_close',
    'pos:cash_movement',
    'pos:discount',
  ],
  GENERAL_ACCOUNTANT: [
    'documents:view',
    'documents:create_sale',
    'documents:create_purchase',
    'documents:post',
    'documents:cancel',
    'inventory:view',
    'parties:view',
    'parties:manage',
    'finance:view',
    'finance:payments',
    'finance:expenses',
    'finance:accounts',
    'reports:view',
    'reports:group_overview',
  ],
  TREASURY_ACCOUNTANT: [
    'pos:access',
    'pos:shift_close',
    'pos:cash_movement',
    'documents:view',
    'finance:view',
    'finance:payments',
    'finance:expenses',
    'finance:accounts',
    'reports:view',
  ],
  CASHIER: [
    'pos:access',
    'pos:shift_open',
    'pos:shift_close',
    'pos:cash_movement',
    'pos:discount',
    'documents:view',
    'documents:create_sale',
    'documents:post',
    'parties:view',
    'parties:manage',
    'inventory:view',
  ],
  STAFF: [
    'documents:view',
    'documents:create_sale',
    'documents:post',
    'parties:view',
    'parties:manage',
    'finance:view',
    'finance:payments',
    'inventory:view',
    'transfers:manage',
  ],
};

export function PermissionsModal({
  targetUser,
  onClose,
  onSaved,
}: {
  targetUser: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [catalog, setCatalog] = useState<PermissionCatalogItem[]>([]);
  const [overrides, setOverrides] = useState<Record<string, boolean | null>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [onlyOverrides, setOnlyOverrides] = useState(false);
  const { busy, act } = useAction();
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      try {
        setLoading(true);
        const [catData, permData] = await Promise.all([
          api<PermissionCatalogItem[]>('/permissions/catalog'),
          api<UserPermissionsResponse>(`/users/${targetUser.id}/permissions`),
        ]);
        if (!cancelled) {
          setCatalog(catData);
          setOverrides(permData.overrides || {});
        }
      } catch (err: any) {
        toast(err.message || 'فشل تحميل كتالوج الصلاحيات');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadData();
    return () => {
      cancelled = true;
    };
  }, [targetUser.id]);

  const categories = useMemo(() => {
    const list: string[] = [];
    catalog.forEach((c) => {
      if (!list.includes(c.category)) list.push(c.category);
    });
    return list;
  }, [catalog]);

  const isRoleAdmin = targetUser.role === 'ADMIN';

  // Overall Statistics
  const stats = useMemo(() => {
    let activeCount = 0;
    let revokedCount = 0;
    let overrideCount = 0;

    catalog.forEach((item) => {
      const overrideVal = overrides[item.key];
      const defaultGranted =
        isRoleAdmin || (ROLE_DEFAULT_MAP[targetUser.role] || []).includes(item.key);
      const isCustom = overrideVal !== undefined && overrideVal !== null;
      const isEffective = isCustom ? overrideVal : defaultGranted;

      if (isCustom) overrideCount++;
      if (isEffective) activeCount++;
      else revokedCount++;
    });

    return { activeCount, revokedCount, overrideCount };
  }, [catalog, overrides, targetUser.role, isRoleAdmin]);

  const handleSetOverride = (key: string, val: boolean | null) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (val === null) {
        delete next[key];
      } else {
        next[key] = val;
      }
      return next;
    });
  };

  const handleBatchCategory = (categoryName: string, action: 'grant' | 'revoke' | 'reset') => {
    const categoryItems = catalog.filter((c) => c.category === categoryName);
    setOverrides((prev) => {
      const next = { ...prev };
      categoryItems.forEach((item) => {
        if (action === 'reset') {
          delete next[item.key];
        } else {
          next[item.key] = action === 'grant';
        }
      });
      return next;
    });
  };

  const handleResetAll = () => {
    setOverrides({});
  };

  const handleSave = () => {
    void act(async () => {
      await api(`/users/${targetUser.id}/permissions`, 'PUT', overrides);
      toast('تم حفظ الصلاحيات المخصصة بنجاح');
      onSaved();
    });
  };

  // Filter Catalog
  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.filter((item) => {
      const matchCat = selectedCategory === 'ALL' || item.category === selectedCategory;
      const matchSearch =
        !q ||
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.key.toLowerCase().includes(q);
      const isCustom = overrides[item.key] !== undefined && overrides[item.key] !== null;
      const matchCustomOnly = !onlyOverrides || isCustom;
      return matchCat && matchSearch && matchCustomOnly;
    });
  }, [catalog, search, selectedCategory, onlyOverrides, overrides]);

  // Group by category for structured layout
  const groupedCatalog = useMemo(() => {
    const groups: Record<string, PermissionCatalogItem[]> = {};
    filteredCatalog.forEach((item) => {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    });
    return groups;
  }, [filteredCatalog]);

  return (
    <Modal
      size="xl"
      showMaximize
      title="إدارة وتخصيص صلاحيات المستخدم"
      description={`تعديل دقيق للصلاحيات الافتراضية والاستثناءات لـ: ${targetUser.name}`}
      onClose={onClose}
    >
      <div className="modal-body perms-redesigned-body">
        {loading ? (
          <Loading />
        ) : (
          <>
            {/* 1. Header Profile Banner */}
            <div className="perms-hero-card">
              <div className="perms-user-summary">
                <Initials name={targetUser.name} />
                <div className="perms-user-details">
                  <div className="perms-user-name-row">
                    <strong>{targetUser.name}</strong>
                    <span className="perms-role-badge">
                      {ROLE_LABELS[targetUser.role] || targetUser.role}
                    </span>
                  </div>
                  <span className="perms-user-email">{targetUser.email}</span>
                </div>
              </div>

              {/* Live Metric Pills */}
              <div className="perms-metrics-pills">
                <div className="perms-metric-pill active">
                  <span className="metric-indicator active" />
                  <span>مفعلة:</span>
                  <b>{stats.activeCount}</b>
                </div>
                <div className="perms-metric-pill disabled">
                  <span className="metric-indicator disabled" />
                  <span>محظورة:</span>
                  <b>{stats.revokedCount}</b>
                </div>
                <div className="perms-metric-pill custom">
                  <span className="metric-indicator custom" />
                  <span>استثناءات مخصصة:</span>
                  <b>{stats.overrideCount}</b>
                </div>
              </div>
            </div>

            {/* Explanation Note */}
            <div className="perms-info-banner">
              <Shield size={18} className="perms-info-icon" />
              <p>
                {isRoleAdmin
                  ? 'مدير النظام يتمتع بكافة الصلاحيات تلقائياً. يمكنك تخصيص قيود أو استثناءات إذا لزم الأمر.'
                  : `الصلاحيات الملونة بالرمادي موروثة تلقائياً من دور «${ROLE_LABELS[targetUser.role]}». النقر على «مسموح» أو «محظور» يُنشئ استثناءً خاصاً ومباشراً لهذا الموظف.`}
              </p>
            </div>

            {/* 2. Filter Bar & Search */}
            <div className="perms-filter-bar">
              <div className="perms-search-input">
                <Search size={16} />
                <input
                  type="text"
                  placeholder="ابحث بالاسم، المعرّف (Key) أو الوصف..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    type="button"
                    className="perms-search-clear"
                    onClick={() => setSearch('')}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <button
                type="button"
                className={'perms-toggle-custom-btn ' + (onlyOverrides ? 'active' : '')}
                onClick={() => setOnlyOverrides(!onlyOverrides)}
              >
                <SlidersHorizontal size={14} />
                <span>الاستثناءات المخصصة فقط ({stats.overrideCount})</span>
              </button>
            </div>

            {/* Category Filter Chips */}
            <div className="perms-category-chips">
              <button
                type="button"
                className={'perms-chip ' + (selectedCategory === 'ALL' ? 'active' : '')}
                onClick={() => setSelectedCategory('ALL')}
              >
                الكل ({catalog.length})
              </button>
              {categories.map((cat) => {
                const CatIcon = CATEGORY_ICONS[cat] || Shield;
                const count = catalog.filter((c) => c.category === cat).length;
                return (
                  <button
                    key={cat}
                    type="button"
                    className={'perms-chip ' + (selectedCategory === cat ? 'active' : '')}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    <CatIcon size={13} />
                    <span>{cat}</span>
                    <small>({count})</small>
                  </button>
                );
              })}
            </div>

            {/* 3. Grouped Permissions Cards */}
            <div className="perms-groups-list">
              {Object.keys(groupedCatalog).length === 0 ? (
                <div className="perms-no-results">
                  <p>لا توجد صلاحيات مطابقة لمعايير البحث الحالية.</p>
                </div>
              ) : (
                Object.entries(groupedCatalog).map(([categoryName, items]) => {
                  const CatIcon = CATEGORY_ICONS[categoryName] || Shield;
                  return (
                    <div className="perms-category-block" key={categoryName}>
                      {/* Section Card Header */}
                      <div className="perms-cat-header">
                        <div className="perms-cat-title">
                          <span className="perms-cat-icon-wrap">
                            <CatIcon size={16} />
                          </span>
                          <strong>{categoryName}</strong>
                          <span className="perms-cat-counter">{items.length} صلاحيات</span>
                        </div>

                        {/* Batch Action Buttons */}
                        <div className="perms-batch-actions">
                          <button
                            type="button"
                            className="perms-batch-btn grant"
                            onClick={() => handleBatchCategory(categoryName, 'grant')}
                            title="منح جميع صلاحيات هذا القسم"
                          >
                            <Check size={12} /> منح الكل
                          </button>
                          <button
                            type="button"
                            className="perms-batch-btn revoke"
                            onClick={() => handleBatchCategory(categoryName, 'revoke')}
                            title="حجب جميع صلاحيات هذا القسم"
                          >
                            <X size={12} /> حجب الكل
                          </button>
                          <button
                            type="button"
                            className="perms-batch-btn reset"
                            onClick={() => handleBatchCategory(categoryName, 'reset')}
                            title="إعادة ضبط صلاحيات هذا القسم إلى افتراضي الدور"
                          >
                            <RotateCcw size={12} /> افتراضي
                          </button>
                        </div>
                      </div>

                      {/* Items List in this category */}
                      <div className="perms-items-table">
                        {items.map((item) => {
                          const overrideVal = overrides[item.key];
                          const defaultGranted =
                            isRoleAdmin ||
                            (ROLE_DEFAULT_MAP[targetUser.role] || []).includes(item.key);

                          const isCustom = overrideVal !== undefined && overrideVal !== null;

                          return (
                            <div
                              key={item.key}
                              className={
                                'perms-row-card ' +
                                (isCustom
                                  ? overrideVal
                                    ? 'override-granted'
                                    : 'override-revoked'
                                  : '')
                              }
                            >
                              {/* Left / Info */}
                              <div className="perms-row-main">
                                <div className="perms-row-title-line">
                                  <span className="perms-row-label">{item.label}</span>
                                  <code className="perms-row-key">{item.key}</code>
                                  {isCustom ? (
                                    <span
                                      className={
                                        'perms-badge-override ' +
                                        (overrideVal ? 'granted' : 'revoked')
                                      }
                                    >
                                      {overrideVal ? 'استثناء: منح (+)' : 'استثناء: حجب (-)'}
                                    </span>
                                  ) : (
                                    <span
                                      className={
                                        'perms-badge-inherited ' +
                                        (defaultGranted ? 'active' : 'inactive')
                                      }
                                    >
                                      {defaultGranted ? 'موروث (مسموح)' : 'موروث (محظور)'}
                                    </span>
                                  )}
                                </div>
                                <p className="perms-row-desc">{item.description}</p>
                              </div>

                              {/* Right / Modern 3-Way Segmented Control */}
                              <div className="perms-segmented-pill">
                                <button
                                  type="button"
                                  className={'pill-segment default ' + (!isCustom ? 'active' : '')}
                                  onClick={() => handleSetOverride(item.key, null)}
                                  title="استعادة السلوك الافتراضي الموروث من دور الموظف"
                                >
                                  افتراضي الدور
                                </button>
                                <button
                                  type="button"
                                  className={
                                    'pill-segment grant ' +
                                    (isCustom && overrideVal === true ? 'active' : '')
                                  }
                                  onClick={() => handleSetOverride(item.key, true)}
                                  title="منح الصلاحية استثنائياً لهذا المستخدم"
                                >
                                  <Check size={14} /> مسموح
                                </button>
                                <button
                                  type="button"
                                  className={
                                    'pill-segment revoke ' +
                                    (isCustom && overrideVal === false ? 'active' : '')
                                  }
                                  onClick={() => handleSetOverride(item.key, false)}
                                  title="حجب الصلاحية استثنائياً عن هذا المستخدم"
                                >
                                  <X size={14} /> محظور
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {/* 4. Modal Footer with Live Summary */}
      <div className="modal-footer perms-footer-bar">
        <div className="perms-footer-summary">
          <Button
            type="button"
            variant="secondary"
            onClick={handleResetAll}
            disabled={loading || busy || Object.keys(overrides).length === 0}
            className="perms-reset-all-btn"
          >
            <RotateCcw size={15} /> استعادة كل الافتراضيات
          </Button>
          {stats.overrideCount > 0 && (
            <span className="perms-footer-note">
              يوجد <b>{stats.overrideCount}</b> استثناءات مخصصة ستُطبّق على المستخدم
            </span>
          )}
        </div>

        <div className="perms-footer-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            إلغاء
          </Button>
          <Button type="button" onClick={handleSave} busy={busy} disabled={loading}>
            حفظ التعديلات
          </Button>
        </div>
      </div>
    </Modal>
  );
}
