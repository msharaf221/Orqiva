import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react';
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  CreditCard,
  Building,
  User as UserIcon,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  Printer,
  Sparkles,
  Barcode,
  Keyboard,
  CheckCircle2,
  AlertCircle,
  X,
  Coins,
  Store,
  RefreshCw,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { api, Button, Field, Loading, Modal, money, useAction, useSession, useToast } from '../lib';
import { useBranch } from '../branch';
import type { PosShift, PosShiftSummary, Product, Party } from '../types';
import {
  BarcodeSvg,
  QrCodeSvg,
  triggerThermalPrint,
  generateInvoiceQrData,
} from '../receipt-components';

interface PosProduct extends Product {
  stock: number;
}

interface CartItem {
  product: PosProduct;
  quantity: number;
  unit_price: number;
}

interface CheckoutResult {
  document: {
    id: string;
    number: string;
    date: string;
    total: number;
    subtotal: number;
    discount: number;
    tax: number;
    tax_rate: number;
    notes?: string;
  };
  lines?: {
    id?: string;
    name: string;
    sku?: string;
    quantity: number;
    unit_price: number;
    total: number;
  }[];
  payment: {
    method: string;
    amount_paid: number;
    amount_tendered?: number;
    change_due: number;
    reference?: string;
    splits?: Array<{ method: string; amount: number; reference?: string }>;
  };
}

const DEFAULT_WALK_IN_CUSTOMER: Party = {
  id: 'walk-in-customer',
  name: 'عميل نقدي (طائر)',
  type: 'CUSTOMER',
  email: '',
  phone: '—',
  address: '',
  tax_number: '',
  notes: '',
  balance: 0,
  documents_count: 0,
  active: 1,
  created_at: new Date().toISOString(),
};

function playSound(success = true) {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = success ? 1050 : 320;
    osc.type = success ? 'sine' : 'sawtooth';
    gain.gain.value = 0.08;
    osc.start();
    osc.stop(ctx.currentTime + (success ? 0.09 : 0.22));
  } catch {
    // Audio might not be available or permitted
  }
}

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

