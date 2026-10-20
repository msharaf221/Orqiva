# خطة العمل المتكاملة — Orqiva v2

> **الحالة:** المراحل ٠–٤ مكتملة ومدفوعة على الفرع `refactor/v2`؛ المرحلة ٥ (تجربة الاستخدام) هي المتبقية.
> **تاريخ الإعداد:** 2026-10-20
> **المصدر:** تحليل شامل للكود (~28k سطر TS/TSX + 628 سطر SQL) — الأرقام والسطور أدناه مُتحقَّق منها في شجرة العمل الحالية.

> **تقدّم التنفيذ (يُحدَّث بعد كل مرحلة):**
> - ✅ المرحلة ٠ — شبكة الأمان (فرع git + خط أساس أخضر).
> - ✅ المرحلة ١ — تنظيف ديون RBAC + الثغرات (`f2df50e`).
> - ✅ المرحلة ٢ — تقسيم `Finance.tsx` و`POS.tsx` (`28c6f03`).
> - ✅ المرحلة ٣ — تقسيم الأنماط CSS إلى 11 ملف (`dde7a79`).
> - ✅ المرحلة ٤.١ — أساس الفاتورة الإلكترونية ETA (`90c8779`).
> - ✅ المرحلة ٤.٤ — حالات حدود POS: تعليق السلات، إعادة التحقق من المخزون، ردّ المرتجعات على الوردية (`de80d0f`).
> - ✅ المرحلة ٤.٣ — الجرد الدوري واعتماد الفروقات واقتراحات إعادة الطلب (`11b05da`).
> - ✅ المرحلة ٤.٢ — دفتر الأستاذ بالقيد المزدوج والترحيل الآلي (`dc10a08`).
> - ⏳ المرحلة ٥ — تجربة الاستخدام (قيد العمل).

---
## المرحلة صفر — شبكة الأمان 🔒

| الإجراء | التفاصيل |
|---|---|
| فرع git منفصل | كل مرحلة = commit (أو سلسلة صغيرة) قابلة للتراجع |
| خط الأساس | `typecheck + 159 vitest + build + playwright` أخضر **قبل** أي تعديل |
| بوابة كل مرحلة | لا تُعتمد أي خطوة إلا بجميع البوابات خضراء 100% |
| مبدأ | كل خطوة إما أن تحقق البوابة كاملة، أو تُتراجع |

**البوابات الخمس لكل مرحلة:**
1. `npm run typecheck` (tsconfig strict + noUnusedLocals/Parameters)
2. `npm test` — 159 اختبار Vitest
3. `npm run build`
4. `npx playwright test`
5. `npm run format:check`

---

## المرحلة 1 — تنظيف ديون الترحيل RBAC + إصلاح الثغرات ⚠️

### 1.1 الثغرات المكتشفة

| # | الخطورة | الثغرة | الدليل |
|---|---|---|---|
| 1 | 🔴 | **`GENERAL_ACCOUNTANT` يملك صفر صلاحيات** — migration `008` أنشأت `role_gen_acc` ولم تزرع لها أي صف في `role_permissions` | `database/migrations/008_pos_and_treasury.sql:75-78` (صف الدور فقط) · `server/routes/rbac.ts:89-97` يربط الدور بـ`role_gen_acc` |
| 2 | 🔴 | **`routes/transfers.ts` و `routes/parties.ts` بلا أي فحص صلاحيات على السيرفر** — الحماية في الواجهة فقط. أي جلسة صالحة تنقل أموالاً بين الفروع أو تنشئ موردين | `server/routes/transfers.ts` (صفر `requirePermission`) · `parties.ts` يفحص فقط `role !== 'ADMIN'` في:31,59 |
| 3 | 🟡 | `admin` middleware يخلط `users:manage` مع إدارة الفروع/المنتجات/الشركاء — مدير فرع يملك `catalog:manage` في القاعدة لكنه يحصل **403** من API المنتجات | `server/middleware.ts:15-24` · مثبّت في `catalog.ts:17,21,25,29` |
| 4 | 🟡 | `pos:discount` و `reports:group_overview` مُصرَّح بهما ولا يُفحصان أبداً · `company:manage` / `audit:view` ميتة تماماً (لا تُستخدم في أي مكان) | `server/rbac.ts:21,48` · لا يوجد site آخر |
| 5 | 🟡 | `PermissionsModal.tsx` ‏`ROLE_DEFAULT_MAP` يعرض قواعد أدوار **مخالفة فعلياً** لبيانات الـseeds (بمصطلحات قديمة `sales:*`) | `src/pages/PermissionsModal.tsx:52-114` مقابل `007:43-120` و`008:81-123` |

