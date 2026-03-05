# Payment Integration Design: GCash, PayMaya & Cards via PayMongo

## Executive Summary

The Loheca Canteen PWA integrates PayMongo for online payments (GCash, PayMaya, credit/debit cards). Combined with cash payments, the system supports four payment methods. There is **no wallet/balance system** — all payments are direct.

**Payment Methods**: `cash`, `gcash`, `paymaya`, `card`

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [PayMongo Concepts](#2-paymongo-concepts)
3. [Database Schema](#3-database-schema)
4. [Edge Function Design](#4-edge-function-design)
5. [Frontend Flow Design](#5-frontend-flow-design)
6. [Use Case Flows](#6-use-case-flows)
7. [Weekly Payment Flow](#7-weekly-payment-flow)
8. [Webhook Security & Handling](#8-webhook-security--handling)
9. [Refund Handling](#9-refund-handling)
10. [Error Handling & Edge Cases](#10-error-handling--edge-cases)
11. [Security & Compliance](#11-security--compliance)
12. [Testing Strategy](#12-testing-strategy)
13. [Environment Configuration](#13-environment-configuration)
14. [Cost Analysis](#14-cost-analysis)

---

## 1. Architecture Overview

```text
┌──────────────────┐
│   React PWA      │
│  (Payment UI)    │
└────────┬─────────┘
         │ 1. Choose payment method
         │ 2. Call edge function
         ▼
┌──────────────────┐
│  Edge Function   │
│  create-checkout │  ← or create-weekly-checkout, create-batch-checkout
│  create-weekly-  │
│  checkout        │
└────────┬─────────┘
         │ 3. Create PayMongo Checkout Session
         │    (server-to-server, secret key)
         ▼
┌──────────────────┐
│   PayMongo API   │
│  Checkout Session│
└────────┬─────────┘
         │ 4. Return checkout_url
         ▼
┌──────────────────┐
│  Parent Browser  │  ← Redirected to PayMongo hosted page
│  (GCash/PayMaya/ │
│   Card form)     │
└────────┬─────────┘
         │ 5. Payment completed
         ▼
┌──────────────────┐     ┌──────────────────┐
│  PayMongo sends  │────►│  paymongo-webhook │
│  webhook event   │     │  (Edge Function)  │
└──────────────────┘     └────────┬─────────┘
                                  │ 6. Update order status
                                  │    (paid / failed)
                                  ▼
                         ┌──────────────────┐
                         │  Supabase DB     │
                         │  orders table    │
                         └──────────────────┘
```

### Key Principles

- **Server-side checkout only**: PayMongo secret key never exposed to frontend
- **Webhook-first**: Order status updated by webhook, not redirect callback
- **Self-healing**: `check-payment-status` polls PayMongo to fix missed webhooks
- **Batch-aware**: One checkout session can cover multiple orders via `payment_group_id`
- **Amounts in centavos**: PayMongo expects amounts in centavos (₱45.00 = 4500)
- **Minimum ₱20**: PayMongo requires minimum checkout amount of ₱20.00 (2000 centavos)

---

## 2. PayMongo Concepts

### Checkout Session Lifecycle

```text
Created → active → (payment attempted) → paid / expired
```

### Key Objects

| Object | Description |
| ------ | ----------- |
| **Checkout Session** | Server-created payment page. Contains amount, payment methods, redirect URLs |
| **Payment** | Created when customer completes checkout. Contains payment details |
| **Refund** | Reversal of a payment. Created via API by admin |

### Checkout Session Fields Used

| Field | Purpose |
| ----- | ------- |
| `id` | Stored as `paymongo_checkout_id` on orders |
| `checkout_url` | Redirect URL for the parent |
| `payment_method_types` | `['gcash']`, `['paymaya']`, or `['card']` |
| `line_items` | Order summary shown on checkout page |
| `success_url` | Redirect after successful payment |
| `cancel_url` | Redirect if parent cancels |
| `metadata` | Contains `order_ids`, `payment_group_id`, `parent_id` |

---

## 3. Database Schema

### Orders Table — Payment Columns

| Column | Type | Description |
| ------ | ---- | ----------- |
| `payment_method` | text | `cash`, `gcash`, `paymaya`, `card` |
| `payment_status` | enum | `awaiting_payment`, `paid`, `timeout`, `refunded`, `failed` |
| `payment_due_at` | timestamptz | Deadline: cash 4hrs, online 30min |
| `payment_group_id` | uuid | Groups batch orders for shared payment |
| `paymongo_checkout_id` | text | PayMongo checkout session ID |
| `paymongo_payment_id` | text | PayMongo payment ID (set after confirmation) |

### Weekly Orders Table — Payment Columns

| Column | Type | Description |
| ------ | ---- | ----------- |
| `payment_method` | text | `cash`, `gcash`, `paymaya`, `card` |
| `payment_status` | enum | `awaiting_payment`, `paid`, `timeout`, `refunded`, `failed` |
| `paymongo_checkout_id` | text | PayMongo checkout session ID |
| `paymongo_checkout_url` | text | PayMongo redirect URL |
| `payment_due_at` | timestamptz | Payment deadline |

### Payments Table

One row per real money movement. See DATA_SCHEMA.md for full schema.

### Payment Allocations Table

Links one payment to multiple orders. See DATA_SCHEMA.md for full schema.

---

## 4. Edge Function Design

### 4.1 create-checkout

Creates a PayMongo checkout session for a single order.

**Flow**:

1. Validate user owns the order
2. Verify order is in `awaiting_payment` status
3. Map payment method to PayMongo type (`gcash` → `['gcash']`)
4. Create checkout session via PayMongo API
5. Store `paymongo_checkout_id` on order
6. Set `payment_due_at` = now + 30 minutes
7. Return `checkout_url` to frontend

### 4.2 create-batch-checkout

Creates a single PayMongo checkout session for multiple orders.

**Flow**:

1. Validate all orders belong to the same parent
2. Generate `payment_group_id` (UUID)
3. Calculate total amount across all orders
4. Create single PayMongo checkout session for the total
5. Store `payment_group_id` and `paymongo_checkout_id` on ALL orders
6. Return `checkout_url`

### 4.3 create-weekly-checkout

Creates a PayMongo checkout for a weekly pre-order total.

**Flow**:

1. Validate cutoff not passed
2. Create `weekly_order` + daily `orders` records (status: `awaiting_payment`)
3. Calculate total = sum of all daily order amounts
4. Create PayMongo checkout for the total
5. Store `paymongo_checkout_id` on weekly_order and all daily orders
6. Return `checkout_url` and `weekly_order_id`

### 4.4 paymongo-webhook

Receives and processes PayMongo webhook events.

**Events handled**:

- `checkout_session.payment.paid`:
  1. Extract `payment_group_id` and `order_ids` from metadata
  2. Update ALL orders with matching `payment_group_id` to `payment_status = 'paid'`
  3. Update order `status` from `awaiting_payment` → `pending`
  4. Create payment + allocation records
  5. If weekly order: update `weekly_orders.payment_status = 'paid'`

- `payment.failed`:
  1. Update order `payment_status = 'failed'`

- `payment.refunded`:
  1. Update order `payment_status = 'refunded'`

### 4.5 check-payment-status

Self-healing function. Queries PayMongo API for checkout session status.

**When called**:

- Parent returns from checkout and payment isn't yet reflected
- Periodic cron job for orders stuck in `awaiting_payment`

**Flow**:

1. Fetch order's `paymongo_checkout_id`
2. Query PayMongo API for checkout session status
3. If paid: update orders (same as webhook handler)
4. If expired: mark as timeout

### 4.6 cleanup-timeout-orders

Cron job that expires unpaid orders past `payment_due_at`.

**Behavior**:

- Finds orders where `payment_status = 'awaiting_payment'` AND `payment_due_at < now()`
- Sets `status = 'cancelled'`, `payment_status = 'timeout'`
- For weekly orders: if all daily orders are cancelled, cancels the weekly_order too

### 4.7 confirm-cash-payment

Staff confirms a cash payment was collected.

**Flow**:

1. Find order in `awaiting_payment` status
2. Set `payment_status = 'paid'`, `status = 'pending'`
3. Create payment record (type: 'payment', method: 'cash', status: 'completed')

### 4.8 retry-checkout

Creates a new checkout session for an order whose previous checkout expired.

**Flow**:

1. Validate order is still in `awaiting_payment`
2. Create new PayMongo checkout session
3. Update `paymongo_checkout_id` and `payment_due_at`
4. Return new `checkout_url`

---

## 5. Frontend Flow Design

### 5.1 Payment Method Selector

```text
┌─────────────────────────────────┐
│  💵 Cash (Pay at counter)       │ ← school method
├─────────────────────────────────┤
│  ──── Pay Online ────           │
├─────────────────────────────────┤
│  📱 GCash                      │ ← online methods
│  📱 PayMaya                    │   (disabled when offline)
│  💳 Credit/Debit Card          │
└─────────────────────────────────┘
```

Online methods show "Requires internet connection" when offline.

### 5.2 Checkout Flow

**Cash**:

1. Parent selects cash → calls `process-weekly-order` or `process-batch-order`
2. Orders created with `payment_status = 'awaiting_payment'`
3. Staff confirms cash collection → `confirm-cash-payment`

**Online (GCash/PayMaya/Card)**:

1. Parent selects online method → calls `create-weekly-checkout` or `create-batch-checkout`
2. Frontend receives `checkout_url`
3. Parent redirected to PayMongo hosted checkout page
4. After payment: redirected back to app with `?status=success`
5. Frontend calls `check-payment-status` to verify
6. Webhook updates order in background

### 5.3 Order Confirmation Page

After checkout redirect:

1. Parse URL params (`status`, `checkout_id`)
2. If `status=success`: show success state, call `check-payment-status`
3. If `status=cancelled`: show retry option
4. Poll until payment is confirmed or timeout

### 5.4 Checkout Button Text

| Method | Button Text |
| ------ | ----------- |
| `cash` | "Place Order" |
| `gcash` | "Pay with GCash" |
| `paymaya` | "Pay with PayMaya" |
| `card` | "Pay with Card" |

---

## 6. Use Case Flows

### 6.1 Parent Pays Weekly Order via GCash

1. Parent adds items for Mon–Fri to cart
2. Selects GCash as payment method
3. Taps "Pay with GCash" → frontend calls `create-weekly-checkout`
4. Edge function creates weekly_order + 5 daily orders (all `awaiting_payment`)
5. Creates PayMongo checkout for ₱225.00 total
6. Parent redirected to GCash → confirms payment
7. PayMongo webhook fires → all 5 orders marked as `paid` → status becomes `pending`
8. Parent sees "Order Confirmed" on return

### 6.2 Parent Places Cash Weekly Order

1. Parent adds items to cart, selects Cash
2. Taps "Place Order" → frontend calls `process-weekly-order`
3. Weekly order + daily orders created with `payment_status = 'awaiting_payment'`
4. Staff sees order on dashboard → collects cash
5. Staff taps "Confirm Cash Payment" → `confirm-cash-payment`
6. All daily orders marked as `paid`

### 6.3 Payment Timeout (Abandoned)

1. Parent selects GCash, gets checkout URL
2. Parent never completes payment
3. After 30 minutes: `check-payment-status` finds session expired
4. `cleanup-timeout-orders` cron marks orders as `timeout`/`cancelled`

### 6.4 Admin Refunds a GCash Order

1. Admin selects order → clicks "Refund"
2. Frontend calls `refund-order` edge function
3. Edge function:
   - Finds original payment via `payment_allocations`
   - Calls PayMongo Refund API with `paymongo_payment_id`
   - Creates refund payment record
   - Updates order `payment_status = 'refunded'`, `status = 'cancelled'`

---

## 7. Weekly Payment Flow

### Overview

Weekly pre-orders are paid as a single lump sum covering all 5 days.

```text
Cart items (Mon-Fri)
  │
  ├─ Cash: process-weekly-order → orders created → staff confirms
  │
  └─ Online: create-weekly-checkout → PayMongo session for total
       │
       ├─ Payment succeeds → webhook → all daily orders → paid
       │
       └─ Payment fails/expires → cleanup → cancelled
```

### Day Cancellation with Partial Refund

When a parent cancels a specific day from a weekly order:

1. `parent-cancel-order` validates before 8 AM cutoff
2. Daily order marked as `cancelled`
3. If originally paid online: refund for that day's amount via PayMongo
4. Weekly order total remains unchanged (historical record)
5. Refund payment record created with link to original payment

---

## 8. Webhook Security & Handling

### 8.1 Signature Verification

PayMongo signs webhooks with HMAC-SHA256. The edge function verifies:

```typescript
const signature = request.headers.get('paymongo-signature');
// Parse timestamp and signatures from header
// Compute expected = HMAC-SHA256(webhook_secret, timestamp + '.' + body)
// Compare using timing-safe comparison
```

**Key**: Stored as `PAYMONGO_WEBHOOK_SECRET` in Supabase Edge Function secrets.

### 8.2 Idempotency

Webhook events may be delivered multiple times. The handler is idempotent:

- Uses `paymongo_payment_id` unique index to prevent duplicate payment records
- Checks order status before updating (no-op if already paid)

### 8.3 Webhook Registration

Configure via PayMongo Dashboard:

- **URL**: `https://<project-ref>.supabase.co/functions/v1/paymongo-webhook`
- **Events**: `checkout_session.payment.paid`, `payment.failed`, `payment.refunded`

### 8.4 Webhook Retry Policy

PayMongo retries failed webhooks with exponential backoff:

- 1st retry: 1 minute
- 2nd retry: 5 minutes
- 3rd retry: 30 minutes
- Then hourly for 24 hours

---

## 9. Refund Handling

### 9.1 Refund Matrix

| Original Method | Refund Process |
| --------------- | -------------- |
| Cash | Admin marks as refunded (manual return of cash) |
| GCash | PayMongo Refund API → refunded to GCash account |
| PayMaya | PayMongo Refund API → refunded to PayMaya account |
| Card | PayMongo Refund API → refunded to card (5-10 business days) |

### 9.2 PayMongo Refund API

```json
POST https://api.paymongo.com/v1/refunds
{
  "data": {
    "attributes": {
      "amount": 4500,
      "payment_id": "pay_xxx",
      "reason": "requested_by_customer",
      "notes": "Day cancellation - Monday order"
    }
  }
}
```

### 9.3 Refund Timing

| Method | Typical Refund Time |
| ------ | ------------------- |
| GCash | Instant to 1 business day |
| PayMaya | 1-3 business days |
| Card | 5-10 business days |
| Cash | Immediate (manual) |

---

## 10. Error Handling & Edge Cases

### 10.1 Payment Failure Scenarios

| Scenario | Handling |
| -------- | -------- |
| Checkout session expires | `cleanup-timeout-orders` cancels orders |
| GCash insufficient balance | PayMongo shows error, parent can retry |
| Card declined | PayMongo shows error, parent gets retry option |
| Webhook delivery fails | `check-payment-status` self-heals |
| Network error during redirect | Parent can manually check order status |
| Double submit | `client_order_id` idempotency prevents duplicates |

### 10.2 Race Condition: Webhook vs. Redirect

Both webhook and redirect-triggered `check-payment-status` may try to update simultaneously:

```text
Parent redirected back → check-payment-status (reads PayMongo)
PayMongo webhook fires → paymongo-webhook (updates DB)
```

**Resolution**: Both use `UPDATE ... WHERE payment_status = 'awaiting_payment'`. Only one succeeds; the other is a no-op (order already paid).

### 10.3 Offline Handling

Online payment methods are disabled when offline (checked by ServiceWorker/navigator.onLine). Cash orders can be queued offline and synced later.

---

## 11. Security & Compliance

### 11.1 PCI DSS

PayMongo handles all card data collection via hosted checkout. No card numbers touch our servers. We are PCI DSS SAQ-A compliant.

### 11.2 Secret Key Management

| Secret | Storage | Never In |
| ------ | ------- | -------- |
| `PAYMONGO_SECRET_KEY` | Supabase Edge Function secrets | Frontend, git, logs |
| `PAYMONGO_WEBHOOK_SECRET` | Supabase Edge Function secrets | Frontend, git, logs |
| `PAYMONGO_PUBLIC_KEY` | Frontend env var (`.env`) | Not secret — safe to expose |

### 11.3 Philippine Data Privacy Act (DPA) Compliance

- No financial data stored beyond transaction records
- PayMongo handles all sensitive payment information
- Users can request data deletion

### 11.4 Amount Validation

All amounts validated server-side:

```typescript
// Edge function validates:
const amountCentavos = Math.round(totalAmount * 100);
if (amountCentavos < 2000) throw new Error('Minimum PayMongo amount is ₱20.00');
if (amountCentavos > 10000000) throw new Error('Maximum single payment is ₱100,000.00');
```

---

## 12. Testing Strategy

### 12.1 PayMongo Test Mode

Use PayMongo test API keys for development. Test card numbers:

| Card | Result |
| ---- | ------ |
| `4343 4343 4343 4345` | Successful payment |
| `4343 4343 4343 4342` | Failed payment |
| `4120 0000 0000 0007` | Visa successful |

GCash/PayMaya test mode: simulates successful authentication.

### 12.2 Test Scenarios

1. **Happy path**: GCash checkout → payment → webhook → order confirmed
2. **Timeout**: Create checkout → wait → verify cleanup
3. **Retry**: Failed checkout → retry → success
4. **Refund**: Paid order → admin refund → PayMongo refund created
5. **Batch**: 3 orders → single checkout → all marked paid
6. **Weekly**: 5-day order → weekly checkout → all days confirmed
7. **Day cancel**: Weekly paid → cancel Monday → partial refund

### 12.3 Unit Tests

- `payments.test.ts`: `createCheckout`, `createBatchCheckout`, `createWeeklyCheckout`, `getPaymentMethodLabel`, `getCheckoutButtonText`
- `PaymentMethodSelector.test.ts`: component rendering, offline state, selection

### 12.4 Integration Tests

- `orderWorkflow.test.ts`: end-to-end order + payment flow

---

## 13. Environment Configuration

### 13.1 Supabase Edge Function Secrets

```bash
supabase secrets set PAYMONGO_SECRET_KEY=sk_test_xxx
supabase secrets set PAYMONGO_WEBHOOK_SECRET=whsk_xxx
```

### 13.2 PayMongo Dashboard Setup

1. Create account at paymongo.com
2. Get API keys from Developers → API Keys
3. Configure webhook endpoint
4. Enable GCash, PayMaya, Card payment methods

### 13.3 Frontend Environment

```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

No PayMongo keys needed in frontend — all checkout sessions created server-side.

---

## 14. Cost Analysis

### 14.1 PayMongo Fees

| Method | Fee |
| ------ | --- |
| GCash | 2.5% |
| PayMaya | 2.5% |
| Credit Card | 3.5% + ₱15 |
| Debit Card | 2.5% + ₱15 |

### 14.2 Monthly Cost Estimate

| Scenario | Monthly Orders | Avg Order | Online % | Monthly Fees |
| -------- | -------------- | --------- | -------- | ------------ |
| Small school (100 students) | 2,000 | ₱45 | 30% | ~₱675 |
| Medium school (300 students) | 6,000 | ₱50 | 40% | ~₱3,000 |
| Large school (500 students) | 10,000 | ₱55 | 50% | ~₱6,875 |

### 14.3 Who Pays the Fee?

Currently absorbed by the school/canteen. Could optionally add a convenience fee for online payments (configurable via `system_settings`).
