# 🐛 Comprehensive Bug Report - Canteen PWA

**Generated:** January 2, 2026  
**Analysis Scope:** Full codebase analysis including components, hooks, services, pages, Supabase functions, and configuration files.

---

## 📊 Executive Summary

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Components | 0 | 5 | 5 | 13 | 23 |
| Hooks | 4 | 3 | 5 | 5 | 17 |
| Services | 2 | 8 | 9 | 4 | 23 |
| Pages | 0 | 6 | 9 | 17 | 32 |
| Supabase Functions | 7 | 12 | 5+ | - | 24+ |
| Configuration | 2 | 3 | 5 | 4 | 14 |
| **TOTAL** | **15** | **37** | **38+** | **43+** | **133+** |

---

## 🔴 CRITICAL ISSUES (15)

### 1. Race Condition in Balance Update - `admin-topup`

**File:** `supabase/functions/admin-topup/index.ts`  
**Lines:** 119-131

**Bug:** Balance update is not atomic. Between reading `previousBalance` and writing `newBalance`, concurrent transactions can cause lost updates.

```typescript
// VULNERABLE CODE:
const previousBalance = wallet!.balance;
const newBalance = previousBalance + amount;
await supabaseAdmin.from('wallets').update({ balance: newBalance })
```

**Fix:** Use atomic increment operation:

```typescript
const { error } = await supabaseAdmin.rpc('increment_balance', {
  p_user_id: user_id,
  p_amount: amount
});
```

---

### 2. Race Condition & No Transaction Rollback - `process-order`

**File:** `supabase/functions/process-order/index.ts`  
**Lines:** 211-234, 284-310

**Bug:** Stock deduction, order creation, balance deduction, and item insertion are separate operations without transaction handling. If any step fails after stock deduction, inventory is corrupted.

**Fix:** Wrap all operations in a database transaction or implement compensating transactions.

---

### 3. Balance Deduction Without Optimistic Locking - `process-order`

**File:** `supabase/functions/process-order/index.ts`  
**Lines:** 284-297

**Bug:** Two concurrent orders could both pass balance check but only one deduction is correct.

**Fix:** Add optimistic locking:

```typescript
.eq('balance', currentBalance) // Only update if balance hasn't changed
```

---

### 4. Missing Authorization for Scheduled Calls - `cleanup-timeout-orders`

**File:** `supabase/functions/cleanup-timeout-orders/index.ts`  
**Lines:** 24-39

**Bug:** Function only validates auth if header exists. Anyone can trigger cleanup by calling without authentication.

**Fix:** Require authentication always or add API key validation.

---

### 5. Syntax Error / Duplicate Variable - `update-dietary`

**File:** `supabase/functions/update-dietary/index.ts`  
**Lines:** 76-79

**Bug:** Duplicate variable declaration `findError` will cause runtime error.

**Fix:** Rename the second variable.

---

### 6. Double Stock Restoration - `refund-order`

**File:** `supabase/functions/refund-order/index.ts`  
**Lines:** 95-115

**Bug:** Stock restoration code runs RPC then ALWAYS does direct update, causing double restoration.

**Fix:** Use proper either/or logic with try-catch.

---

### 7. Password Exposed in Response - `create-user`

**File:** `supabase/functions/create-user/index.ts`  
**Lines:** 130-137

**Bug:** Default password `'Welcome123!'` returned in API response body.

**Fix:** Don't return password in response. Use password reset flow instead.

---

### 8. Race Condition in Database Initialization - `localQueue.ts`

**File:** `src/services/localQueue.ts`  
**Lines:** 28-44

**Bug:** Multiple simultaneous calls to `getDB()` before `db` is assigned will create multiple IndexedDB connections.

**Fix:**

```typescript
let dbPromise: Promise<IDBPDatabase<CanteenDB>> | null = null;
async function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<CanteenDB>('canteen-offline', 2, { /* ... */ });
  }
  return dbPromise;
}
```