### 1.2 مصفوفة الديون (ما يُحذف وما يُبقي)

**`server/rbac.ts` (529 سطر):**

| السطور | الإجراء |
|---|---|
| 63–82 | **حذف** دفع الـaliases من `ALL_PERMISSION_IDS` · الإبقاء على `admin:all` كـsuper-permission صريح داخل `PERMISSIONS` |
| 141–163 | خريطة role-name→roleId fallback: **تُبقي** أو تُهاجر اختبارات `pos.test.ts:17-27,220-230` (تُنشئ مستخدمين بـSQL خام بلا `user_roles`) |
| 176–210 | **حذف** قواعد fallback لكل دور — تحققت أنها subsets **دقيقة** من الـseeds (CASHIER ⊆ `008:81-96`، TREASURY ⊆ `008:99-110`، STAFF == `007:96-104`) |
| 212–257 | **حذف** توسيع الـaliases بعد ضمان الاختبارات المقفلة (انظر 1.4) |
| 259–263 | **إبقاء** تطبيق الـoverrides (مقفل بـ`permissions.test.ts:80-124`) |
| 268–274 | **حذف** `getEffectivePermissions` — export ميت (صفر call sites) |
| 284–285 | **إبقاء** bypass خاص بـADMIN/`admin:all` |
| 289–307 | **حذف** إعادة فحص الـaliases في `hasPermission` — كل المستدعيين يمرّون canonical IDs |
| 396, 418–420 | استبدال case خاص بـADMIN→`ALL_PERMISSION_IDS` بصفوف `role_admin` المزروعة (أو `admin:all` فقط) |
| 474–476 | **إبقاء** force-push لـ`admin:all` في `updateRole` (حارس ثابت) |

**الخطوات:**
1. **Migration 010**: صلح صلاحيات `role_gen_acc` (مرآة `role_accountant` + `documents:create_purchase` و`reports:group_overview`) · تطبيع `users.role` ↔ `user_roles.role_id` · backfill أي مستخدم بلا صف دور.
2. **توسيع الفحص في السيرفر**: استبدال `admin` middleware بـ`requirePermission` حسب المجال:
   - `catalog.ts` → `catalog:manage` / `inventory:adjust`
   - `branches.ts` → `branches:manage`
   - `owners.ts` → `distribution:manage`
   - `reports.ts` → `reports:view` (+ `reports:group_overview` للتوطين)
   - `parties.ts` → `parties:view` / `parties:manage`
   - `transfers.ts` → `transfers:manage` (يُضاف فحص مفقود تماماً)
   - ملاحظة: هذا **يفتح** صلاحيات لمديري الفروع كانوا محظورين (سابقاً عبر `admin` middleware)، ولا يُغلقها.
3. **`routes/pos.ts:44,57,73,87`**: حذف `'admin:all'` الحرفي المكرر من قوائم `requirePermission`.
4. **الواجهة**: تضييق `PermissionKey` في `src/types.ts:14-45` (حذف الـunion القديم: `sales:*`, `purchases:*`, `products:*`, `customers:manage`, `company:manage`, `audit:view`…) · استبدال `ROLE_DEFAULT_MAP` بمشتق من `GET /api/roles`.
5. **قرار سياسة**: إما تنفيذ `pos:discount` عند checkout في `server/pos.ts` أو حذفه من الكتالوج والـseeds · حذف `company:manage`/`audit:view`.

### 1.3 الـseeds الحالية (مصدر الحقيقة)

- **007**: `roles` + `role_permissions` + `user_roles` — 6 أدوار نظام (ADMIN ‏21 صلاحية · BRANCH_MANAGER ‏14 · ACCOUNTANT ‏9 · SALES ‏8 · WAREHOUSE ‏5 · VIEWER ‏5) — **كلها canonical بلا aliases**.
- **008**: ‏3 أدوار إضافية (CASHIER ‏15 · TREASURY ‏11 · GENERAL_ACCOUNTANT ‏**0** — الخطأ) + `user_permission_overrides` + ADMIN/BRANCH_MANAGER يحصلان `pos:*` الخمسة.
- **المفاتيح المُصرَّح بها ولا تُفحص أبداً:** `pos:discount`, `reports:group_overview`.
- **مفاتيح قديمة لا تُزرع أبداً (تعيش فقط عبر الـaliases):** `sales:cancel`, `purchases:*`, `products:manage`, `suppliers:manage`, `distributions:manage`, `company:manage`, `audit:view`.

