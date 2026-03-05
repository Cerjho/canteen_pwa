# Comprehensive Bug Analysis: Parent Menu & Cart Bottom Sheet

> **⚠️ PARTIALLY OBSOLETE**: This analysis was written before the Weekly Pre-Order Refactor. Findings related to wallet/balance, stock quantity tracking, and the `children` table have been resolved by removing those features entirely. The cart/menu rendering and payment flow analysis may still be partially relevant.

**Date:** March 2, 2026  
**Components Analyzed:**

- [src/pages/Parent/Menu.tsx](src/pages/Parent/Menu.tsx) (749 lines)
- [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx) (724 lines)
- [src/hooks/useCart.ts](src/hooks/useCart.ts) (1,022 lines)
- Related services and utilities

**Total Bugs Found:** 55 (8 High, 17 Medium, 30 Low)

---

## Executive Summary

This analysis identified 55 bugs across the Parent Menu and Cart Bottom Sheet components, including:

- **8 Critical/High severity** bugs that can cause data loss, duplicate orders, or checkout failures
- **17 Medium severity** bugs affecting UX, error handling, and data consistency
- **30 Low severity** bugs related to edge cases, accessibility, and performance

The most impactful findings are:

1. **BUG-020**: Empty string notes fall through to stale notes from previous sessions (silent data corruption)
2. **BUG-019**: Race condition in rapid addItem calls can create duplicate DB rows
3. **BUG-003**: Checkout button not disabled when wallet balance insufficient
4. **BUG-017**: No validation prevents checkout of items with past dates
5. **BUG-010**: PostgREST filter syntax may be incorrect for active orders query
6. **BUG-035**: `isDateInPast` uses browser timezone but DB uses Asia/Manila (timezone drift)
7. **BUG-036**: `copyDateItems` sequential DB writes — partial failure corrupts cart
8. **BUG-038**: Cart item deletion uses optimistic IDs; DB delete filters by stale `item.id`

---

## Bug Catalog

### HIGH SEVERITY (5 bugs)

#### BUG-003: Checkout button not disabled when balance insufficient

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L700-L710)  
**Type:** Logic / UI  
**Severity:** HIGH

**Description:**  
When `paymentMethod === 'balance'` and `!canUseBalance` (i.e., `parentBalance < selectedTotal`), the component shows a warning text "Need ₱X more balance" but the checkout button remains enabled. Users can tap it, triggering a server error and wasting a round trip.

**Root Cause:**  
Missing disabled condition: `disabled={items.length === 0 || isCheckingOut}` should also check `|| (paymentMethod === 'balance' && !canUseBalance)`

**Reproduction:**

1. Add items totaling > wallet balance
2. Select "Wallet Balance" as payment
3. Observe button is enabled despite warning
4. Tap → server error

**Fix:**

```tsx
// CartBottomSheet.tsx L700
disabled={
  items.length === 0 || 
  isCheckingOut || 
  (paymentMethod === 'balance' && !canUseBalance)
}
```

**Risk:** Very low — purely additive guard  
**Test:** Update [CartBottomSheet.test.ts](tests/unit/components/CartBottomSheet.test.ts) with disabled state checks

---

#### BUG-010: Active orders query filter syntax may be incorrect