---

### 9. Application Crash on Missing Environment Variables - `supabaseClient.ts`

**File:** `src/services/supabaseClient.ts`  
**Lines:** 6-8

**Bug:** Missing env variables throw error at module load, crashing entire app.

**Fix:** Add graceful degradation or user-friendly error handling.

---

### 10. Unsafe Non-null Assertion - `useOrders.ts`

**File:** `src/hooks/useOrders.ts`

**Bug:** `user!.id` uses TypeScript non-null assertion. Could throw if called when user is null.

**Fix:**

```typescript
queryFn: async () => {
  if (!user) throw new Error('User not authenticated');
  return getOrderHistory(user.id);
}
```

---

### 11. Unsafe Non-null Assertion - `useStudents.ts`

**File:** `src/hooks/useStudents.ts`

**Bug:** Same pattern - uses `user!.id` which could throw.

**Fix:** Add null check before using user.id.

---

### 12. Unstable Dependency in useEffect - `useOrderSubscription.ts`

**File:** `src/hooks/useOrderSubscription.ts`

**Bug:** `showToast` in dependency array causes subscription recreation on every render if not stable.

**Fix:** Use `user?.id` instead of entire `user` object in deps.

---

### 13. Missing Workbox Dependencies

**File:** `package.json`

**Bug:** `service-worker.ts` imports workbox modules not listed in package.json.

**Fix:** Add dependencies:

```json
"workbox-precaching": "^7.0.0",
"workbox-routing": "^7.0.0",
"workbox-strategies": "^7.0.0",
"workbox-expiration": "^7.0.0"
```

---

### 14. Missing Vitest Coverage Provider

**File:** `package.json`

**Bug:** `vite.config.ts` configures coverage but `@vitest/coverage-v8` not installed.

**Fix:** Add `"@vitest/coverage-v8": "^1.1.0"` to devDependencies.

---

### 15. Hardcoded Fallback Supabase URL

**File:** `src/pwa/service-worker.ts`  
**Line:** 259

**Bug:** Placeholder URL `'https://your-project.supabase.co'` will fail in production.

**Fix:** Use environment variable during build.

---

## 🟠 HIGH SEVERITY ISSUES (37)

### Components (5)

| # | File | Issue | Lines |
|---|------|-------|-------|
| 1 | `ChangePasswordModal.tsx` | Memory leak - setTimeout not cleaned up on unmount | - |
| 2 | `ConfirmDialog.tsx` | Component created inside useCallback causes remounts | - |
| 3 | `CartDrawer.tsx` | Missing error handling in checkout - users don't see errors | - |
| 4 | `PullToRefresh.tsx` | Race condition - setState on unmounted component | - |
| 5 | `Toast.tsx` | Memory leak - setTimeout IDs not cleaned up | - |

### Hooks (3)

| # | File | Issue |
|---|------|-------|
| 1 | `useAuth.ts` | State update after unmount - missing cleanup flag |
| 2 | `useAuth.ts` | Missing error handling for getSession promise |
| 3 | `useOrderSubscription.ts` | QueryClient in deps causes unnecessary re-subscriptions |

### Services (8)

| # | File | Issue | Lines |
|---|------|-------|-------|
| 1 | `localQueue.ts` | Unhandled promise rejection in 'online' event listener | 271-276 |
| 2 | `localQueue.ts` | Data loss on IndexedDB upgrade - old data deleted | 33-37 |
| 3 | `orders.ts` | Missing error handling for edge function response | 26-30 |
| 4 | `orders.ts` | No retry logic for network failures | 23-30 |
| 5 | `products.ts` | Silent error handling returns null for holidays | 38-67 |
| 6 | `storage.ts` | Path traversal vulnerability in delete operation | 63-68 |
| 7 | `storage.ts` | Memory leak - Object URL never revoked | 115 |
| 8 | `students.ts` | Inconsistent error handling pattern | 64-75 |