### 1.4 الاختبارات المقفلة (يجب ألّا تنكسر)

| الاختبار | ما يقفله | الأثر على التغيير |
|---|---|---|
| `permissions.test.ts:30,36` 🔴 | `sales:view` موجود لـADMIN **ولـSTAFF** | يعتمد على دفع الـaliases + توسيع `documents:view→sales:view` — يجب تحديثه أو زرع الـalias |
| `permissions.test.ts:111-124` 🔴 | دورة حياة revoke عبر aliases (`sales:create`) | يحتاج مراجعة عند حذف `expandAliases` |
| `pos.test.ts:17-27,220-230` 🟡 | مستخدمون بـSQL خام بلا `user_roles` | يقفل خريطة role-name→roleId fallback |
| `rbac.test.ts:148-150` 🟡 | محاسب **لا** يحصل على `documents:create_sale` | حارس ضد التوسيع المفرط |
| `migration.test.ts:41-51` 🟡 | قائمة ملفات الهجرات `001…009` + توقعات backfill | **يجب تحديثه عند إضافة 010** |
| `client-utils.test.ts:43-86` 🟡 | عقد `can()` في الواجهة (ADMIN/`admin:all`) | يبقى كما هو |
| `helpers.ts:32-33,46,59-60` | منطق تنظيف الـoverrides والأدوار بين الاختبارات | يبقى كما هو |

**البوابة:** كل الاختبارات خضراء (159+ اختبار جديد لـGENERAL_ACCOUNTANT وفحص السيرفر) · لا صلاحية تُفحص في الواجهة بدون فحص مكافئ في السيرفر.

---

## المرحلة 2 — تقسيم الملفات الضخمة ✂️

### 2.1 كشف التكرار الأكبر — ~1,000 سطر متطابقة بين Finance و POS

| المكرر في Finance | المكرر في POS | الحل |
|---|---|---|
| `ShiftTreasuryAuditModal` (2835–3435، 601 سطر) | `TreasuryReviewModal` (1516–2288، 773 سطر) | مكوّن واحد `ShiftReconciliationForm` + hook `useShiftApproval` (الحالة، جدول المطابقة، checklist الخمسة، جدول المدفوعات، payload الـapprove — كلها متطابقة حرفياً · الفارق الوحيد: POS يضيف sidebar للورديات المعلّقة) |
| `ShiftZReportModal` (3437–3698، 262) | `ShiftHandoverSlipModal` (2290–2554، 265) | سلب تسليم حراري واحد موحد (يدعم prop الاسم بدل الت_hardcode) |
| `Math.round(parseFloat(x)*100)` + expected + diff ×3 | | `useTenderVerification(summary)` + مكوّن `DiffBadge` |

### 2.2 `POS.tsx` — من 3,457 سطر إلى hooks + مجلدات

```
src/pages/pos/
├── POS.tsx              (المحرّك فقط: data + hotkeys + cart orchestration ~400 سطر)
├── hooks/
│   ├── useCart.ts           cart state + totals (يُنقَل من L128-131, 298-386)
│   ├── usePosData.ts        shift/products/customers + reloadData (L122-181)
│   ├── useBarcodeWedge.ts   كاشف ماسح الباركود + hotkeys (L193-284)
│   └── useProductFilter.ts  بحث/تصنيف/فلترة (L133-135, 389-406)
├── catalog/               شريط البحث + التصنيفات + شبكة المنتجات (L670-760)
├── cart/                  شريط العميل + صفوف السلة + الإجماليات (L529-668)
├── shift/                 OpenShiftModal · CashMovementModal · CloseShiftModal · HandoverSlipModal
├── checkout/              CheckoutModal · DiscountModal · CustomerPickerModal · ThermalReceiptModal
└── treasury/              TreasuryReviewModal (يُستهلك من Finance أيضاً)
src/shared/
├── reconciliation/        ShiftReconciliationForm + useShiftApproval + DiffBadge
├── receipt/               سلب التسليم الموحد + HotkeysModal
└── pos-utils.ts           playSound · DEFAULT_WALK_IN_CUSTOMER · types · buildCheckoutPayload
```

