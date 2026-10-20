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
  Flame,
  Undo2,
  Calculator,
} from 'lucide-react';
import { api, Button, Modal, money, useSession, useToast, useDebounced, usePref } from '../../lib';
import { useBranch } from '../../branch';
import type { PosShift, PosShiftSummary, Party, PosParkedSale, ParkedCartLine } from '../../types';
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
import { PosReturnModal } from './return';

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
  const [fastProducts, setFastProducts] = useState<PosProduct[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  // A silent refresh keeps the catalogue on screen after a sale instead of a full-screen spinner.
  const [refreshing, setRefreshing] = useState(false);

  // Cart & Sale State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState<Party>(DEFAULT_WALK_IN_CUSTOMER);
  const [discountCents, setDiscountCents] = useState(0);

  // Search & Filters (rawInput drives the box; searchQuery is debounced for filtering)
  const [rawSearch, setRawSearch] = useState('');
  const searchQuery = useDebounced(rawSearch, 220);
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Cashier preferences
  const [autoPrint, setAutoPrint] = usePref('pos.autoPrint', false);
  const [showNumpad, setShowNumpad] = usePref('pos.numpad', false);

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
  const [parkedModal, setParkedModal] = useState(false);
  const [parkedSales, setParkedSales] = useState<PosParkedSale[]>([]);
  const [returnModal, setReturnModal] = useState(false);

  // Load Data
  const reloadData = async (silent = false) => {
    if (!activeBranch) return;
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [shiftData, productsData, customersData, fastData] = await Promise.all([
        api<PosShift | null>(`/pos/shifts/current?branch_id=${activeBranch.id}`),
        api<PosProduct[]>(`/pos/products?branch_id=${activeBranch.id}`),
        api<Party[]>('/parties?type=CUSTOMER'),
        api<PosProduct[]>(`/pos/products?branch_id=${activeBranch.id}&top=8`),
      ]);
      setShift(shiftData);
      setProducts(productsData);
      setCustomers(customersData);
      setFastProducts(fastData.filter((p) => p.active && p.stock > 0));

      if (isAccountantOrAdmin) {
        api<PosShift[]>(`/pos/shifts/pending-review?branch_id=${activeBranch.id}`)
          .then((l) => setPendingCount(l.length))
          .catch(() => setPendingCount(0));
      }
    } catch (err: any) {
      if (!silent) toast(err.message || 'تعذر تحميل بيانات نقطة البيع');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void reloadData();
  }, [activeBranch?.id]);

  /** Applies a sold cart's quantities to the local catalogue so the grid never flickers. */
  const applySoldStock = (sold: CartItem[]) => {
    const soldBy = new Map(sold.map((c) => [c.product.id, c.quantity]));
    setProducts((prev) =>
      prev.map((p) => {
        const qty = soldBy.get(p.id);
        return qty ? { ...p, stock: Math.max(0, p.stock - qty) } : p;
      }),
    );
    setFastProducts((prev) =>
      prev
        .map((p) => {
          const qty = soldBy.get(p.id);
          return qty ? { ...p, stock: Math.max(0, p.stock - qty) } : p;
        })
        .filter((p) => p.stock > 0),
    );
  };

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

  // Parked (held) sales — suspend the current cart and resume it later.
  const refreshParkedSales = async () => {
    if (!activeBranch) return;
    try {
      setParkedSales(await api<PosParkedSale[]>(`/pos/parked?branch_id=${activeBranch.id}`));
    } catch {
      setParkedSales([]);
    }
  };

  const holdCart = async () => {
    if (cart.length === 0 || !activeBranch) return;
    try {
      await api('/pos/parked', 'POST', {
        branch_id: activeBranch.id,
        shift_id: shift?.id,
        label: customer.id === 'walk-in-customer' ? '' : customer.name,
        customer_id: customer.id,
        discount: discountCents,
        cart: cart.map((c) => ({
          product_id: c.product.id,
          name: c.product.name,
          sku: c.product.sku,
          quantity: c.quantity,
          unit_price: c.unit_price,
        })),
      });
      clearCart();
      playSound(true);
      toast('تم تعليق السلة. يمكنك استئنافها في أي وقت.');
      void refreshParkedSales();
    } catch (err: any) {
      toast(err.message || 'تعذر تعليق السلة');
    }
  };

  const resumeCart = async (parked: PosParkedSale) => {
    try {
      const lines = JSON.parse(parked.cart || '[]') as ParkedCartLine[];
      const restored: CartItem[] = lines.map((line) => {
        const product = products.find((p) => p.id === line.product_id) || {
          id: line.product_id,
          sku: line.sku || '',
          name: line.name,
          category: '',
          unit: '',
          sale_price: line.unit_price,
          cost_price: 0,
          min_stock: 0,
          active: 1,
          created_at: '',
          stock: line.quantity,
        };
        return { product, quantity: line.quantity, unit_price: line.unit_price };
      });
      await api(`/pos/parked/${parked.id}/resume`, 'POST', {});
      const customerMatch = [DEFAULT_WALK_IN_CUSTOMER, ...customers].find(
        (c) => c.id === parked.customer_id,
      );
      setCart(restored);
      setDiscountCents(parked.label_discount || 0);
      setCustomer(customerMatch || DEFAULT_WALK_IN_CUSTOMER);
      setParkedModal(false);
      toast('تم استئناف السلة المعلّقة.');
      void refreshParkedSales();
    } catch (err: any) {
      toast(err.message || 'تعذر استئناف السلة');
    }
  };

  const discardParked = async (parked: PosParkedSale) => {
    try {
      await api(`/pos/parked/${parked.id}`, 'DELETE');
      toast('تم حذف السلة المعلّقة.');
      void refreshParkedSales();
    } catch (err: any) {
      toast(err.message || 'تعذر حذف السلة');
    }
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
            onClick={() => void reloadData(true)}
            title="تحديث البيانات"
            aria-label="تحديث البيانات"
          >
            <RefreshCw size={17} className={refreshing ? 'spin' : ''} />
          </button>
          <button
            className={'icon-btn ' + (autoPrint ? 'active' : '')}
            onClick={() => setAutoPrint(!autoPrint)}
            title={autoPrint ? 'الطباعة التلقائية: مفعّلة' : 'الطباعة التلقائية: متوقفة'}
            aria-label="تبديل الطباعة التلقائية بعد الدفع"
            aria-pressed={autoPrint}
          >
            <Printer size={17} />
          </button>
          <button
            className={'icon-btn ' + (showNumpad ? 'active' : '')}
            onClick={() => setShowNumpad(!showNumpad)}
            title={
              showNumpad ? 'لوحة الأرقام على الشاشة: مفعّلة' : 'لوحة الأرقام على الشاشة: متوقفة'
            }
            aria-label="تبديل لوحة الأرقام على الشاشة"
            aria-pressed={showNumpad}
          >
            <Calculator size={17} />
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
                onClick={holdCart}
                disabled={cart.length === 0}
                className="pos-clear-btn"
              >
                <Clock size={16} /> تعليق
              </Button>

              <Button
                variant="secondary"
                onClick={() => {
                  void refreshParkedSales();
                  setParkedModal(true);
                }}
                className="pos-clear-btn"
              >
                <ShoppingCart size={16} /> المعلّقة
                {parkedSales.length > 0 && (
                  <span className="parked-count-chip">{parkedSales.length}</span>
                )}
              </Button>

              <Button
                variant="secondary"
                onClick={clearCart}
                disabled={cart.length === 0}
                className="pos-clear-btn"
              >
                <Trash2 size={16} /> مسح السلة
              </Button>

              <Button
                variant="secondary"
                onClick={() => {
                  if (!shift) {
                    toast('يرجى افتتاح وردية أولاً لتسجيل المرتجعات');
                    return;
                  }
                  setReturnModal(true);
                }}
                className="pos-clear-btn"
                title="إرجاع فاتورة بيع سابقة (مرتجع)"
              >
                <Undo2 size={16} /> إرجاع
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
                value={rawSearch}
                onChange={(e) => setRawSearch(e.target.value)}
              />
              {rawSearch && (
                <button type="button" className="pos-clear-search" onClick={() => setRawSearch('')}>
                  <X size={15} />
                </button>
              )}
            </div>

            <div className="pos-barcode-indicator" title="قارئ الباركود متصل وجاهز للاستقبال">
              <Barcode size={18} />
              <span>ماسح الباركود متصل</span>
            </div>
          </div>

          {/* Fast movers: top sellers for this branch (one tap away) */}
          {fastProducts.length > 0 && (
            <div className="pos-fast-row">
              <span className="pos-fast-label">
                <Flame size={15} /> الأكثر مبيعاً
              </span>
              {fastProducts.map((p) => {
                const inCart = cart.find((i) => i.product.id === p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={'pos-fast-chip ' + (inCart ? 'in-cart' : '')}
                    onClick={() => addToCart(p)}
                    title={`${p.name} — متاح ${p.stock}`}
                  >
                    <span className="pos-fast-name">{p.name}</span>
                    <span className="pos-fast-price">{money(p.sale_price)}</span>
                    {inCart && <span className="pos-cart-badge">{inCart.quantity}</span>}
                  </button>
                );
              })}
            </div>
          )}

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

          {/* Products Grid — shows a skeleton on first load, never blanks out after a sale */}
          {loading ? (
            <div className="pos-products-grid">
              <ProductGridSkeleton />
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="pos-products-grid">
              <div className="pos-no-products">لا توجد منتجات مطابقة في هذا الفرع</div>
            </div>
          ) : (
            <div className={'pos-products-grid ' + (refreshing ? 'refreshing' : '')}>
              {filteredProducts.map((p) => {
                const inCart = cart.find((i) => i.product.id === p.id);
                const isOutOfStock = p.stock <= 0;
                const isLow = !isOutOfStock && p.min_stock > 0 && p.stock <= p.min_stock;
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
                    {isLow && (
                      <span className="pos-low-badge" title="المخزون وصل الحد الأدنى">
                        <AlertCircle size={12} /> منخفض
                      </span>
                    )}
                    <div className="pos-prod-info">
                      <span className="pos-prod-name">{p.name}</span>
                      <span className="pos-prod-sku">{p.sku}</span>
                    </div>

                    <div className="pos-prod-footer">
                      <strong className="pos-prod-price">{money(p.sale_price)} ج.م</strong>
                      <span
                        className={'pos-prod-stock ' + (isOutOfStock ? 'zero' : isLow ? 'low' : '')}
                      >
                        {isOutOfStock ? 'نفد المخزون' : `متاح: ${p.stock}`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
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
          numpad={showNumpad}
          onSuccess={(res) => {
            applySoldStock(cart);
            setReceiptResult(res);
            setCheckoutModal(false);
            clearCart();
            // A silent refresh reconciles stock/shift in the background without blanking the grid.
            void reloadData(true);
          }}
          onClose={() => setCheckoutModal(false)}
        />
      )}

      {/* MODAL: Cashier refund of a previous sale */}
      {returnModal && shift && (
        <PosReturnModal
          branchId={activeBranch.id}
          onClose={() => setReturnModal(false)}
          onDone={() => {
            setReturnModal(false);
            void reloadData(true);
          }}
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
          autoPrint={autoPrint}
          onClose={() => setReceiptResult(null)}
        />
      )}

      {/* MODAL 8: Hotkeys Guide Modal */}
      {hotkeysModal && <HotkeysModal onClose={() => setHotkeysModal(false)} />}

      {/* MODAL 9: Parked (held) sales */}
      {parkedModal && (
        <Modal title="السلات المعلّقة" onClose={() => setParkedModal(false)}>
          <div className="modal-body">
            {parkedSales.length === 0 ? (
              <p className="muted">لا توجد سلات معلّقة حالياً.</p>
            ) : (
              <div className="parked-list">
                {parkedSales.map((p) => (
                  <div className="parked-item" key={p.id}>
                    <div className="parked-item-info">
                      <strong>{p.label || 'بدون وصف'}</strong>
                      <small className="muted">
                        {p.user_name} · {new Date(p.created_at).toLocaleTimeString('ar-EG')}
                      </small>
                    </div>
                    <div className="parked-item-meta">
                      <span>{money(p.total)} ج.م</span>
                      <div className="row-actions">
                        <Button variant="secondary" onClick={() => resumeCart(p)}>
                          استئناف
                        </Button>
                        <Button variant="danger" onClick={() => discardParked(p)}>
                          حذف
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ==========================================
// Sub-components & Dedicated Modals
// ==========================================

/** Lightweight skeleton of the product grid shown only on the very first load. */
function ProductGridSkeleton() {
  return (
    <>
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="pos-product-card pos-skeleton-card" aria-hidden="true">
          <div className="pos-skeleton-line w-70" />
          <div className="pos-skeleton-line w-40" />
          <div className="pos-skeleton-footer">
            <div className="pos-skeleton-line w-30" />
            <div className="pos-skeleton-line w-30" />
          </div>
        </div>
      ))}
    </>
  );
}