### Pages (6)

| # | File | Issue |
|---|------|-------|
| 1 | `Login.tsx` | Missing loading state reset on success |
| 2 | `Register.tsx` | Missing dependency in useEffect for code verification |
| 3 | `Admin/Dashboard.tsx` | Race condition in real-time subscription |
| 4 | `Parent/Menu.tsx` | showToast dependency causes unnecessary re-renders |
| 5 | `Parent/Menu.tsx` | Potential infinite loop in date selection |
| 6 | `Staff/Orders.tsx` | Memory leak in real-time subscription |

### Supabase Functions (12)

| # | Function | Issue |
|---|----------|-------|
| 1 | `list-staff` | Unbounded user listing - no pagination (DoS risk) |
| 2 | `send-invites` | Unbounded user listing |
| 3 | `register` | Unbounded user listing |
| 4 | `parent-cancel-order` | Incomplete refund for non-balance orders |
| 5 | `manage-product` | Broken RPC call in delete operation |
| 6 | ALL | CORS wildcard `'*'` allows any origin |
| 7 | `verify-invitation` | In-memory rate limiting doesn't persist |
| 8 | `notify` | Missing input validation for notification type |
| 9 | `manage-order` | Stock restoration silently fails |
| 10 | `parent-cancel-order` | Wrong RPC usage for stock increment |
| 11 | `manage-student` | No rate limiting on bulk import (500 students) |
| 12 | `admin-topup` | Missing transaction atomicity |

### Configuration (3)

| # | File | Issue |
|---|------|-------|
| 1 | `App.tsx` / `types/index.ts` | Duplicate UserRole type definition |
| 2 | `vite.config.ts` / `manifest` | PWA icon `purpose: "any maskable"` causes rendering issues |
| 3 | `service-worker.ts` | Hardcoded placeholder URL |

---

## 🟡 MEDIUM SEVERITY ISSUES (38+)

### Components (5)

| # | File | Issue |
|---|------|-------|
| 1 | `ActiveOrderBadge.tsx` | Unsafe non-null assertion with `user!.id` |
| 2 | `CartDrawer.tsx` | Missing focus trap in drawer modal |
| 3 | `ConfirmDialog.tsx` | Stale closure in callback - promise may never resolve |
| 4 | `PaymentMethodSelector.tsx` | Missing fieldset/legend for accessibility |
| 5 | `Toast.tsx` | Missing ARIA live region for screen readers |

### Hooks (5)

| # | File | Issue |
|---|------|-------|
| 1 | `useFavorites.ts` | Missing error handling for JSON.parse |
| 2 | `useFavorites.ts` | No type validation for parsed data |
| 3 | `useFavorites.ts` | Stale closure issue in toggle function |
| 4 | `useOrderSubscription.ts` | No error handling for subscription |
| 5 | `useCart.ts` | Stale closure in checkout function |

### Services (9)

| # | File | Issue | Lines |
|---|------|-------|-------|
| 1 | `localQueue.ts` | Failed orders can grow indefinitely in localStorage | - |
| 2 | `localQueue.ts` | Missing input validation in queueOrder | 51-65 |
| 3 | `localQueue.ts` | Missing error handling for localStorage | 223-229 |
| 4 | `orders.ts` | Missing input validation for items | 17-31 |
| 5 | `products.ts` | Inefficient multiple sequential DB calls | 86-109 |
| 6 | `products.ts` | Date handling inconsistency | 29-34 |
| 7 | `products.ts` | Potential infinite loop in getAvailableDays | 169-204 |
| 8 | `storage.ts` | Null canvas context not handled | 91-103 |
| 9 | `students.ts` | Type safety issue with Supabase select | 10-31 |

### Pages (9)