**إصلاحات المسار الحارق (تُنفَّذ أثناء التقسيم):**

| المشكلة | الدليل | الإصلاح |
|---|---|---|
| وميض شبكة المنتجات بعد كل بيع — `reloadData()` يضبط `loading=true` فتظهر `<Loading/>` بدل الكتالوج | `POS.tsx:154-177` مع `L723-724` | تحديث خلفي (background refresh) لا يضبط `loading` — المنتجات موجودة في الحالة أصلاً |
| side-effects داخل `setCart` updater (`playSound`+`toast`) — تُستدعى أثناء render ومرّتين تحت StrictMode | `POS.tsx:310-325, 329-344` | نقلها خارج الـupdater |
| مستمع `keydown` يعاد الاشتراك مع **كل تغيير سلة** | `POS.tsx:284` (dependencies) | استخدام ref للسلة داخل hook `useBarcodeWedge` |
| معرّف طباعة مكرر `id="printable-pos-receipt"` في مكوّنين | `POS.tsx:3233` و `L2331` | معرّف فريد لكل سلب |
| لا حارس ضد submit مزدوج (Enter) | `POS.tsx:3167-3175` | حارس إرسال صريح |
| سلة تُضاف بمخزون قديم — لا revalidation عند الدفع | `POS.tsx:304-317` | تحقق مخزون قبل POST |
| payload مكرر بين مسار split وsingle | `POS.tsx:2799-2823` و `2847-2875` | `buildCheckoutPayload()` |

**شرط ثابت:** `export function POS` يبقى (مستورد في `App.tsx:58`).

### 2.3 `Finance.tsx` — من 3,698 سطر إلى 7 مجلدات

```
src/pages/finance/
├── expenses/       Expenses (89–398) + ExpenseFormModal (مستخرج من 263–395) + expenseScope
├── payments/       Payments (399–583) + SelectPaymentDoc (584–649)  [PaymentForm تبقى في Documents]
├── reports/        Reports (650–891)
├── settings/       SettingsPage (892–966) + Company (967–1062) + Security (1063–1133)
│                   + UserSettings (1134–1365) + RolesSettings (1367–1477) + RoleModal (1479–1629)
├── activity/       ActivityPage (1630–1713)
├── treasury/       Accounts (2182–2833) + CashAccountModal + TransferModal + StatementModal
└── index.ts        (إعادة تصدير الأسماء الستة كما هي لـApp.tsx:69-77)
```

- **لا توجد بيانات مشتركة بين الأبناء** — كل صفحة تجلب بياناتها بـ`useData` خاص بها · السياق الوحيد المشترك: `useSession` / `useBranch` / `useAction` / `useToast`.
- **`Accounts` هو مركز الحالة** (3 جلب + 8 useState + `reloadAll` fan-out) → يستحق hook `useTreasuryData(branchId)` + مكوّن لكل tab (`AccountCards` / `TransfersTable` / `ShiftSettlementsTable` — المعزولة أصلاً في L2480-2773).
- لا مكوّن يأخذ 5+ props.

### 2.4 primitives مشتركة جديدة

| الـprimitive | يزيل التكرار من |
|---|---|
| `<AsyncTable>` / `<ListPage>` (query + reset page + filters + triad + pagination) | Expenses · Payments · Activity · Accounts tabs · Documents · Catalog · Transfers |
| بناء CSV لكل كيان (`buildXRows()` + `downloadCSV`) | 6 مواقع مع copy مكرر داخل `PageHeader actions` |
| `src/components/` (مجلد جديد — اليوم كل شيء في `lib.tsx`) | موطن المكونات المستخرجة |

**ملاحظة:** لا يوجد `src/components/` اليوم — `lib.tsx:544` سطر يحوي كل primitives (`PageHeader, Button, Field, SearchBox, Modal, Confirm, Loading, ErrorState, Empty, Status, Stat, Pagination, downloadCSV, formValues, Initials`).

### 2.5 خطر الاختبارات