function OpenShiftModal({
  branchId,
  onClose,
  onSuccess,
}: {
  branchId: string;
  onClose: () => void;
  onSuccess: (shift: PosShift) => void;
}) {
  const { busy, act } = useAction();
  const [openingCash, setOpeningCash] = useState('0');
  const [notes, setNotes] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      const shift = await api<PosShift>('/pos/shifts/open', 'POST', {
        branch_id: branchId,
        opening_cash: Math.round(parseFloat(openingCash || '0') * 100),
        notes: notes.trim() || undefined,
      });
      onSuccess(shift);
    });
  };

  return (
    <Modal
      title="افتتاح وردية جديدة لنقطة البيع"
      description="أدخل الرصيد الافتتاحي في درج النقدية لبدء تسجيل المبيعات."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <div className="modal-body form-grid">
          <Field label="الرصيد النقدي الافتتاحي في الدرج (ج.م) *">
            <input
              type="number"
              step="any"
              min="0"
              required
              autoFocus
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="ملاحظات افتتاح الوردية">
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثال: وردية صباحية - فكة متوفرة"
            />
          </Field>
        </div>
        <div className="modal-footer">
          <Button type="submit" busy={busy}>
            افتتاح الوردية
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CashMovementModal({
  shiftId,
  onClose,
  onSuccess,
}: {
  shiftId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { busy, act } = useAction();
  const [type, setType] = useState<'IN' | 'OUT'>('IN');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      await api(`/pos/shifts/${shiftId}/cash-movement`, 'POST', {
        type,
        amount: Math.round(parseFloat(amount || '0') * 100),
        reason: reason.trim(),
      });
      onSuccess();
    });
  };

  return (
    <Modal
      title="تسجيل حركة نقدية في درج الوردية"
      description="إيداع فكة إضافية أو سحب مصروف طارئ أثناء الوردية."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <div className="modal-body form-grid">
          <Field label="نوع الحركة النقدية *">
            <div className="pos-segmented-control">
              <button
                type="button"
                className={'pos-segment ' + (type === 'IN' ? 'active in' : '')}
                onClick={() => setType('IN')}
              >
                <ArrowDownLeft size={16} /> توريد نقدية (إيداع فكة)
              </button>
              <button
                type="button"
                className={'pos-segment ' + (type === 'OUT' ? 'active out' : '')}
                onClick={() => setType('OUT')}
              >
                <ArrowUpRight size={16} /> سحب نقدية (مصروف طارئ)
              </button>
            </div>
          </Field>
          <Field label="المبلغ بالجنيه (ج.م) *">
            <input
              type="number"
              step="any"
              min="0.01"
              required
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="السبب أو البيان *">
            <input
              type="text"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                type === 'IN' ? 'مثال: فكة إضافية من الإدارة' : 'مثال: شراء أدوات نظافة طارئة'
              }
            />
          </Field>
        </div>
        <div className="modal-footer">
          <Button type="submit" busy={busy}>
            تسجيل الحركة
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CloseShiftModal({
  shiftId,
  isAccountantOrAdmin,
  onClose,
  onSubmitSuccess,
  onDirectCloseSuccess,
}: {
  shiftId: string;
  isAccountantOrAdmin: boolean;
  onClose: () => void;
  onSubmitSuccess: (shift: PosShift, summary: PosShiftSummary) => void;
  onDirectCloseSuccess: () => void;
}) {
  const { busy, act } = useAction();
  const [summary, setSummary] = useState<PosShiftSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [directClose, setDirectClose] = useState(false);

  // Cashier counts and declarations
  const [closingCash, setClosingCash] = useState('');
  const [closingCard, setClosingCard] = useState('');
  const [terminalBatchNumber, setTerminalBatchNumber] = useState('');
  const [cardSlipsCount, setCardSlipsCount] = useState('');
  const [closingBank, setClosingBank] = useState('');
  const [bankTransfersCount, setBankTransfersCount] = useState('');
  const [safeEnvelopeNumber, setSafeEnvelopeNumber] = useState('');
  const [proofDocuments, setProofDocuments] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    api<PosShiftSummary>(`/pos/shifts/${shiftId}/summary`)
      .then((data) => {
        setSummary(data);
        setClosingCash((data.expected_cash / 100).toFixed(2));
        setClosingCard((data.expected_card / 100).toFixed(2));
        setClosingBank((data.expected_bank / 100).toFixed(2));
      })
      .finally(() => setLoading(false));
  }, [shiftId]);

  const cashCountedCents = Math.round(parseFloat(closingCash || '0') * 100);
  const cashExpectedCents = summary?.expected_cash ?? 0;
  const cashDiffCents = cashCountedCents - cashExpectedCents;

  const cardCountedCents = Math.round(parseFloat(closingCard || '0') * 100);
  const cardExpectedCents = summary?.expected_card ?? 0;
  const cardDiffCents = cardCountedCents - cardExpectedCents;

  const bankCountedCents = Math.round(parseFloat(closingBank || '0') * 100);
  const bankExpectedCents = summary?.expected_bank ?? 0;
  const bankDiffCents = bankCountedCents - bankExpectedCents;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      if (directClose && isAccountantOrAdmin) {
        await api(`/pos/shifts/${shiftId}/close`, 'POST', {
          closing_cash: cashCountedCents,
          closing_card: cardCountedCents,
          closing_bank: bankCountedCents,
          notes: notes.trim() || undefined,
        });
        onDirectCloseSuccess();
      } else {
        const submitted = await api<PosShift>(`/pos/shifts/${shiftId}/submit`, 'POST', {
          declared_cash: cashCountedCents,
          declared_card: cardCountedCents,
          declared_bank: bankCountedCents,
          terminal_batch_number: terminalBatchNumber.trim() || undefined,
          card_slips_count: cardSlipsCount ? parseInt(cardSlipsCount, 10) : undefined,
          bank_transfers_count: bankTransfersCount ? parseInt(bankTransfersCount, 10) : undefined,
          safe_envelope_number: safeEnvelopeNumber.trim() || undefined,
          proof_documents: proofDocuments.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        if (summary) {
          onSubmitSuccess(submitted, {
            ...summary,
            cashier_declared_cash: cashCountedCents,
            cashier_declared_card: cardCountedCents,
            cashier_declared_bank: bankCountedCents,
            card_difference: cardDiffCents,
            bank_difference: bankDiffCents,
          });
        }
      }
    });
  };

  return (
    <Modal
      title={
        directClose
          ? 'إغلاق الوردية والاعتماد المباشر (مدير/محاسب)'
          : 'تسليم وتقفيل الوردية للخزنة (تسليم الكاشير)'
      }
      description={
        directClose
          ? 'إغلاق الوردية واعتماد مطابقة جميع وسائل الدفع وترحيل القيود فوراً.'
          : 'جرد نقدية الدرج ومطابقة إيصالات الفيزا وشريط التسوية وتسليم الوردية لمسؤول الخزنة للمراجعة والاعتماد.'
      }
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <div className="modal-body form-grid" style={{ maxHeight: '74vh', overflowY: 'auto' }}>
          {loading ? (
            <Loading />
          ) : summary ? (
            <>
              {isAccountantOrAdmin && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 12px',
                    background: '#f8faf9',
                    border: '1px solid #dbe6e0',
                    borderRadius: '8px',
                  }}
                >
                  <input
                    type="checkbox"
                    id="directCloseToggle"
                    checked={directClose}
                    onChange={(e) => setDirectClose(e.target.checked)}
                  />
                  <label
                    htmlFor="directCloseToggle"
                    style={{ fontSize: '13px', cursor: 'pointer', fontWeight: 600 }}
                  >
                    إغلاق واعتماد مالي مباشر فوري (صلاحية مدير / محاسب خزنة)
                  </label>
                </div>
              )}

              {/* Multi-Tender Overview Grid */}
              <div className="pos-tender-summary-grid">
                <div className="pos-tender-summary-card">
                  <div className="pos-tender-card-header">
                    <span>نقدية الدرج (كاش)</span>
                    <Coins size={16} style={{ color: '#d97706' }} />
                  </div>
                  <div className="pos-tender-card-expected">{money(summary.expected_cash)} ج.م</div>
                  <span className="pos-tender-card-meta">
                    مبيعات: {money(summary.cash_sales)} + العهدة
                  </span>
                </div>

                <div className="pos-tender-summary-card">
                  <div className="pos-tender-card-header">
                    <span>بطاقات بنكية / فيزا</span>
                    <CreditCard size={16} style={{ color: '#2563eb' }} />
                  </div>
                  <div className="pos-tender-card-expected">{money(summary.expected_card)} ج.م</div>
                  <span className="pos-tender-card-meta">مسجل بالنظام من المبيعات</span>
                </div>

                <div className="pos-tender-summary-card">
                  <div className="pos-tender-card-header">
                    <span>إنستاباي / محفظة</span>
                    <Building size={16} style={{ color: '#059669' }} />
                  </div>
                  <div className="pos-tender-card-expected">{money(summary.expected_bank)} ج.م</div>
                  <span className="pos-tender-card-meta">تحويلات بنكية ومحافظ</span>
                </div>

                <div className="pos-tender-summary-card">
                  <div className="pos-tender-card-header">
                    <span>مبيعات آجلة (ذمم)</span>
                    <Clock size={16} style={{ color: '#7c3aed' }} />
                  </div>
                  <div className="pos-tender-card-expected">{money(summary.credit_sales)} ج.م</div>
                  <span className="pos-tender-card-meta">على حسابات العملاء</span>
                </div>
              </div>

              {/* SECTION 1: Cash Drawer Count */}
              <div className="pos-tender-section-box">
                <div className="pos-tender-section-title">
                  <Coins size={18} style={{ color: '#d97706' }} />
                  <span>1. جرد نقدية الدرج الفعلي (Cash Drawer Count)</span>
                </div>

                <div className="pos-reconciliation-card">
                  <div className="pos-recon-row">
                    <span>الرصيد الافتتاحي (عهدة البداية):</span>
                    <b>{money(summary.opening_cash)} ج.م</b>
                  </div>
                  <div className="pos-recon-row">
                    <span>مبيعات نقدية (كاش):</span>
                    <b>+{money(summary.cash_sales)} ج.م</b>
                  </div>
                  <div className="pos-recon-row">
                    <span>توريدات نقدية إضافية (إيداع درج):</span>
                    <b>+{money(summary.cash_in)} ج.م</b>
                  </div>
                  <div className="pos-recon-row">
                    <span>مسحوبات نقدية (مصروفات درج):</span>
                    <b>-{money(summary.cash_out)} ج.م</b>
                  </div>
                  <div className="pos-recon-divider" />
                  <div className="pos-recon-row total">
                    <span>النقدية المتوقعة بالدرج:</span>
                    <strong>{money(summary.expected_cash)} ج.م</strong>
                  </div>
                </div>

                <Field
                  label={
                    directClose
                      ? 'النقدية الفعلية المعتمدة (ج.م) *'
                      : 'النقدية المحصاة في الدرج المسلّمة للخزنة (ج.م) *'
                  }
                >
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    autoFocus
                    value={closingCash}
                    onChange={(e) => setClosingCash(e.target.value)}
                  />
                </Field>

                {/* Cash Live Difference Badge */}
                <div
                  className={
                    'pos-diff-banner ' +
                    (cashDiffCents === 0 ? 'match' : cashDiffCents < 0 ? 'deficit' : 'surplus')
                  }
                >
                  {cashDiffCents === 0 ? (
                    <>
                      <CheckCircle2 size={18} />
                      <span>النقدية مطابقة تماماً مع المسجل بالنظام (الفارق: 0.00 ج.م)</span>
                    </>
                  ) : cashDiffCents < 0 ? (
                    <>
                      <AlertCircle size={18} />
                      <span>
                        عجز نقدي في الدرج بمقدار: <b>{money(Math.abs(cashDiffCents))} ج.م</b>
                      </span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} />
                      <span>
                        توجد زيادة نقدية في الدرج بمقدار: <b>+{money(cashDiffCents)} ج.م</b>
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* SECTION 2: Card & POS Terminal Settlement */}
              <div className="pos-tender-section-box">
                <div className="pos-tender-section-title">
                  <CreditCard size={18} style={{ color: '#2563eb' }} />
                  <span>2. تسوية ماكينة البطاقات والفيزا (POS Terminal & Slips)</span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '12px',
                  }}
                >
                  <Field label="إجمالي شريط تسوية الماكينة (Batch Total) ج.م *">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      required
                      value={closingCard}
                      onChange={(e) => setClosingCard(e.target.value)}
                    />
                  </Field>

                  <Field label="رقم تسوية الماكينة (Terminal Batch #)">
                    <input
                      type="text"
                      placeholder="مثال: BATCH-0042 / 9821"
                      value={terminalBatchNumber}
                      onChange={(e) => setTerminalBatchNumber(e.target.value)}
                    />
                  </Field>

                  <Field label="عدد إيصالات البطاقات الورقية المرفقة">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="عدد الفواتير الورقية الموقعة"
                      value={cardSlipsCount}
                      onChange={(e) => setCardSlipsCount(e.target.value)}
                    />
                  </Field>
                </div>

                <div
                  className={
                    'pos-diff-banner ' +
                    (cardDiffCents === 0 ? 'match' : cardDiffCents < 0 ? 'deficit' : 'surplus')
                  }
                >
                  {cardDiffCents === 0 ? (
                    <>
                      <CheckCircle2 size={18} />
                      <span>
                        مبيعات البطاقات مطابقة تماماً لشريط تسوية الماكينة (الفارق: 0.00 ج.م)
                      </span>
                    </>
                  ) : cardDiffCents < 0 ? (
                    <>
                      <AlertCircle size={18} />
                      <span>
                        فارق نقص في شريط البطاقات بمقدار:{' '}
                        <b>{money(Math.abs(cardDiffCents))} ج.م</b>
                      </span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} />
                      <span>
                        زيادة في شريط البطاقات بمقدار: <b>+{money(cardDiffCents)} ج.م</b>
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* SECTION 3: InstaPay & Bank Transfers */}
              <div className="pos-tender-section-box">
                <div className="pos-tender-section-title">
                  <Building size={18} style={{ color: '#059669' }} />
                  <span>3. إثباتات إنستاباي والمحافظ الإلكترونية (InstaPay & Wallets)</span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '12px',
                  }}
                >
                  <Field label="إجمالي المحصل عبر إنستاباي / البنك (ج.م) *">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      required
                      value={closingBank}
                      onChange={(e) => setClosingBank(e.target.value)}
                    />
                  </Field>

                  <Field label="عدد عمليات التحويل / الإشعارات المرفقة">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="عدد إشعارات التحويل"
                      value={bankTransfersCount}
                      onChange={(e) => setBankTransfersCount(e.target.value)}
                    />
                  </Field>
                </div>

                <div
                  className={
                    'pos-diff-banner ' +
                    (bankDiffCents === 0 ? 'match' : bankDiffCents < 0 ? 'deficit' : 'surplus')
                  }
                >
                  {bankDiffCents === 0 ? (
                    <>
                      <CheckCircle2 size={18} />
                      <span>إجمالي إنستاباي مطابق مع المسجل بالنظام (الفارق: 0.00 ج.م)</span>
                    </>
                  ) : bankDiffCents < 0 ? (
                    <>
                      <AlertCircle size={18} />
                      <span>
                        فارق نقص في تحويلات إنستاباي بمقدار:{' '}
                        <b>{money(Math.abs(bankDiffCents))} ج.م</b>
                      </span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} />
                      <span>
                        زيادة في تحويلات إنستاباي بمقدار: <b>+{money(bankDiffCents)} ج.م</b>
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* SECTION 4: Safe Drop Envelope & Proof Documents */}
              <div className="pos-proof-box">
                <div className="pos-tender-section-title">
                  <ShieldCheck size={18} style={{ color: '#4f46e5' }} />
                  <span>4. ظرف إيداع الخزنة والمستندات الثبوتية (Safe Drop & Proofs)</span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: '12px',
                  }}
                >
                  <Field label="رقم ظرف إيداع الخزنة المحكم (Safe Drop Envelope #)">
                    <input
                      type="text"
                      placeholder="مثال: ENV-2026-0482 أو رقم الكيس الأمني"
                      value={safeEnvelopeNumber}
                      onChange={(e) => setSafeEnvelopeNumber(e.target.value)}
                    />
                  </Field>

                  <Field label="بيان المرفقات والإثباتات الورقية">
                    <input
                      type="text"
                      placeholder="شريط تسوية ماكينة + إيصالات فيزا + أذونات صرف..."
                      value={proofDocuments}
                      onChange={(e) => setProofDocuments(e.target.value)}
                    />
                  </Field>
                </div>

                <Field label="ملاحظات التسليم وأسباب الفروقات إن وجدت">
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="أي ملاحظات حول التقفيلة أو سبب أي فارق مالي..."
                  />
                </Field>
              </div>
            </>
          ) : null}
        </div>
        <div className="modal-footer">
          <Button type="submit" busy={busy} disabled={loading}>
            {directClose ? 'إغلاق الوردية واعتماد التقرير' : 'تسليم الوردية للخزنة وطباعة السند'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TreasuryReviewModal({
  branchId,
  onClose,
  onApproved,
}: {
  branchId: string;
  onClose: () => void;
  onApproved: () => void;
}) {
  const { busy, act } = useAction();
  const toast = useToast();
  const [pendingList, setPendingList] = useState<PosShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [summary, setSummary] = useState<PosShiftSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Treasury Verified Amounts
  const [verifiedCash, setVerifiedCash] = useState('');
  const [verifiedCard, setVerifiedCard] = useState('');
  const [verifiedBank, setVerifiedBank] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [showPaymentsTable, setShowPaymentsTable] = useState(false);

  // Physical Proof Documents Checklist
  const [checklist, setChecklist] = useState({
    terminal_batch_verified: false,
    card_slips_counted: false,
    instapay_verified: false,
    drawer_vouchers_signed: false,
    safe_envelope_received: false,
  });

  const loadPending = async () => {
    setLoading(true);
    try {
      const list = await api<PosShift[]>(`/pos/shifts/pending-review?branch_id=${branchId}`);
      setPendingList(list);
      if (list.length > 0) {
        void selectShift(list[0].id);
      } else {
        setSelectedShiftId(null);
        setSummary(null);
      }
    } catch (err: any) {
      toast(err.message || 'تعذر تحميل الورديات المعلقة');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPending();
  }, [branchId]);

  const selectShift = async (id: string) => {
    setSelectedShiftId(id);
    setSummaryLoading(true);
    try {
      const sum = await api<PosShiftSummary>(`/pos/shifts/${id}/summary`);
      setSummary(sum);

      const initialCash =
        sum.cashier_declared_cash !== null && sum.cashier_declared_cash !== undefined
          ? sum.cashier_declared_cash
          : sum.expected_cash;
      setVerifiedCash((initialCash / 100).toFixed(2));

      const initialCard =
        sum.cashier_declared_card !== null && sum.cashier_declared_card !== undefined
          ? sum.cashier_declared_card
          : sum.expected_card;
      setVerifiedCard((initialCard / 100).toFixed(2));

      const initialBank =
        sum.cashier_declared_bank !== null && sum.cashier_declared_bank !== undefined
          ? sum.cashier_declared_bank
          : sum.expected_bank;
      setVerifiedBank((initialBank / 100).toFixed(2));

      setReviewNotes('');
      setChecklist({
        terminal_batch_verified: Boolean(sum.shift.terminal_batch_number),
        card_slips_counted: Boolean(sum.shift.card_slips_count),
        instapay_verified: Boolean(sum.shift.bank_transfers_count),
        drawer_vouchers_signed: true,
        safe_envelope_received: Boolean(sum.shift.safe_envelope_number),
      });
    } catch (err: any) {
      toast(err.message || 'تعذر تحميل ملخص الوردية');
    } finally {
      setSummaryLoading(false);
    }
  };

  const verifiedCashCents = Math.round(parseFloat(verifiedCash || '0') * 100);
  const expectedCashCents = summary?.expected_cash ?? 0;
  const cashDiffCents = verifiedCashCents - expectedCashCents;

  const verifiedCardCents = Math.round(parseFloat(verifiedCard || '0') * 100);
  const expectedCardCents = summary?.expected_card ?? 0;
  const cardDiffCents = verifiedCardCents - expectedCardCents;

  const verifiedBankCents = Math.round(parseFloat(verifiedBank || '0') * 100);
  const expectedBankCents = summary?.expected_bank ?? 0;
  const bankDiffCents = verifiedBankCents - expectedBankCents;

  const handleApprove = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedShiftId) return;

    void act(async () => {
      await api(`/pos/shifts/${selectedShiftId}/approve`, 'POST', {
        verified_cash: verifiedCashCents,
        closing_card: verifiedCardCents,
        closing_bank: verifiedBankCents,
        review_notes: reviewNotes.trim() || undefined,
        verification_checklist: checklist,
      });
      toast('تم اعتماد إغلاق الوردية والمطابقة متعددة القنوات وترحيل القيود بنجاح');
      onApproved();
      await loadPending();
    });
  };

  return (
    <Modal
      title="اعتماد ورديات الخزنة والمطابقة المالية الشاملة"
      description="مراجعة ورديات الكاشير، فحص أشرطة تسوية الماكينات وإيصالات الفيزا وإنستاباي، والتحقق من المستندات الثبوتية وترحيل قيود الفروقات."
      onClose={onClose}
    >
      <div className="modal-body form-grid" style={{ maxHeight: '78vh', overflowY: 'auto' }}>
        {loading ? (
          <Loading />
        ) : pendingList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '36px 12px', color: 'var(--muted)' }}>
            <CheckCircle2 size={46} style={{ color: 'var(--green)', marginBottom: '10px' }} />
            <h4>لا توجد ورديات معلقة بانتظار الاعتماد</h4>
            <p>جميع ورديات الكاشير في هذا الفرع معتمدة ومطابقة بالكامل.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '16px' }}>
            {/* Shifts Sidebar */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                borderLeft: '1px solid var(--border)',
                paddingLeft: '12px',
              }}
            >
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--muted)' }}>
                الورديات المعلقة للاعتماد ({pendingList.length})
              </span>
              {pendingList.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectShift(s.id)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border:
                      '1px solid ' + (selectedShiftId === s.id ? 'var(--green)' : 'var(--border)'),
                    background: selectedShiftId === s.id ? '#f0f7f4' : '#fff',
                    textAlign: 'right',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    boxShadow: 'var(--shadow-xs)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <strong style={{ fontSize: '13px' }}>{s.number}</strong>
                    {s.safe_envelope_number && (
                      <span
                        style={{
                          fontSize: '10.5px',
                          background: '#ede9fe',
                          color: '#5b21b6',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontWeight: 700,
                        }}
                      >
                        ظرف #{s.safe_envelope_number}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    الكاشير: <b>{s.user_name || '—'}</b>
                  </span>
                  <div
                    style={{
                      fontSize: '11px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      marginTop: '2px',
                    }}
                  >
                    <span style={{ color: '#b45309', fontWeight: 600 }}>
                      كاش مسلّم: {money(s.cashier_declared_cash || 0)} ج.م
                    </span>
                    {(s.cashier_declared_card || 0) > 0 && (
                      <span style={{ color: '#2563eb' }}>
                        فيزا: {money(s.cashier_declared_card || 0)} ج.م
                      </span>
                    )}
                    {(s.cashier_declared_bank || 0) > 0 && (
                      <span style={{ color: '#059669' }}>
                        إنستاباي: {money(s.cashier_declared_bank || 0)} ج.م
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {/* Shift Detail & Approval Form */}
            <div>
              {summaryLoading ? (
                <Loading />
              ) : summary ? (
                <form onSubmit={handleApprove}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {/* Shift Metadata Bar */}
                    <div
                      style={{
                        padding: '12px 14px',
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: '14px', color: 'var(--slate-900)' }}>
                          وردية #{summary.shift.number}
                        </strong>
                        <div style={{ fontSize: '12px', color: 'var(--slate-500)' }}>
                          الكاشير: <b>{summary.shift.user_name}</b> | الفرع:{' '}
                          {summary.shift.branch_id}
                        </div>
                      </div>
                      <div style={{ textAlign: 'left', fontSize: '12px' }}>
                        <div>
                          إجمالي المبيعات:{' '}
                          <b style={{ color: 'var(--indigo-600)' }}>
                            {money(summary.total_sales)} ج.م
                          </b>{' '}
                          ({summary.sales_count} عملية)
                        </div>
                        {summary.shift.safe_envelope_number && (
                          <div style={{ color: '#5b21b6', fontWeight: 700 }}>
                            مظروف الإيداع: #{summary.shift.safe_envelope_number}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Multi-Tender Reconciliation Table */}
                    <div style={{ overflowX: 'auto' }}>
                      <table className="pos-reconciliation-table">
                        <thead>
                          <tr>
                            <th>وسيلة الدفع</th>
                            <th>المسجل بالنظام</th>
                            <th>المصرح به من الكاشير</th>
                            <th>المعتمد بالخزينة (ج.م)</th>
                            <th>الفارق المالي</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* Cash Row */}
                          <tr>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Coins size={15} style={{ color: '#d97706' }} />
                                <strong>النقدية بالدرج</strong>
                              </div>
                              <small style={{ color: 'var(--muted)', fontSize: '11px' }}>
                                رصيد البداية {money(summary.opening_cash)} + مبيعات{' '}
                                {money(summary.cash_sales)}
                              </small>
                            </td>
                            <td>
                              <b>{money(summary.expected_cash)} ج.م</b>
                            </td>
                            <td>
                              <span style={{ color: '#b45309', fontWeight: 600 }}>
                                {money(summary.cashier_declared_cash ?? summary.expected_cash)} ج.م
                              </span>
                            </td>
                            <td style={{ width: '140px' }}>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                required
                                value={verifiedCash}
                                onChange={(e) => setVerifiedCash(e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '5px 8px',
                                  fontSize: '13px',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                }}
                              />
                            </td>
                            <td>
                              <span
                                style={{
                                  fontWeight: 700,
                                  color:
                                    cashDiffCents === 0
                                      ? '#16a34a'
                                      : cashDiffCents < 0
                                        ? '#dc2626'
                                        : '#2563eb',
                                }}
                              >
                                {cashDiffCents === 0
                                  ? 'مطابق'
                                  : cashDiffCents < 0
                                    ? `عجز: -${money(Math.abs(cashDiffCents))} ج.م`
                                    : `زيادة: +${money(cashDiffCents)} ج.م`}
                              </span>
                            </td>
                          </tr>

                          {/* Card Row */}
                          <tr>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <CreditCard size={15} style={{ color: '#2563eb' }} />
                                <strong>بطاقات / فيزا</strong>
                              </div>
                              <small style={{ color: 'var(--muted)', fontSize: '11px' }}>
                                باتش: {summary.shift.terminal_batch_number || 'غير مسجل'} |{' '}
                                {summary.shift.card_slips_count || 0} إيصال
                              </small>
                            </td>
                            <td>
                              <b>{money(summary.expected_card)} ج.م</b>
                            </td>
                            <td>
                              <span style={{ color: '#2563eb', fontWeight: 600 }}>
                                {money(summary.cashier_declared_card ?? summary.expected_card)} ج.م
                              </span>
                            </td>
                            <td style={{ width: '140px' }}>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                required
                                value={verifiedCard}
                                onChange={(e) => setVerifiedCard(e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '5px 8px',
                                  fontSize: '13px',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                }}
                              />
                            </td>
                            <td>
                              <span
                                style={{
                                  fontWeight: 700,
                                  color:
                                    cardDiffCents === 0
                                      ? '#16a34a'
                                      : cardDiffCents < 0
                                        ? '#dc2626'
                                        : '#2563eb',
                                }}
                              >
                                {cardDiffCents === 0
                                  ? 'مطابق'
                                  : cardDiffCents < 0
                                    ? `عجز: -${money(Math.abs(cardDiffCents))} ج.م`
                                    : `زيادة: +${money(cardDiffCents)} ج.م`}
                              </span>
                            </td>
                          </tr>

                          {/* Bank / InstaPay Row */}
                          <tr>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Building size={15} style={{ color: '#059669' }} />
                                <strong>إنستاباي / محفظة</strong>
                              </div>
                              <small style={{ color: 'var(--muted)', fontSize: '11px' }}>
                                {summary.shift.bank_transfers_count || 0} عملية تحويل
                              </small>
                            </td>
                            <td>
                              <b>{money(summary.expected_bank)} ج.م</b>
                            </td>
                            <td>
                              <span style={{ color: '#059669', fontWeight: 600 }}>
                                {money(summary.cashier_declared_bank ?? summary.expected_bank)} ج.م
                              </span>
                            </td>
                            <td style={{ width: '140px' }}>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                required
                                value={verifiedBank}
                                onChange={(e) => setVerifiedBank(e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '5px 8px',
                                  fontSize: '13px',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                }}
                              />
                            </td>
                            <td>
                              <span
                                style={{
                                  fontWeight: 700,
                                  color:
                                    bankDiffCents === 0
                                      ? '#16a34a'
                                      : bankDiffCents < 0
                                        ? '#dc2626'
                                        : '#2563eb',
                                }}
                              >
                                {bankDiffCents === 0
                                  ? 'مطابق'
                                  : bankDiffCents < 0
                                    ? `عجز: -${money(Math.abs(bankDiffCents))} ج.م`
                                    : `زيادة: +${money(bankDiffCents)} ج.م`}
                              </span>
                            </td>
                          </tr>

                          {/* Credit Sales Row */}
                          <tr>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Clock size={15} style={{ color: '#7c3aed' }} />
                                <strong>مبيعات آجلة</strong>
                              </div>
                              <small style={{ color: 'var(--muted)', fontSize: '11px' }}>
                                ترحل تلقائياً لذمم العملاء
                              </small>
                            </td>
                            <td>
                              <b>{money(summary.credit_sales)} ج.م</b>
                            </td>
                            <td>
                              <span style={{ color: 'var(--muted)' }}>—</span>
                            </td>
                            <td>
                              <span style={{ color: 'var(--muted)', fontSize: '12px' }}>
                                {money(summary.credit_sales)} ج.م
                              </span>
                            </td>
                            <td>
                              <span style={{ color: '#16a34a', fontWeight: 700 }}>مطابق</span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* PHYSICAL PROOFS VERIFICATION CHECKLIST */}
                    <div className="pos-tender-section-box">
                      <div className="pos-tender-section-title">
                        <ShieldCheck size={18} style={{ color: '#15803d' }} />
                        <span>قائمة التحقق من المستندات والإثباتات الورقية (Audit Checklist)</span>
                      </div>

                      <div className="pos-audit-checklist">
                        <label
                          className={
                            'pos-checklist-row ' +
                            (checklist.terminal_batch_verified ? 'checked' : '')
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checklist.terminal_batch_verified}
                            onChange={(e) =>
                              setChecklist((c) => ({
                                ...c,
                                terminal_batch_verified: e.target.checked,
                              }))
                            }
                          />
                          <span>
                            تم استلام ومطابقة شريط تسوية ماكينة الدفع (Batch Settlement Slip)
                          </span>
                          <span className="pos-checklist-badge">
                            باتش: #{summary.shift.terminal_batch_number || 'غير مسجل'}
                          </span>
                        </label>

                        <label
                          className={
                            'pos-checklist-row ' + (checklist.card_slips_counted ? 'checked' : '')
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checklist.card_slips_counted}
                            onChange={(e) =>
                              setChecklist((c) => ({
                                ...c,
                                card_slips_counted: e.target.checked,
                              }))
                            }
                          />
                          <span>
                            تم عد ومطابقة إيصالات الدفع الورقية للبطاقات الموقعة من العملاء
                          </span>
                          <span className="pos-checklist-badge">
                            العدد: {summary.shift.card_slips_count || 0} إيصال
                          </span>
                        </label>

                        <label
                          className={
                            'pos-checklist-row ' + (checklist.instapay_verified ? 'checked' : '')
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checklist.instapay_verified}
                            onChange={(e) =>
                              setChecklist((c) => ({
                                ...c,
                                instapay_verified: e.target.checked,
                              }))
                            }
                          />
                          <span>
                            تم التحقق من إشعارات تطبيق إنستاباي / كشف حساب المحافظ الإلكترونية
                          </span>
                          <span className="pos-checklist-badge">
                            العمليات: {summary.shift.bank_transfers_count || 0} عملية
                          </span>
                        </label>

                        <label
                          className={
                            'pos-checklist-row ' +
                            (checklist.drawer_vouchers_signed ? 'checked' : '')
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checklist.drawer_vouchers_signed}
                            onChange={(e) =>
                              setChecklist((c) => ({
                                ...c,
                                drawer_vouchers_signed: e.target.checked,
                              }))
                            }
                          />
                          <span>
                            مراجعة وتوقيع أذونات التوريد والصرف اليدوية للدرج (Cash In/Out)
                          </span>
                          <span className="pos-checklist-badge">
                            صافي الحركات: {money(summary.cash_in - summary.cash_out)} ج.م
                          </span>
                        </label>

                        <label
                          className={
                            'pos-checklist-row ' +
                            (checklist.safe_envelope_received ? 'checked' : '')
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checklist.safe_envelope_received}
                            onChange={(e) =>
                              setChecklist((c) => ({
                                ...c,
                                safe_envelope_received: e.target.checked,
                              }))
                            }
                          />
                          <span>
                            تم استلام ظرف إيداع النقدية والمستندات المحكم بالخزينة الرئيسية
                          </span>
                          <span className="pos-checklist-badge">
                            ظرف #{summary.shift.safe_envelope_number || 'غير مسجل'}
                          </span>
                        </label>
                      </div>
                    </div>

                    {/* EXPANDABLE ITEMIZED TRANSACTIONS AUDIT */}
                    <div style={{ marginTop: '2px' }}>
                      <button
                        type="button"
                        onClick={() => setShowPaymentsTable(!showPaymentsTable)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          background: 'none',
                          border: 'none',
                          color: 'var(--indigo-600)',
                          fontSize: '13px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          padding: '4px 0',
                        }}
                      >
                        {showPaymentsTable ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        <span>
                          {showPaymentsTable ? 'إخفاء' : 'عرض'} كشف تفصيلي بعمليات الوردية (
                          {summary.payments?.length || 0} عملية)
                        </span>
                      </button>

                      {showPaymentsTable && (
                        <div className="pos-payments-audit-wrapper">
                          <table className="pos-reconciliation-table">
                            <thead>
                              <tr>
                                <th>الوقت</th>
                                <th>رقم الفاتورة</th>
                                <th>العميل</th>
                                <th>وسيلة الدفع</th>
                                <th>المبلغ</th>
                                <th>المرجع / إيصال الفيزا</th>
                              </tr>
                            </thead>
                            <tbody>
                              {!summary.payments || summary.payments.length === 0 ? (
                                <tr>
                                  <td
                                    colSpan={6}
                                    style={{ textAlign: 'center', color: 'var(--muted)' }}
                                  >
                                    لا توجد مدفوعات مسجلة في هذه الوردية
                                  </td>
                                </tr>
                              ) : (
                                summary.payments.map((p, idx) => (
                                  <tr key={idx}>
                                    <td style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
                                      {p.created_at
                                        ? new Date(p.created_at).toLocaleTimeString('ar-EG', {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                          })
                                        : '—'}
                                    </td>
                                    <td>
                                      <strong>#{p.document_number}</strong>
                                    </td>
                                    <td>{p.party_name || 'عميل نقدي'}</td>
                                    <td>
                                      <span
                                        style={{
                                          padding: '2px 6px',
                                          borderRadius: '4px',
                                          fontSize: '11px',
                                          fontWeight: 700,
                                          background:
                                            p.method === 'CASH'
                                              ? '#fef3c7'
                                              : p.method === 'CARD'
                                                ? '#dbeafe'
                                                : p.method === 'BANK'
                                                  ? '#dcfce7'
                                                  : '#ede9fe',
                                          color:
                                            p.method === 'CASH'
                                              ? '#92400e'
                                              : p.method === 'CARD'
                                                ? '#1e40af'
                                                : p.method === 'BANK'
                                                  ? '#15803d'
                                                  : '#6b21a8',
                                        }}
                                      >
                                        {p.method === 'CASH'
                                          ? 'كاش'
                                          : p.method === 'CARD'
                                            ? 'فيزا'
                                            : p.method === 'BANK'
                                              ? 'إنستاباي'
                                              : 'آجل'}
                                      </span>
                                    </td>
                                    <td>
                                      <b>{money(p.amount)} ج.م</b>
                                    </td>
                                    <td style={{ fontSize: '11.5px', color: 'var(--slate-600)' }}>
                                      {p.reference || '—'}
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Automatic Shortage Alert */}
                    {cashDiffCents < 0 && (
                      <div className="pos-shortage-alert">
                        <AlertCircle size={18} />
                        <div>
                          <strong>تسجيل قيد عجز تلقائي:</strong>
                          <p style={{ margin: '2px 0 0', fontSize: '12px' }}>
                            سيتم تلقائياً إنشاء قيد مصروف تشغيلي بقيمة (
                            {money(Math.abs(cashDiffCents))} ج.م) في تصنيف «عجز نقدية نقطة بيع» لضبط
                            الخزنة وحساب الأرباح والخسائر.
                          </p>
                        </div>
                      </div>
                    )}

                    <Field label="ملاحظات مراجعة واعتماد الخزنة">
                      <input
                        type="text"
                        value={reviewNotes}
                        onChange={(e) => setReviewNotes(e.target.value)}
                        placeholder="ملاحظات المحاسب المسؤول بشأن مطابقة الوردية والمستندات..."
                      />
                    </Field>

                    <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                      <Button type="submit" busy={busy}>
                        <CheckCircle2 size={16} /> اعتماد إغلاق الوردية وترحيل القيود
                      </Button>
                    </div>
                  </div>
                </form>
              ) : null}
            </div>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="secondary" onClick={onClose}>
          إغلاق
        </Button>
      </div>
    </Modal>
  );
}

function ShiftHandoverSlipModal({
  shift,
  summary,
  companyName,
  branchName,
  cashierName,
  onClose,
}: {
  shift: PosShift;
  summary: PosShiftSummary;
  companyName: string;
  branchName: string;
  cashierName: string;
  onClose: () => void;
}) {
  const declaredCash =
    shift.cashier_declared_cash ?? summary.cashier_declared_cash ?? summary.expected_cash;
  const cashDiff = declaredCash - summary.expected_cash;

  const declaredCard =
    shift.cashier_declared_card ?? summary.cashier_declared_card ?? summary.expected_card;
  const cardDiff = declaredCard - summary.expected_card;

  const declaredBank =
    shift.cashier_declared_bank ?? summary.cashier_declared_bank ?? summary.expected_bank;
  const bankDiff = declaredBank - summary.expected_bank;

  const openedDateStr = shift.opened_at
    ? new Date(shift.opened_at).toLocaleTimeString('ar-EG', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
  const closedDateStr = new Date().toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Modal title="سند تسليم وردية كاشير للخزنة (Z-Report)" onClose={onClose}>
      <div className="modal-body pos-receipt-wrapper">
        <div className="thermal-receipt" id="printable-pos-receipt">
          {/* Receipt Top Brand Header */}
          <div className="receipt-header">
            <div className="receipt-brand-badge">ORQIVA POS</div>
            <h3 className="receipt-company-title">{companyName}</h3>
            <p className="receipt-branch-name">فرع: {branchName}</p>
            <div className="receipt-title-box">
              <span>محضر تسليم وتقفيل وردية كاشير (Z-Report)</span>
            </div>
            <div className="receipt-cut-line" />
            <div className="receipt-meta-grid">
              <div className="meta-item">
                <span className="meta-label">رقم الوردية:</span>
                <span className="meta-value bold num">#{shift.number}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">تاريخ التسليم:</span>
                <span className="meta-value">{new Date().toLocaleDateString('ar-EG')}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">الكاشير المسلّم:</span>
                <span className="meta-value bold">{cashierName}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">فترة الوردية:</span>
                <span className="meta-value num">
                  من {openedDateStr} إلى {closedDateStr}
                </span>
              </div>
            </div>
            <div className="receipt-cut-line" />
          </div>

          {/* Multi-Tender Breakdown */}
          <div className="receipt-totals">
            <div className="receipt-section-title">1. مطابقة نقدية الدرج (كاش)</div>
            <div className="receipt-row">
              <span>الرصيد الافتتاحي (العهدة):</span>
              <span className="num">{money(summary.opening_cash)} ج.م</span>
            </div>
            <div className="receipt-row">
              <span>المبيعات النقدية:</span>
              <span className="num font-semibold">{money(summary.cash_sales)} ج.م</span>
            </div>
            <div className="receipt-row">
              <span>توريدات نقدية (إيداع درج):</span>
              <span className="num text-green">+{money(summary.cash_in)} ج.م</span>
            </div>
            <div className="receipt-row">
              <span>مسحوبات ومصروفات (درج):</span>
              <span className="num text-red">-{money(summary.cash_out)} ج.م</span>
            </div>
            <div className="receipt-row grand-total-row">
              <span>النقدية المتوقعة بالدرج:</span>
              <span className="num total-amount">{money(summary.expected_cash)} ج.م</span>
            </div>
            <div className="receipt-row grand-total-row" style={{ color: '#1e40af' }}>
              <span>النقدية المسلّمة فعلياً:</span>
              <span className="num total-amount">{money(declaredCash)} ج.م</span>
            </div>
            <div className="receipt-row">
              <span>فارق النقدية:</span>
              <span
                className="num font-semibold"
                style={{
                  color: cashDiff === 0 ? '#15803d' : cashDiff < 0 ? '#b91c1c' : '#1d4ed8',
                }}
              >
                {cashDiff === 0
                  ? 'مطابق (0.00)'
                  : cashDiff < 0
                    ? `عجز: -${money(Math.abs(cashDiff))} ج.م`
                    : `زيادة: +${money(cashDiff)} ج.م`}
              </span>
            </div>

            <div className="receipt-cut-line" />

            <div className="receipt-section-title">2. مبيعات البطاقات وماكينة الفيزا</div>
            <div className="receipt-row">
              <span>المبيعات المسجلة بالنظام:</span>
              <span className="num">{money(summary.expected_card)} ج.م</span>
            </div>
            <div className="receipt-row">
              <span>إجمالي شريط التسوية (Batch):</span>
              <span className="num font-semibold">{money(declaredCard)} ج.م</span>
            </div>
            {shift.terminal_batch_number && (
              <div className="receipt-row">
                <span>رقم تسوية الماكينة:</span>
                <span className="num bold">{shift.terminal_batch_number}</span>
              </div>
            )}
            <div className="receipt-row">
              <span>عدد إيصالات البطاقات المرفقة:</span>
              <span className="num">{shift.card_slips_count || 0} إيصال</span>
            </div>
            <div className="receipt-row">
              <span>فارق تسوية البطاقات:</span>
              <span
                className="num font-semibold"
                style={{
                  color: cardDiff === 0 ? '#15803d' : cardDiff < 0 ? '#b91c1c' : '#1d4ed8',
                }}
              >
                {cardDiff === 0
                  ? 'مطابق'
                  : cardDiff < 0
                    ? `عجز: -${money(Math.abs(cardDiff))} ج.م`
                    : `زيادة: +${money(cardDiff)} ج.م`}
              </span>
            </div>

            <div className="receipt-cut-line" />

            <div className="receipt-section-title">3. إنستاباي والتحويلات البنكية</div>
            <div className="receipt-row">
              <span>المسجل بالنظام:</span>
              <span className="num">{money(summary.expected_bank)} ج.م</span>
            </div>
            <div className="receipt-row">
              <span>المحصل الفعلي المسلّم:</span>
              <span className="num font-semibold">{money(declaredBank)} ج.م</span>
            </div>
            <div className="receipt-row">
              <span>عدد عمليات التحويل:</span>
              <span className="num">{shift.bank_transfers_count || 0} عملية</span>
            </div>
            <div className="receipt-row">
              <span>فارق إنستاباي:</span>
              <span
                className="num font-semibold"
                style={{
                  color: bankDiff === 0 ? '#15803d' : bankDiff < 0 ? '#b91c1c' : '#1d4ed8',
                }}
              >
                {bankDiff === 0
                  ? 'مطابق'
                  : bankDiff < 0
                    ? `عجز: -${money(Math.abs(bankDiff))} ج.م`
                    : `زيادة: +${money(bankDiff)} ج.م`}
              </span>
            </div>

            <div className="receipt-cut-line" />

            <div className="receipt-row grand-total-highlight">
              <span className="label">إجمالي إيراد مبيعات الوردية:</span>
              <span className="num value">{money(summary.total_sales)} ج.م</span>
            </div>

            {/* Proof Documents & Envelope */}
            <div className="receipt-diff-box" style={{ marginTop: '10px' }}>
              <div className="receipt-row">
                <span>رقم مظروف الخزنة الأمني:</span>
                <span className="font-semibold num">
                  {shift.safe_envelope_number || 'غير مسجل'}
                </span>
              </div>
              <div className="receipt-row">
                <span>حالة الاعتماد بالخزينة:</span>
                <span
                  style={{
                    color: shift.status === 'CLOSED' ? '#15803d' : '#b45309',
                    fontWeight: 700,
                  }}
                >
                  {shift.status === 'CLOSED' ? 'معتمد ومقفل بالخزنة' : 'مسلّم - بانتظار الاعتماد'}
                </span>
              </div>
            </div>

            {shift.notes && (
              <div className="receipt-notes-box">
                <b>ملاحظات الكاشير:</b> {shift.notes}
              </div>
            )}
            {shift.review_notes && (
              <div className="receipt-notes-box" style={{ background: '#f0fdf4' }}>
                <b>ملاحظات اعتماد الخزنة:</b> {shift.review_notes}
              </div>
            )}
          </div>

          <div className="receipt-cut-line" />

          {/* Dual Signatures */}
          <div className="receipt-signatures-container">
            <div className="signature-box">
              <span className="sign-title">توقيع الكاشير المسلّم</span>
              <div className="sign-line" />
              <span className="sign-sub">{cashierName}</span>
            </div>
            <div className="signature-box">
              <span className="sign-title">توقيع مستلم الخزينة</span>
              <div className="sign-line" />
              <span className="sign-sub">المحاسب المسؤول</span>
            </div>
          </div>

          {/* Barcode of shift */}
          <div className="receipt-barcode-wrapper">
            <BarcodeSvg value={`SHIFT-${shift.number}`} height={30} fontSize={10} />
          </div>

          <div className="receipt-footer">
            <div className="receipt-cut-line" />
            <p>سند تقفيل وردية Z-Report معتمد بالنظام</p>
            <small>نظام أوركيفا السحابي لإدارة نقاط البيع والمطابقة المالية</small>
          </div>
        </div>
      </div>

      <div className="modal-footer">
        <Button onClick={triggerThermalPrint}>
          <Printer size={16} /> طباعة سند التسليم والـ Z-Report (Ctrl+P)
        </Button>
        <Button variant="secondary" onClick={onClose}>
          إغلاق
        </Button>
      </div>
    </Modal>
  );
}

function CustomerPickerModal({
  customers,
  selectedCustomer,
  onSelect,
  onClose,
}: {
  customers: Party[];
  selectedCustomer: Party;
  onSelect: (c: Party) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = [DEFAULT_WALK_IN_CUSTOMER, ...customers];
    if (!q) return all;
    return all.filter((c) => c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q)));
  }, [customers, search]);

  return (
    <Modal
      title="اختيار العميل (F4)"
      description="اختر العميل المخصص للفاتورة أو استمر مع العميل النقدي الطائر."
      onClose={onClose}
    >
      <div className="modal-body pos-customer-picker">
        <div className="pos-search-input-wrap">
          <Search size={16} />
          <input
            type="text"
            autoFocus
            placeholder="ابحث باسم العميل أو رقم الهاتف..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="pos-customer-list">
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              className={'pos-customer-item ' + (selectedCustomer.id === c.id ? 'active' : '')}
              onClick={() => onSelect(c)}
            >
              <div className="pos-cust-main">
                <strong>{c.name}</strong>
                <span>{c.phone || 'بدون هاتف'}</span>
              </div>
              {c.id !== 'walk-in-customer' && (
                <span className="pos-cust-bal">الرصيد: {money(c.balance || 0)} ج.م</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="secondary" onClick={onClose}>
          إغلاق
        </Button>
      </div>
    </Modal>
  );
}

function DiscountModal({
  subtotalCents,
  currentDiscountCents,
  onApply,
  onClose,
}: {
  subtotalCents: number;
  currentDiscountCents: number;
  onApply: (cents: number) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'FIXED' | 'PERCENT'>('FIXED');
  const [val, setVal] = useState(
    currentDiscountCents > 0 ? (currentDiscountCents / 100).toString() : '0',
  );

  const calculatedDiscount = useMemo(() => {
    const num = parseFloat(val || '0');
    if (isNaN(num) || num <= 0) return 0;
    if (mode === 'PERCENT') {
      return Math.min(subtotalCents, Math.round((subtotalCents * num) / 100));
    }
    return Math.min(subtotalCents, Math.round(num * 100));
  }, [mode, val, subtotalCents]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onApply(calculatedDiscount);
  };

  return (
    <Modal title="تطبيق خصم على الفاتورة" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="modal-body form-grid">
          <div className="pos-segmented-control">
            <button
              type="button"
              className={'pos-segment ' + (mode === 'FIXED' ? 'active' : '')}
              onClick={() => setMode('FIXED')}
            >
              مبلغ ثابت (ج.م)
            </button>
            <button
              type="button"
              className={'pos-segment ' + (mode === 'PERCENT' ? 'active' : '')}
              onClick={() => setMode('PERCENT')}
            >
              نسبة مئوية (%)
            </button>
          </div>

          <Field label={mode === 'FIXED' ? 'قيمة الخصم بالجنيه' : 'نسبة الخصم المئوية'}>
            <input
              type="number"
              step="any"
              min="0"
              max={mode === 'PERCENT' ? 100 : subtotalCents / 100}
              autoFocus
              value={val}
              onChange={(e) => setVal(e.target.value)}
            />
          </Field>

          <div className="pos-discount-preview">
            <span>إجمالي الخصم المحسوب:</span>
            <b>{money(calculatedDiscount)} ج.م</b>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="submit">تطبيق الخصم</Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onApply(0);
            }}
          >
            إلغاء الخصم
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CheckoutModal({
  branchId,
  shiftId,
  customer,
  cart,
  discountCents,
  totalCents,
  onSuccess,
  onClose,
}: {
  branchId: string;
  shiftId: string;
  customer: Party;
  cart: CartItem[];
  discountCents: number;
  totalCents: number;
  onSuccess: (res: CheckoutResult) => void;
  onClose: () => void;
}) {
  const { busy, act } = useAction();
  const toast = useToast();
  const [method, setMethod] = useState<'CASH' | 'CARD' | 'BANK' | 'CREDIT'>('CASH');
  const [amountTendered, setAmountTendered] = useState((totalCents / 100).toFixed(2));
  const [cardRef, setCardRef] = useState('');
  const [bankRef, setBankRef] = useState('');

  // Split Payment Mode
  const [splitMode, setSplitMode] = useState(false);
  const [splitCash, setSplitCash] = useState((totalCents / 100).toFixed(2));
  const [splitCard, setSplitCard] = useState('0');
  const [splitCardRef, setSplitCardRef] = useState('');
  const [splitBank, setSplitBank] = useState('0');
  const [splitBankRef, setSplitBankRef] = useState('');
  const [splitCredit, setSplitCredit] = useState('0');

  const tenderedCents = Math.round(parseFloat(amountTendered || '0') * 100);
  const changeDueCents = Math.max(0, tenderedCents - totalCents);

  // Split cents
  const splitCashCents = Math.round(parseFloat(splitCash || '0') * 100);
  const splitCardCents = Math.round(parseFloat(splitCard || '0') * 100);
  const splitBankCents = Math.round(parseFloat(splitBank || '0') * 100);
  const splitCreditCents = Math.round(parseFloat(splitCredit || '0') * 100);
  const splitAllocatedCents = splitCashCents + splitCardCents + splitBankCents + splitCreditCents;
  const splitRemainingCents = totalCents - splitAllocatedCents;

  const quickCashOptions = [
    { label: 'المبلغ بالضبط', val: totalCents },
    { label: '50 ج.م', val: 5000 },
    { label: '100 ج.م', val: 10000 },
    { label: '200 ج.م', val: 20000 },
    { label: '500 ج.م', val: 50000 },
    { label: '1000 ج.م', val: 100000 },
  ];

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    if (splitMode) {
      if (splitAllocatedCents !== totalCents) {
        toast(`يجب توزيع كامل مبلغ الفاتورة. المتبقي للتوزيع: ${money(splitRemainingCents)} ج.م`);
        return;
      }
      if (splitCreditCents > 0 && customer.id === 'walk-in-customer') {
        toast('لا يمكن تسجيل جزء آجل لـ «عميل نقدي طائر». يرجى اختيار عميل مسجل.');
        return;
      }

      const activeSplits = [
        { method: 'CASH' as const, amount: splitCashCents },
        {
          method: 'CARD' as const,
          amount: splitCardCents,
          reference: splitCardRef.trim() || undefined,
        },
        {
          method: 'BANK' as const,
          amount: splitBankCents,
          reference: splitBankRef.trim() || undefined,
        },
        { method: 'CREDIT' as const, amount: splitCreditCents },
      ].filter((s) => s.amount > 0);

      const nonCreditSum = splitCashCents + splitCardCents + splitBankCents;

      void act(async () => {
        const res = await api<CheckoutResult>('/pos/checkout', 'POST', {
          branch_id: branchId,
          shift_id: shiftId,
          party_id: customer.id,
          date: new Date().toISOString().slice(0, 10),
          discount: discountCents,
          lines: cart.map((c) => ({
            product_id: c.product.id,
            quantity: c.quantity,
            unit_price: c.unit_price,
          })),
          payment: {
            method: 'SPLIT',
            amount_paid: nonCreditSum,
            amount_tendered: nonCreditSum,
          },
          split_payments: activeSplits,
        });

        const finalRes: CheckoutResult = {
          ...res,
          lines:
            res.lines && res.lines.length > 0
              ? res.lines
              : cart.map((c) => ({
                  name: c.product.name,
                  sku: c.product.sku,
                  quantity: c.quantity,
                  unit_price: c.unit_price,
                  total: c.quantity * c.unit_price,
                })),
        };
        playSound(true);
        onSuccess(finalRes);
      });
      return;
    }

    if (method === 'CASH' && tenderedCents < totalCents) {
      toast('المبلغ المستلم من العميل أقل من إجمالي الفاتورة');
      return;
    }
    if (method === 'CREDIT' && customer.id === 'walk-in-customer') {
      toast('لا يمكن البيع الآجل للعميل الطائر. يرجى اختيار عميل مسجل.');
      return;
    }

    void act(async () => {
      const res = await api<CheckoutResult>('/pos/checkout', 'POST', {
        branch_id: branchId,
        shift_id: shiftId,
        party_id: customer.id,
        date: new Date().toISOString().slice(0, 10),
        discount: discountCents,
        lines: cart.map((c) => ({
          product_id: c.product.id,
          quantity: c.quantity,
          unit_price: c.unit_price,
        })),
        payment: {
          method,
          amount_paid: method === 'CREDIT' ? 0 : totalCents,
          amount_tendered: method === 'CASH' ? tenderedCents : totalCents,
          reference:
            method === 'CARD'
              ? cardRef.trim() || undefined
              : method === 'BANK'
                ? bankRef.trim() || undefined
                : undefined,
        },
      });
      const finalRes: CheckoutResult = {
        ...res,
        lines:
          res.lines && res.lines.length > 0
            ? res.lines
            : cart.map((c) => ({
                name: c.product.name,
                sku: c.product.sku,
                quantity: c.quantity,
                unit_price: c.unit_price,
                total: c.quantity * c.unit_price,
              })),
      };
      playSound(true);
      onSuccess(finalRes);
    });
  };

  return (
    <Modal
      title="إتمام عملية الدفع وإنهاء الطلب (F2)"
      description={`المبلغ المطلوب سداده: ${money(totalCents)} ج.م`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <div className="modal-body form-grid" style={{ maxHeight: '74vh', overflowY: 'auto' }}>
          {/* Total Display Banner */}
          <div className="pos-checkout-amount-banner">
            <div>
              <span>المبلغ المستحق:</span>
              <strong style={{ display: 'block' }}>{money(totalCents)} ج.م</strong>
            </div>

            <button
              type="button"
              onClick={() => setSplitMode(!splitMode)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                background: splitMode ? '#4f46e5' : '#ffffff',
                color: splitMode ? '#ffffff' : '#4f46e5',
                border: '1px solid #4f46e5',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '13px',
              }}
            >
              {splitMode ? '✓ إلغاء الدفع المجزأ' : '⚡ دفع مجزأ (أكثر من وسيلة)'}
            </button>
          </div>

          {/* SPLIT PAYMENT MODE */}
          {splitMode ? (
            <div className="pos-split-mode-box">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <strong style={{ fontSize: '13.5px', color: 'var(--slate-800)' }}>
                  توزيع مبلغ الفاتورة على وسائل الدفع:
                </strong>
                <span
                  className={
                    'pos-split-status-bar ' + (splitRemainingCents === 0 ? 'matched' : 'unmatched')
                  }
                  style={{ padding: '4px 10px', fontSize: '12.5px' }}
                >
                  {splitRemainingCents === 0 ? (
                    <span>✓ المبلغ موزع بالكامل</span>
                  ) : splitRemainingCents > 0 ? (
                    <span>متبقي للتوزيع: {money(splitRemainingCents)} ج.م</span>
                  ) : (
                    <span>زيادة في التوزيع: {money(Math.abs(splitRemainingCents))} ج.م</span>
                  )}
                </span>
              </div>

              {/* Cash Split Row */}
              <div className="pos-split-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                  <Coins size={16} style={{ color: '#d97706' }} />
                  <span>نقداً (كاش):</span>
                </div>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={splitCash}
                  onChange={(e) => setSplitCash(e.target.value)}
                  placeholder="المبلغ كاش"
                  style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
                <span style={{ fontSize: '12px', color: 'var(--slate-500)' }}>من الدرج</span>
              </div>

              {/* Card Split Row */}
              <div className="pos-split-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                  <CreditCard size={16} style={{ color: '#2563eb' }} />
                  <span>بطاقة / فيزا:</span>
                </div>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={splitCard}
                  onChange={(e) => setSplitCard(e.target.value)}
                  placeholder="المبلغ بالفيزا"
                  style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
                <input
                  type="text"
                  placeholder="رقم إيصال الماكينة (اختياري)"
                  value={splitCardRef}
                  onChange={(e) => setSplitCardRef(e.target.value)}
                  style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </div>

              {/* InstaPay Split Row */}
              <div className="pos-split-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                  <Building size={16} style={{ color: '#059669' }} />
                  <span>إنستاباي / محفظة:</span>
                </div>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={splitBank}
                  onChange={(e) => setSplitBank(e.target.value)}
                  placeholder="المبلغ عبر إنستاباي"
                  style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
                <input
                  type="text"
                  placeholder="رقم العملية المرجعي / IPN"
                  value={splitBankRef}
                  onChange={(e) => setSplitBankRef(e.target.value)}
                  style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </div>

              {/* Credit Split Row */}
              <div className="pos-split-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                  <Clock size={16} style={{ color: '#7c3aed' }} />
                  <span>آجل (على الحساب):</span>
                </div>
                <input
                  type="number"
                  step="any"
                  min="0"
                  disabled={customer.id === 'walk-in-customer'}
                  value={splitCredit}
                  onChange={(e) => setSplitCredit(e.target.value)}
                  placeholder="المبلغ الآجل"
                  style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
                <span style={{ fontSize: '12px', color: 'var(--slate-500)' }}>
                  {customer.id === 'walk-in-customer'
                    ? 'يتطلب اختيار عميل مسجل'
                    : `على حساب: ${customer.name}`}
                </span>
              </div>
            </div>
          ) : (
            <>
              {/* Standard Single Payment Method Selector */}
              <div className="pos-payment-methods">
                <button
                  type="button"
                  className={'pos-pay-method-btn ' + (method === 'CASH' ? 'active' : '')}
                  onClick={() => {
                    setMethod('CASH');
                    setAmountTendered((totalCents / 100).toFixed(2));
                  }}
                >
                  <Coins size={20} />
                  <span>نقداً (كاش)</span>
                </button>

                <button
                  type="button"
                  className={'pos-pay-method-btn ' + (method === 'CARD' ? 'active' : '')}
                  onClick={() => {
                    setMethod('CARD');
                    setAmountTendered((totalCents / 100).toFixed(2));
                  }}
                >
                  <CreditCard size={20} />
                  <span>بطاقة بنكية / فيزا</span>
                </button>

                <button
                  type="button"
                  className={'pos-pay-method-btn ' + (method === 'BANK' ? 'active' : '')}
                  onClick={() => {
                    setMethod('BANK');
                    setAmountTendered((totalCents / 100).toFixed(2));
                  }}
                >
                  <Building size={20} />
                  <span>محفظة / إنستاباي</span>
                </button>

                <button
                  type="button"
                  className={'pos-pay-method-btn ' + (method === 'CREDIT' ? 'active' : '')}
                  onClick={() => {
                    setMethod('CREDIT');
                    setAmountTendered('0');
                  }}
                >
                  <Clock size={20} />
                  <span>آجل (على الحساب)</span>
                </button>
              </div>

              {/* Cash Tender & Quick Buttons */}
              {method === 'CASH' && (
                <div className="pos-cash-tender-section">
                  <Field label="المبلغ المستلم من العميل (ج.م) *">
                    <input
                      type="number"
                      step="any"
                      min={totalCents / 100}
                      required
                      autoFocus
                      value={amountTendered}
                      onChange={(e) => setAmountTendered(e.target.value)}
                    />
                  </Field>

                  <div className="pos-quick-cash-chips">
                    {quickCashOptions.map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        className="pos-quick-cash-chip"
                        onClick={() => setAmountTendered((opt.val / 100).toFixed(2))}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* Change Due Card */}
                  <div className="pos-change-card">
                    <span>الباقي للعميل:</span>
                    <strong className={changeDueCents > 0 ? 'has-change' : ''}>
                      {money(changeDueCents)} ج.م
                    </strong>
                  </div>
                </div>
              )}

              {/* Card Reference Input */}
              {method === 'CARD' && (
                <div className="pos-tender-section-box">
                  <Field label="رقم إيصال ماكينة الدفع / الفيزا (Slip # / RRN) - لمطابقة الوردية">
                    <input
                      type="text"
                      autoFocus
                      placeholder="مثال: SLIP-4921 / 003829"
                      value={cardRef}
                      onChange={(e) => setCardRef(e.target.value)}
                    />
                  </Field>
                </div>
              )}

              {/* InstaPay Reference Input */}
              {method === 'BANK' && (
                <div className="pos-tender-section-box">
                  <Field label="رقم العملية المرجعي / إنستاباي (InstaPay Ref #) - إثبات التحويل">
                    <input
                      type="text"
                      autoFocus
                      placeholder="مثال: IPN-89214792 / 123456"
                      value={bankRef}
                      onChange={(e) => setBankRef(e.target.value)}
                    />
                  </Field>
                </div>
              )}

              {method === 'CREDIT' && customer.id === 'walk-in-customer' && (
                <div className="warning-banner">
                  ⚠️ لا يمكن إتمام عملية بيع آجل لـ «عميل نقدي طائر». يرجى اختيار عميل مسجل أولاً.
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <Button
            type="submit"
            busy={busy}
            disabled={
              splitMode
                ? splitRemainingCents !== 0
                : method === 'CREDIT' && customer.id === 'walk-in-customer'
            }
          >
            تأكيد الدفع وطباعة الإيصال
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ThermalReceiptModal({
  result,
  companyName,
  taxNumber,
  branchName,
  cashierName,
  customerName,
  onClose,
}: {
  result: CheckoutResult;
  companyName: string;
  taxNumber?: string;
  branchName: string;
  cashierName: string;
  customerName: string;
  onClose: () => void;
}) {
  const invoiceDateStr = result.document.date || new Date().toLocaleDateString('ar-EG');
  const invoiceTimeStr = new Date().toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const qrData = generateInvoiceQrData({
    sellerName: companyName,
    taxNumber,
    invoiceNumber: result.document.number,
    invoiceDate: `${invoiceDateStr} ${invoiceTimeStr}`,
    total: result.document.total,
    tax: result.document.tax,
  });

  const paymentMethodLabel =
    result.payment.method === 'CASH'
      ? 'نقداً (كاش)'
      : result.payment.method === 'CARD'
        ? 'بطاقة دفع إلكتروني (شبكة / فيزا)'
        : result.payment.method === 'BANK'
          ? 'محفظة إلكترونية / إنستاباي'
          : result.payment.method === 'SPLIT'
            ? 'دفع مجزأ (متعدد الوسائل)'
            : 'حساب آجل (ذمم مدينة)';

  return (
    <Modal title="إيصال استلام نقطة البيع (POS)" onClose={onClose}>
      <div className="modal-body pos-receipt-wrapper">
        <div className="thermal-receipt" id="printable-pos-receipt">
          {/* Receipt Header */}
          <div className="receipt-header">
            <div className="receipt-brand-badge">ORQIVA POS</div>
            <h3 className="receipt-company-title">{companyName}</h3>
            {taxNumber && (
              <div className="receipt-tax-badge">
                <span>الرقم الضريبي: {taxNumber}</span>
              </div>
            )}
            <p className="receipt-branch-name">فرع: {branchName}</p>
            <div className="receipt-title-box">
              <span>فاتورة ضريبية مبسطة</span>
              <small>SIMPLIFIED TAX INVOICE</small>
            </div>
            <div className="receipt-cut-line" />
            <div className="receipt-meta-grid">
              <div className="meta-item">
                <span className="meta-label">رقم الفاتورة:</span>
                <span className="meta-value bold num">#{result.document.number}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">التاريخ والوقت:</span>
                <span className="meta-value num">
                  {invoiceDateStr} - {invoiceTimeStr}
                </span>
              </div>
              <div className="meta-item">
                <span className="meta-label">الكاشير:</span>
                <span className="meta-value">{cashierName}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">العميل:</span>
                <span className="meta-value">{customerName}</span>
              </div>
            </div>
            <div className="receipt-cut-line" />
          </div>

          {/* Itemized Lines Table */}
          {result.lines && result.lines.length > 0 && (
            <div className="receipt-items-container">
              <table className="receipt-items-table">
                <thead>
                  <tr>
                    <th className="col-item">الصنف</th>
                    <th className="col-qty">الكمية</th>
                    <th className="col-price">السعر</th>
                    <th className="col-total">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lines.map((line, idx) => (
                    <tr key={idx}>
                      <td className="col-item">
                        <div className="item-name">{line.name}</div>
                        {line.sku && <small className="item-sku num">{line.sku}</small>}
                      </td>
                      <td className="col-qty num">{line.quantity}</td>
                      <td className="col-price num">{money(line.unit_price)}</td>
                      <td className="col-total num">{money(line.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="receipt-cut-line" />
            </div>
          )}

          {/* Financial Totals */}
          <div className="receipt-totals">
            <div className="receipt-row">
              <span>المجموع الفرعي (قبل الضريبة):</span>
              <span className="num">{money(result.document.subtotal)} ج.م</span>
            </div>

            {result.document.discount > 0 && (
              <div className="receipt-row discount-row">
                <span>خصم الفاتورة:</span>
                <span className="num text-red">-{money(result.document.discount)} ج.م</span>
              </div>
            )}

            <div className="receipt-row">
              <span>
                ضريبة القيمة المضافة ({((result.document.tax_rate ?? 1400) / 100).toFixed(0)}%):
              </span>
              <span className="num">{money(result.document.tax)} ج.م</span>
            </div>

            <div className="receipt-cut-line double-cut" />

            <div className="receipt-row grand-total-highlight">
              <span className="label">الإجمالي النهائي:</span>
              <span className="num value">{money(result.document.total)} ج.م</span>
            </div>

            <div className="receipt-cut-line double-cut" />

            {/* Payment Details */}
            <div className="receipt-row payment-method-row">
              <span>طريقة الدفع:</span>
              <span className="font-semibold">{paymentMethodLabel}</span>
            </div>

            {result.payment.reference && (
              <div className="receipt-row">
                <span>رقم إيصال / مرجع الدفع:</span>
                <span className="num font-semibold">{result.payment.reference}</span>
              </div>
            )}

            {/* Split payments breakdown on receipt */}
            {result.payment.splits && result.payment.splits.length > 0 && (
              <div style={{ margin: '4px 0', padding: '4px 0', borderTop: '1px dashed #e2e8f0' }}>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                  تفاصيل الدفع المجزأ:
                </span>
                {result.payment.splits.map((s, idx) => (
                  <div
                    key={idx}
                    className="receipt-row"
                    style={{ fontSize: '11px', color: '#334155' }}
                  >
                    <span>
                      •{' '}
                      {s.method === 'CASH'
                        ? 'كاش'
                        : s.method === 'CARD'
                          ? 'فيزا'
                          : s.method === 'BANK'
                            ? 'إنستاباي'
                            : 'آجل'}
                      {s.reference ? ` (مرجع: ${s.reference})` : ''}:
                    </span>
                    <span className="num">{money(s.amount)} ج.م</span>
                  </div>
                ))}
              </div>
            )}

            {result.payment.method === 'CASH' && (
              <>
                <div className="receipt-row">
                  <span>المبلغ المستلم (المدفوع):</span>
                  <span className="num">
                    {money(result.payment.amount_tendered || result.document.total)} ج.م
                  </span>
                </div>
                <div className="receipt-row change-highlight">
                  <span>المتبقي للعميل (الباقي):</span>
                  <span className="num change-amount">{money(result.payment.change_due)} ج.م</span>
                </div>
              </>
            )}
          </div>

          {/* Electronic QR Code & Barcode */}
          <div className="receipt-verification-section">
            <div className="receipt-cut-line" />
            <div className="receipt-qr-box">
              <QrCodeSvg value={qrData} size={105} />
              <small className="qr-hint">امسح للتحقق من الفاتورة الإلكترونية</small>
            </div>
            <div className="receipt-barcode-box">
              <BarcodeSvg value={result.document.number} height={34} fontSize={10} />
            </div>
          </div>

          {/* Receipt Footer */}
          <div className="receipt-footer">
            <div className="receipt-cut-line" />
            <p className="policy-note">
              البضاعة المباعة ترد وتستبدل خلال 14 يوماً وفقاً لقانون حماية المستهلك مع إحضار
              الفاتورة
            </p>
            <p className="thanks-note">شكراً لزيارتكم! نتشرف بخدمتكم دائماً ❤️</p>
            <small className="system-credit">أوركيفا لإدارة نقاط البيع · Orqiva Cloud POS</small>
          </div>
        </div>
      </div>

      <div className="modal-footer">
        <Button onClick={triggerThermalPrint}>
          <Printer size={16} /> طباعة الإيصال (Ctrl+P)
        </Button>
        <Button variant="secondary" onClick={onClose}>
          فاتورة جديدة
        </Button>
      </div>
    </Modal>
  );
}

function HotkeysModal({ onClose }: { onClose: () => void }) {
  const hotkeys = [
    { key: 'F2 / مسافة', desc: 'فتح نافذة الدفع الفوري وإنهاء الطلب' },
    { key: 'F3', desc: 'الانتقال السريع لحقل البحث والباركود' },
    { key: 'F4', desc: 'فتح قائمة اختيار العميل أو العميل الطائر' },
    { key: 'F8', desc: 'تسجيل حركة نقدية في الدرج (إيداع/سحب)' },
    { key: 'F9', desc: 'إغلاق الوردية ومطابقة النقدية' },
    { key: 'Escape', desc: 'إغلاق أي نافذة منبثقة مفتوحة' },
    { key: 'ماسح الباركود', desc: 'مسح أي منتج لإضافته للسلة فوراً دون استخدام الفأرة' },
  ];

  return (
    <Modal title="اختصارات لوحة المفاتيح لنقطة البيع" onClose={onClose}>
      <div className="modal-body">
        <div className="pos-hotkeys-list">
          {hotkeys.map((h) => (
            <div className="pos-hotkey-row" key={h.key}>
              <kbd className="pos-kbd">{h.key}</kbd>
              <span>{h.desc}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="secondary" onClick={onClose}>
          إغلاق
        </Button>
      </div>
    </Modal>
  );
}
