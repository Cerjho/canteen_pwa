# LOHECA Canteen PWA — Comprehensive Code Review

**Review Date:** March 1, 2026  
**Reviewer:** Senior Full-Stack Engineer (Supabase & PWA Specialist)  
**Tech Stack:** React 18 + Vite 6 + TypeScript 5 + Tailwind + Supabase (PostgREST + Edge Functions + Realtime + Storage) + Workbox 7 + PayMongo  
**Deployment:** Vercel

---

## Executive Summary

| Dimension | Score | Notes |
|---|---|---|
| **Security** | **8/10** | RLS on all 21 tables, `app_metadata` roles, zero client-side service key exposure. Two overly permissive RLS policies (invitations, audit logs) reduce the score. |
| **Offline Reliability** | **7/10** | Solid IndexedDB queue + background sync + foreground retry. However, the SW background sync is non-functional (auth token never sent to SW), and there's no offline page fallback. |
| **Performance** | **5/10** | No route-level code splitting (`React.lazy`), 15+ `select('*')` queries, zero pagination anywhere. Well-structured vendor chunking partially compensates. |
| **Business Logic** | **9/10** | Rigorous state machine, atomic stock ops with row locks, CAS on wallet, idempotency keys everywhere. Minor merge-race window. |
| **Code Quality** | **8/10** | Strict TypeScript, comprehensive test suite (56 unit files), CI/CD pipeline, good documentation. E2E tests largely disabled. |

**Overall readiness:** The app demonstrates **strong security fundamentals and business logic integrity**. The payment system is exceptionally well-designed with multiple layers of idempotency. The two primary blockers to production are the **lack of code splitting** (every page eagerly loaded in main bundle — poor mobile performance) and the **dead background sync** in the service worker. These are fixable without architectural changes.

---

## Critical Findings (🔴 Fix Before Launch)