- كل اختبارات الخادم **contract-level** → استخراج المكوّنات لا يكسرها ما دامت الـAPI لم تتغير.
- الحامي الوحيد للواجهة: `tests/e2e/workspace.spec.ts` — يعتمد **نصوص** نموذج المصروفات (`"وصف المصروف *"`, `"تسجيل المصروف"`) → تبقى ثابتة عند استخراج `ExpenseFormModal`.
- **التحقق بعد كل خطوة:** `typecheck + vitest + playwright test tests/e2e/workspace.spec.ts`.

---

## المرحلة 3 — تنظيم الأنماط 🎨

### 3أ — نظافة (منخفضة المخاطرة)

| البند | الدليل |
|---|---|
| حذف **38 كلاس ميت** (~300 سطر): قديم permissions modal ‏(6898–7121، 224 سطر — المستبدل بـ8590–9072 الحي) · login-visual orbits ‏(4653–4666, 4778–4835) · `pos-page`, `pos-review-table`, `modal-close-btn`, `receipt-meta-row` | فحص 634 فئة ضد كل TSX: 586 مستخدَمة، 38 ميتة بعد استثناء 10 بناء ديناميكي |
| ⚠️ **لا تحذف** `perms-group-grid / perm-group-box / perm-check-item` ‏(6846–6897) — ما زالت مستخدمة | |
| إصلاح `product-tone-0` المفقود — الكود يفعل `i % 4` لكن القاعدة `product-tone-0` غير موجودة → أول عنصر بلا تنسيق | `Catalog.tsx:184`, `Dashboard.tsx:421` |
| إصلاح **29 استخداماً بلا قواعد**: `font-semibold` ×21 · `text-red` ×5 · `text-green` ×3 — أسماء تبدو Tailwind ولا يوجد Tailwind | `receipt-components.tsx:410`, `Finance.tsx:3519,3523,3527` |
| توحيد سلّم الأقطار: `--radius:14px` **أكبر من** `--radius-md:12px` | `styles.css:1-121` |
| توحيد selectors المكررة المتعارضة: `.field` ×22 · `.receipt-items-table` ×16 · `.invoice-totals` ×14 · `.login-form` ×12 · `.editor-lines` ×12 | |

### 3ب — تقسيم معياري (صفر مخاطر بصرية)

`src/styles/` بـ ~15 ملف partial **بنفس أسماء الكلاسات حرفياً** — Vite يدمج `@import` تلقائياً:

```
src/styles/
├── 00-tokens.css        (1–121    :root — 83 custom property)
├── 01-base.css          (122–254   reset + micro-utilities)
├── 02-shell.css         (255–660   app-shell + sidebar + topbar)
├── 03-components.css    (661–780   page-heading + .btn system)
├── 04-dashboard.css     (781–1627)
├── 05-tables-forms.css  (1628–2170)
├── 06-modals.css        (2171–2499 modal + toast + loading/empty)
├── 07-documents.css     (2500–3085 editor + invoice paper)
├── 08-reports.css       (3086–3287)
├── 09-settings.css      (3288–3426)
├── 10-login.css         (3427–4037)
├── 11-responsive.css    (4038–5767 + 6568–6580 + 9073–9096 — 1,721 سطر، 18.5%)
├── 12-print.css         (5976–6102 + 8358–8484 — يُبقيان حرفياً: 108 × !important)
├── 13-features.css      (6103–6897 branches/transfers/distributions/treasury/rbac)
├── 14-pos.css           (7122–8484 + 9097–9280)
└── index.css            (@import مرتّب)
```

**يُبقي حرفياً:** كتلتا `@media print` ‏(5976–6102 و8358–8484) · حقن `receipt-components.tsx:191` الإ/style runtime.

### 3ج — ترحيل Tailwind (مرحلي — يُنفَّذ لاحقاً أو حسب القرار)

1. **الـ83 token في `:root` هي أصلاً stock palettes** (slate/indigo/emerald 1:1) → `tailwind.config` جاهز تقريباً (اللوحة الكاملة موثّقة في تحليل CSS).
2. ترحيل primitives أولاً — `Button`/`Modal`/`Field`/`Status`/`Stat`/`Pagination` في `lib.tsx` **تُغطّي 1,438 site** عبر ~10 مكوّنات فقط.
3. ثم صفحات slice-by-slice (443 فئة مرجع واحد فقط لكل صفحة).
4. ثم RTL: **133 إعلان خصائص مادية** (`right:41, left:20, text-align:right:25…`) → logical properties (`ms-/me-/ps-/pe-/start-/end-`).
5. ثم breakpoints: 8 قياسات عشوائية (600/768/800/900/1000/1050/1250/1600) → سلّم قياسي.
6. **أصعب ما هو محمي:** كتلة responsive ‏(1,721 سطر) + كتلتا print ‏(pixel-exact business documents).

