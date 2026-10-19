import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  Building,
  User as UserIcon,
  Clock,
  ArrowDownLeft,
  Printer,
  Barcode,
  Keyboard,
  CheckCircle2,
  AlertCircle,
  X,
  Coins,
  Store,
  RefreshCw,
} from 'lucide-react';
import { api, Button, Loading, money, useSession, useToast } from '../../lib';
import { useBranch } from '../../branch';
import type { PosShift, PosShiftSummary, Party } from '../../types';
import {
  playSound,
  DEFAULT_WALK_IN_CUSTOMER,
  type PosProduct,
  type CartItem,
  type CheckoutResult,
} from './helpers';
import { OpenShiftModal, CashMovementModal, CloseShiftModal } from './shift-modals';
import { TreasuryReviewModal, ShiftHandoverSlipModal } from './treasury-review';
import { CustomerPickerModal, DiscountModal, CheckoutModal } from './checkout';
import { ThermalReceiptModal } from './receipt';
import { HotkeysModal } from './hotkeys';

export function POS() {
  const { user, company } = useSession();
  const { active, branches, defaultBranchId } = useBranch();
  const activeBranch =
    active || branches.find((b) => b.id === defaultBranchId) || branches[0] || null;
  const toast = useToast();
  const isAccountantOrAdmin =
    user.role === 'ADMIN' || user.role === 'BRANCH_MANAGER' || user.role === 'TREASURY_ACCOUNTANT';

  // Shift & Products Data
  const [shift, setShift] = useState<PosShift | null>(null);
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);

  // Cart & Sale State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState<Party>(DEFAULT_WALK_IN_CUSTOMER);
  const [discountCents, setDiscountCents] = useState(0);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Modals
  const [openShiftModal, setOpenShiftModal] = useState(false);
  const [cashMovementModal, setCashMovementModal] = useState(false);
  const [closeShiftModal, setCloseShiftModal] = useState(false);
  const [treasuryReviewModal, setTreasuryReviewModal] = useState(false);
  const [handoverSlip, setHandoverSlip] = useState<{
    shift: PosShift;
    summary: PosShiftSummary;
  } | null>(null);
  const [customerPickerModal, setCustomerPickerModal] = useState(false);
  const [discountModal, setDiscountModal] = useState(false);
  const [checkoutModal, setCheckoutModal] = useState(false);
  const [hotkeysModal, setHotkeysModal] = useState(false);
  const [receiptResult, setReceiptResult] = useState<CheckoutResult | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  // Load Data
  const reloadData = async () => {
    if (!activeBranch) return;
    setLoading(true);
    try {
      const [shiftData, productsData, customersData] = await Promise.all([
        api<PosShift | null>(`/pos/shifts/current?branch_id=${activeBranch.id}`),
        api<PosProduct[]>(`/pos/products?branch_id=${activeBranch.id}`),
        api<Party[]>('/parties?type=CUSTOMER'),
      ]);
      setShift(shiftData);
      setProducts(productsData);
      setCustomers(customersData);

      if (isAccountantOrAdmin) {
        api<PosShift[]>(`/pos/shifts/pending-review?branch_id=${activeBranch.id}`)
          .then((l) => setPendingCount(l.length))
          .catch(() => setPendingCount(0));
      }
    } catch (err: any) {
      toast(err.message || 'تعذر تحميل بيانات نقطة البيع');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reloadData();
  }, [activeBranch?.id]);

  const fetchAndShowHandoverSlip = async (shiftId: string) => {
    try {
      const summary = await api<PosShiftSummary>(`/pos/shifts/${shiftId}/summary`);
      setHandoverSlip({ shift: summary.shift, summary });
    } catch (err: any) {
      toast(err.message || 'تعذر تحميل بيانات محضر التسليم');
    }
  };

  // Barcode Wedge Detector
  useEffect(() => {
    let barcodeBuffer = '';
    let lastKeyTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when user is typing inside text inputs/textareas
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Handle Function Hotkeys
      if (e.key === 'F2') {
        e.preventDefault();
        if (cart.length > 0 && shift) {
          setCheckoutModal(true);
        } else if (!shift) {
          toast('يرجى افتتاح وردية أولاً للبدء بالبيع');
        } else {
          toast('سلة المشتريات فارغة');
        }
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === 'F4') {
        e.preventDefault();
        setCustomerPickerModal(true);
        return;
      }
      if (e.key === 'F8') {
        e.preventDefault();
        if (shift) setCashMovementModal(true);
        else toast('لا توجد وردية مفتوحة لتسجيل حركة نقدية');
        return;
      }
      if (e.key === 'F9') {
        e.preventDefault();
        if (shift) setCloseShiftModal(true);
        else toast('لا توجد وردية مفتوحة لإغلاقها');
        return;
      }
      if (e.key === 'Escape') {
        setCheckoutModal(false);
        setCustomerPickerModal(false);
        setCashMovementModal(false);
        setCloseShiftModal(false);
        setOpenShiftModal(false);
        setDiscountModal(false);
        setHotkeysModal(false);
        return;
      }

      // Space Hotkey for instant checkout (when not typing in an input and modals closed)
      if (
        e.key === ' ' &&
        !isInput &&
        !checkoutModal &&
        !receiptResult &&
        !customerPickerModal &&
        cart.length > 0 &&
        shift
      ) {
        e.preventDefault();
        setCheckoutModal(true);
        return;
      }

      // Barcode Scanner detection: keys arrive with very low inter-key interval (< 50ms)
      const now = Date.now();
      if (now - lastKeyTime > 60) {
        barcodeBuffer = '';
      }
      lastKeyTime = now;

      if (e.key === 'Enter') {
        if (barcodeBuffer.length >= 3) {
          e.preventDefault();
          const scannedCode = barcodeBuffer.trim();
          barcodeBuffer = '';
          handleBarcodeScanned(scannedCode);
        }
      } else if (e.key.length === 1) {
        barcodeBuffer += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [products, cart, shift, checkoutModal, receiptResult, customerPickerModal]);

  const handleBarcodeScanned = (code: string) => {
    const matched = products.find((p) => p.sku.toLowerCase() === code.toLowerCase());
    if (!matched) {
      playSound(false);
      toast(`لم يتم العثور على منتج بهذا الباركود: «${code}»`);
      return;
    }

    addToCart(matched);
  };

  // Cart operations
  const addToCart = (product: PosProduct) => {
    if (shift?.status === 'PENDING_REVIEW') {
      playSound(false);
      toast('تم تسليم الوردية لمسؤول الخزنة وبانتظار الاعتماد. لا يمكن إضافة منتجات حالياً.');
      return;
    }
    if (product.stock <= 0) {
      playSound(false);
      toast(`نفد المخزون: لا توجد كمية متاحة من «${product.name}»`);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        if (existing.quantity + 1 > product.stock) {
          playSound(false);
          toast(`المخزون المتاح من «${product.name}» هو (${product.stock}) فقط`);
          return prev;
        }
        playSound(true);
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      playSound(true);
      return [...prev, { product, quantity: 1, unit_price: product.sale_price }];
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(
      (prev) =>
        prev
          .map((item) => {
            if (item.product.id !== productId) return item;
            const nextQty = item.quantity + delta;
            if (nextQty <= 0) return null;
            if (nextQty > item.product.stock) {
              playSound(false);
              toast(`المخزون المتاح من «${item.product.name}» هو (${item.product.stock}) فقط`);
              return item;
            }
            return { ...item, quantity: nextQty };
          })
          .filter(Boolean) as CartItem[],
    );
  };

  const setDirectQuantity = (productId: string, qty: number) => {
    if (qty <= 0) {
      removeFromCart(productId);
      return;
    }
    setCart((prev) =>
      prev.map((item) => {
        if (item.product.id !== productId) return item;
        if (qty > item.product.stock) {
          playSound(false);
          toast(`المخزون المتاح من «${item.product.name}» هو (${item.product.stock}) فقط`);
          return { ...item, quantity: item.product.stock };
        }
        return { ...item, quantity: qty };
      }),
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const clearCart = () => {
    setCart([]);
    setDiscountCents(0);
    setCustomer(DEFAULT_WALK_IN_CUSTOMER);
  };

  // Calculations
  const taxRate = company?.tax_rate ?? 1400; // 14% = 1400 bps
  const subtotalCents = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity * item.unit_price, 0),
    [cart],
  );
  const effectiveDiscountCents = Math.min(discountCents, subtotalCents);
  const taxCents = useMemo(
    () => Math.round(((subtotalCents - effectiveDiscountCents) * taxRate) / 10000),
    [subtotalCents, effectiveDiscountCents, taxRate],
  );
  const totalCents = subtotalCents - effectiveDiscountCents + taxCents;

  // Filter products
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => p.category && set.add(p.category));
    return Array.from(set);
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      const matchCat = selectedCategory === 'ALL' || p.category === selectedCategory;
      const matchSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.category && p.category.toLowerCase().includes(q));
      return matchCat && matchSearch;
    });
  }, [products, searchQuery, selectedCategory]);

  if (!activeBranch) {
    return (
      <div className="pos-empty-state card">
        <Store size={48} />
        <h2>يرجى اختيار فرع للعمل</h2>
        <p>تحتاج إلى تحديد الفرع النشط من القائمة العلوية لتشغيل نقطة البيع POS.</p>
      </div>
    );
  }

  return (
    <div className="pos-container">
      {/* Top POS Status Bar */}
      <div className="pos-topbar card">
        <div className="pos-topbar-right">
          <div className="pos-badge-group">
            <span className="pos-branch-badge">
              <Store size={15} />
              <b>{activeBranch.name}</b> ({activeBranch.code})
            </span>
            <span className="pos-cashier-badge">
              <UserIcon size={15} />
              <span>الكاشير:</span> <b>{user.name}</b>
            </span>
            {shift ? (
              shift.status === 'PENDING_REVIEW' ? (
                <span className="pos-shift-badge pending">
                  <Clock size={15} />
                  <span>بانتظار اعتماد الخزنة:</span> <b>{shift.number}</b>
                </span>
              ) : (
                <span className="pos-shift-badge open">
                  <Clock size={15} />
                  <span>وردية مفتوحة:</span> <b>{shift.number}</b>
                </span>
              )
            ) : (
              <span className="pos-shift-badge closed">
                <AlertCircle size={15} />
                <b>لا توجد وردية مفتوحة</b>
              </span>
            )}
          </div>
        </div>

        <div className="pos-topbar-actions">
          {isAccountantOrAdmin && (
            <Button
              variant={pendingCount > 0 ? 'primary' : 'secondary'}
              onClick={() => setTreasuryReviewModal(true)}
              title="مراجعة واعتماد ورديات نقاط البيع المسلمة"
            >
              <Building size={16} />
              <span>اعتماد ورديات الخزنة</span>
              {pendingCount > 0 && <span className="pos-badge-count">{pendingCount}</span>}
            </Button>
          )}

          {!shift ? (
            <Button onClick={() => setOpenShiftModal(true)}>
              <Plus size={16} /> افتتاح وردية جديدة
            </Button>
          ) : shift.status === 'PENDING_REVIEW' ? (
            <Button variant="secondary" onClick={() => fetchAndShowHandoverSlip(shift.id)}>
              <Printer size={16} /> سند تسليم الوردية
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setCashMovementModal(true)}>
                <ArrowDownLeft size={16} /> حركة نقدية (درج)
              </Button>
              <Button variant="secondary" onClick={() => setCloseShiftModal(true)}>
                <CheckCircle2 size={16} /> تسليم الوردية للخزنة (F9)
              </Button>
            </>
          )}
          <button
            className="icon-btn"
            onClick={reloadData}
            title="تحديث البيانات"
            aria-label="تحديث البيانات"
          >
            <RefreshCw size={17} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setHotkeysModal(true)}
            title="دليل اختصارات الكيبورد"
            aria-label="دليل اختصارات الكيبورد"
          >
            <Keyboard size={17} />
          </button>
        </div>
      </div>

      {/* Shift Pending Review Banner */}
      {shift?.status === 'PENDING_REVIEW' && (
        <div className="pos-pending-banner">
          <div className="pos-pending-info">
            <div className="pos-pending-icon">
              <Clock size={24} />
            </div>
            <div>
              <h4>الوردية ({shift.number}) تم تسليمها وبانتظار اعتماد محاسب الخزنة</h4>
              <p>
                تم جرد وتسجيل النقدية بالدرج ({money(shift.cashier_declared_cash || 0)} ج.م)
                وإرسالها للمراجعة. لا يمكن تسجيل مبيعات جديدة على هذه الوردية حتى يتم اعتمادها
                مالياً وترحيل القيود.
              </p>
            </div>
          </div>
          <div className="pos-pending-actions">
            <Button variant="secondary" onClick={() => fetchAndShowHandoverSlip(shift.id)}>
              <Printer size={16} /> طباعة سند التسليم
            </Button>
          </div>
        </div>
      )}

      {/* Main POS Interface Grid: Left Cart / Right Catalog */}
      <div className="pos-layout">
        {/* Left Column (Cart & Checkout Sidebar) */}
        <div className="pos-cart-panel card">
          {/* Customer Selection Line */}
          <div className="pos-customer-bar" onClick={() => setCustomerPickerModal(true)}>
            <div className="pos-customer-info">
              <UserIcon size={18} />
              <div>
                <span className="pos-customer-label">العميل الحالي (F4)</span>
                <strong>{customer.name}</strong>
              </div>
            </div>
            <button type="button" className="pos-change-customer-btn">
              تغيير
            </button>
          </div>

          {/* Cart Items List */}
          <div className="pos-cart-items">
            {cart.length === 0 ? (
              <div className="pos-cart-empty">
                <ShoppingCart size={40} />
                <p>سلة المشتريات فارغة</p>
                <small>امسح الباركود أو اضغط على المنتجات لإضافتها</small>
              </div>
            ) : (
              cart.map((item) => {
                const lineTotal = item.quantity * item.unit_price;
                return (
                  <div className="pos-cart-row" key={item.product.id}>
                    <div className="pos-cart-row-info">
                      <strong>{item.product.name}</strong>
                      <div className="pos-cart-row-meta">
                        <span className="pos-cart-price">{money(item.unit_price)} ج.م</span>
                        <span className="pos-cart-sku">{item.product.sku}</span>
                      </div>
                    </div>

                    <div className="pos-cart-qty-controls">
                      <button
                        type="button"
                        className="pos-qty-btn"
                        onClick={() => updateQuantity(item.product.id, -1)}
                      >
                        <Minus size={14} />
                      </button>
                      <input
                        type="number"
                        className="pos-qty-input"
                        min="1"
                        max={item.product.stock}
                        value={item.quantity}
                        onChange={(e) =>
                          setDirectQuantity(item.product.id, parseInt(e.target.value) || 0)
                        }
                      />
                      <button
                        type="button"
                        className="pos-qty-btn"
                        onClick={() => updateQuantity(item.product.id, 1)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>

                    <div className="pos-cart-row-total">
                      <b>{money(lineTotal)} ج.م</b>
                      <button
                        type="button"
                        className="pos-cart-delete-btn"
                        onClick={() => removeFromCart(item.product.id)}
                        title="حذف المنتج من السلة"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Cart Summary & Financial Totals */}
          <div className="pos-cart-summary">
            <div className="pos-summary-line">
              <span>المجموع الفرعي:</span>
              <span>{money(subtotalCents)} ج.م</span>
            </div>

            <div className="pos-summary-line discount">
              <span onClick={() => setDiscountModal(true)} className="pos-discount-trigger">
                الخصم: {effectiveDiscountCents > 0 && <small>(تعديل)</small>}
              </span>
              <span>
                {effectiveDiscountCents > 0 ? `-${money(effectiveDiscountCents)}` : '0.00'} ج.م
              </span>
            </div>

            <div className="pos-summary-line">
              <span>ضريبة القيمة المضافة ({taxRate / 100}%):</span>
              <span>{money(taxCents)} ج.م</span>
            </div>

            <div className="pos-summary-total">
              <span>الإجمالي النهائي:</span>
              <strong>{money(totalCents)} ج.م</strong>
            </div>

            {/* Big Action Buttons */}
            <div className="pos-cart-actions">
              <Button
                variant="secondary"
                onClick={clearCart}
                disabled={cart.length === 0}
                className="pos-clear-btn"
              >
                <Trash2 size={16} /> مسح السلة
              </Button>

              <Button
                onClick={() => {
                  if (!shift) {
                    toast('يرجى افتتاح وردية أولاً للبدء بالبيع');
                    return;
                  }
                  if (shift.status === 'PENDING_REVIEW') {
                    toast(
                      'تم تسليم الوردية لمسؤول الخزنة وبانتظار الاعتماد. لا يمكن تسجيل مبيعات جديدة.',
                    );
                    return;
                  }
                  setCheckoutModal(true);
                }}
                disabled={cart.length === 0 || shift?.status === 'PENDING_REVIEW'}
                className="pos-pay-btn"
              >
                <Coins size={18} /> الدفع (F2 / مسافة)
              </Button>
            </div>
          </div>
        </div>

        {/* Right Column (Product Search & Catalog Grid) */}
        <div className="pos-catalog-panel card">
          {/* Search Box & Barcode Scanner Indicator */}
          <div className="pos-search-bar">
            <div className="pos-search-input-wrap">
              <Search size={18} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="ابحث بالاسم أو امسح الباركود مباشرة (F3)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="pos-clear-search"
                  onClick={() => setSearchQuery('')}
                >
                  <X size={15} />
                </button>
              )}
            </div>

            <div className="pos-barcode-indicator" title="قارئ الباركود متصل وجاهز للاستقبال">
              <Barcode size={18} />
              <span>ماسح الباركود متصل</span>
            </div>
          </div>

          {/* Category Tabs */}
          <div className="pos-category-tabs">
            <button
              type="button"
              className={'pos-cat-tab ' + (selectedCategory === 'ALL' ? 'active' : '')}
              onClick={() => setSelectedCategory('ALL')}
            >
              الكل ({products.length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={'pos-cat-tab ' + (selectedCategory === cat ? 'active' : '')}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Products Grid */}
          <div className="pos-products-grid">
            {loading ? (
              <Loading />
            ) : filteredProducts.length === 0 ? (
              <div className="pos-no-products">لا توجد منتجات مطابقة في هذا الفرع</div>
            ) : (
              filteredProducts.map((p) => {
                const inCart = cart.find((i) => i.product.id === p.id);
                const isOutOfStock = p.stock <= 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={
                      'pos-product-card ' +
                      (isOutOfStock ? 'out-of-stock ' : '') +
                      (inCart ? 'in-cart ' : '')
                    }
                    onClick={() => addToCart(p)}
                    disabled={isOutOfStock}
                  >
                    {inCart && <span className="pos-cart-badge">{inCart.quantity}</span>}
                    <div className="pos-prod-info">
                      <span className="pos-prod-name">{p.name}</span>
                      <span className="pos-prod-sku">{p.sku}</span>
                    </div>

                    <div className="pos-prod-footer">
                      <strong className="pos-prod-price">{money(p.sale_price)} ج.م</strong>
                      <span className={'pos-prod-stock ' + (isOutOfStock ? 'zero' : '')}>
                        {isOutOfStock ? 'نفد المخزون' : `متاح: ${p.stock}`}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* MODAL 1: Open Shift Modal */}
      {openShiftModal && (
        <OpenShiftModal
          branchId={activeBranch.id}
          onClose={() => setOpenShiftModal(false)}
          onSuccess={(newShift) => {
            setShift(newShift);
            setOpenShiftModal(false);
            toast('تم افتتاح الوردية بنجاح. جاهز للبيع.');
          }}
        />
      )}

      {/* MODAL 2: Cash Movement Modal */}
      {cashMovementModal && shift && (
        <CashMovementModal
          shiftId={shift.id}
          onClose={() => setCashMovementModal(false)}
          onSuccess={() => {
            setCashMovementModal(false);
            toast('تم تسجيل الحركة النقدية في الدرج بنجاح.');
          }}
        />
      )}

      {/* MODAL 3: Close Shift & Reconciliation Modal */}
      {closeShiftModal && shift && (
        <CloseShiftModal
          shiftId={shift.id}
          isAccountantOrAdmin={isAccountantOrAdmin}
          onClose={() => setCloseShiftModal(false)}
          onSubmitSuccess={(submittedShift, summary) => {
            setShift(submittedShift);
            setCloseShiftModal(false);
            setHandoverSlip({ shift: submittedShift, summary });
            toast('تم تسليم الوردية وإرسالها لمراجعة واعتماد محاسب الخزنة.');
            void reloadData();
          }}
          onDirectCloseSuccess={() => {
            setShift(null);
            setCloseShiftModal(false);
            toast('تم إغلاق الوردية واعتماد تقرير المطابقة النقدية بنجاح.');
            void reloadData();
          }}
        />
      )}

      {/* MODAL: Treasury Review & Reconciliation Modal */}
      {treasuryReviewModal && (
        <TreasuryReviewModal
          branchId={activeBranch.id}
          onClose={() => setTreasuryReviewModal(false)}
          onApproved={() => {
            void reloadData();
          }}
        />
      )}

      {/* MODAL: Cashier Handover Slip Modal */}
      {handoverSlip && (
        <ShiftHandoverSlipModal
          shift={handoverSlip.shift}
          summary={handoverSlip.summary}
          companyName={company?.name || 'مؤسسة أوركيفا'}
          branchName={activeBranch.name}
          cashierName={user.name}
          onClose={() => setHandoverSlip(null)}
        />
      )}

      {/* MODAL 4: Customer Selector Modal */}
      {customerPickerModal && (
        <CustomerPickerModal
          customers={customers}
          selectedCustomer={customer}
          onSelect={(c) => {
            setCustomer(c);
            setCustomerPickerModal(false);
          }}
          onClose={() => setCustomerPickerModal(false)}
        />
      )}

      {/* MODAL 5: Discount Modal */}
      {discountModal && (
        <DiscountModal
          subtotalCents={subtotalCents}
          currentDiscountCents={discountCents}
          onApply={(cents) => {
            setDiscountCents(cents);
            setDiscountModal(false);
          }}
          onClose={() => setDiscountModal(false)}
        />
      )}

      {/* MODAL 6: Checkout & Payment Modal */}
      {checkoutModal && shift && (
        <CheckoutModal
          branchId={activeBranch.id}
          shiftId={shift.id}
          customer={customer}
          cart={cart}
          discountCents={effectiveDiscountCents}
          totalCents={totalCents}
          onSuccess={(res) => {
            setReceiptResult(res);
            setCheckoutModal(false);
            clearCart();
            void reloadData();
          }}
          onClose={() => setCheckoutModal(false)}
        />
      )}

      {/* MODAL 7: Thermal Receipt Modal */}
      {receiptResult && (
        <ThermalReceiptModal
          result={receiptResult}
          companyName={company?.name || 'مؤسسة أوركيفا'}
          taxNumber={company?.tax_number}
          branchName={activeBranch.name}
          cashierName={user.name}
          customerName={customer.name}
          onClose={() => setReceiptResult(null)}
        />
      )}

      {/* MODAL 8: Hotkeys Guide Modal */}
      {hotkeysModal && <HotkeysModal onClose={() => setHotkeysModal(false)} />}
    </div>
  );
}

// ==========================================
// Sub-components & Dedicated Modals
// ==========================================