| # | Severity | Area | Location | Issue | Fix |
|---|---|---|---|---|---|
| 1 | 🔴 | Offline | [src/pwa/service-worker.ts#L386-L396](src/pwa/service-worker.ts#L386-L396) | SW expects `STORE_AUTH_TOKEN` message to authenticate background sync, but **no app code ever sends it**. Background sync silently skips all queued orders when the app is closed. | In [src/hooks/useAuth.tsx](src/hooks/useAuth.tsx), post `STORE_AUTH_TOKEN` and `STORE_SUPABASE_URL` messages to the SW whenever the session changes. |
| 2 | 🔴 | Performance | [src/App.tsx#L1-L42](src/App.tsx#L1-L42) | **Zero `React.lazy` usage** — all ~40 page/component imports are static. Admin, Staff, and Parent bundles all load on first paint regardless of user role. | Lazy-load all route-level pages with `React.lazy()` + `<Suspense>`. Group by role for maximum impact. |
| 3 | 🔴 | Performance | Entire frontend | **No pagination anywhere** — zero `.range()` calls. Order history, audit logs, user lists, and payment history all fetch unbounded datasets. Will degrade severely as data grows. | Add cursor-based or `.range()` pagination to [src/services/orders.ts](src/services/orders.ts), [src/pages/Admin/AuditLogs.tsx](src/pages/Admin/AuditLogs.tsx), [src/pages/Admin/Users.tsx](src/pages/Admin/Users.tsx), [src/pages/Parent/Balance.tsx](src/pages/Parent/Balance.tsx). |
| 4 | 🔴 | Security | [supabase/consolidated_schema.sql#L1538](supabase/consolidated_schema.sql#L1538) | Invitations SELECT policy is `USING (true)` — any user (including anon key) can **enumerate all invitation codes, emails, and roles**. An attacker could read unused invitation codes and register as admin/staff. | Restrict to `USING (code = current_setting('app.invitation_code', true))` or remove client-side SELECT entirely and use the `verify-invitation` edge function exclusively. |

---

## High Priority (🟠 Fix in Next Sprint)

| # | Severity | Area | Location | Issue | Fix |
|---|---|---|---|---|---|
| 5 | 🟠 | Security | [supabase/consolidated_schema.sql#L1712](supabase/consolidated_schema.sql#L1712) | Audit logs INSERT policy is `WITH CHECK (TRUE)` — any authenticated user can insert arbitrary audit log entries, poisoning the audit trail. | Restrict to `WITH CHECK (is_staff_or_admin())` or remove client INSERT and log exclusively from edge functions. |
| 6 | 🟠 | Offline | [src/pwa/service-worker.ts](src/pwa/service-worker.ts) | No offline page fallback. If a user navigates to an uncached route while offline, they see the browser's default "no internet" page instead of a branded offline screen. | Add a `setCatchHandler` in Workbox to serve a precached `offline.html` for navigation requests. |
| 7 | 🟠 | Integrity | [supabase/functions/process-order/index.ts#L378-L510](supabase/functions/process-order/index.ts#L378-L510) | Order merge is **check-then-act without locking**. Between checking `slotConflicts` and inserting merge items, the target order could be cancelled or transitioned to `preparing`. | Use `SELECT ... FOR UPDATE` or `UPDATE ... WHERE status IN ('pending','awaiting_payment') RETURNING id` as a gate before inserting merge items. |
| 8 | 🟠 | Performance | 15+ locations | `select('*')` used in ~15 frontend queries and ~6 edge functions where specific columns would suffice. Transfers unnecessary data over the wire. | Replace with explicit column lists, especially in [src/services/products.ts#L317](src/services/products.ts#L317), [src/pages/Admin/Users.tsx#L103](src/pages/Admin/Users.tsx#L103), [src/pages/Admin/AuditLogs.tsx#L58](src/pages/Admin/AuditLogs.tsx#L58). |
| 9 | 🟠 | Monitoring | — | **No error monitoring** (Sentry/Logflare). Production errors will be invisible. Mentioned as "optional" in [docs/DEPLOYMENT.md#L203](docs/DEPLOYMENT.md#L203). | Integrate `@sentry/react` with Supabase error boundary. Critical for a payment-handling app. |
| 10 | 🟠 | CORS | [supabase/functions/manage-order/index.ts#L10](supabase/functions/manage-order/index.ts#L10), [supabase/functions/manage-product/index.ts#L10](supabase/functions/manage-product/index.ts#L10) | Two edge functions define their own CORS logic, falling back to `*` when `ALLOWED_ORIGINS` is unset, instead of using the shared [supabase/functions/_shared/cors.ts](supabase/functions/_shared/cors.ts). | Migrate to the shared CORS module which properly denies unknown origins. |
| 11 | 🟠 | Offline | [src/services/localQueue.ts](src/services/localQueue.ts) + [src/pwa/service-worker.ts#L83-L120](src/pwa/service-worker.ts#L83-L120) | Dual queue processors (SW `syncQueuedOrders` + main-thread `processQueue`) can run concurrently on the same IndexedDB queue without cross-context locking. Server-side idempotency prevents duplicates, but wastes network requests. | Add an IndexedDB-based "processing" flag per order, or use a BroadcastChannel to coordinate. |
| 12 | 🟠 | Testing | E2E tests | Most authenticated E2E tests are `test.skip`'d ([e2e/auth.spec.ts](e2e/auth.spec.ts), [e2e/flows.spec.ts](e2e/flows.spec.ts), [e2e/concurrency.spec.ts](e2e/concurrency.spec.ts)). Only login rendering, PWA checks, and accessibility tests run. | Create an auth setup project in Playwright for token-based login, un-skip critical flows. |

---

## Medium / Low Priority (🟡🟢 Backlog)

### Medium Priority (🟡)

- **Missing iOS PWA meta tags** ([index.html](index.html)) — No `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, or iOS splash images. Degrades iOS standalone experience.
- **Push notifications are dead code** ([src/pwa/service-worker.ts#L310-L330](src/pwa/service-worker.ts#L310-L330)) — SW handles `push` events but no client code calls `PushManager.subscribe()`. Remove or implement fully.
- **Storage bucket policy not in migrations** ([supabase/migrations/20260105_admin_enhancements.sql#L230-L233](supabase/migrations/20260105_admin_enhancements.sql#L230-L233)) — Comments out the bucket creation SQL. No storage RLS policies defined in code. Bucket must be configured manually in dashboard.
- **No orphan image cleanup** ([supabase/functions/manage-product/index.ts](supabase/functions/manage-product/index.ts)) — When a product is deleted, the associated image in Supabase Storage is not deleted. [deleteProductImage](src/services/storage.ts#L64) exists but isn't wired to product deletion.
- **Manifest dark mode mismatch** ([public/manifest.webmanifest](public/manifest.webmanifest)) — `theme_color`/`background_color` hardcoded to `#F9FAFB` (light) while app supports dark mode at runtime.
- **Env var duplication** ([src/pages/Staff/Profile.tsx#L26-L27](src/pages/Staff/Profile.tsx#L26-L27), [src/pages/Staff/Products.tsx#L12-L13](src/pages/Staff/Products.tsx#L12-L13)) — Read `import.meta.env.VITE_SUPABASE_*` directly instead of using shared [src/services/supabaseClient.ts](src/services/supabaseClient.ts).
- **Balance merge uses wrong RPC** ([supabase/functions/process-batch-order/index.ts#L322](supabase/functions/process-batch-order/index.ts#L322)) — Uses `deduct_balance` (simple) instead of `deduct_balance_with_payment` (creates proper payment/allocation records) for merge delta. Audit trail gap.
- **Wallet credit retry in webhook** ([supabase/functions/paymongo-webhook/index.ts#L449-L453](supabase/functions/paymongo-webhook/index.ts#L449-L453)) — Uses optimistic lock on raw `balance` value with only 2 retries. Under high concurrency, all retries could fail. `credit_balance_with_payment` RPC (uses `FOR UPDATE`) would be more robust.

### Low Priority (🟢)

- **No manifest `screenshots`** — Adding screenshots enables the Richer Install UI on Android.
- **No `display_override`** — Could add `window-controls-overlay` for a more native feel.
- **No stale-data warning** — No mechanism to warn users their menu/price data may be outdated after extended offline periods.
- **No network quality detection** ([src/components/OfflineIndicator.tsx](src/components/OfflineIndicator.tsx)) — Only checks binary `navigator.onLine`, not connection quality.
- **React Query staleTime** of 5 min ([src/main.tsx#L14](src/main.tsx#L14)) — Generous for a real-time app, may cause stale menu/price data.

---

## Top 5 Action Items (by ROI)

1. **Add `React.lazy` code splitting by role** — Immediately reduces initial bundle by ~60%. Split admin, staff, and parent page groups. 15-minute change, enormous performance gain on mobile.

2. **Wire auth token to service worker** — Single `postMessage` call in `useAuth` on session change fixes background sync entirely. Without this, offline orders placed when the app is backgrounded are lost until the user manually re-opens the app.

3. **Lock down invitations SELECT policy** — The current `USING (true)` policy lets any user enumerate invitation codes. This is a privilege escalation vector: an attacker reads an admin invitation code and registers as admin. Fix with one SQL migration.

4. **Add pagination to list queries** — Start with order history and audit logs. These are the highest-volume tables and will cause timeouts as data grows past a few thousand rows.

5. **Integrate Sentry** — For a payment-processing app, flying blind on production errors is unacceptable. `@sentry/react` + Supabase Edge Function error reporting gives full visibility.

---

## ✅ What's Working Well

### Security Architecture

- **Financial integrity is exceptional.** The `deduct_balance_with_payment` RPC with compare-and-swap ([consolidated_schema.sql#L160-L184](supabase/consolidated_schema.sql#L160-L184)), `CHECK (balance >= 0)`, immutability triggers on payment fields ([consolidated_schema.sql#L108-L139](supabase/consolidated_schema.sql#L108-L139)), and `guard_payment_status_transition` trigger ([consolidated_schema.sql#L142-L149](supabase/consolidated_schema.sql#L142-L149)) create defense-in-depth that's rare even in production fintech apps.

- **Role security is properly layered.** The migration from `user_metadata` (client-writable) to `app_metadata` (server-only) in [supabase/migrations/20260219_secure_role_app_metadata.sql](supabase/migrations/20260219_secure_role_app_metadata.sql) was the right call. Every edge function validates roles via `app_metadata`.

- **RLS coverage is complete.** All 21 tables have RLS enabled ([consolidated_schema.sql#L1300-L1316](supabase/consolidated_schema.sql#L1300-L1316)) with appropriate policies for SELECT/INSERT/UPDATE/DELETE.

- **Edge function security patterns:**
  - Rate limiting with timing-attack mitigation on `verify-invitation` ([supabase/functions/verify-invitation/index.ts#L13-L29](supabase/functions/verify-invitation/index.ts#L13-L29), [#L93-L100](supabase/functions/verify-invitation/index.ts#L93-L100))
  - HMAC webhook signature verification with timestamp freshness ([supabase/functions/_shared/paymongo.ts#L201-L283](supabase/functions/_shared/paymongo.ts#L201-L283))
  - Anti-impersonation checks on order creation ([supabase/functions/process-order/index.ts#L108](supabase/functions/process-order/index.ts#L108), [supabase/functions/create-checkout/index.ts#L92](supabase/functions/create-checkout/index.ts#L92))
  - Consistent auth + role validation across all 29 functions
  - Zero service role key exposure in frontend code

### Business Logic

- **Idempotency is comprehensive.** `client_order_id` uniqueness ([supabase/functions/process-order/index.ts#L360-L375](supabase/functions/process-order/index.ts#L360-L375)), optimistic locks on payment status changes, and the self-healing poll in `check-payment-status` ([supabase/functions/check-payment-status/index.ts#L104-L143](supabase/functions/check-payment-status/index.ts#L104-L143)) cover every duplicate scenario.

- **Stock management uses row-level locking.** `decrement_stock` with `SELECT ... FOR UPDATE` ([consolidated_schema.sql#L1092-L1130](supabase/consolidated_schema.sql#L1092-L1130)) prevents overselling under concurrent load — not just an application-level check.

- **Order state machine is rigorous.** Valid transitions enforced at both DB level ([consolidated_schema.sql#L1203-L1231](supabase/consolidated_schema.sql#L1203-L1231)) and application level ([supabase/functions/manage-order/index.ts#L43-L50](supabase/functions/manage-order/index.ts#L43-L50)).

- **Cash payment deadline enforcement.** [confirm-cash-payment](supabase/functions/confirm-cash-payment/index.ts#L118-L139) explicitly checks if `payment_due_at` has passed, even if the cleanup job hasn't run yet, preventing race conditions.

### Offline & PWA

- **Offline queue design is architecturally sound.** IndexedDB with `idb` library ([src/services/localQueue.ts#L40-L57](src/services/localQueue.ts#L40-L57)), exponential backoff with jitter ([src/services/localQueue.ts#L123-L129](src/services/localQueue.ts#L123-L129)), max retries → failed queue ([src/services/localQueue.ts#L250](src/services/localQueue.ts#L250)), dual sync paths (SW + foreground). The auth token gap is the only issue.

- **Multi-strategy caching.** Well-designed Workbox setup ([src/pwa/service-worker.ts](src/pwa/service-worker.ts)):
  - NetworkFirst for API (5s timeout)
  - StaleWhileRevalidate for products (1hr)
  - CacheFirst for images (30 days) and fonts (1 year)
  - Precache for all build assets

### Code Quality

- **CI/CD pipeline is production-grade** ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) — Full lint → unit test → e2e → build → deploy chain with Codecov, Vercel deployment, Supabase function deployment, and DB migration automation.

- **Test infrastructure is excellent:**
  - 56 unit test files covering components, hooks, services, pages, and database schema
  - Mock setup ([tests/mocks/supabase.ts](tests/mocks/supabase.ts), [tests/mocks/data.ts](tests/mocks/data.ts))
  - Specialized concurrency tests (`balanceConcurrency.test.ts`, `indexedDBRace.test.ts`)
  - Proper provider wrappers ([tests/utils/testUtils.tsx](tests/utils/testUtils.tsx))

- **Strict TypeScript** — All strict checks enabled ([tsconfig.json](tsconfig.json)), unused vars/params flagged.

- **Comprehensive documentation** — 23 markdown files in `/docs` covering architecture, security, testing, deployment, and more.

---

## Detailed Technical Findings

### 1. 🔐 Supabase Security & RLS

#### RLS Coverage (✅ Excellent)

All 21 tables have RLS enabled ([consolidated_schema.sql#L1300-L1316](supabase/consolidated_schema.sql#L1300-L1316)):

| Table | RLS Policies | Assessment |
|---|---|---|
| `user_profiles` | Own + staff/admin SELECT; Own INSERT; Own + admin UPDATE | ✅ Good |
| `wallets` | Own + staff/admin SELECT; Own INSERT; Own + admin UPDATE | ✅ Good |
| `students` | Linked parents + staff/admin SELECT; Admin ALL | ✅ Good |
| `parent_students` | Own + staff/admin SELECT; Own INSERT; Admin UPDATE/DELETE | ⚠️ Self-referencing issue in INSERT |
| `products` | PUBLIC SELECT; Staff/admin INSERT/UPDATE; Admin DELETE | ✅ Good |
| `orders` | Own + staff/admin SELECT; Own INSERT (validates parent_students); Staff/admin UPDATE | ✅ Good |
| `order_items` | Own (via orders) + staff/admin SELECT | ✅ Good (read-only) |
| `payments` | Own + staff/admin SELECT; Admin INSERT | ✅ Good |
| `payment_allocations` | Own (via payments) + staff/admin SELECT | ✅ Good |
| `topup_sessions` | Own SELECT | ✅ Good |
| `invitations` | PUBLIC SELECT + Admin ALL | 🔴 **Too permissive** |
| `menu_schedules` | PUBLIC SELECT; Admin INSERT/UPDATE/DELETE | ✅ Good |
| `holidays` | PUBLIC SELECT; Admin INSERT/UPDATE/DELETE | ✅ Good |
| `makeup_days` | PUBLIC SELECT; Admin INSERT/UPDATE/DELETE | ✅ Good |
| `menu_date_overrides` | PUBLIC SELECT; Admin INSERT/UPDATE/DELETE | ✅ Good |
| `date_closures` | PUBLIC SELECT; Admin INSERT/UPDATE/DELETE | ✅ Good |
| `system_settings` | PUBLIC SELECT; Admin UPDATE | ✅ Good |
| `audit_logs` | Admin SELECT; PUBLIC INSERT | 🔴 **Too permissive** |
| `cart_items` | Own (all ops) | ✅ Good |
| `cart_state` | Own (all ops) | ✅ Good |
| `favorites` | Own (all ops) | ✅ Good |

#### Role System (✅ Excellent)

- **`app_metadata` only** ([consolidated_schema.sql#L64-L82](supabase/consolidated_schema.sql#L64-L82)) — `is_admin()` and `is_staff_or_admin()` functions read from server-only `app_metadata`, not client-writable `user_metadata`
- **SECURITY DEFINER** on role-check functions
- **Migration to secure roles** ([supabase/migrations/20260219_secure_role_app_metadata.sql](supabase/migrations/20260219_secure_role_app_metadata.sql)) — Migrated all roles from `user_metadata` to `app_metadata`

#### Edge Function Authentication (✅ Excellent)

All 29 edge functions follow the same pattern:
1. Extract Bearer token from `Authorization` header
2. Create admin client with `SUPABASE_SERVICE_ROLE_KEY` (server-side only)
3. Validate token via `supabaseAdmin.auth.getUser(token)`
4. Check `user.app_metadata?.role` for authorization

**Confirmed:** Zero service role key usage in frontend code.

#### Financial Protection (✅ Exceptional)

1. **Allocation integrity trigger** ([consolidated_schema.sql#L89-L105](supabase/consolidated_schema.sql#L89-L105)) — Prevents over-allocation
2. **Immutability triggers** ([consolidated_schema.sql#L108-L139](supabase/consolidated_schema.sql#L108-L139)) — Prevents mutation of `amount_total`, `type`, `parent_id` on payments
3. **Payment status transition guard** ([consolidated_schema.sql#L142-L149](supabase/consolidated_schema.sql#L142-L149)) — Limits `pending → completed|failed` only
4. **Optimistic concurrency control** ([consolidated_schema.sql#L155-L175](supabase/consolidated_schema.sql#L155-L175)) — Wallet debit with `WHERE balance = p_expected_balance`
5. **Balance constraint** ([consolidated_schema.sql#L237](supabase/consolidated_schema.sql#L237)) — `CHECK (balance >= 0)`

---

### 2. 📱 PWA Fundamentals

#### Manifest (✅ Complete)

[public/manifest.webmanifest](public/manifest.webmanifest) includes all required fields:
- `name`, `short_name`, `description`
- `start_url: "/"`, `scope: "/"`
- `display: "standalone"`
- `theme_color`, `background_color`
- Icons: 192×192 + 512×512 (both `any` + `maskable` variants)
- `shortcuts` for Browse Menu and Order History
- `categories: ["food", "education"]`

**Missing (non-critical):**
- No `screenshots` array (Richer Install UI on Android)
- No `id` field (recommended for stable identity)
- No `display_override`
- Dark mode colors not reflected (hardcoded `#F9FAFB`)

#### Service Worker (✅ Well-Implemented)

[src/pwa/service-worker.ts](src/pwa/service-worker.ts) (400 lines):

**Caching strategies:**
- **Precache**: All Vite build assets via `self.__WB_MANIFEST`
- **NetworkFirst**: Supabase API (excluding `/functions/` and `/auth/`), 5s timeout, 50 entries, 5-min TTL
- **StaleWhileRevalidate**: Products/menu data, 100 entries, 1-hour TTL
- **CacheFirst**: Images (30 days), Google Fonts (1 year)

**Background Sync** ([src/pwa/service-worker.ts#L83-L120](src/pwa/service-worker.ts#L83-L120)):
- Listens for `sync-orders` event
- Opens IndexedDB `canteen-offline` v2, store `order-queue`
- Iterates queued orders, calls `process-order` Edge Function
- **Critical issue:** Auth token never populated (see Critical Finding #1)

**Lifecycle:**
- `install`: `skipWaiting()` immediately
- `activate`: Deletes old caches, `clients.claim()`, sends `SW_UPDATED` to all clients

#### Install Prompt (✅ Good)

[src/components/InstallPrompt.tsx](src/components/InstallPrompt.tsx):
- Captures `beforeinstallprompt` from pre-React in [index.html#L12-L15](index.html#L12-L15)
- iOS detection with "Add to Home Screen" instructions
- Standalone detection via media query + `navigator.standalone`
- 24-hour dismissal cooldown

**Missing:**
- No A2HS analytics tracking
- No iOS PWA meta tags in `<head>`

---

### 3. 🔄 Offline Functionality

#### Local Queue (✅ Architecturally Sound, 🔴 Auth Gap)

[src/services/localQueue.ts](src/services/localQueue.ts) (342 lines):

**Storage:** IndexedDB (`idb`), database `canteen-offline` v2, store `order-queue`

**Key features:**
- Exponential backoff with jitter (1s base, 30s max)
- Max 5 retries before moving to failed queue (localStorage)
- Concurrency guard (`isProcessing` flag)
- Auto-triggers `processQueue()` on `window.online` event
- Dual sync path: SW background sync + foreground retry

**Critical gap:** SW background sync cannot authenticate because no code sends auth token to SW.

#### Conflict Resolution (⚠️ Limited)

- **Sold-out handling:** Server returns `INSUFFICIENT_STOCK`, marked as terminal failure
- **Idempotency key prevents duplicates** via `client_order_id`
- **No stale-data warning** for extended offline periods
- **No price mismatch detection** when queued order processes with changed prices

#### Realtime Subscriptions (✅ Well-Scoped)

**Parent:** [src/hooks/useOrderSubscription.ts](src/hooks/useOrderSubscription.ts)
- Channel: `order-updates-${userId}`
- Filter: `parent_id=eq.${userId}`
- Event: `UPDATE` only on `orders` table

**Staff:** [src/pages/Staff/Dashboard.tsx#L641-L662](src/pages/Staff/Dashboard.tsx#L641-L662)
- Channel: `staff-orders`
- Events: `INSERT` + `UPDATE` on `orders`

**Admin:** [src/pages/Admin/Dashboard.tsx#L716-L805](src/pages/Admin/Dashboard.tsx#L716-L805)
- Channel: `admin-dashboard-realtime`
- Events: `INSERT`/`UPDATE` on `orders`, `*` on `products`, `INSERT` on `user_profiles`
- Tracks realtime health: `healthy` / `degraded` / `down`

**Good practices:**
- Clean `useRef` pattern avoids re-subscriptions
- Cleanup on unmount
- Tight filtering (not subscribing to entire tables)

---

### 4. 🍽️ Business Logic

#### Order State Machine (✅ Rigorous)

**Status enum:** `'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled' | 'awaiting_payment'`

**Valid transitions** ([supabase/functions/manage-order/index.ts#L43-L50](supabase/functions/manage-order/index.ts#L43-L50)):
- `awaiting_payment` → `cancelled`
- `pending` → `preparing`, `cancelled`
- `preparing` → `ready`, `cancelled`
- `ready` → `completed`, `cancelled`
- Terminal: `completed`, `cancelled`

**DB-level constraint:** [consolidated_schema.sql#L1203-L1231](supabase/consolidated_schema.sql#L1203-L1231)

#### Order Creation Flow (✅ Well-Protected)

[supabase/functions/process-order/index.ts](supabase/functions/process-order/index.ts):

1. **Auth & anti-impersonation** (L79-L113)
2. **System settings** (L175-L284): Maintenance, hours, cutoff
3. **Date validation** (L285-L330): Sundays, Saturdays, holidays, past/future
4. **Idempotency** (L360-L375): `client_order_id` uniqueness → 409
5. **Slot merging** (L378-L510): Auto-merge if student+date exists
6. **Stock validation** (L514-L575): Price match, availability, stock
7. **Stock reservation** (L643-L682): Sequential `decrement_stock` RPC with rollback
8. **Balance deduction** (L745-L769): Atomic `deduct_balance_with_payment` RPC
9. **Order insert** (L700-L730): Sets status based on payment method

**Batch order:** [supabase/functions/process-batch-order/index.ts](supabase/functions/process-batch-order/index.ts)
- Single `Promise.all` for auth, settings, holidays, products, student links (L144-L155)
- Aggregated stock reservation
- Batch inserts

**⚠️ Race condition:** Order merge is check-then-act without locking (see High Priority #7).

#### Payment Handling (✅ Exceptional)

**Payment methods:** `'cash' | 'balance' | 'gcash' | 'paymaya' | 'card'`

**Cash flow:**
1. Order created with `status='awaiting_payment'`, `payment_due_at` = NOW + 4 hours
2. Staff confirms via [confirm-cash-payment](supabase/functions/confirm-cash-payment/index.ts)
3. Optimistic lock: `.eq('payment_status', 'awaiting_payment')` → prevents double-confirm

**Balance flow:**
1. `deduct_balance_with_payment` RPC with CAS on `balance = p_expected_balance`
2. Atomically: deduct wallet + create payment + create allocations
3. `CHECK (balance >= 0)` prevents negative balances

**Online flow:**
1. `createCheckout` → PayMongo checkout session
2. User redirects to PayMongo
3. PayMongo webhook → [paymongo-webhook](supabase/functions/paymongo-webhook/index.ts)
4. Webhook handler updates order with optimistic lock
5. Frontend polls [check-payment-status](supabase/functions/check-payment-status/index.ts) with self-healing

**Idempotency measures:**
- Order creation: `client_order_id` UNIQUE
- Cash confirmation: Optimistic lock on `payment_status`
- Webhook: Checks `order.payment_status === 'paid'` before processing
- Balance deduction: CAS on `balance`
- Refund: Optimistic lock `.neq('status', 'cancelled')`

#### Stock Management (✅ Atomic)

**RPC functions** ([consolidated_schema.sql#L1092-L1130](supabase/consolidated_schema.sql#L1092-L1130)):

- `decrement_stock`: Uses `SELECT ... FOR UPDATE` (row-level lock), raises exception if insufficient
- `increment_stock`: Simple atomic add
- `CHECK (stock_quantity >= 0)` constraint

**Protocol:**
- Order creation: `decrement_stock` per item, with rollback tracking
- Cancel/refund/timeout: `increment_stock` per item (failures logged but don't block)

---

### 5. ⚡ Performance

#### Bundle Analysis

- **No code splitting** — Zero `React.lazy` calls ([src/App.tsx](src/App.tsx))
- All ~40 page imports are static (Admin, Staff, Parent)
- **Vendor chunks** ([vite.config.ts#L55-L60](vite.config.ts#L55-L60)): `react-vendor`, `supabase-vendor`, `ui-vendor` — well-structured
- **5MB max cache size** ([vite.config.ts#L45](vite.config.ts#L45))

**Impact:** Mobile users downloading entire app (admin + staff + parent features) regardless of role. Initial load will be slow on 3G.

#### Query Patterns

**`select('*')` — 15+ occurrences:**

| File | Line | Table |
|---|---|---|
| [src/services/products.ts](src/services/products.ts) | L317, L335, L345, L357 | products, menu_schedules, holidays |
| [src/pages/Admin/WeeklyMenu.tsx](src/pages/Admin/WeeklyMenu.tsx) | L148, L192, L205 | menu_schedules |
| [src/pages/Admin/Users.tsx](src/pages/Admin/Users.tsx) | L103, L118 | user_profiles |
| [src/pages/Admin/Products.tsx](src/pages/Admin/Products.tsx) | L46 | products |
| [src/pages/Admin/Settings.tsx](src/pages/Admin/Settings.tsx) | L63 | system_settings |
| [src/pages/Admin/AuditLogs.tsx](src/pages/Admin/AuditLogs.tsx) | L58 | audit_logs |

**Pagination: Zero `.range()` calls.** All queries fetch unbounded result sets.

#### Image Optimization

- **Storage service** ([src/services/storage.ts](src/services/storage.ts)):
  - Type validation: JPEG, PNG, WebP, GIF
  - Size limit: 5MB
  - 1-hour cache-control header
- **CDN usage:** `getPublicUrl()` from Supabase Storage
- **No lazy loading, no WebP fallbacks, no srcset**

---

### 6. 🗄️ Database

#### Migrations (✅ Comprehensive)

42 migrations from `001_init.sql` through `20260228000004_order_auto_merge.sql`.

**Key migration:** [20260219_secure_role_app_metadata.sql](supabase/migrations/20260219_secure_role_app_metadata.sql) — Migrates roles from `user_metadata` to `app_metadata`.

#### Schema Quality (✅ Excellent)

- **Foreign keys with cascades:** 16 `ON DELETE CASCADE`, 1 `ON DELETE SET NULL` ([consolidated_schema.sql](supabase/consolidated_schema.sql))
- **Check constraints:** Order status values, `balance >= 0`
- **Unique constraints:** Prevent duplicate orders per student+date
- **Indexes:** On `user_id`, `status`, `created_at`, `scheduled_for`, `parent_id`, `student_id`
- **Updated_at triggers:** 6 tables have auto-updating `updated_at` timestamps

#### RPC Functions (✅ Well-Designed)

| RPC | Concurrency Safety |
|---|---|
| `decrement_stock` | `SELECT ... FOR UPDATE` row lock |
| `increment_stock` | Simple atomic add |
| `deduct_balance_with_payment` | CAS on `balance = expected` |
| `credit_balance_with_payment` | `SELECT ... FOR UPDATE` |
| `cleanup_past_cart_items` | `SECURITY DEFINER` |

---

### 7. 🪣 Supabase Storage

**Bucket:** `product-images`, public

**Upload validation** ([src/services/storage.ts#L14-L26](src/services/storage.ts#L14-L26)):
- MIME type whitelist: JPEG, PNG, WebP, GIF
- Max size: 5MB
- Filename sanitization: UUIDs used

**Delete protection** ([src/services/storage.ts#L64-L73](src/services/storage.ts#L64-L73)):
- Path traversal prevention: Only allows `products/` prefix, blocks `..`

**Missing:**
- **No storage RLS policies** — Bucket setup commented out in migration ([supabase/migrations/20260105_admin_enhancements.sql#L230-L233](supabase/migrations/20260105_admin_enhancements.sql#L230-L233))
- **No orphan cleanup** — Images not deleted when products are deleted

---

### 8. 🔧 Environment & DevOps

#### Environment Variables (✅ Secure)

**Frontend:**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_VAPID_PUBLIC_KEY`
- `VITE_GA_MEASUREMENT_ID`
- `VITE_DEV_MODE`

**`.gitignore`:** All `.env` variants covered ([.gitignore](../.gitignore))

**Service role key:** Used exclusively in server-side Deno edge functions. Zero frontend exposure confirmed.

#### CI/CD (✅ Production-Grade)

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) — 6 jobs:

1. `lint` → 2. `test-unit` → 3. `test-e2e` → 4. `build` → 5. `deploy-vercel` + 6. `deploy-functions` + `migrate`

**Features:**
- Node 18, npm ci with cache
- Codecov coverage upload
- Playwright (Chromium only for CI)
- Vercel deployment via `amondnet/vercel-action@v25`
- Supabase Edge Functions deployment + `db push` migrations

#### Backup & Monitoring

- **Supabase backups:** Not mentioned in code (should be enabled in dashboard)
- **Error monitoring:** Not implemented (Sentry mentioned as future)
- **Logging:** Console.log audit entries in edge functions

---

### 9. 🧪 Testing

#### Unit Tests (✅ Excellent — 56 files)

**Coverage areas:**
- **Components:** 16 files (CartBottomSheet, ConfirmDialog, EditProfileModal, etc.)
- **Hooks:** 8 files (useAuth, useCart, useOrders, useProducts, etc.)
- **Services:** 12 files (orders, payments, localQueue, products, etc.)
- **Pages:** 11 files (Login, Register, Menu, Dashboard variants)
- **Specialized:** `balanceConcurrency.test.ts`, `indexedDBRace.test.ts`, `cashPaymentFlow.test.ts`

**Test infrastructure:**
- [tests/setup.ts](tests/setup.ts): 106 lines of mocks (matchMedia, IntersectionObserver, crypto, etc.)
- [tests/mocks/supabase.ts](tests/mocks/supabase.ts): Full Supabase client mock
- [tests/mocks/data.ts](tests/mocks/data.ts): 365 lines of realistic Filipino canteen data
- [tests/utils/testUtils.tsx](tests/utils/testUtils.tsx): Provider wrappers

#### E2E Tests (⚠️ Mostly Skipped)

**Files:** [e2e/auth.spec.ts](e2e/auth.spec.ts), [e2e/flows.spec.ts](e2e/flows.spec.ts), [e2e/concurrency.spec.ts](e2e/concurrency.spec.ts)

**Status:** Most authenticated tests are `test.skip`'d. Only unauthenticated tests run (login page, PWA checks, accessibility).

**Playwright config:** 5 browsers (Chromium, Firefox, WebKit, Mobile Chrome, Mobile Safari), proper CI settings.

---

## Files Reviewed

### Frontend (`src/`)
- `App.tsx`, `main.tsx`, `index.css`
- `hooks/`: useAuth.tsx, useCart.ts, useOrders.ts, useProducts.ts, useStudents.ts, useOrderSubscription.ts
- `services/`: supabaseClient.ts, authSession.ts, orders.ts, payments.ts, products.ts, students.ts, storage.ts, localQueue.ts
- `pages/Admin/`: Dashboard.tsx, Orders.tsx, Products.tsx, Users.tsx, WeeklyMenu.tsx, Settings.tsx, AuditLogs.tsx
- `pages/Staff/`: Dashboard.tsx, Products.tsx, Profile.tsx
- `pages/Parent/`: Menu.tsx, OrderHistory.tsx, OrderConfirmation.tsx, Balance.tsx
- `components/`: 20+ components
- `pwa/`: service-worker.ts

### Backend (`supabase/`)
- `consolidated_schema.sql`
- `config.toml`
- `migrations/`: 42 migration files
- `functions/`: 29 edge functions

### Config & Build
- `vite.config.ts`, `tsconfig.json`, `package.json`
- `tailwind.config.cjs`, `postcss.config.cjs`
- `vercel.json`
- `.gitignore`

### Testing
- `tests/`: 56 unit test files
- `e2e/`: 3 E2E test files
- `tests/setup.ts`, `tests/mocks/`, `tests/utils/`

### Documentation
- `docs/`: 23 markdown files (ARCHITECTURE.md, SECURITY.md, TESTING.md, DEPLOYMENT.md, etc.)

---

## Implementation Roadmap

### Sprint 1 (Critical — 1 week)
- [ ] Add `React.lazy` code splitting for all route-level pages
- [ ] Wire auth token to service worker (`postMessage` in `useAuth`)
- [ ] Fix invitations RLS policy (restrict SELECT)
- [ ] Add pagination to order history, audit logs, user lists

### Sprint 2 (High Priority — 2 weeks)
- [ ] Fix audit logs RLS policy
- [ ] Add offline page fallback
- [ ] Fix order merge race condition (add locking)
- [ ] Replace `select('*')` with explicit columns
- [ ] Integrate Sentry error monitoring
- [ ] Migrate CORS to shared module
- [ ] Add cross-context locking for queue processing
- [ ] Un-skip E2E tests (create auth setup)

### Sprint 3 (Medium — 3 weeks)
- [ ] Add iOS PWA meta tags and splash screens
- [ ] Remove dead push notification code
- [ ] Add storage bucket RLS policies via migration
- [ ] Wire orphan image cleanup to product deletion
- [ ] Fix manifest dark mode support
- [ ] Deduplicate env var reads (use shared client)
- [ ] Fix balance merge RPC (use proper payment record)
- [ ] Improve wallet credit retry logic

### Backlog
- [ ] Add manifest screenshots
- [ ] Add display_override
- [ ] Add stale-data warning for long offline periods
- [ ] Add network quality detection
- [ ] Tune React Query staleTime per feature

---

## Conclusion

This is a **well-architected PWA with exceptional attention to payment integrity and security fundamentals**. The use of atomic RPC functions, optimistic locking, and layered idempotency demonstrates senior-level engineering. The primary gaps are **performance (no code splitting, no pagination)** and **one critical offline bug** (SW auth token). All issues are fixable without architectural rewrites.

**Recommendation:** Address the 4 critical findings before launch. The app is otherwise production-ready with minor issues that can be tackled post-launch.