---

## المرحلة 4 — الفجوات الوظيفية 📦

### 4.1 الربط مع ETA 2026 (أولوية قانونية)

**الوضع الحالي:** يوجد QR code وطباعة حرارية (`receipt-components.tsx`, `ThermalReceiptModal`)، لكن **لا أثر** لـUBL 2.1 / UUID / حالة الإرسال / رقم الفاتورة الضريبية.

**الأساس المطلوب (بنية جاهزة للربط):**
- عمود `internal_code (UUID)` على الفواتير (UBL 2.1 UUID الإلزامي)
- جدول `e_invoice_submissions` — status, UUID, submission timestamp, ETA response, retry count
- خط أنابيب إرسال قابل للتشغيل بوضع `stub` (worker مستقل، لا يعِق الدفع)
- ربط `server/returns.ts` بـcredit notes (UBL CreditNote)
- حقل الرقم الضريبي والكود الضريبي على الشركة (`company` table)
- QR موسّح حسب مواصفة ETA (Version, UUID, Timestamp, Total, VAT)
- اختبارات: UUID فريد، تسلسل إرسال، retry/backoff

> ⚠️ التكامل الفعلي يتطلب شهادات ومفاتيح sandbox من هيئة الضرائب — **البنية كاملة وجاهزة**، والربط يبقى في انتظار المفاتيح.

### 4.2 دفتر الأستاذ (GL) — أكبر قيمة محاسبية

**المشكلة:** P&L اليوم يُحسب من استعلامات مجمّعة على جداول أولية (`server/reports.ts`) — ليس محاسبة قيد مزدوج.

**المخطط:**
- `chart_of_accounts` (أصول/خصوم/إيرادات/تكاليف/ حقوق ملكية) — مخطط مصري قياسي
- `journal_entries` + `journal_lines` (مدين/دائن، قيد متوازن إلزامياً عبر CHECK + trigger)
- **توليد قيود آلياً من نفس محرّكاتPosting الموجودة** — `service.ts` `postDocument` / `cancelDocument`، `returns.ts`، `allocation.ts`، `accounts.ts` — كلها مغلقة أصلاً بـ`BEGIN IMMEDIATE`
- ميزان مراجعة (trial balance) · إقفال فترة شهرية · ميزانية مختصرة
- ربط بـ`branch_stock` (مخزون كحساب) و`accounts` (نقدية) وWAC (تكلفة المبيعات)

### 4.3 تحسينات المخازن

| الميزة | التفاصيل |
|---|---|
| Stocktake دوري | جرد دوري بموافقة فروقات (variance approval) — اليوم يوجد `stock movements` و`adjustment` فقط |
| تسعير النقل بين الفروع | transfer pricing — `ORQIVA_ULTIMATE.md` يذكره في الـroadmap |
| ATP (Available to Promise) | مخزون متاح = موجود − محجوز في ورديات مفتوحة وطلبات |
| إعادة بناء اقتراحات إعادة الطلب | **يوجد CSS `.suggestion-` جاهز (6346–6384) بلا صفحات!** — reorder suggestions بناءً على حد إعادة الطلب الموجود في الفروع |

### 4.4 حالات حدود غير مغطاة ⚡