| # | File | Issue |
|---|------|-------|
| 1 | `Admin/Settings.tsx` | Missing dependency in dark mode useEffect |
| 2 | `Admin/Settings.tsx` | Type safety issue with settings parsing |
| 3 | `Admin/Orders.tsx` | Date filter mutates Date object |
| 4 | `Parent/Orders.tsx` | Stale closure in mutation callback |
| 5 | `Parent/Checkout.tsx` | Missing cleanup in navigation useEffect |
| 6 | `Admin/Products.tsx` | Memory leak in image preview |
| 7 | `Admin/AuditLogs.tsx` | XSS risk in JSON.stringify search |
| 8 | `Parent/Menu.tsx` | Date formatting edge cases |
| 9 | `Parent/Profile.tsx` | Complex profile creation may fail silently |

### Configuration (5)

| # | File | Issue |
|---|------|-------|
| 1 | `types/index.ts` | Deprecated `Child` interface still used |
| 2 | `package.json` | Missing ESLint configuration |
| 3 | `types/index.ts` | Redundant PaymentMethod union |
| 4 | `index.html` / manifest | Manifest location mismatch |
| 5 | `tsconfig.json` / `vite.config.ts` | Alias path inconsistency |

---

## 🟢 LOW SEVERITY ISSUES (43+)

### Components (13)

| # | File | Issue |
|---|------|-------|
| 1 | `ActiveOrderBadge.tsx` | Hook called for all users, not just parents |
| 2 | `CartDrawer.tsx` | Missing Escape key handler |
| 3 | `ChangePasswordModal.tsx` | Missing aria-label on close button |
| 4 | `EmptyState.tsx` | Unsafe React internal type check |
| 5 | `OrderNotes.tsx` | Missing label association for textarea |
| 6 | `ProductCard.tsx` | Missing fallback for broken images |
| 7 | `PullToRefresh.tsx` | startY ref not reset properly |
| 8 | `PullToRefresh.tsx` | Missing passive event option |
| 9 | `SearchBar.tsx` | Clear button missing aria-label |
| 10 | `SearchBar.tsx` | Missing input label association |
| 11 | `StudentSelector.tsx` | Potential null submission |
| 12 | `Toast.tsx` | Dismiss button missing aria-label |
| 13 | `ChangePasswordModal.tsx` | Race condition in password change |

### Hooks (5)

| # | File | Issue |
|---|------|-------|
| 1 | `useCart.ts` | Missing error state management |
| 2 | `useCart.ts` | No loading state for checkout |
| 3 | `useFavorites.ts` | Old favorites briefly visible on user switch |
| 4 | `useProducts.ts` | Unused queryClient |
| 5 | `useStudents.ts` | Missing return type annotation |

### Services (4)

| # | File | Issue |
|---|------|-------|
| 1 | `localQueue.ts` | Type assertion with `any` |
| 2 | `orders.ts` | Missing type safety for response |
| 3 | `products.ts` | No caching of holiday data |
| 4 | `storage.ts` | Missing URL validation |

### Pages (17)

| # | File | Issue |
|---|------|-------|
| 1 | `Login.tsx` | Missing error sanitization |
| 2 | `Admin/index.tsx` | Missing loading state during role check |
| 3 | `Admin/Reports.tsx` | Date range function not memoized |
| 4 | `Admin/Dashboard.tsx` | Console.log in production |
| 5 | `Parent/Wallet.tsx` | Missing error handling |
| 6 | `Staff/Orders.tsx` | Using `any` type |
| 7 | `Admin/Inventory.tsx` | Input onChange triggers mutation on keystroke |
| 8 | `Admin/Dashboard.tsx` | Batched queries may fail partially |
| 9 | `Parent/Menu.tsx` | Missing validation before checkout |
| 10 | `Admin/Students.tsx` | Filtering logic inconsistent |
| 11 | `Staff/Profile.tsx` | Fallback profile date type mismatch |
| 12 | `Admin/Calendar.tsx` | Holiday check performance O(n) |
| 13 | `Admin/Settings.tsx` | localStorage sync in SSR |
| 14 | `Parent/Orders.tsx` | handleReorder doesn't check availability |
| 15 | `Admin/Products.tsx` | Uses window.confirm instead of custom dialog |
| 16 | `Admin/AuditLogs.tsx` | Using `as any` type assertion |
| 17 | `Admin/Reports.tsx` | Console.log statements |