**Location:** [src/pages/Parent/Menu.tsx](src/pages/Parent/Menu.tsx#L82-L91)  
**Type:** Data flow  
**Severity:** HIGH

**Description:**  
The `activeOrders` query uses `.not('status', 'in', '("cancelled","completed")')`. The PostgREST filter syntax with inner double-quotes may be incorrect. The correct syntax might be `'(cancelled,completed)'` without inner quotes. If incorrect, the query may not properly exclude cancelled/completed orders, causing false "Adding to existing order" badges.

**Root Cause:**  
PostgREST `in` operator syntax ambiguity between Supabase JS client versions

**Reproduction:**

1. Have a completed order for the same student and date
2. Add items to cart
3. Open CartBottomSheet
4. Badge shows "Adding to existing order" incorrectly

**Fix:**

```tsx
// Menu.tsx L86 - Try both versions:
// Option A (no inner quotes):
.not('status', 'in', '(cancelled,completed)')

// Option B (safer - explicit negation):
.not('status', 'eq', 'cancelled')
.not('status', 'eq', 'completed')
```

**Risk:** Medium — needs testing with actual Supabase instance  
**Test:** Add test in [ParentMenu.test.ts](tests/unit/pages/ParentMenu.test.ts) for query filter

---

#### BUG-017: No validation prevents checkout of items with past dates

**Location:** [src/hooks/useCart.ts](src/hooks/useCart.ts#L780-L786) & [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L218-L233)  
**Type:** Logic  
**Severity:** HIGH

**Description:**  
`useCart` loads items with `gte('scheduled_for', today)` and validates on `addItem`. But if a user adds items before midnight and the clock rolls past midnight, those items now have a past date. The `checkout()` function doesn't re-validate dates — it will place orders for yesterday.

**Root Cause:**  
No time-of-checkout validation that all items' `scheduled_for` dates are still in the future

**Reproduction:**

1. Open app before midnight
2. Add items for "today"
3. Wait until after midnight
4. Checkout → order placed for yesterday's date

**Fix:**

```ts
// useCart.ts - in checkout() after filtering items
const pastDateItems = currentItems.filter(item => isDateInPast(item.scheduled_for));
if (pastDateItems.length > 0) {
  // Remove them from cart
  setItems(prev => prev.filter(i => !isDateInPast(i.scheduled_for)));
  throw new Error('Some items were for past dates and have been removed. Please review your cart.');
}
```

**Risk:** Low — only affects edge case  
**Test:** Add test in [useCart.test.ts](tests/unit/hooks/useCart.test.ts) for past-date checkout validation

---

#### BUG-019: Race condition in rapid addItem calls can create duplicate DB rows

**Location:** [src/hooks/useCart.ts](src/hooks/useCart.ts#L370-L445)  
**Type:** Runtime / Race condition  
**Severity:** HIGH

**Description:**  
`addItem` does an optimistic local update then checks Supabase for an existing row via `.maybeSingle()`. If the user rapidly taps "Add" twice before the first DB round-trip completes, both calls see no existing row and both try to insert. The `upsert` with `onConflict` should prevent duplicates, but the race window between the first call's check and the second call's insert can cause:

- One upsert succeeds, the other throws constraint error → triggers `loadCart()` refresh
- Jarring UX with cart "jumping"

**Root Cause:**  
No mutex serializing DB writes; concurrent `maybeSingle()` queries both see null

**Reproduction:**

1. Open Menu
2. Double-tap "Add" on a product rapidly (<100ms apart)
3. Close and reopen cart → potential duplicate entries or sudden cart refresh

**Fix:**
Remove the `maybeSingle()` check and rely solely on `upsert`:

```ts
// useCart.ts - simplify addItem DB logic
try {
  const { error } = await supabase
    .from('cart_items')
    .upsert({
      user_id: user.id,
      student_id: item.student_id,
      product_id: item.product_id,
      quantity: item.quantity,
      scheduled_for: item.scheduled_for,
      meal_period: item.meal_period
    }, {
      onConflict: 'user_id,student_id,product_id,scheduled_for,meal_period',
      ignoreDuplicates: false // This will update quantity on conflict
    });
  if (error) throw error;
} catch (err) {
  // Handle error
}
```

**Risk:** Medium — requires testing the upsert behavior  
**Test:** Add race condition test in [useCart.test.ts](tests/unit/hooks/useCart.test.ts)

---

#### BUG-020: Empty string notes fall through to stale notes

**Location:** [src/hooks/useCart.ts](src/hooks/useCart.ts#L786-L788), [L831](src/hooks/useCart.ts#L831), [L909](src/hooks/useCart.ts#L909)  
**Type:** Logic  
**Severity:** HIGH

**Description:**  
`checkout()` uses `orderNotes || currentNotes` fallback. If CartBottomSheet passes an empty string `""` for notes, it's falsy in JavaScript and falls through to `currentNotes` (the hook's state from a previous session). This causes orders to be placed with stale notes the user never intended.

**Root Cause:**  
Using `||` (logical OR) instead of `??` (nullish coalescing) for fallback

**Reproduction:**

1. Type notes in a previous checkout attempt that fails
2. `useCart.notes` retains the old notes
3. Next checkout: empty notes field → passes `""` → old notes are used

**Fix:**

```ts
// useCart.ts L831 and L909
notes: orderNotes ?? currentNotes,  // Use ?? instead of ||
```

**Risk:** Very low — `??` only falls through on null/undefined  
**Test:** Add test in [useCart.test.ts](tests/unit/hooks/useCart.test.ts) for empty string vs null notes

---

### MEDIUM SEVERITY (11 bugs)

#### BUG-001: Double error display on checkout failure

**Location:** [src/pages/Parent/Menu.tsx](src/pages/Parent/Menu.tsx#L279-L289) & [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L218-L233)  
**Type:** Integration  
**Severity:** MEDIUM

**Description:**  
Menu's `handleCheckout` catches errors, shows a toast, then re-throws. CartBottomSheet's `onCheckout` catch block sets `checkoutError` inline. One error triggers two UI displays: toast + inline text.

**Root Cause:**  
Two independent error handling paths for the same operation

**Reproduction:**

1. Add items to cart
2. Trigger checkout failure (go offline)
3. See toast and inline error simultaneously

**Fix:**  
Remove the re-throw from Menu's catch block:

```tsx
// Menu.tsx L279-289
} catch (error) {
  console.error('Checkout error:', error);
  const msg = error instanceof Error
    ? friendlyError(error.message, 'place your order')
    : 'Something went wrong. Please try again.';
  showToast(msg, 'error');
  // Remove: throw error;  ← Delete this line
}
```

**Risk:** Low — simplifies error flow  
**Test:** Verify single error display in integration tests

---

#### BUG-005: No error handling for copy/clear date operations

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L195-L210)  
**Type:** Runtime  
**Severity:** MEDIUM

**Description:**  
`handleCopyItems` and `handleClearDate` call async callbacks without try/catch. If Supabase operations fail, errors propagate unhandled — no user feedback.

**Root Cause:**  
Missing try/catch around async callback invocations

**Reproduction:**

1. Go offline
2. Tap "Copy to another day" or "Clear" on a date group
3. Error is silently swallowed

**Fix:**

```tsx
// CartBottomSheet.tsx
const handleCopyItems = async (fromDate: string, toDate: string) => {
  try {
    if (onCopyDateItems) await onCopyDateItems(fromDate, toDate);
    setShowCopyModal(null);
  } catch (err) {
    setCheckoutError(friendlyError(err, 'copy items'));
  }
};

const handleClearDate = async (dateStr: string, e: React.MouseEvent) => {
  e.stopPropagation();
  if (!onClearDate) return;
  const confirmed = await confirm({...});
  if (!confirmed) return;
  try {
    await onClearDate(dateStr);
  } catch (err) {
    setCheckoutError(friendlyError(err, 'clear items'));
  }
};
```

**Risk:** Low — only adds error visibility  
**Test:** Add error handling tests in [CartBottomSheet.test.ts](tests/unit/components/CartBottomSheet.test.ts)

---

#### BUG-006: Copy targets include holidays (no validation)

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L180-L192)  
**Type:** Logic  
**Severity:** MEDIUM

**Description:**  
`getNextValidDates` skips Saturdays/Sundays but doesn't check for holidays. Parents can copy items to a holiday date when the canteen is closed.

**Root Cause:**  
CartBottomSheet has no access to holiday/canteen schedule data

**Reproduction:**

1. Add items for Monday
2. Open copy modal
3. If a holiday falls mid-week, it appears as a valid copy target
4. Copy → items exist for a closed canteen day

**Fix:**  
Add `closedDates?: string[]` prop to CartBottomSheet:

```tsx
// CartBottomSheet.tsx
interface CartBottomSheetProps {
  // ... existing props
  closedDates?: string[];
}

const getNextValidDates = (excludeDate: string): string[] => {
  // ... existing logic
  if (closedDates?.includes(dateStr)) continue;
  // ...
};

// Menu.tsx - pass the prop
<CartBottomSheet
  closedDates={weekdaysInfo?.filter(w => !w.isOpen).map(w => w.dateStr)}
  // ... other props
/>
```

**Risk:** Low — additive prop, backward compatible  
**Test:** Add holiday exclusion test in [CartBottomSheet.test.ts](tests/unit/components/CartBottomSheet.test.ts)

---

#### BUG-007: selectedDates state drifts when items are removed

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L103-L104)  
**Type:** Data flow  
**Severity:** MEDIUM

**Description:**  
`selectedDates` is a Set of date strings for partial checkout. If all items for a selected date are removed, `selectedDates` still contains that date. The total shows ₱0.00 but the button label says "Checkout 1 Day".

**Root Cause:**  
`selectedDates` not synchronized when `items` change

**Reproduction:**

1. Add items for two dates
2. Select only date A via checkboxes
3. Clear date A's items using trash icon
4. Selected total = ₱0.00, but "Checkout 1 Day" still shows

**Fix:**

```tsx
// CartBottomSheet.tsx - add useEffect
useEffect(() => {
  setSelectedDates(prev => {
    const pruned = new Set([...prev].filter(d => uniqueDates.includes(d)));
    return pruned.size === prev.size ? prev : pruned;
  });
}, [uniqueDates]);
```

**Risk:** Low — purely corrective  
**Test:** Add test in [CartBottomSheet.test.ts](tests/unit/components/CartBottomSheet.test.ts) for stale date pruning

---

#### BUG-018: ConfirmDialog z-index may clash with Drawer overlay

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L719) & [src/components/ConfirmDialog.tsx](src/components/ConfirmDialog.tsx#L60)  
**Type:** UI  
**Severity:** MEDIUM

**Description:**  
`ConfirmDialogElement` is rendered outside `Drawer.Portal`. The confirm dialog uses its own portal with `z-[60]`, but if this is lower than or equal to the Drawer's overlay (`z-40`) + content (`z-50`), it may appear behind the drawer, making it unusable.

**Root Cause:**  
Z-index stacking context competition between two portals

**Reproduction:**

1. Open cart
2. Click trash icon on a date group
3. Confirm dialog may appear behind dark overlay

**Fix:**  
Ensure ConfirmDialog overlay and content have `z-[60]` or higher:

```tsx
// ConfirmDialog.tsx L60
<div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] animate-fade-in" />
```

**Risk:** Low — CSS-only change  
**Test:** Manual verification or E2E test

---

#### BUG-021: Double checkout possible via keyboard submission

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L218) vs [src/pages/Parent/Menu.tsx](src/pages/Parent/Menu.tsx#L230)  
**Type:** Race condition / Integration  
**Severity:** MEDIUM

**Description:**  
CartBottomSheet guards with `if (isCheckingOut) return;` but Menu's `handleCheckout` (passed as `onCheckout`) has no such guard. If the drawer form is submitted twice rapidly (e.g., Enter key pressed twice), `useCart.checkout()` executes twice, potentially creating duplicate orders.

**Root Cause:**  
No idempotency guard in `useCart.checkout()` itself

**Reproduction:**

1. Focus on order notes textarea
2. Rapidly press Enter twice while first checkout is in-flight
3. Two orders may be created

**Fix:**

```ts
// useCart.ts - add ref-based guard
const checkoutInProgressRef = useRef(false);

const checkout = useCallback(async (...) => {
  if (checkoutInProgressRef.current) {
    throw new Error('Checkout already in progress');
  }
  checkoutInProgressRef.current = true;
  setIsLoading(true);
  try {
    // ... existing logic
  } finally {
    checkoutInProgressRef.current = false;
    setIsLoading(false);
  }
}, [user]);
```

**Risk:** Low  
**Test:** Add concurrent checkout test in [useCart.test.ts](tests/unit/hooks/useCart.test.ts)

---

#### BUG-024: All drinks forced to afternoon_snack (no user override)

**Location:** [src/types/index.ts](src/types/index.ts#L91-L97) used by [src/pages/Parent/Menu.tsx](src/pages/Parent/Menu.tsx#L176)  
**Type:** Logic  
**Severity:** MEDIUM

**Description:**  
`autoMealPeriod('drinks')` returns `'afternoon_snack'` unconditionally. Parents cannot add a drink for morning snack — it's always assigned to afternoon with no popup.

**Root Cause:**  
Business logic hardcodes drinks to afternoon without user choice

**Reproduction:**

1. Add a drink to cart
2. Check meal period badge in cart
3. Always says "Afternoon Snack"

**Fix:**  
Change drinks to use popup (like snacks):

```ts
// types/index.ts L95
case 'drinks': return null;  // Was: return 'afternoon_snack';
```

**Risk:** Medium — changes default UX for all drink additions  
**Alternative:** Default to `'lunch'` instead  
**Test:** Update snack popup tests to include drinks

---

#### BUG-027: Copy to existing date silently merges items (no warning)

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L180-L192)  
**Type:** Logic / UX  
**Severity:** MEDIUM

**Description:**  
`getNextValidDates` includes dates that already have items. Copying "Monday → Wednesday" when Wednesday already has items will merge/add quantities. Users may be surprised by doubled quantities.

**Root Cause:**  
Function intentionally allows merge but UI gives no warning

**Reproduction:**

1. Add items for Mon and Wed
2. Open copy modal on Mon
3. Select Wed
4. Items are merged, quantities doubled unexpectedly

**Fix:**  
Add visual indicator in copy modal:

```tsx
// CartBottomSheet.tsx L500-510
{getNextValidDates(dateStr).map((targetDate) => (
  <button {...}>
    {format(parseISO(targetDate), 'EEE, MMM d')}
    {uniqueDates.includes(targetDate) && (
      <span className="text-xs ml-1 opacity-60">(merge)</span>
    )}
  </button>
))}
```

**Risk:** Low — cosmetic UX improvement  
**Test:** Add test for merge indicator visibility

---

#### BUG-028: ConfirmDialog doesn't trap keyboard focus

**Location:** [src/components/ConfirmDialog.tsx](src/components/ConfirmDialog.tsx#L28-L36)  
**Type:** Accessibility  
**Severity:** MEDIUM

**Description:**  
ConfirmDialog handles Escape and click-outside dismiss but doesn't trap focus. Pressing Tab moves focus to elements behind the dialog (violates WCAG 2.1 SC 2.4.3).

**Root Cause:**  
Custom dialog implementation without focus trap

**Reproduction:**

1. Open cart
2. Click trash icon → confirm dialog opens
3. Press Tab repeatedly → focus escapes

**Fix:**  
Add focus trapping:

```tsx
// ConfirmDialog.tsx - use @radix-ui/react-focus-guards or manual trap
<div
  className="..."
  onKeyDown={(e) => {
    if (e.key === 'Tab') {
      // Trap focus within confirm/cancel buttons
      const focusableElements = e.currentTarget.querySelectorAll('button');
      // ... implement focus wrap logic
    }
  }}
>
```

**Risk:** Low  
**Test:** Manual accessibility testing

---

#### BUG-029: useConfirm hook leaks Promises on rapid calls

**Location:** [src/components/ConfirmDialog.tsx](src/components/ConfirmDialog.tsx#L119-L127), [L131](src/components/ConfirmDialog.tsx#L131)  
**Type:** Runtime / Memory leak  
**Severity:** MEDIUM

**Description:**  
If `confirm()` is called twice before the first resolves, the first Promise's `resolve` is overwritten in `resolveRef.current`. The first Promise never resolves, causing a memory leak.

**Root Cause:**  
`resolveRef.current` overwritten without resolving previous Promise

**Reproduction:**

1. Click "Clear" on date group A
2. Before dialog appears, click "Clear" on date group B
3. First Promise never resolves

**Fix:**

```tsx
// ConfirmDialog.tsx L131
const confirm = useCallback((opts: UseConfirmOptions): Promise<boolean> => {
  // Resolve previous pending dialog with false
  if (resolveRef.current) {
    resolveRef.current(false);
  }
  
  setOptions(opts);
  setIsOpen(true);
  return new Promise((resolve) => {
    resolveRef.current = resolve;
  });
}, []);
```

**Risk:** Very low  
**Test:** Add test for rapid confirm() calls

---

#### BUG-031: Drawer Escape key may bypass dismissible guard

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L283)  
**Type:** UI / Integration  
**Severity:** MEDIUM

**Description:**  
`dismissible={!isCheckingOut}` prevents drag/click-to-dismiss but may not prevent Escape key in some vaul versions. Pressing Escape during checkout closes the drawer but `isCheckingOut` stays true.

**Root Cause:**  
`dismissible` may not cover keyboard dismissal

**Reproduction:**

1. Start checkout
2. Press Escape while "Processing..." shows
3. Drawer closes, checkout continues in background

**Fix:**

```tsx
// CartBottomSheet.tsx L289
<Drawer.Content
  onKeyDown={(e) => {
    if (isCheckingOut && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
    }
  }}
  className="..."
>
```

**Risk:** Low  
**Test:** Manual test with keyboard during checkout

---

### LOW SEVERITY (18 bugs)

#### BUG-002: handleCheckout closure over items is stale after checkout

**Location:** [src/pages/Parent/Menu.tsx](src/pages/Parent/Menu.tsx#L230-L289)  
**Type:** Data flow / Runtime  
**Severity:** LOW

**Description:**  
`handleCheckout` is memoized with `items` in deps. After `await checkout()` returns, `items` in the closure is stale (pre-checkout). The computed `studentNames` and `checkoutTotal` happen to be correct because they were derived before the mutation, but the pattern is fragile.

**Root Cause:**  
`useCallback` closes over `items` array that gets mutated by `checkout()`

**Fix:**  
Use data from `checkout()` result instead of closure:

```tsx
// Menu.tsx - derive student names from result.orders instead of items
const studentNames = result.orders.map(o => o.student_name).join(', ');
```

**Risk:** Low — requires extending checkout return type  
**Test:** Not critical

---

#### BUG-004: handleClearDate casts KeyboardEvent to MouseEvent unsafely

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L478-L481)  
**Type:** Runtime  
**Severity:** LOW

**Description:**  
`onKeyDown` handler calls `handleClearDate(dateStr, e as unknown as React.MouseEvent)`. The cast is unsafe — if `handleClearDate` ever accesses mouse-specific properties (clientX, clientY), it will crash.

**Root Cause:**  
Function typed for MouseEvent but also used from keyboard events

**Fix:**

```tsx
// CartBottomSheet.tsx
const handleClearDate = async (dateStr: string, e: React.SyntheticEvent) => {
  e.stopPropagation();
  // ... rest unchanged
};
```

**Risk:** Very low  
**Test:** None needed (code smell fix)

---

#### BUG-008: Empty image_url causes broken image flash

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L556-L565) & [src/hooks/useCart.ts](src/hooks/useCart.ts#L193)  
**Type:** UI / Runtime  
**Severity:** LOW

**Description:**  
Cart items render `<img src={item.image_url}>`. The hook sets `image_url: item.products.image_url || ''`. An empty `src=""` triggers a request to the current page URL, causing a broken image flash before `onError` fires.

**Root Cause:**  
Empty string is not a valid image URL

**Fix:**

```ts
// useCart.ts L193
image_url: item.products.image_url || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23ddd" width="100" height="100"/></svg>',
```

**Risk:** Very low  
**Test:** Visual verification

---

#### BUG-009: Snack popup orphaned if products refetch

**Location:** [src/pages/Parent/Menu.tsx](src/pages/Parent/Menu.tsx#L209-L228), [L695-L727](src/pages/Parent/Menu.tsx#L695-L727)  
**Type:** Data flow / Race condition  
**Severity:** LOW

**Description:**  
When snack popup is open, if products query refetches and the product is no longer available, `products?.find()` returns undefined. The popup shows "undefined" as product name and selecting a period does nothing.

**Root Cause:**  
`snackPopup` stores only productId that may become stale

**Fix:**

```tsx
// Menu.tsx - add useEffect
useEffect(() => {
  if (snackPopup && products && !products.find(p => p.id === snackPopup.productId)) {
    setSnackPopup(null);
  }
}, [products, snackPopup]);
```

**Risk:** Very low  
**Test:** Add test in [Menu.test.tsx](tests/unit/pages/Menu.test.tsx)

---

#### BUG-011: activeOrders query only fetches when cartOpen

**Location:** [src/pages/Parent/Menu.tsx](src/pages/Parent/Menu.tsx#L88)  
**Type:** Data flow / UX  
**Severity:** LOW

**Description:**  
`activeOrders` query has `enabled: !!user?.id && cartOpen`. On first cart open, there's a race — the cart renders with `existingOrders = undefined`, then the query fires. "Adding to existing order" badges are missing for ~200-500ms.

**Root Cause:**  
Query is lazy-loaded on cart open

**Fix:**

```tsx
// Menu.tsx L88
enabled: !!user?.id,  // Remove && cartOpen
staleTime: 30_000,
```

**Risk:** Low — slightly more network traffic  
**Test:** None needed

---

#### BUG-012: Checkout button missing type="button"

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L700-L710)  
**Type:** UI  
**Severity:** LOW

**Description:**  
Checkout button has no `type="button"` attribute. Some browsers may treat it as type="submit" if inside a form context, causing unexpected submission on Enter key.

**Root Cause:**  
Missing explicit button type

**Fix:**

```tsx
// CartBottomSheet.tsx L700
<button
  type="button"
  onClick={handleCheckout}
  disabled={...}
>
```

**Risk:** None  
**Test:** None needed

---

#### BUG-013: parentBalance defaults to 0 via || fallback

**Location:** [src/pages/Parent/Menu.tsx](src/pages/Parent/Menu.tsx#L79)  
**Type:** Logic  
**Severity:** LOW

**Description:**  
`const parentBalance = walletData?.balance || 0;` — if user has no wallet row, shows ₱0.00 for wallet payment option, which is confusing UX. This is semantically fine but could be improved.

**Root Cause:**  
`|| 0` fallback is correct but UX could be clearer

**Fix:**  
Out of scope for this bug pass — consider hiding wallet payment when no wallet exists

**Risk:** N/A  
**Test:** None needed

---

#### BUG-014: collapsedDates state persists across cart open/close

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L102), [L143-L148](src/components/CartBottomSheet.tsx#L143-L148)  
**Type:** UI / Data flow  
**Severity:** LOW

**Description:**  
When cart closes, `useEffect` resets `checkoutError`, `selectedDates`, `showCopyModal` — but not `collapsedDates`. If a user collapses a date, closes cart, reopens, that date remains collapsed.

**Root Cause:**  
`collapsedDates` omitted from cleanup effect

**Fix:**

```tsx
// CartBottomSheet.tsx L145
useEffect(() => {
  if (!isOpen) {
    setCheckoutError(null);
    setSelectedDates(new Set());
    setShowCopyModal(null);
    setCollapsedDates(new Set());  // Add this
  }
}, [isOpen]);
```

**Risk:** Very low  
**Test:** Add test in [CartBottomSheet.test.ts](tests/unit/components/CartBottomSheet.test.ts)

---

#### BUG-015: paymentExpanded state not reset when cart closes

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L101), [L143-L148](src/components/CartBottomSheet.tsx#L143-L148)  
**Type:** UI  
**Severity:** LOW

**Description:**  
Like `collapsedDates`, `paymentExpanded` is not reset when `isOpen` becomes false. Payment section stays expanded across cart sessions.

**Root Cause:**  
`paymentExpanded` omitted from cleanup effect

**Fix:**

```tsx
// CartBottomSheet.tsx L145
setPaymentExpanded(false);  // Add this
```

**Risk:** Very low  
**Test:** Add to same test as BUG-014

---

#### BUG-016: Redundant item filtering between Menu and useCart

**Location:** [src/pages/Parent/Menu.tsx](src/pages/Parent/Menu.tsx#L230-L270) & [src/hooks/useCart.ts](src/hooks/useCart.ts#L780-L786)  
**Type:** Logic  
**Severity:** LOW

**Description:**  
Menu's `handleCheckout` filters `items` by `selectedDates`, then `useCart.checkout()` also filters by `selectedDates`. Redundant but not harmful — defensive programming.

**Root Cause:**  
Intentional redundancy

**Fix:**  
Document as intentional, no code change needed

**Risk:** N/A  
**Test:** None needed

---

#### BUG-022: window.location.href redirect leaks setIsLoading(false)

**Location:** [src/hooks/useCart.ts](src/hooks/useCart.ts#L874), [L962](src/hooks/useCart.ts#L962)  
**Type:** Runtime / Memory leak  
**Severity:** LOW

**Description:**  
After `window.location.href = ...` triggers navigation, the `finally` block still runs, calling `setIsLoading(false)`. This causes a React state update on an unmounting component, producing a console warning.

**Root Cause:**  
`finally` always runs, even after return; navigation is async

**Fix:**  
Acceptable as-is — the warning is harmless. Proper fix would require cleanup ref to skip state update if navigating.

**Risk:** N/A  
**Test:** None needed

---

#### BUG-023: ProductCard Add button has redundant disabled guard

**Location:** [src/components/ProductCard.tsx](src/components/ProductCard.tsx#L91)  
**Type:** UI / Accessibility  
**Severity:** LOW

**Description:**  
Add button has `onClick={() => !addDisabled && onAddToCart(id)}` AND `disabled={addDisabled}`. The inline guard is redundant, but harmless. The `disabled` button with `active:scale-95` may briefly animate on touch before JS prevents it.

**Root Cause:**  
CSS `active:` pseudo-class applies on touch to disabled buttons on some mobile browsers

**Fix:**  
Remove `active:scale-95` from disabled state:

```tsx
className={`... ${addDisabled ? 'cursor-not-allowed' : 'active:scale-95'}`}
```

**Risk:** Very low  
**Test:** Visual/manual

---

#### BUG-025: formatDateLocal duplicated in useCart and products.ts

**Location:** [src/hooks/useCart.ts](src/hooks/useCart.ts#L80-L83) vs [src/services/products.ts](src/services/products.ts#L33-L35)  
**Type:** Data flow  
**Severity:** LOW

**Description:**  
Both files define identical `formatDateLocal` functions. If one is changed without the other, cart dates and product dates would use different timezone formatting, causing items to never match.

**Root Cause:**  
Code duplication

**Fix:**  
Extract to shared utility:

```ts
// src/utils/dateUtils.ts
export function formatDateLocal(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}
```

**Risk:** Low — refactoring risk  
**Test:** None needed

---

#### BUG-026: PaymentMethodSelector balance check has floating-point risk

**Location:** [src/components/PaymentMethodSelector.tsx](src/components/PaymentMethodSelector.tsx#L123-L128)  
**Type:** Logic  
**Severity:** LOW

**Description:**  
`balance < orderTotal` comparison doesn't account for floating-point precision. If `balance = 99.999999...` and `orderTotal = 100.00`, comparison might pass/fail unexpectedly.

**Root Cause:**  
Floating-point comparison without epsilon tolerance

**Fix:**  
Add epsilon tolerance:

```ts
const epsilon = 0.01;
if (method.value === 'balance' && balance + epsilon < orderTotal) {
  return { disabled: true, reason: `Need ₱${(orderTotal - balance).toFixed(2)} more` };
}
```

**Risk:** Very low — edge case  
**Test:** None needed

---

#### BUG-030: Expired Supabase Storage URLs cause continuous image error loops

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L556-L565)  
**Type:** Runtime / Performance  
**Severity:** LOW

**Description:**  
Cart images with expired signed URLs trigger `onError` on every render. The `onError` handler replaces `src` with a data URI, but on re-render, a new `<img>` element uses the original expired URL again.

**Root Cause:**  
`image_url` is captured at add-time and never refreshed

**Fix:**  
Use local state to track error:

```tsx
const [imageError, setImageError] = useState<Set<string>>(new Set());
<img 
  src={imageError.has(item.id) ? dataUriPlaceholder : item.image_url}
  onError={() => setImageError(prev => new Set(prev).add(item.id))}
/>
```

**Risk:** Low  
**Test:** Visual/manual

---

#### BUG-032: showToast dependency causes handleCheckout re-creation

**Location:** [src/pages/Parent/Menu.tsx](src/pages/Parent/Menu.tsx#L289)  
**Type:** Data flow  
**Severity:** LOW

**Description:**  
`showToast` in dependency array causes `handleCheckout` to be re-created when any toast is shown, triggering CartBottomSheet re-render.

**Root Cause:**  
`showToast` is not a stable reference

**Fix:**  
Wrap in ref or exclude from deps (with eslint disable comment)

**Risk:** Low — micro-optimization  
**Test:** None needed

---

#### BUG-033: effectiveDate memoization unstable on weekdaysInfo refetch

**Location:** [src/pages/Parent/Menu.tsx](src/pages/Parent/Menu.tsx#L122-L125)  
**Type:** Performance / Data flow  
**Severity:** LOW

**Description:**  
`effectiveDate` depends on `weekdaysInfo` array. Query refetch creates new `Date` objects for the same calendar dates, causing `effectiveDate` identity change and unnecessary products query refetch.

**Root Cause:**  
`useMemo` depends on object identity, not value equality

**Fix:**  
Use `dateStr` instead of `Date` objects in query keys:

```tsx
queryKey: ['products', formatDateLocal(effectiveDate)]
```

**Risk:** Low  
**Test:** None needed

---

#### BUG-034: WeeklyCartSummary totals include items outside visible weekdays

**Location:** [src/components/WeeklyCartSummary.tsx](src/components/WeeklyCartSummary.tsx#L67-L70)  
**Type:** Logic  
**Severity:** LOW

**Description:**  
Footer totals are computed from all `items`, not filtered by `weekdays` param. If user has items outside the visible week, summary shows higher totals than the visible pills.

**Root Cause:**  
Footer summary not filtered by weekdays

**Fix:**

```tsx
// WeeklyCartSummary.tsx L67
const visibleDateStrs = weekdays?.map(w => w.dateStr) || [];
const visibleItems = items.filter(i => visibleDateStrs.includes(i.scheduled_for));
const totalItems = visibleItems.reduce((sum, i) => sum + i.quantity, 0);
const totalAmount = visibleItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
```

**Risk:** Low  
**Test:** Add test in [WeeklyCartSummary.test.tsx](tests/unit/components/WeeklyCartSummary.test.tsx)

---

## Test Coverage Requirements

### High Priority Tests

**[tests/unit/hooks/useCart.test.ts](tests/unit/hooks/useCart.test.ts):**

```ts
describe('BUG-020: Notes Handling', () => {
  it('empty string notes should not fallback to stale notes', async () => {});
});

describe('BUG-019: Race Conditions', () => {
  it('concurrent addItem calls should not create duplicate DB rows', async () => {});
});

describe('BUG-017: Date Validation', () => {
  it('rejects checkout for past-dated items', async () => {});
  it('removes past-dated items from cart on checkout attempt', async () => {});
});

describe('BUG-021: Checkout Idempotency', () => {
  it('concurrent checkout calls should be blocked', async () => {});
});
```

**[tests/unit/components/CartBottomSheet.test.ts](tests/unit/components/CartBottomSheet.test.ts):**

```ts
describe('BUG-003: Checkout Button Disabled States', () => {
  it('disables checkout when balance payment selected but insufficient', () => {});
  it('enables checkout when balance is sufficient', () => {});
});

describe('BUG-007: Date Selection Pruning', () => {
  it('removes selected dates that no longer have items', () => {});
});

describe('BUG-005: Error Handling', () => {
  it('captures error from failed copy operation', async () => {});
  it('captures error from failed clear operation', async () => {});
});

describe('BUG-027: Copy Target Validation', () => {
  it('identifies dates that will merge in copy targets', () => {});
});
```

**[tests/unit/components/ConfirmDialog.test.ts](tests/unit/components/ConfirmDialog.test.ts)** (new file):

```ts
describe('BUG-029: useConfirm Hook', () => {
  it('calling confirm() twice resolves first Promise with false', async () => {});
});

describe('BUG-028: Focus Trap', () => {
  it('Tab key should not escape the dialog', () => {});
});
```

**[tests/unit/pages/Menu.test.tsx](tests/unit/pages/Menu.test.tsx):**

```ts
describe('BUG-001: Error Handling', () => {
  it('does not show duplicate errors on checkout failure', async () => {});
});

describe('BUG-009: Snack Popup Edge Cases', () => {
  it('closes snack popup when product becomes unavailable', () => {});
});
```

---

## Extended Deep-Dive Analysis (BUG-035 — BUG-055)

*Third-pass analysis targeting timezone drift, schema/client mismatches, partial failure corruption, stock validation gaps, offline edge cases, and subtle state management bugs.*

---

### HIGH SEVERITY (3 additional)

#### BUG-035: `isDateInPast` uses browser timezone, but DB trigger uses Asia/Manila

**Location:** [src/hooks/useCart.ts](src/hooks/useCart.ts#L97-L102)  
**Type:** Timezone / Logic  
**Severity:** HIGH

**Description:**  
`isDateInPast` calls `startOfDay(new Date())` which uses the **browser's local timezone**. The DB trigger `validate_cart_item_date()` uses `(NOW() AT TIME ZONE 'Asia/Manila')::DATE`. If a parent is in a timezone ahead of Manila (e.g., Japan, UTC+9) or behind (e.g., US Pacific, UTC-8), the client and server disagree on what "today" is.

**Scenario A (East of Manila, UTC+9):** At 11pm Japan time (10pm Manila), the user's browser thinks today is already the *next* day. `isDateInPast` may reject a valid "today" date that the server still accepts.

**Scenario B (West of Manila, UTC-8):** At 1am Manila time (9am previous day US Pacific), the user's browser thinks it's still "yesterday". `isDateInPast` passes a date that the server considers past → DB trigger rejects the insert, causing an unhandled Supabase error.

**Root Cause:**  
Mixed timezone handling: `isDateInPast` uses `date-fns` with browser TZ, while `formatDateLocal` and `getTodayLocal` correctly use Asia/Manila. `isDateInPast` should use the same approach.

**Fix:**

```ts
// useCart.ts L97-102 — replace isDateInPast
function isDateInPast(dateStr: string): boolean {
  const todayStr = getTodayLocal();  // Uses Asia/Manila
  return dateStr < todayStr;  // String comparison works for YYYY-MM-DD
}
```

**Risk:** Very low — simpler and more correct  
**Test:** Add test with mocked timezone offset vs Manila

---

#### BUG-036: `copyDateItems` has sequential DB writes — partial failure leaves orphan items

**Location:** [src/hooks/useCart.ts](src/hooks/useCart.ts#L640-L670)  
**Type:** Data integrity / Atomicity  
**Severity:** HIGH

**Description:**  
`copyDateItems` loops through items and writes each one to the DB sequentially. If the 3rd of 5 items fails (e.g., network blip), items 1-2 are already persisted but items 3-5 are not. The `catch` block calls `loadCart()` which reloads from DB, but the optimistic local state already had all 5 items — so the UI will "jump" and the user doesn't know which items succeeded.

The same pattern exists in `copyStudentItems` (L720-740).

**Root Cause:**  
No transaction/batch write — each item is an independent Supabase call

**Reproduction:**

1. Copy 5 items from Monday to Tuesday
2. Simulate network drop after 2 items
3. Cart shows 5 items locally, DB has 2 items → `loadCart()` fixes it to 2
4. User confused, repeats copy → now has double quantities for items 1-2

**Fix:**  
Batch the inserts into a single call:

```ts
// useCart.ts - batch copyDateItems DB writes
try {
  // Build all upsert rows at once
  const upsertRows = itemsToCopy.map(item => ({
    user_id: user.id,
    student_id: item.student_id,
    product_id: item.product_id,
    quantity: item.quantity,
    scheduled_for: toDate,
    meal_period: item.meal_period,
  }));
  
  // Single upsert call  
  const { error } = await supabase
    .from('cart_items')
    .upsert(upsertRows, {
      onConflict: 'user_id,student_id,product_id,scheduled_for,meal_period',
      ignoreDuplicates: false,
    });
  if (error) throw error;
} catch (err) {
  await loadCart();
}
```

**Risk:** Medium — changes DB access pattern  
**Test:** Add partial failure test in [useCart.multiday.test.ts](tests/unit/hooks/useCart.multiday.test.ts)

---

#### BUG-038: Checkout deletes cart items by `item.id` which may be a client-generated UUID

**Location:** [src/hooks/useCart.ts](src/hooks/useCart.ts#L863-L870), [L951-L958](src/hooks/useCart.ts#L951-L958)  
**Type:** Data integrity  
**Severity:** HIGH

**Description:**  
When `addItem` creates a new item locally, it generates `id: crypto.randomUUID()`. This ID is **not** the actual DB row ID — the DB generates its own UUID on insert. When checkout later does:

```ts
const cartItemIdsToDelete = currentItems.map(item => item.id);
await supabase.from('cart_items').delete().in('id', cartItemIdsToDelete);
```

These IDs won't match any DB rows if the item was added in the same session and `loadCart()` was never called to sync the real DB IDs.

**Root Cause:**  
Optimistic item IDs differ from actual DB-generated UUIDs. Only after `loadCart()` do `item.id` values match the DB.

**Reproduction:**

1. Add items to cart (new session, no prior cart)
2. Immediately checkout *without* closing/reopening the cart
3. Checkout succeeds (orders created) but `delete().in('id', [...])` silently deletes 0 rows
4. Cart items persist in DB, reappear on next page load

**Fix:**  
Delete by composite key instead of by ID:

```ts
// useCart.ts - replace .in('id', cartItemIdsToDelete) with:
for (const item of currentItems) {
  await supabase
    .from('cart_items')
    .delete()
    .match({
      user_id: user.id,
      student_id: item.student_id,
      product_id: item.product_id,
      scheduled_for: item.scheduled_for,
      meal_period: item.meal_period,
    });
}
// Or batch: delete all items for the checked-out student+date combos
```

**Risk:** Medium — must test with actual DB  
**Test:** Add test for checkout with client-generated IDs

---

### MEDIUM SEVERITY (6 additional)

#### BUG-037: `cart_state.payment_method` CHECK constraint doesn't include `paymaya` or `card`

**Location:** [supabase/consolidated_schema.sql](supabase/consolidated_schema.sql#L498)  
**Type:** Schema / Data integrity  
**Severity:** MEDIUM

**Description:**  
The `cart_state` table has a CHECK constraint: `payment_method IN ('cash', 'gcash', 'balance')`. The frontend allows `paymaya` and `card` payment methods. If `useCart` or any future code tries to persist the payment method choice to `cart_state`, it will fail with a constraint violation for PayMaya and Card.

Currently, `useCart` does NOT persist `paymentMethod` to `cart_state` (only `student_id` is persisted). But the schema implies this was intended, and any future feature adding payment persistence will silently fail.

**Root Cause:**  
Schema CHECK constraint out of sync with frontend `PaymentMethod` type

**Fix:**

```sql
-- Update cart_state CHECK constraint
ALTER TABLE cart_state 
  DROP CONSTRAINT IF EXISTS cart_state_payment_method_check;
ALTER TABLE cart_state
  ADD CONSTRAINT cart_state_payment_method_check 
  CHECK (payment_method IN ('cash', 'gcash', 'paymaya', 'card', 'balance'));
```

**Risk:** Low — migration required  
**Test:** Verify with Supabase migration

---

#### BUG-039: `isToday(parseISO(dateStr))` in CartBottomSheet uses browser timezone

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L354)  
**Type:** Timezone  
**Severity:** MEDIUM

**Description:**  
CartBottomSheet uses `isToday(parseISO(dateStr))` to determine if a date group should be styled green. `isToday` from `date-fns` uses browser local time. WeeklyCartSummary correctly compares against `formatDateLocal(new Date())` (PH timezone). A user in UTC-8 at 11pm Monday Manila time will see Monday styled as "not today" in the cart but "today" in the WeeklyCartSummary.

**Root Cause:**  
Inconsistent "today" detection: `isToday` (browser TZ) vs `formatDateLocal` (Asia/Manila)

**Fix:**

```tsx
// CartBottomSheet.tsx - use consistent PH timezone check
const todayStr = formatDateLocal(new Date());
// Then replace isToday(parseISO(dateStr)) with:
const dateIsToday = dateStr === todayStr;
```

**Risk:** Very low — already exported from products.ts  
**Test:** Add timezone-aware test

---

#### BUG-040: `getNextValidDates` skips Sunday but doesn't skip holidays or past dates

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L180-L192)  
**Type:** Logic  
**Severity:** MEDIUM

**Description:**  
`getNextValidDates` checks `date.getDay() === 0` (Sunday) and `isSaturday(date)` but:

1. Doesn't skip holidays (already documented as BUG-006)
2. Doesn't skip dates that are in the past
3. Doesn't skip dates beyond the 14-day max advance limit (DB trigger `validate_cart_item_max_advance` will reject these)

If a user opens the copy modal on a Friday, the function may suggest dates up to 14 days ahead. But if it includes a date 15 days out, the copy will silently fail when the DB trigger rejects the insert.

**Root Cause:**  
No alignment between `getNextValidDates` and DB validation triggers

**Fix:**

```tsx
const getNextValidDates = (excludeDate: string): string[] => {
  const dates: string[] = [];
  const start = parseISO(excludeDate);
  const todayStr = formatDateLocal(new Date());
  const maxDate = addDays(parseISO(todayStr), 14);
  
  for (let i = 1; i <= 14 && dates.length < 5; i++) {
    const date = addDays(start, i);
    if (date.getDay() === 0) continue;  // Sunday
    if (isSaturday(date)) continue;      // Saturday
    const dateStr = formatDateLocal(date);
    if (dateStr < todayStr) continue;    // Past date
    if (date > maxDate) break;           // Beyond 14-day limit
    if (closedDates?.includes(dateStr)) continue; // Holiday (from BUG-006)
    dates.push(dateStr);
  }
  return dates;
};
```

**Risk:** Low  
**Test:** Add test for max-advance enforcement

---

#### BUG-041: No stock validation before adding to cart

**Location:** [src/pages/Parent/Menu.tsx](src/pages/Parent/Menu.tsx#L164-L194) & [src/hooks/useCart.ts](src/hooks/useCart.ts#L366-L430)  
**Type:** Logic / UX  
**Severity:** MEDIUM

**Description:**  
ProductCard shows "Sold Out" badge when `available === false`, preventing add-to-cart. But `stock_quantity` is never checked. A product with `available: true` and `stock_quantity: 0` can be added to cart. The error only surfaces at checkout when the edge function validates stock.

Furthermore, for advance ordering (adding items for Wednesday on Monday), stock may change between cart-add and checkout, but there's no re-validation.

**Root Cause:**  
Client-side cart has no stock awareness beyond the boolean `available` flag

**Fix:**

```tsx
// ProductCard.tsx - check stock_quantity
const isSoldOut = !available || stock_quantity <= 0;
// ...
{isSoldOut ? (
  <span className="...">Sold Out</span>
) : (
  <button onClick={() => onAddToCart(id)} ...>Add</button>
)}
```

**Risk:** Low — additive check  
**Test:** Add test for stock_quantity=0 with available=true

---

#### BUG-042: `loadCart` doesn't refetch when items are remotely deleted

**Location:** [src/hooks/useCart.ts](src/hooks/useCart.ts#L135-L216)  
**Type:** Data sync  
**Severity:** MEDIUM

**Description:**  
`loadCart` runs on mount and when `user` changes. But if cart items are deleted server-side (e.g., admin removes a product, `ON DELETE CASCADE` removes cart items), the local state becomes stale. There's no real-time subscription on `cart_items` and no periodic refetch.

This is especially problematic for advance orders: a parent adds items on Monday for Friday, an admin deactivates a product on Wednesday, the parent's cart still shows the item on Thursday. Checkout will fail at the edge function.

**Root Cause:**  
No real-time sync or polling for cart items

**Fix:**

```ts
// useCart.ts - add visibility-based refetch
useEffect(() => {
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      loadCart();
    }
  };
  document.addEventListener('visibilitychange', handleVisibility);
  return () => document.removeEventListener('visibilitychange', handleVisibility);
}, [loadCart]);
```

**Risk:** Low — only adds passive refetch  
**Test:** None critical

---

#### BUG-043: `handleCheckout` navigates with stale `itemsToCheckout` after `checkout()` mutates state

**Location:** [src/pages/Parent/Menu.tsx](src/pages/Parent/Menu.tsx#L249-L286)  
**Type:** Data flow  
**Severity:** MEDIUM

**Description:**  
`handleCheckout` filters `items` into `itemsToCheckout` at the top of the function. After `await checkout(...)` returns, `items` state has been mutated (checked-out items removed). But `itemsToCheckout` still references the old items. The navigation state uses `checkoutTotal` and `studentNames` derived from the stale `itemsToCheckout` — which happens to be correct because they're computed before the mutation. However, `itemsToCheckout.length` is passed as `itemCount`, which will also be correct for the same reason.

The fragility is that if any future refactor moves the computed values after the `await`, they'll silently break.

**Root Cause:**  
Stale closure over `itemsToCheckout` after async mutation — functionally correct today but a maintenance hazard

**Fix:**  
Capture values before await:

```tsx
const checkoutTotal = itemsToCheckout.reduce((sum, i) => sum + i.price * i.quantity, 0);
const studentNames = [...new Set(itemsToCheckout.map(i => i.student_name))].join(', ');
const itemCount = itemsToCheckout.length;
// Then: const result = await checkout(...);
```

**Risk:** Very low  
**Test:** None critical

---

### LOW SEVERITY (12 additional)

#### BUG-044: `products` query uses `effectiveDate.toISOString()` as query key — timezone-shifted

**Location:** [src/pages/Parent/Menu.tsx](src/pages/Parent/Menu.tsx#L140)  
**Type:** Data flow / Cache  
**Severity:** LOW

**Description:**  
`queryKey: ['products', effectiveDate.toISOString()]` includes the time portion. Two `Date` objects representing the same Philippine day but created at different times produce different ISO strings (e.g., `2026-03-02T00:00:00` vs `2026-03-02T01:00:00`), causing unnecessary cache misses and duplicate fetches.

**Root Cause:**  
Using full ISO timestamp instead of date string in query key

**Fix:**

```tsx
queryKey: ['products', formatDateLocal(effectiveDate)],
```

**Risk:** Very low  
**Test:** None needed

---

#### BUG-045: `canteen-status` query uses ISO string key, duplicates work with `weekdays-with-status`

**Location:** [src/pages/Parent/Menu.tsx](src/pages/Parent/Menu.tsx#L131-L134)  
**Type:** Performance  
**Severity:** LOW

**Description:**  
The `canteen-status` query has `enabled: !!selectedDate && !selectedWeekdayInfo` — it's skipped when weekday info exists. Good. But the `queryKey` includes `effectiveDate.toISOString()`, so if the first query runs before weekday data loads, it caches with a time-dependent key that may not match on subsequent renders. This creates orphan cache entries.

**Root Cause:**  
Redundant query with unstable cache key

**Fix:**  
Use `formatDateLocal(effectiveDate)` for cache key consistency

**Risk:** Very low  
**Test:** None needed

---

#### BUG-046: `getNextValidDates` includes dates already in cart (contradicts filter logic)

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L188-L189)  
**Type:** Logic  
**Severity:** LOW

**Description:**  
The filter `!uniqueDates.includes(dateStr) || dateStr === excludeDate` **excludes** dates that already have cart items. This means if a user has items for Mon, Wed, and Fri, and copies Mon, the targets will be Tue, Thu — but NOT Wed or Fri. This conflicts with BUG-027 (merge behavior) which says copying to an existing date merges items. The function specifically avoids offering existing dates as targets, but the merge logic exists if called directly.

This is actually a safeguard — but it means the "copy to existing date" scenario from BUG-027 should be impossible through the UI. The merge indicator fix from BUG-027 is therefore moot unless this filter is changed.

**Root Cause:**  
Filter intentionally prevents cross-day merge, making BUG-027 scenario unreachable through UI

**Fix:**  
Consider removing the exclusion to allow intentional merging:

```tsx
// Remove: if (!uniqueDates.includes(dateStr) || dateStr === excludeDate) {
// Replace with: always push valid dates
dates.push(dateStr);
```

Or document the current behavior as intentional.

**Risk:** N/A  
**Test:** Document behavior

---

#### BUG-047: No max quantity enforcement in CartBottomSheet increment button

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L615-L625)  
**Type:** Logic / UX  
**Severity:** LOW

**Description:**  
The `+` button in CartBottomSheet calls `onUpdateQuantity(... item.quantity + 1 ...)`. The `useCart.updateQuantity` clamps to `MAX_QUANTITY = 20`, but the UI has no visual indication of the maximum. Users can tap `+` past 20, and the quantity will silently stay at 20.

**Root Cause:**  
Max quantity not communicated to UI

**Fix:**

```tsx
// CartBottomSheet.tsx - disable + at max
<button
  onClick={() => onUpdateQuantity(...)}
  disabled={item.quantity >= 20}
  className={`... ${item.quantity >= 20 ? 'opacity-50 cursor-not-allowed' : ''}`}
>
```

**Risk:** Very low  
**Test:** Visual verification

---

#### BUG-048: `OrderNotes` textarea loses expansion state when cart re-renders

**Location:** [src/components/OrderNotes.tsx](src/components/OrderNotes.tsx#L10)  
**Type:** UI  
**Severity:** LOW

**Description:**  
`OrderNotes` manages its own `isExpanded` state. When CartBottomSheet re-renders (e.g., quantity update causes `items` prop change), `OrderNotes` component identity is preserved (same key), so React keeps its state. However, if the component unmounts and remounts (e.g., cart close + reopen), the user's expansion state and notes are reset — notes because CartBottomSheet has its own `notes` state reset in the cleanup effect.

If a user types notes, collapses the notes section, then scrolls around, expanding state persists. But the component itself is a controlled component — `value={notes}` is owned by CartBottomSheet — so the notes text persists correctly. Only the expansion toggle resets on remount.

**Root Cause:**  
Local state for UI toggle inside a child component — acceptable pattern

**Fix:**  
Acceptable as-is. Could lift `isExpanded` to CartBottomSheet if desired.

**Risk:** N/A  
**Test:** None needed

---

#### BUG-049: `selectAllDates` toggles instead of checking/unchecking

**Location:** [src/components/CartBottomSheet.tsx](src/components/CartBottomSheet.tsx#L169-L176)  
**Type:** UX  
**Severity:** LOW

**Description:**  
`selectAllDates()` checks if `selectedDates.size === uniqueDates.length`, and if so, clears the selection (meaning "all selected" = no filter). This toggle behavior can be confusing: "Select all" actually means "clear selection and show all", while "Deselect all" means "check all boxes so the filter is active on all dates". The semantic meaning is inverted.

When no dates are explicitly selected (`selectedDates.size === 0`), all dates are implicitly included. "Select all" creates explicit selection of all dates, which is equivalent. "Deselect all" clears explicit selection, which also shows all dates. The button becomes a no-op.

**Root Cause:**  
Ambiguous selection semantics: empty set = all selected, full set = all selected

**Fix:**  
Consider only showing the button when `selectedDates.size > 0 && selectedDates.size < uniqueDates.length`:

```tsx
{selectedDates.size > 0 && selectedDates.size < uniqueDates.length && (
  <button onClick={selectAllDates} ...>
    Select all
  </button>
)}
```

**Risk:** Very low — UX improvement  
**Test:** Manual UX testing

---

#### BUG-050: `activeOrders` query has no `staleTime` — refetches on every cart open

**Location:** [src/pages/Parent/Menu.tsx](src/pages/Parent/Menu.tsx#L82-L91)  
**Type:** Performance  
**Severity:** LOW

**Description:**  
`activeOrders` query has `enabled: !!user?.id && cartOpen`. Every time the user opens the cart, it refetches (default `staleTime: 0`). For a user who opens/closes the cart frequently, this creates unnecessary network traffic. Active orders rarely change within seconds.

**Root Cause:**  
Missing `staleTime` configuration

**Fix:**

```tsx
staleTime: 30_000, // 30 seconds
```

**Risk:** Very low  
**Test:** None needed

---

#### BUG-051: `ConfirmDialogElement` is memoized with `options` object — breaks on same-value but new-reference options

**Location:** [src/components/ConfirmDialog.tsx](src/components/ConfirmDialog.tsx#L153-L161)  
**Type:** Performance  
**Severity:** LOW

**Description:**  
`useMemo(() => <ConfirmDialog ...>, [isOpen, options, handleConfirm, handleCancel])` — `options` is a new object on every `setOptions` call. Even if the same title/message is passed, the memoization breaks and the element re-creates. This is harmless because React reconciles the same JSX structure, but it defeats the memoization intent.

**Root Cause:**  
Object identity dependency in useMemo

**Fix:**  
Memoize individual values:

```tsx
const ConfirmDialogElement = useMemo(() => (
  <ConfirmDialog
    isOpen={isOpen}
    title={options.title}
    message={options.message}
    ...
  />
), [isOpen, options.title, options.message, options.confirmLabel, options.cancelLabel, options.type, handleConfirm, handleCancel]);
```

**Risk:** Very low  
**Test:** None needed

---

#### BUG-052: `WeeklyCartSummary` day pill truncates total with `.toFixed(0)` — loses centavos

**Location:** [src/components/WeeklyCartSummary.tsx](src/components/WeeklyCartSummary.tsx#L139)  
**Type:** UI  
**Severity:** LOW

**Description:**  
Day pill shows `₱{day.total.toFixed(0)}` (no decimal places). If a day's total is ₱45.50, it shows `₱46` (rounded). The footer summary uses `.toFixed(2)` showing `₱45.50`. Inconsistency may confuse users.

**Root Cause:**  
Different `toFixed` precision in pill vs footer

**Fix:**

```tsx
// WeeklyCartSummary.tsx L139
₱{day.total.toFixed(2)}
```

**Risk:** Very low — CSS may need width adjustment  
**Test:** Visual verification

---

#### BUG-053: `cleanup_past_cart_items` RPC called without error surfacing

**Location:** [src/hooks/useCart.ts](src/hooks/useCart.ts#L212-L214)  
**Type:** Runtime  
**Severity:** LOW

**Description:**  
`supabase.rpc('cleanup_past_cart_items')` is called fire-and-forget with `.then(({ error }) => { if (error) console.warn(...) })`. If this function is not defined or the user lacks EXECUTE permission, the warning appears only in console — invisible to user.

Additionally, this is `SECURITY DEFINER` function, meaning it runs with the function owner's privileges. If cleanup deletes items across all users (which it does: `DELETE FROM cart_items WHERE scheduled_for < today_ph`), any user calling this RPC cleans up everyone's past items. This is probably intentional but could be unexpected.

**Root Cause:**  
Silent failure + SECURITY DEFINER scope

**Fix:**  
Acceptable as-is — cleanup is a best-effort background task. Consider adding RLS or WHERE clause:

```sql
DELETE FROM cart_items 
WHERE scheduled_for < today_ph 
AND user_id = auth.uid();  -- Scope to calling user only
```

**Risk:** Low  
**Test:** None critical

---

#### BUG-054: `PaymentMethodSelector` doesn't detect offline status automatically

**Location:** [src/components/PaymentMethodSelector.tsx](src/components/PaymentMethodSelector.tsx#L117)  
**Type:** UX  
**Severity:** LOW

**Description:**  
`isOffline` is a prop but CartBottomSheet never passes it. Default is `false`. Online payment methods are always shown as enabled even when the user is offline. Clicking GCash/PayMaya/Card while offline will fail at the `ensureValidSession()` call in the payment service.

**Root Cause:**  
`isOffline` prop not wired up from parent

**Fix:**

```tsx
// CartBottomSheet.tsx
<PaymentMethodSelector
  selected={paymentMethod}
  onSelect={(method) => { setPaymentMethod(method); setPaymentExpanded(false); }}
  balance={parentBalance}
  orderTotal={selectedTotal}
  isOffline={!navigator.onLine}  // Add this
/>
```

**Risk:** Very low  
**Test:** Manual offline testing

---

#### BUG-055: Cart badge count doesn't update when items are modified in another tab

**Location:** [src/pages/Parent/Menu.tsx](src/pages/Parent/Menu.tsx#L548-L551)  
**Type:** Data sync  
**Severity:** LOW

**Description:**  
The cart badge in `PageHeader` shows `summary.totalItems`. If the user has the app open in two browser tabs and modifies the cart in one tab, the other tab's badge remains stale until the next `loadCart()` call (which only happens on mount or user change). This is related to BUG-042 (no real-time sync) but specifically affects the always-visible badge.

**Root Cause:**  
No cross-tab cart synchronization

**Fix:**  
Use `BroadcastChannel` API or `storage` event for cross-tab sync:

```ts
// useCart.ts
useEffect(() => {
  const channel = new BroadcastChannel('cart-sync');
  channel.onmessage = () => loadCart();
  return () => channel.close();
}, [loadCart]);

// After any cart mutation:
new BroadcastChannel('cart-sync').postMessage('updated');
```

**Risk:** Low  
**Test:** Manual multi-tab testing

---

## Fix Priority Matrix

| Priority | Count | Bug IDs |
| ---------- | ------- | --------- |
| **HIGH** | 8 | BUG-003, 010, 017, 019, 020, 035, 036, 038 |
| **MEDIUM** | 17 | BUG-001, 005, 006, 007, 018, 021, 024, 027, 028, 029, 031, 037, 039, 040, 041, 042, 043 |
| **LOW** | 30 | BUG-002, 004, 008, 009, 011, 012, 013, 014, 015, 016, 022, 023, 025, 026, 030, 032, 033, 034, 044, 045, 046, 047, 048, 049, 050, 051, 052, 053, 054, 055 |

---

## Recommended Fix Order

1. **BUG-020** — Notes `||` vs `??` (1 character change, high impact)
2. **BUG-035** — Timezone-consistent `isDateInPast` (3 line rewrite)
3. **BUG-003** — Checkout button disabled state (1 line change)
4. **BUG-038** — Cart item deletion by composite key instead of stale UUID
5. **BUG-019** — addItem race condition (simplify to upsert-only)
6. **BUG-036** — Batch `copyDateItems` DB writes
7. **BUG-017** — Past-date checkout validation
8. **BUG-010** — PostgREST filter verification
9. **BUG-039** — CartBottomSheet `isToday` timezone fix
10. **BUG-029** — useConfirm Promise leak (3 lines)
11. **BUG-021** — Checkout idempotency guard
12. **BUG-037** — Schema migration for `cart_state.payment_method`
13. **BUG-041** — Stock validation in ProductCard
14. **BUG-040** — Copy date max-advance limit
15. Remaining by severity

---

## Estimated Fix Effort

| Category | Bugs | Effort | Notes |
| ---------- | ------ | -------- | ------- |
| Trivial (< 5 lines) | 16 | 1.5 days | BUG-020, 003, 012, 014, 015, 008, 011, 004, 029, 032, 035, 039, 044, 045, 050, 054 |
| Small (5-20 lines) | 22 | 3 days | BUG-007, 005, 006, 027, 009, 022, 023, 025, 026, 030, 033, 034, 001, 021, 031, 040, 041, 043, 047, 049, 052, 055 |
| Medium (20-50 lines) | 12 | 4 days | BUG-019, 017, 010, 018, 028, 024, 002, 036, 038, 037, 042, 051 |
| Large (> 50 lines) | 5 | 2 days | BUG-016, 013, 046, 048, 053 (doc/no-change) |
| **Total** | **55** | **~10.5 days** | Including test writing |

---

## Risk Assessment by Component

### useCart.ts (highest risk)

- **High risk fixes:** 5 (BUG-019, 020, 035, 036, 038)
- **Medium risk fixes:** 3 (BUG-017, 021, 042)
- **Low risk fixes:** 7 (BUG-002, 008, 011, 022, 025, 033, 053)
- **Overall risk:** **High** — core data layer

### CartBottomSheet.tsx

- **High risk fixes:** 0
- **Medium risk fixes:** 8 (BUG-005, 006, 007, 018, 027, 031, 039, 040)
- **Low risk fixes:** 6 (BUG-014, 015, 030, 034, 047, 049)
- **Overall risk:** Medium

### Menu.tsx

- **High risk fixes:** 1 (BUG-010)
- **Medium risk fixes:** 3 (BUG-001, 024, 043)
- **Low risk fixes:** 6 (BUG-009, 013, 016, 032, 044, 045)
- **Overall risk:** Medium

### ConfirmDialog.tsx

- **Medium risk fixes:** 2 (BUG-028, 029)
- **Low risk fixes:** 1 (BUG-051)
- **Overall risk:** Low

### Database Schema

- **Medium risk fixes:** 1 (BUG-037)
- **Low risk fixes:** 1 (BUG-053)
- **Overall risk:** Low (migration required)

### Other Components

- **Medium risk fixes:** 1 (BUG-041 — ProductCard)
- **Low risk fixes:** 4 (BUG-050, 052, 054, 055)
- **Overall risk:** Low

---

## Conclusion

This analysis identified **55 bugs** across the Parent Menu and Cart Bottom Sheet components. The most critical findings are:

1. **Data integrity issues** (BUG-019, 020, 036, 038) causing duplicates, silent data corruption, or orphan DB rows
2. **Timezone drift** (BUG-035, 039) where browser timezone and Asia/Manila disagree on "today"
3. **Validation gaps** (BUG-003, 017, 010, 040, 041) allowing invalid checkouts or copy targets
4. **Race conditions** (BUG-019, 021, 029) that can cause duplicate operations or memory leaks
5. **Schema mismatches** (BUG-037) where DB constraints don't match frontend types
6. **UX/accessibility issues** (BUG-024, 027, 028, 047, 054) affecting usability

The recommended approach is to fix the **8 high-severity bugs first** (estimated 4-5 days), then address medium-severity bugs based on user impact. Low-severity bugs can be batched into a cleanup pass or addressed as time permits.

Total estimated effort: **~10.5 days** (including test writing and verification).

---

**Document Version:** 2.0  
**Last Updated:** March 2, 2026  
**Analyst:** GitHub Copilot (Claude Opus 4.6)