| # | السيناريو | الحالة اليوم | الإجراء |
|---|---|---|---|
| 1 | منتج يُضاف للسلة بمخزون ثم يُباع آخر كاشير | 🔴 السلة تتحقق من `product.stock` **قديم** — لا revalidation عند الدفع (السيرفر يمنع السلب لكن الرسالة متأخرة للعميل) | revalidate قبل POST |
| 2 | **تعليق/استئناف بيع** (Hold/Park) | 🔴 مفقود تماماً — ضروري في المحلات عند مقاطعة عميل | جدول `pos_parked_sales` + استرجاع باللمس |
| 3 | إرجاع مبيعات POS من الصندوق | 🟡 هل يُخصم المبلغ من صندوق الوردية (`pos_shift_id`)؟ | ربط المرتجعات بالوردية وإلزام اختبار |
| 4 | تعطيل موظف وهو في جلسة نشطة | ⚠️需 فحص: هل يُفحص `active` في كل طلب؟ | تأكيد في session middleware |
| 5 | انقطاع الشبكة/الطاقة وسط checkout | 🟡 idempotency للدفعات موجود (`002_payment_idempotency`) لكن **لا اختبار crash-recovery ولا drill لاستعادة `backups/`** | اختبار استرجاع نسخة + drill وثّقي |
| 6 | انتهاء الجلسة أثناء الدفع | 🟢 مغطى (session generation fires once) | — |
| 7 | طباعة إيصال بعد إغلاق الوردية | ⚠️需 فحص | تأكيد وإصلاح إن لزم |
| 8 | كتالوج ضخم (آلاف المنتجات) | 🟡 لا pagination/virtualization في شبكة POS | pagination للـAPI + lazy render |
| 9 | اثنان على نفس الصندوق | 🟢 مغطى (`pos.test.ts` PENDING_REVIEW + guards) | — |
| 10 | خصم يتجاوز الإجمالي / كميات سالبة | 🟢 مغطى بـZod refinements + CHECK constraints | — |
| 11 | أداء `canSee()` (استعلام لكل طلب) | 🟡 fine لـSQLite واحد — hotspot عند الانتقال لـPostgres | توثيق + cache عند الحاجة |
| 12 | ازدواجية صلاحيات أثناء الجلسة | ⚠️ هل تعديل role/override يُفعّل فوراً؟ (يُعاد الجلب في كل طلب — نعم) | — |

---

## المرحلة 5 — تجربة الاستخدام 🖐️

### 5.1 عام

| التحسين | الحالة | التفاصيل |
|---|---|---|
| تقليل الازدحام | ⏳ | كشف تدريجي (progressive disclosure) بدل جدران البيانات · تجميع إحصائيات ثانوية |
| Skeletons | ✅ | `Loading` يعرض هياكل بحسب المحتوى (rows/cards/inline) بدل شاشة عامة — على كل الشاشات |
| إزالة inline styles | 🟡 | من **213 → 139**: `treasury-review` (66→31) و`shift-audit` (49→27) و`checkout` (22→5) استُخرجت لفئات؛ المتبقي ألوان ديناميكية مشروعة |
| كثافة جداول | ✅ | إعداد كثافة (مريحة/عادية/مضغوطة) في الإعدادات → `html[data-density]` + `useDensity` |
| RTL | 🟡 | التطبيق RTL-first أصلاً؛ `left/right` المتبقية مقصودة (أعمدة أرقام LTR، ترويسة فاتورة) |
| لوحة المفاتيح | ✅ (سابق) | تنقل كامل بـkeyboard في الجداول + اختصارات POS + `Ctrl+K` بحث عام |
| إزالة التكرار البصري | ✅ | دمج `.receipt-items-table` المكرر (pos.css) وتوحيد `.field` بين components/typography |

### 5.2 POS — هدف مقيس: بيع نقدي ≤ 3 لمسات

> ✅ **مكتمل** (commit `92987d7`). المنفذ فعلياً:
> إصلاح وميض الكتالوج (تحديث مخزون محلي + تحديث صامت في الخلفية + skeleton للتحميل الأول)،
> شريط المنتجات الأكثر مبيعاً، بحث بـdebounce، لوحة أرقام على الشاشة للمبلغ المستلم،
> طباعة تلقائية بعد الدفع (إعداد محفوظ)، شارة نقص المخزون، زر «إرجاع» في الـPOS
> (بحث برقم الفاتورة → اختيار الكميات → رد مرتبط بالوردية)، أهداف لمس ≥44px،
> وشريط دفع ثابت. نقطة `GET /pos/products?top=N` + `POST /pos/return` + `GET /pos/sales/lookup`.

**الأثر الأكبر على سرعة الكاشير (أولوية):**
1. **إصلاح وميض الكتالوج** بعد كل عملية بيع — اليوم الشبكة تُعاد تحميلاً بالكامل مع `<Loading/>` (يُنفَّذ ضمن 2.2)
2. تحديث المخزون في الكتالوج فوراً بعد الدفع (بدون refetch كامل)