### Configuration (4)

| # | File | Issue |
|---|------|-------|
| 1 | `package.json` | Missing @types/eslint |
| 2 | `tailwind.config.cjs` / `index.css` | Duplicate animation definition |
| 3 | `postcss.config.cjs` | Formatting issue |
| 4 | `main.tsx` | SW registration may conflict with vite-plugin-pwa |

---

## 🔧 PRIORITY FIX RECOMMENDATIONS

### Immediate (Critical Security/Data Issues)

1. ✅ Fix balance race conditions in `admin-topup` and `process-order`
2. ✅ Add authentication to `cleanup-timeout-orders`
3. ✅ Remove password from `create-user` response
4. ✅ Fix syntax error in `update-dietary`
5. ✅ Fix double stock restoration in `refund-order`

### Urgent (Data Integrity)

1. ✅ Add transaction handling to order processing
2. ✅ Fix IndexedDB race condition in `localQueue.ts`
3. ✅ Add pagination to user listing functions
4. ✅ Install missing workbox dependencies
5. ✅ Fix unsafe non-null assertions in hooks

### High Priority (User Experience)

1. ✅ Fix memory leaks in Toast, ChangePasswordModal, PullToRefresh
2. ✅ Add error handling to CartDrawer checkout
3. ✅ Fix subscription dependency arrays
4. ✅ Add proper cleanup to useAuth
5. ✅ Fix real-time subscription memory leaks

### Medium Priority (Code Quality)

1. ✅ Replace `window.confirm` with custom dialog
2. ✅ Add ARIA labels for accessibility
3. ✅ Remove console.log statements
4. ✅ Fix type safety issues
5. ✅ Add input validation

---

## 📋 RECOMMENDED ACTIONS BY CATEGORY

### Security

- [ ] Implement atomic database operations for balance updates
- [ ] Add authentication to all edge functions
- [ ] Restrict CORS to known domains
- [ ] Add rate limiting to all public endpoints
- [ ] Validate all input data server-side

### Performance

- [ ] Add pagination to user listing endpoints
- [ ] Cache holiday data with TTL
- [ ] Debounce input handlers that trigger mutations
- [ ] Memoize expensive date calculations
- [ ] Optimize O(n) holiday lookups

### Reliability

- [ ] Add proper transaction handling
- [ ] Implement retry logic with exponential backoff
- [ ] Add mounted state checks to prevent state updates after unmount
- [ ] Add proper cleanup to all useEffect hooks
- [ ] Handle localStorage errors gracefully

### Code Quality

- [ ] Remove duplicate type definitions
- [ ] Replace `any` types with proper interfaces
- [ ] Add ESLint configuration
- [ ] Remove deprecated interfaces
- [ ] Add proper error boundaries

### Accessibility

- [ ] Add ARIA labels to interactive elements
- [ ] Add live regions for dynamic content
- [ ] Implement focus trap in modals
- [ ] Add keyboard navigation support
- [ ] Add proper form labels

---

## 📝 TESTING RECOMMENDATIONS

1. **Unit Tests**
   - Add tests for balance calculation edge cases
   - Test concurrent order processing
   - Test IndexedDB initialization race conditions

2. **Integration Tests**
   - Test complete order flow with concurrent users
   - Test refund process
   - Test subscription reconnection

3. **E2E Tests**
   - Test checkout with various payment methods
   - Test offline queue synchronization
   - Test real-time order updates

---

*Report generated by comprehensive codebase analysis. All line numbers are approximate and should be verified against the current codebase.*