**اللمس والسرعة:**
| التحسين | الحالة | التفاصيل |
|---|---|---|
| أزرار لمس ≥ 44px | ✅ | صياغة min-height/min-width للعناصر التفاعلية في `.pos-*` |
| لوحة أرقام على الشاشة | ✅ | مكوّن `numpad.tsx` للمبلغ المستلم (إعداد على الشاشة اللمسية) |
| منتجات سريعة/مفضلة | ✅ | شريط الأكثر مبيعاً (`top=N` آخر 90 يوماً لكل فرع) |
| بحث debounce | ✅ | `useDebounced` في `lib.tsx` |
| Modal bottom-sheets | ✅ | prop `sheet` على `Modal` — على الشاشات اللمسية الصغيرة يفتح من الأسفل بارتفاع `85vh` (مطبّق على دفع/إرجاع/منتج سريع) |
| شريط دفع ثابت | ✅ | `.pos-cart-summary` sticky مع تمرير قائمة السلة |
| طباعة تلقائية | ✅ | إعداد «طباعة فورية بعد الدفع» محفوظ في `usePref` |
| **Hold/Park sale** | ✅ (4.4) | تعليق السلة الحالية والعودة لها بلمسة |
| شاشة عميل (customer display) | ⏳ | عرض السلة على شاشة ثانية/مرآة — إعداد اختياري |

**ميزات POS ناقصة أخرى:** إرجاع من واجهة الـPOS (مرتبط بالوردية) ✅ · إشعارات low-stock أثناء البيع ✅ · تعريف سريع لمنتج جديد من شاشة الكاشير ✅ (زر «منتج جديد» → `ProductForm` مضغوط، يظهر لمن يملك `catalog:manage`).

---

## مراحل التنفيذ والبوابات

| # | المرحلة | المخرج | بوابة التحقق | المخاطرة |
|---|---|---|---|---|
| 0 | التأسيس | فرع git + خط أساس أخضر | البوابات الخمس | — |
| 1 | RBAC + الثغرات | migration 010 + `rbac.ts` أنظف + فحوص سيرفر + PermissionKey مضيّق | 159+ اختبار + اختبارات جديدة | متوسطة (اختبارات مقفلة معروفة) |
| 2أ | توحيد التكرار shifts (~1,000 سطر) | `src/shared/reconciliation/` | typecheck + vitest + e2e | متوسطة |
| 2ب | تقسيم POS + إصلاحات المسار الحارق | `src/pages/pos/` + hooks | + `pos.test.ts` | متوسطة |
| 2ج | تقسيم Finance | `src/pages/finance/` | + `workspace.spec.ts` | منخفضة |
| 2د | primitives (AsyncTable/CSV) | `src/components/` | typecheck + vitest | منخفضة |
| 3أ | نظافة CSS | حذف ميت + إصلاحات صامتة | build + مراجعة بصرية | منخفضة |
| 3ب | تقسيم CSS معياري | `src/styles/` ‏15 ملف | build + مراجعة بصرية | **صفر** (نفس الأسماء) |
| 3ج | Tailwind | theme + primitives | مراجعة بصرية شاملة | عالية (مؤجل/بحسب القرار) |
| 4 | الميزات (ETA stub → GL → مخازن → edge cases) | migrations + services + tests | اختبارات جديدة لكل ميزة | تُقدر لكل بند |
| 5 | UI/UX | POS speed + skeletons + touch | مراجعة بصرية + e2e | منخفضة–متوسطة |

---

## أولويات التنفيذ المقترحة

1. **المرحلة 1 أولاً** — ثغرتان حمراويتان (transfers/parties بلا فحص + GENERAL_ACCOUNTANT معطّل) لا يجوز أن تنتظران.
2. ثم **2أ → 2ب → 2ج** (أكبر عائد على قابلية الصيانة، مع إصلاحات المسار الحارق للـPOS في الطريق).
3. ثم **3أ → 3ب** (نظيفة + تقسيم معياري بلا مخاطر).
4. ثم **4** (القيمة التجارية: ETA stub + GL) و**5** (سرعة الكاشير) بالتوازي حيث أمكن.

---

*هذه الوثيقة حيّة — تُحدَّث بعد اكتمال كل مرحلة.*
