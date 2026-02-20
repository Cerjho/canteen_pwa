# Payment Integration Design: GCash, PayMaya & Cards via PayMongo

## Executive Summary

This document is the comprehensive plan for integrating **real electronic payments** (GCash, PayMaya, credit/debit cards) and **self-service wallet top-ups** into the Canteen PWA using **PayMongo** as the payment gateway â€” the leading Philippine payment processor that unifies GCash, PayMaya, and cards under one API.

---

## Table of Contents

1. [Current State & Gap Analysis](#1-current-state--gap-analysis)
2. [Why PayMongo](#2-why-paymongo)
3. [Architecture Overview](#3-architecture-overview)
4. [PayMongo Concepts](#4-paymongo-concepts)
5. [Database Schema Changes](#5-database-schema-changes)
6. [Edge Function Design](#6-edge-function-design)
7. [Frontend Flow Design](#7-frontend-flow-design)
8. [Use Case Flows](#8-use-case-flows)
9. [Webhook Security & Handling](#9-webhook-security--handling)
10. [Self-Service Wallet Top-Up](#10-self-service-wallet-top-up)
11. [Refund Handling](#11-refund-handling)
12. [Error Handling & Edge Cases](#12-error-handling--edge-cases)
13. [Security & Compliance](#13-security--compliance)
14. [Testing Strategy](#14-testing-strategy)
15. [Rollout Plan](#15-rollout-plan)
16. [Environment Configuration](#16-environment-configuration)
17. [Cost Analysis](#17-cost-analysis)
18. [File-by-File Implementation Checklist](#18-file-by-file-implementation-checklist)

---

## 1. Current State & Gap Analysis

### What's Working

| Feature | Status | Details |
| --------- | -------- | --------- |
| Cash payment | âœ… Full | 15-min timeout, staff confirmation, auto-cleanup |
| Wallet balance payment | âœ… Full | Optimistic locking, rollback on failure |
| Admin manual top-up | âœ… Full | Admin receives cash â†’ adds balance |
| Refund to wallet | âœ… Full | Stock + balance restoration |
| Transaction history | âœ… Full | payment/refund/topup records |

### What's Broken or Missing

| Feature | Status | Problem |
| --------- | -------- | --------- |
| GCash payment | âš ï¸ **FAKE** | Frontend shows option, backend marks as `paid` immediately â€” **no money collected** |
| PayMaya payment | âŒ Missing | Not in frontend, `'paymongo'` in DB but unused |
| Card payment | âŒ Missing | No implementation |
| Self-service top-up | âŒ Missing | Balance page shows disabled "Top Up" button with "Soon" badge |
| GCash/card refunds | âŒ Missing | Only DB record created, no money returned via API |
| PayMongo integration | âŒ Missing | No SDK, no API keys, no webhooks |

### Database Already Supports

- `payment_method IN ('cash', 'balance', 'gcash', 'paymongo')` âœ…
- `transactions.method IN ('cash', 'gcash', 'paymongo', 'balance')` âœ…
- `transactions.reference_id` for external IDs âœ…
- `payment_status` enum: `awaiting_payment | paid | timeout | refunded` âœ…
- `payment_due_at` timestamp for deadlines âœ…

---

## 2. Why PayMongo

**PayMongo** (<https://paymongo.com>) is the recommended payment gateway because:

1. **Philippine-focused**: Built for PHP (â‚±) transactions, BSP-licensed
2. **Unified API**: One integration covers GCash, PayMaya, credit/debit cards, grab_pay, and more
3. **Checkout Sessions**: Hosted payment page â€” no PCI DSS scope for us (card details never touch our servers)
4. **Webhooks**: Real-time payment confirmation
5. **Refund API**: Programmatic refunds for cards; refund-to-source for e-wallets
6. **Test Mode**: Full sandbox with test credentials
7. **Pricing**: 2.5% + â‚±15 for cards, 2.5% for e-wallets (GCash/PayMaya) â€” no monthly fee
8. **Deno-compatible**: REST API works from Supabase Edge Functions (no SDK needed)

### PayMongo API Endpoints Used

| Endpoint | Purpose |
| ---------- | --------- |
| `POST /v1/checkout_sessions` | Create payment page (GCash, PayMaya, card) |
| `GET /v1/checkout_sessions/:id` | Check payment status |
| `POST /v1/refunds` | Refund a payment |
| `GET /v1/payments/:id` | Get payment details |
| Webhook events | `checkout_session.payment.paid`, `payment.refunded` |

### PayMongo API Authentication

```text
Authorization: Basic base64(SECRET_KEY + ":")
```

All API calls from Edge Functions use the **Secret Key** (never exposed to client).
The **Public Key** is only needed if using PayMongo.js for card tokenization (we won't â€” we use Checkout Sessions).

---

## 3. Architecture Overview

```text
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                         PARENT (Browser/PWA)                         â”‚
â”‚  1. Select GCash/PayMaya/Card â†’ clicks "Pay"                       â”‚
â”‚  2. Redirected to PayMongo Checkout page                            â”‚
â”‚  3. Completes payment on PayMongo                                   â”‚
â”‚  4. Redirected back to app (success/cancel URL)                     â”‚
â”‚  5. App shows order confirmation                                    â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
               â”‚ Step 1                   â”‚ Step 4
               â–¼                          â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    SUPABASE EDGE FUNCTIONS                            â”‚
â”‚                                                                      â”‚
â”‚  create-checkout â”€â”€â”€â”€â”€â–º PayMongo API â”€â”€â–º Checkout Session created    â”‚
â”‚       â”‚                                                              â”‚
â”‚       â–¼                                                              â”‚
â”‚  Order created with:                                                 â”‚
â”‚    status = 'awaiting_payment'                                       â”‚
â”‚    payment_status = 'awaiting_payment'                               â”‚
â”‚    payment_due_at = now + 30 min                                     â”‚
â”‚    paymongo_checkout_id = 'cs_...'                                   â”‚
â”‚                                                                      â”‚
â”‚  paymongo-webhook â—„â”€â”€â”€â”€â”€ PayMongo Webhook â”€â”€â–º Payment confirmed     â”‚
â”‚       â”‚                                                              â”‚
â”‚       â–¼                                                              â”‚
â”‚  Order updated:                                                      â”‚
â”‚    status = 'pending'                                                â”‚
â”‚    payment_status = 'paid'                                           â”‚
â”‚    paymongo_payment_id = 'pay_...'                                   â”‚
â”‚                                                                      â”‚
â”‚  create-topup-checkout â”€â”€â–º PayMongo API â”€â”€â–º Wallet top-up session   â”‚
â”‚  paymongo-webhook â—„â”€â”€â”€â”€â”€â”€â”€â”€ Webhook â”€â”€â”€â”€â”€â”€â–º Wallet balance credited â”‚
â”‚                                                                      â”‚
â”‚  create-refund â”€â”€â”€â”€â”€â”€â–º PayMongo Refund API â”€â”€â–º Money returned       â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
               â”‚
               â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                          PayMongo                                    â”‚
â”‚  - Hosts checkout page (GCash, PayMaya, Card forms)                 â”‚
â”‚  - Processes payments                                                â”‚
â”‚  - Sends webhook events                                              â”‚
â”‚  - Handles refunds                                                   â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Key Principle: **Checkout Sessions (Server-Side)**

We use **PayMongo Checkout Sessions** exclusively. This means:

- **No card numbers ever touch our frontend or backend** (PCI DSS out of scope)
- **GCash/PayMaya** handled by PayMongo's redirect flow
- Parent is redirected to PayMongo's hosted page â†’ completes payment â†’ redirected back
- We confirm payment **only** via webhook (never trust the redirect alone)

---

## 4. PayMongo Concepts

### Checkout Session Lifecycle

```text
Created â”€â”€â–º [Parent redirects to checkout_url] â”€â”€â–º Payment Attempted
                                                        â”‚
                                              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                                              â–¼         â–¼          â–¼
                                           Paid     Failed     Expired
                                              â”‚                    â”‚
                                      Webhook fires         30-min timeout
                                    (payment.paid)         (our cleanup job)
```

### Key Objects

| Object | Description | Our Use |
| -------- | ------------- | --------- |
| `CheckoutSession` | A payment intent with a hosted URL | Created per order or top-up |
| `Payment` | Actual money movement | Referenced after webhook confirms |
| `Refund` | Money returned to customer | Created for cancellations |

### Checkout Session Fields We Use

```json
{
  "data": {
    "id": "cs_...",
    "attributes": {
      "checkout_url": "https://checkout.paymongo.com/cs_...",
      "payment_intent": { "id": "pi_..." },
      "payments": [{ "id": "pay_...", "attributes": { "status": "paid" } }],
      "status": "active|expired|paid",
      "metadata": {
        "order_id": "uuid",       // or "topup" for wallet top-ups
        "parent_id": "uuid",
        "type": "order|topup"
      },
      "payment_method_types": ["gcash", "paymaya", "card"],
      "line_items": [{ "name": "...", "amount": 5000, "currency": "PHP", "quantity": 1 }]
    }
  }
}
```

---

## 5. Database Schema Changes

### 5.1 New Columns on `orders` Table

```sql
-- Migration: 20260221_paymongo_integration.sql

-- Add PayMongo reference columns to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  paymongo_checkout_id TEXT;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  paymongo_payment_id TEXT;

-- Index for webhook lookups
CREATE INDEX IF NOT EXISTS idx_orders_paymongo_checkout_id
  ON orders(paymongo_checkout_id)
  WHERE paymongo_checkout_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_paymongo_payment_id
  ON orders(paymongo_payment_id)
  WHERE paymongo_payment_id IS NOT NULL;
```

### 5.2 New Columns on `transactions` Table

```sql
-- Add PayMongo references to transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS
  paymongo_payment_id TEXT;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS
  paymongo_refund_id TEXT;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS
  paymongo_checkout_id TEXT;

-- Index for webhook lookups
CREATE INDEX IF NOT EXISTS idx_transactions_paymongo_payment_id
  ON transactions(paymongo_payment_id)
  WHERE paymongo_payment_id IS NOT NULL;
```

### 5.3 New `topup_sessions` Table

```sql
-- Track self-service top-up checkout sessions
CREATE TABLE IF NOT EXISTS topup_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 50 AND amount <= 50000),
  paymongo_checkout_id TEXT NOT NULL,
  paymongo_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'expired', 'failed')),
  payment_method TEXT, -- filled after payment: 'gcash', 'paymaya', 'card'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_topup_sessions_parent_id ON topup_sessions(parent_id);
CREATE INDEX IF NOT EXISTS idx_topup_sessions_checkout_id ON topup_sessions(paymongo_checkout_id);
CREATE INDEX IF NOT EXISTS idx_topup_sessions_status ON topup_sessions(status) WHERE status = 'pending';
```

### 5.4 Update `payment_method` Check Constraint

```sql
-- Add 'paymaya' and 'card' to orders.payment_method
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('cash', 'balance', 'gcash', 'paymaya', 'card', 'paymongo'));

-- Add to transactions.method
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_method_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_method_check
  CHECK (method IN ('cash', 'gcash', 'paymaya', 'card', 'paymongo', 'balance'));

-- Add to cart_state.payment_method
ALTER TABLE cart_state DROP CONSTRAINT IF EXISTS cart_state_payment_method_check;
ALTER TABLE cart_state ADD CONSTRAINT cart_state_payment_method_check
  CHECK (payment_method IN ('cash', 'gcash', 'paymaya', 'card', 'balance'));
```

### 5.5 RLS Policies for `topup_sessions`

```sql
ALTER TABLE topup_sessions ENABLE ROW LEVEL SECURITY;

-- Parents can view their own topup sessions
CREATE POLICY "parents_view_own_topups" ON topup_sessions
  FOR SELECT USING (auth.uid() = parent_id);

-- Only Edge Functions (service_role) can insert/update
-- No INSERT/UPDATE policies for authenticated users
-- edge functions use service_role key which bypasses RLS
```

### 5.6 Extend `payment_due_at` for Online Payments

For GCash/PayMaya/Card orders, the timeout should be **30 minutes** (PayMongo checkout sessions expire in 24h, but we want shorter for stock reservation). For cash orders, keep 15 minutes.

---

## 6. Edge Function Design

### 6.1 `create-checkout` (NEW)

**Purpose**: Create a PayMongo Checkout Session for an order payment.

**Flow**:

1. Receives order details from parent (same as `process-order` input + `payment_method`)
2. Validates everything (same as `process-order`: auth, products, stock, prices, dates)
3. Creates order in DB with `status: 'awaiting_payment'`, `payment_status: 'awaiting_payment'`
4. **Reserves stock** (decrements `stock_quantity`)
5. Calls PayMongo `POST /v1/checkout_sessions` with:
   - `line_items`: order items with names & prices
   - `payment_method_types`: determined by selected method
   - `success_url`: `{APP_URL}/order-confirmation/{order_id}?payment=success`
   - `cancel_url`: `{APP_URL}/order-confirmation/{order_id}?payment=cancelled`
   - `metadata`: `{ order_id, parent_id, type: "order" }`
   - `description`: "School Canteen Order #{short_id}"
6. Saves `paymongo_checkout_id` on the order
7. Returns `{ order_id, checkout_url, payment_due_at }` to frontend

```typescript
// supabase/functions/create-checkout/index.ts

// POST body:
interface CreateCheckoutRequest {
  parent_id: string;
  student_id: string;
  client_order_id: string;
  items: Array<{
    product_id: string;
    quantity: number;
    price_at_order: number;
  }>;
  payment_method: 'gcash' | 'paymaya' | 'card';
  notes?: string;
  scheduled_for?: string;
  meal_period?: string;
}

// Response:
interface CreateCheckoutResponse {
  success: true;
  order_id: string;
  checkout_url: string;     // PayMongo hosted checkout page
  payment_due_at: string;   // ISO timestamp (30 min from now)
}
```

**PayMongo API Call**:

```typescript
const PAYMONGO_SECRET = Deno.env.get('PAYMONGO_SECRET_KEY')!;
const encodedKey = btoa(PAYMONGO_SECRET + ':');

const checkoutResponse = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
  method: 'POST',
  headers: {
    'Authorization': `Basic ${encodedKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  body: JSON.stringify({
    data: {
      attributes: {
        send_email_receipt: true,
        show_description: true,
        show_line_items: true,
        description: `School Canteen Order`,
        line_items: orderItems.map(item => ({
          name: item.product_name,
          quantity: item.quantity,
          amount: Math.round(item.price_at_order * 100), // PayMongo uses centavos
          currency: 'PHP',
        })),
        payment_method_types: mapPaymentMethod(paymentMethod),
        success_url: `${APP_URL}/order-confirmation/${orderId}?payment=success`,
        cancel_url: `${APP_URL}/order-confirmation/${orderId}?payment=cancelled`,
        metadata: {
          order_id: orderId,
          parent_id: parentId,
          client_order_id: clientOrderId,
          type: 'order',
        },
      },
    },
  }),
});
```

**Payment Method Mapping**:

```typescript
function mapPaymentMethod(method: string): string[] {
  switch (method) {
    case 'gcash':   return ['gcash'];
    case 'paymaya': return ['paymaya'];
    case 'card':    return ['card'];
    default:        return ['gcash', 'paymaya', 'card']; // all options
  }
}
```

### 6.2 `paymongo-webhook` (NEW)

**Purpose**: Receive and process PayMongo webhook events.

**Endpoint**: `POST /functions/v1/paymongo-webhook`

**Security**:

- Verify webhook signature using PayMongo's `Paymongo-Signature` header
- Signature format: `t=timestamp,te=test_signature,li=live_signature`
- Compute HMAC-SHA256 of `"{timestamp}.{raw_body}"` using webhook secret key
- Compare against `li` (live) or `te` (test) signature

```typescript
// supabase/functions/paymongo-webhook/index.ts

function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecretKey: string
): boolean {
  const parts = signatureHeader.split(',');
  const timestamp = parts.find(p => p.startsWith('t='))?.slice(2);
  const testSig = parts.find(p => p.startsWith('te='))?.slice(3);
  const liveSig = parts.find(p => p.startsWith('li='))?.slice(3);

  const payload = `${timestamp}.${rawBody}`;
  const expectedSig = hmacSHA256(payload, webhookSecretKey);

  // Check live signature first, fall back to test in dev
  return liveSig === expectedSig || testSig === expectedSig;
}
```

**Handled Events**:

| Event | Action |
| ------- | -------- |
| `checkout_session.payment.paid` | Mark order as paid OR credit wallet for top-ups |
| `payment.failed` | Mark order/topup as failed, restore stock |
| `payment.refunded` | Confirm refund completed |

**`checkout_session.payment.paid` Handler**:

```typescript
async function handlePaymentPaid(event: PayMongoEvent) {
  const checkout = event.data.attributes.data;
  const metadata = checkout.attributes.metadata;

  if (metadata.type === 'order') {
    await handleOrderPayment(metadata.order_id, checkout);
  } else if (metadata.type === 'topup') {
    await handleTopupPayment(metadata.topup_session_id, checkout);
  }
}

async function handleOrderPayment(orderId: string, checkout: any) {
  const paymentId = checkout.attributes.payments?.[0]?.id;
  const paymentMethod = checkout.attributes.payments?.[0]?.attributes?.source?.type;
  // e.g., 'gcash', 'paymaya', 'card'

  // Update order â€” idempotent (check current status first)
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('id, status, payment_status, parent_id, total_amount')
    .eq('id', orderId)
    .single();

  if (!order || order.payment_status === 'paid') {
    return; // Already processed (idempotent)
  }

  await supabaseAdmin
    .from('orders')
    .update({
      status: 'pending',
      payment_status: 'paid',
      paymongo_payment_id: paymentId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId);

  // Create completed transaction record
  await supabaseAdmin
    .from('transactions')
    .insert({
      parent_id: order.parent_id,
      order_id: orderId,
      type: 'payment',
      amount: order.total_amount,
      method: paymentMethod || 'paymongo',
      status: 'completed',
      reference_id: `PAYMONGO-${paymentId}`,
      paymongo_payment_id: paymentId,
      paymongo_checkout_id: checkout.id,
    });
}
```

### 6.3 `create-topup-checkout` (NEW)

**Purpose**: Create a PayMongo Checkout Session for self-service wallet top-up.

```typescript
// POST body:
interface CreateTopupRequest {
  amount: number;  // in PHP, min 50, max 50000
  payment_method?: 'gcash' | 'paymaya' | 'card'; // optional, default: all
}

// Response:
interface CreateTopupResponse {
  success: true;
  topup_session_id: string;
  checkout_url: string;
  expires_at: string;
}
```

**Flow**:

1. Validate parent auth, amount range (â‚±50 â€“ â‚±50,000)
2. Create `topup_sessions` record
3. Call PayMongo `POST /v1/checkout_sessions`:
   - Single line item: "Wallet Top-Up â‚±{amount}"
   - `metadata`: `{ topup_session_id, parent_id, type: "topup" }`
   - `success_url`: `{APP_URL}/balance?topup=success`
   - `cancel_url`: `{APP_URL}/balance?topup=cancelled`
4. Save `paymongo_checkout_id` on `topup_sessions`
5. Return `checkout_url` to frontend

### 6.4 Updates to Existing `process-order`

The existing `process-order` function continues to handle `cash` and `balance` payments. For `gcash`, `paymaya`, and `card`, the frontend calls `create-checkout` instead.

**Modification**: Remove the current GCash stub that marks orders as `paid` immediately. Instead:

- If `payment_method` is `gcash`, `paymaya`, or `card` â†’ return error: "Use create-checkout endpoint for online payments"
- Only `cash` and `balance` remain in `process-order`

### 6.5 Updates to Existing `refund-order`

Add PayMongo refund API call for online payment orders:

```typescript
// After setting order to cancelled/refunded in DB:
if (['gcash', 'paymaya', 'card', 'paymongo'].includes(order.payment_method)) {
  if (order.paymongo_payment_id) {
    const refundResponse = await fetch('https://api.paymongo.com/v1/refunds', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${encodedKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          attributes: {
            amount: Math.round(order.total_amount * 100), // centavos
            payment_id: order.paymongo_payment_id,
            reason: 'requested_by_customer',
            metadata: { order_id: order.id },
          },
        },
      }),
    });

    const refundData = await refundResponse.json();
    // Save refund ID to transaction
    await supabaseAdmin
      .from('transactions')
      .update({ paymongo_refund_id: refundData.data.id })
      .eq('order_id', order.id)
      .eq('type', 'refund');
  }
}
```

### 6.6 Updates to `cleanup-timeout-orders`

Already handles `awaiting_payment` orders. No changes needed â€” it will automatically clean up expired online payment orders that weren't paid within 30 minutes.

### 6.7 `check-payment-status` (NEW, optional)

**Purpose**: Polling endpoint for frontend to check if payment completed (backup for webhook delays).

```typescript
// GET /functions/v1/check-payment-status?order_id=uuid

// Response:
{
  "order_id": "uuid",
  "payment_status": "awaiting_payment" | "paid" | "timeout",
  "order_status": "awaiting_payment" | "pending"
}
```

Simple DB lookup â€” no PayMongo API call. The webhook updates the DB; this just reads it.

---

## 7. Frontend Flow Design

### 7.1 Updated Payment Method Selector

Replace current 3-option selector with expanded options:

```typescript
// src/types/index.ts
export type PaymentMethod = 'cash' | 'balance' | 'gcash' | 'paymaya' | 'card';

// Grouped for UI:
// â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
// â”‚ ðŸ’µ Cash â€” Pay at the canteen        â”‚
// â”‚ ðŸ‘› Wallet Balance â€” â‚±1,250.00       â”‚
// â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
// â”‚     â”€â”€ Pay Online â”€â”€                â”‚
// â”‚ ðŸ“± GCash                            â”‚
// â”‚ ðŸ“± PayMaya                          â”‚
// â”‚ ðŸ’³ Credit/Debit Card               â”‚
// â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Component**: `PaymentMethodSelector.tsx`

- Group into "Pay at School" (cash, balance) and "Pay Online" (gcash, paymaya, card)
- Show GCash/PayMaya logos (SVG icons)
- Card option shows Visa/Mastercard logos
- Disable wallet balance if insufficient funds
- Show "Processing fee may apply" note for card payments

### 7.2 Checkout Flow (Frontend)

```text
Parent taps "Place Order"
         â”‚
         â–¼
   payment_method?
     â”‚         â”‚
  cash/balance  gcash/paymaya/card
     â”‚              â”‚
     â–¼              â–¼
  Call             Call
  process-order   create-checkout
     â”‚              â”‚
     â–¼              â–¼
  Order            Receive
  confirmed        checkout_url
                    â”‚
                    â–¼
              window.location.href = checkout_url
              (redirect to PayMongo)
                    â”‚
                    â–¼
              Parent pays on PayMongo page
                    â”‚
                â”Œâ”€â”€â”€â”´â”€â”€â”€â”€â”
                â–¼        â–¼
           Success    Cancel
                â”‚        â”‚
                â–¼        â–¼
          Redirect    Redirect
          /order-     /order-
          confirm     confirm
          ?payment=   ?payment=
          success     cancelled
                â”‚        â”‚
                â–¼        â–¼
           Poll for    Show
           payment     retry/
           status      cancel
           (3-5s       option
           intervals)
```

### 7.3 Order Confirmation Page Updates

`src/pages/Parent/OrderConfirmation.tsx` needs to handle:

1. **`?payment=success`**: Show "Verifying payment..." spinner, poll `check-payment-status` every 3 seconds (max 60 seconds), then show confirmed state
2. **`?payment=cancelled`**: Show "Payment was cancelled" with options to retry or cancel order
3. **Normal flow** (cash/balance): Keep existing behavior

### 7.4 Balance Page â€” Self-Service Top-Up

`src/pages/Parent/Balance.tsx` â€” Enable the "Top Up" button:

```text
Parent taps "Top Up"
       â”‚
       â–¼
  TopUpModal opens
  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
  â”‚  Top Up Wallet           â”‚
  â”‚                          â”‚
  â”‚  Amount: [â‚±_________]   â”‚
  â”‚                          â”‚
  â”‚  Quick amounts:          â”‚
  â”‚  [â‚±100] [â‚±200] [â‚±500]  â”‚
  â”‚  [â‚±1000] [â‚±2000]       â”‚
  â”‚                          â”‚
  â”‚  Pay via:                â”‚
  â”‚  â—‹ GCash                 â”‚
  â”‚  â—‹ PayMaya               â”‚
  â”‚  â—‹ Credit/Debit Card     â”‚
  â”‚                          â”‚
  â”‚  [Proceed to Payment]    â”‚
  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
       â”‚
       â–¼
  Call create-topup-checkout
       â”‚
       â–¼
  Redirect to PayMongo
       â”‚
       â–¼
  Return to /balance?topup=success
       â”‚
       â–¼
  Webhook credits wallet
  Balance page refreshes
```

### 7.5 New Components

| Component | Purpose |
| ----------- | --------- |
| `TopUpModal.tsx` | Modal with amount selector + payment method for wallet top-ups |
| `PaymentStatusPoller.tsx` | Polls payment status after PayMongo redirect, shows loading/success/failure |
| `OnlinePaymentBadge.tsx` | Shows "Verifying..." / "Paid via GCash" badges on order cards |

### 7.6 Cart Drawer Changes

In `CartDrawer.tsx`:

- When user selects gcash/paymaya/card â†’ update "Place Order" button text to "Pay with GCash" / "Pay with PayMaya" / "Pay with Card"
- Add note: "You'll be redirected to complete payment"
- On submit: call `create-checkout` instead of `process-order`

### 7.7 useCart Hook Changes

In `useCart.ts` `checkout()`:

```typescript
async function checkout() {
  // ... existing grouping logic ...

  for (const group of orderGroups) {
    if (['gcash', 'paymaya', 'card'].includes(paymentMethod)) {
      // Online payment: use create-checkout
      const { data } = await supabase.functions.invoke('create-checkout', {
        body: { ...orderData, payment_method: paymentMethod }
      });
      // Redirect to PayMongo
      window.location.href = data.checkout_url;
      return; // Exit â€” page will redirect
    } else {
      // Cash or balance: use existing process-order
      await createOrder(orderData);
    }
  }
}
```

**Important**: For online payments, only ONE order per checkout session. If the parent has items for multiple students/dates, create separate checkout sessions sequentially, or batch into one checkout with combined line items. Recommended: **one checkout per order** for clean tracking.

---

## 8. Use Case Flows

### 8.1 Parent Pays for Order via GCash

```text
1. Parent browses menu, adds items, opens cart
2. Selects "GCash" payment method
3. Taps "Pay with GCash" button
4. Frontend calls create-checkout edge function
5. Edge function:
   a. Validates order (products, stock, prices, dates)
   b. Creates order: status='awaiting_payment', payment_status='awaiting_payment'
   c. Deducts stock (reserved)
   d. Calls PayMongo API â†’ creates Checkout Session
   e. Returns { order_id, checkout_url }
6. Frontend redirects parent to checkout_url
7. PayMongo shows GCash payment page
8. Parent authorizes payment in GCash app
9. PayMongo confirms payment
10. PayMongo redirects parent back to success_url
11. PayMongo sends webhook to paymongo-webhook edge function
12. Webhook handler:
    a. Verifies signature
    b. Updates order: status='pending', payment_status='paid'
    c. Creates transaction record
13. Frontend (OrderConfirmation) polls check-payment-status
14. Sees payment_status='paid' â†’ shows "Order Confirmed!"
15. Staff sees new pending order in dashboard
```

### 8.2 Parent Tops Up Wallet via PayMaya

```text
1. Parent goes to Balance page, taps "Top Up"
2. TopUpModal opens, parent enters â‚±500, selects PayMaya
3. Frontend calls create-topup-checkout edge function
4. Edge function:
   a. Validates amount (â‚±50â€“â‚±50,000)
   b. Creates topup_sessions record
   c. Calls PayMongo API â†’ creates Checkout Session
   d. Returns { topup_session_id, checkout_url }
5. Frontend redirects to checkout_url
6. PayMongo shows PayMaya payment page
7. Parent pays via PayMaya
8. PayMongo sends webhook
9. Webhook handler:
   a. Verifies signature
   b. Updates topup_sessions: status='paid'
   c. Credits wallet: balance += 500
   d. Creates transaction: type='topup', method='paymaya', amount=500
10. Parent returns to /balance?topup=success
11. Balance page refreshes, shows new balance
```

### 8.3 Parent Pays via Credit Card

Same flow as GCash but:

- `payment_method_types: ['card']` in checkout session
- PayMongo shows card form (number, expiry, CVV)
- Card details never touch our servers
- Higher processing fee (2.5% + â‚±15 vs 2.5% for e-wallets)

### 8.4 Payment Timeout (Abandoned)

```text
1. Parent starts checkout but abandons (closes browser, etc.)
2. Order sits with status='awaiting_payment' for 30 minutes
3. cleanup-timeout-orders cron runs (every 5 min)
4. Finds expired orders â†’ cancels, restores stock
5. Sets payment_status='timeout'
6. (Optional) PayMongo checkout session expires naturally after 24h
```

### 8.5 Admin Refunds a GCash Order

```text
1. Admin selects a completed GCash order to refund
2. Calls refund-order edge function
3. Edge function:
   a. Sets order status='cancelled', payment_status='refunded'
   b. Restores stock
   c. Calls PayMongo Refund API with payment_id
   d. Creates transaction: type='refund', method='gcash'
   e. PayMongo processes refund back to parent's GCash
4. Parent receives GCash refund notification
```

---

## 9. Webhook Security & Handling

### 9.1 Signature Verification

PayMongo signs every webhook with HMAC-SHA256. We MUST verify this.

```typescript
import { crypto } from "https://deno.land/std/crypto/mod.ts";

async function verifySignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string
): Promise<boolean> {
  // Parse header: t=timestamp,te=test_sig,li=live_sig
  const parts: Record<string, string> = {};
  signatureHeader.split(',').forEach(part => {
    const [key, value] = part.split('=');
    parts[key] = value;
  });

  const timestamp = parts['t'];
  if (!timestamp) return false;

  // Check timestamp freshness (reject if > 5 min old)
  const age = Math.abs(Date.now() / 1000 - parseInt(timestamp));
  if (age > 300) return false;

  // Compute expected signature
  const payload = `${timestamp}.${rawBody}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const computed = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Compare (use constant-time comparison in production)
  const expected = parts['li'] || parts['te']; // live or test
  return computed === expected;
}
```

### 9.2 Idempotency

Webhooks may be delivered multiple times. Every handler must be idempotent:

- Check `payment_status` before updating â€” if already `'paid'`, skip
- Use `paymongo_payment_id` as a unique reference

### 9.3 Webhook Registration

Register webhook in PayMongo Dashboard or via API:

```bash
curl -X POST https://api.paymongo.com/v1/webhooks \
  -u "sk_live_xxx:" \
  -d "data[attributes][url]=https://YOUR_SUPABASE_PROJECT.supabase.co/functions/v1/paymongo-webhook" \
  -d "data[attributes][events][]=checkout_session.payment.paid" \
  -d "data[attributes][events][]=payment.failed" \
  -d "data[attributes][events][]=payment.refunded"
```

### 9.4 Webhook Retry Policy

PayMongo retries failed webhooks (non-2xx response) with exponential backoff for up to 3 days. Our webhook handler should:

- Return 200 immediately after successful processing
- Return 200 even for duplicate/already-processed events (idempotent)
- Return 500 only for transient errors (DB down)

---

## 10. Self-Service Wallet Top-Up

### 10.1 Preset Amounts

```typescript
const TOPUP_PRESETS = [100, 200, 500, 1000, 2000, 5000];
const MIN_TOPUP = 50;   // PayMongo minimum is â‚±20, but we set â‚±50 for practical reasons
const MAX_TOPUP = 50000; // Safety limit
```

### 10.2 Top-Up Transaction Record

When webhook confirms top-up payment:

```sql
-- 1. Update topup_sessions
UPDATE topup_sessions SET
  status = 'paid',
  payment_method = 'gcash',  -- actual method from PayMongo
  paymongo_payment_id = 'pay_...',
  completed_at = NOW()
WHERE paymongo_checkout_id = 'cs_...' AND status = 'pending';

-- 2. Credit wallet (with optimistic lock)
UPDATE wallets SET
  balance = balance + 500.00,
  updated_at = NOW()
WHERE user_id = 'parent_uuid';

-- 3. Create transaction record
INSERT INTO transactions (parent_id, type, amount, method, status, reference_id, paymongo_payment_id, paymongo_checkout_id)
VALUES ('parent_uuid', 'topup', 500.00, 'gcash', 'completed', 'TOPUP-cs_xxx', 'pay_xxx', 'cs_xxx');
```

### 10.3 Daily/Weekly Top-Up Limits (Optional, Recommended)

To prevent fraud/money laundering:

```text
Daily limit: â‚±10,000 per parent
Weekly limit: â‚±30,000 per parent
Monthly limit: â‚±100,000 per parent
```

---

## 11. Refund Handling

### 11.1 Refund Matrix

| Original Payment | Refund Method | Automated? |
| ----------------- | --------------- | ------------ |
| Cash | Physical cash (manual) | No â€” admin marks transaction only |
| Balance (wallet) | Credit back to wallet | Yes â€” already implemented |
| GCash | PayMongo Refund â†’ GCash | Yes â€” via PayMongo API |
| PayMaya | PayMongo Refund â†’ PayMaya | Yes â€” via PayMongo API |
| Card | PayMongo Refund â†’ Card | Yes â€” via PayMongo API |

### 11.2 PayMongo Refund API

```typescript
async function createPayMongoRefund(paymentId: string, amountCentavos: number, reason: string) {
  const response = await fetch('https://api.paymongo.com/v1/refunds', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${encodedKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        attributes: {
          amount: amountCentavos,
          payment_id: paymentId,
          reason: reason, // 'requested_by_customer' | 'duplicate' | 'fraudulent'
          notes: 'Canteen order cancellation',
        },
      },
    }),
  });
  return response.json();
}
```

### 11.3 Refund Timing

| Method | Refund Speed |
| -------- | ------------- |
| GCash | Instant to 1 business day |
| PayMaya | 1-3 business days |
| Credit card | 5-10 business days |
| Debit card | 5-10 business days |

Show estimated refund timeframe to parent on cancellation.

### 11.4 Partial Refunds

PayMongo supports partial refunds. Useful for:

- Removing a single item from a multi-item order
- Admin-initiated partial refunds

Not in MVP scope â€” full refunds only for now.

---

## 12. Error Handling & Edge Cases

### 12.1 Payment Failure Scenarios

| Scenario | Handling |
| ---------- | --------- |
| Parent closes browser mid-checkout | Order stays `awaiting_payment`, cleaned up after 30 min |
| GCash insufficient balance | PayMongo shows error, parent can retry |
| Card declined | PayMongo shows error, parent can retry with different card |
| Network error after payment | Webhook still fires â†’ order confirmed. Parent sees "Verifying..." then confirmed |
| Webhook delivery delayed | Frontend polls `check-payment-status` every 3s for 60s |
| Webhook fails to arrive | Fallback: admin can manually verify via PayMongo dashboard + manual order confirmation |
| PayMongo API down | Return friendly error: "Online payments temporarily unavailable. Please use Cash or Wallet Balance." |
| Double-click on pay button | `client_order_id` idempotency key prevents duplicate orders |
| Same checkout session paid twice | PayMongo prevents this; webhook idempotency prevents double-processing |

### 12.2 Stock Reservation Timeout

When an online payment order is created:

1. Stock is **immediately reserved** (decremented)
2. If payment never completes within 30 min â†’ `cleanup-timeout-orders` restores stock
3. This prevents stock from being permanently locked by abandoned checkouts

### 12.3 Race Condition: Webhook vs. Redirect

The parent may return to the app (via success_url redirect) **before** the webhook arrives. Handle this with polling:

```typescript
// In OrderConfirmation.tsx
useEffect(() => {
  if (searchParams.get('payment') === 'success') {
    const interval = setInterval(async () => {
      const status = await checkPaymentStatus(orderId);
      if (status.payment_status === 'paid') {
        clearInterval(interval);
        setPaymentConfirmed(true);
      }
    }, 3000); // Poll every 3 seconds

    // Timeout after 60 seconds
    const timeout = setTimeout(() => {
      clearInterval(interval);
      setPaymentMessage('Payment is being verified. You will be notified once confirmed.');
    }, 60000);

    return () => { clearInterval(interval); clearTimeout(timeout); };
  }
}, []);
```

### 12.4 Offline Handling

Online payments (GCash, PayMaya, Card) **cannot work offline**. If the user is offline:

- Disable GCash/PayMaya/Card options in `PaymentMethodSelector`
- Show note: "Online payments require internet connection"
- Only `cash` and `balance` (if cached) are available offline

---

## 13. Security & Compliance

### 13.1 PCI DSS

Using PayMongo Checkout Sessions means **card details never touch our servers**. We are **SAQ-A** level (simplest compliance). No card data is stored, processed, or transmitted by our application.

### 13.2 Secret Key Management

| Secret | Location | Access |
| -------- | ---------- | -------- |
| `PAYMONGO_SECRET_KEY` | Supabase Edge Function secrets | Edge Functions only |
| `PAYMONGO_PUBLIC_KEY` | Not needed (Checkout Sessions) | N/A |
| `PAYMONGO_WEBHOOK_SECRET` | Supabase Edge Function secrets | Webhook function only |

```bash
# Set secrets via Supabase CLI
supabase secrets set PAYMONGO_SECRET_KEY=sk_live_xxxxx
supabase secrets set PAYMONGO_WEBHOOK_SECRET=whsk_xxxxx
# Optional: for dev/test
supabase secrets set PAYMONGO_SECRET_KEY=sk_test_xxxxx
supabase secrets set PAYMONGO_WEBHOOK_SECRET=whsk_test_xxxxx
```

### 13.3 Philippine Data Privacy Act (DPA) Compliance

- **No card data stored** â€” tokenized by PayMongo
- **Transaction records** contain only reference IDs, not payment credentials
- **Privacy policy** must be updated to disclose PayMongo as a payment processor
- **Data sharing**: Only order amount, description, and metadata shared with PayMongo

### 13.4 BSP (Bangko Sentral) Compliance

PayMongo is a BSP-licensed Electronic Money Issuer (EMI) and Payment System Operator (PSO). By using PayMongo, we inherit their compliance. No separate BSP registration needed for us.

### 13.5 Amount Validation

Always validate amounts server-side:

```typescript
// In create-checkout edge function
const totalCentavos = Math.round(totalAmount * 100);
if (totalCentavos < 2000) { // PayMongo minimum: â‚±20
  return error('Minimum order amount is â‚±20 for online payment');
}
if (totalCentavos > 10000000) { // â‚±100,000 safety limit
  return error('Order amount exceeds maximum');
}
```

---

## 14. Testing Strategy

### 14.1 PayMongo Test Mode

PayMongo provides complete test mode with test API keys (`sk_test_*`).

**Test Cards**:

| Card Number | Result |
| ------------ | -------- |
| `4343 4343 4343 4345` | Successful payment |
| `4444 4444 4444 4457` | Declined (generic) |
| `4242 4242 4242 4242` | 3DSecure required |

**Test E-Wallets**:

- GCash and PayMaya test mode auto-approves with no real money movement

### 14.2 Test Scenarios

| # | Scenario | Expected |
| --- | ---------- | ---------- |
| 1 | Create GCash checkout â†’ complete payment | Order status changes to `pending`, `paid` |
| 2 | Create GCash checkout â†’ abandon payment | Order cancelled after 30 min, stock restored |
| 3 | Create card checkout â†’ use success test card | Payment confirmed via webhook |
| 4 | Create card checkout â†’ use decline test card | Payment failed, error shown |
| 5 | Webhook received for already-paid order | No duplicate processing (idempotent) |
| 6 | Invalid webhook signature | Rejected with 401 |
| 7 | Refund a GCash order | PayMongo refund API called, money returned |
| 8 | Top up â‚±500 via PayMaya | Wallet balance increases by â‚±500 |
| 9 | Top up while offline | Online payment options disabled |
| 10 | Concurrent stock reservation | Only available stock reserved |

### 14.3 Unit Tests

```typescript
// tests/unit/paymongo.test.ts
describe('PayMongo Integration', () => {
  it('should verify valid webhook signature', async () => {});
  it('should reject invalid webhook signature', async () => {});
  it('should reject stale webhook timestamp', async () => {});
  it('should map payment methods correctly', () => {});
  it('should calculate correct centavo amounts', () => {});
  it('should handle idempotent webhook delivery', async () => {});
});
```

### 14.4 Integration Tests

```typescript
// tests/integration/payment-checkout.test.ts
describe('Payment Checkout Flow', () => {
  it('should create checkout session and return URL', async () => {});
  it('should reserve stock on checkout creation', async () => {});
  it('should restore stock on timeout', async () => {});
  it('should reject duplicate client_order_id', async () => {});
  it('should credit wallet on successful topup', async () => {});
});
```

### 14.5 E2E Tests

```typescript
// e2e/payment.spec.ts
describe('Payment E2E', () => {
  it('parent completes GCash order', async () => {
    // Use PayMongo test mode
    // Verify redirect, webhook simulation, order confirmation
  });
  it('parent tops up wallet via card', async () => {});
  it('admin refunds online payment order', async () => {});
});
```

---

## 15. Rollout Plan

### Phase 1: Foundation (Week 1)

- [ ] Create PayMongo account, get test keys
- [ ] Run database migration (new columns + topup_sessions table)
- [ ] Implement `_shared/paymongo.ts` utility (API calls, signature verification)
- [ ] Implement `create-checkout` edge function
- [ ] Implement `paymongo-webhook` edge function
- [ ] Write unit tests for webhook verification

### Phase 2: Order Payments (Week 2)

- [ ] Update `PaymentMethodSelector.tsx` with GCash, PayMaya, Card options
- [ ] Update `useCart.ts` checkout flow for online payments
- [ ] Update `CartDrawer.tsx` UI for online payment methods
- [ ] Update `OrderConfirmation.tsx` with payment polling
- [ ] Update `process-order` to reject gcash/paymaya/card (redirect to create-checkout)
- [ ] Update `refund-order` with PayMongo refund API
- [ ] E2E test: full order â†’ pay â†’ confirm flow

### Phase 3: Wallet Top-Up (Week 3)

- [ ] Implement `create-topup-checkout` edge function
- [ ] Add top-up handling to `paymongo-webhook`
- [ ] Create `TopUpModal.tsx` component
- [ ] Update `Balance.tsx` page (enable top-up button)
- [ ] E2E test: top-up â†’ pay â†’ balance credited

### Phase 4: Polish & Ship (Week 4)

- [ ] Update `OfflineIndicator` to disable online payment when offline
- [ ] Add PayMongo payment method logos/icons
- [ ] Update parent Dashboard to show "Verifying payment..." for in-progress online payments
- [ ] Update admin refund UI to show "Refund will be processed via GCash/PayMaya/Card"
- [ ] Update docs: API.md, ARCHITECTURE.md, SECURITY.md
- [ ] Switch from test keys to live keys
- [ ] Register live webhook URL
- [ ] Deploy to production

### Phase 5: Monitor & Iterate (Ongoing)

- [ ] Monitor webhook success rate
- [ ] Track payment conversion rates
- [ ] Handle edge cases discovered in production
- [ ] Add daily top-up/spend limits if needed

---

## 16. Environment Configuration

### 16.1 Supabase Edge Function Secrets

```bash
# Development (test mode)
supabase secrets set PAYMONGO_SECRET_KEY="sk_test_xxxxxxxxxxxxxxxxxx"
supabase secrets set PAYMONGO_WEBHOOK_SECRET="whsk_test_xxxxxxxxxxxxxxxxxx"
supabase secrets set APP_URL="http://localhost:5173"

# Production (live mode)
supabase secrets set PAYMONGO_SECRET_KEY="sk_live_xxxxxxxxxxxxxxxxxx"
supabase secrets set PAYMONGO_WEBHOOK_SECRET="whsk_live_xxxxxxxxxxxxxxxxxx"
supabase secrets set APP_URL="https://yourapp.vercel.app"
```

### 16.2 PayMongo Dashboard Setup

1. **Sign up** at <https://dashboard.paymongo.com>
2. **Verify business**: Submit documents (DTI/SEC registration, valid ID)
3. **Get API keys**: Settings â†’ API Keys
4. **Create webhook**: Settings â†’ Webhooks â†’ Add endpoint
   - URL: `https://{SUPABASE_PROJECT_REF}.supabase.co/functions/v1/paymongo-webhook`
   - Events: `checkout_session.payment.paid`, `payment.failed`, `payment.refunded`
5. **Note webhook secret**: shown once after creation

### 16.3 Frontend Environment

No frontend environment variables needed â€” all PayMongo interaction happens via Edge Functions. The frontend only receives the `checkout_url` and redirects the user.

---

## 17. Cost Analysis

### 17.1 PayMongo Fees

| Payment Method | Fee | Example (â‚±100 order) |
| --------------- | ----- | ---------------------- |
| GCash | 2.5% | â‚±2.50 |
| PayMaya | 2.5% | â‚±2.50 |
| Credit Card | 2.5% + â‚±15 | â‚±17.50 |
| Debit Card | 2.5% + â‚±15 | â‚±17.50 |

### 17.2 Who Pays the Fee?

**Recommended**: School/canteen absorbs the fee. This is simpler and more parent-friendly.

**Alternative**: Pass fee to parent (add surcharge). Requires showing "Service fee: â‚±2.50" in cart before payment. Note: card brand rules may prohibit surcharging in some cases.

### 17.3 Monthly Cost Estimate

| Metric | Value | Fee Cost |
| -------- | ------- | ---------- |
| 150 daily orders Ã— 22 school days | 3,300 orders/month | |
| 50% use online payments | 1,650 online orders | |
| Average order: â‚±75 | | |
| 80% e-wallet, 20% card | | |
| E-wallet fees: 1,320 Ã— â‚±1.88 | | â‚±2,475 |
| Card fees: 330 Ã— â‚±16.88 | | â‚±5,569 |
| **Total monthly** | | **â‰ˆ â‚±8,044** |

Plus wallet top-up fees (same rates).

---

## 18. File-by-File Implementation Checklist

### New Files to Create

| File | Purpose |
| ------ | --------- |
| `supabase/migrations/20260221_paymongo_integration.sql` | DB migration |
| `supabase/functions/create-checkout/index.ts` | Order checkout session creation |
| `supabase/functions/paymongo-webhook/index.ts` | Webhook receiver |
| `supabase/functions/create-topup-checkout/index.ts` | Wallet top-up checkout |
| `supabase/functions/check-payment-status/index.ts` | Payment status polling |
| `supabase/functions/_shared/paymongo.ts` | PayMongo API utilities |
| `src/components/TopUpModal.tsx` | Self-service top-up modal |
| `src/components/PaymentStatusPoller.tsx` | Payment verification polling |
| `src/services/payments.ts` | Frontend payment service (API calls) |
| `tests/unit/paymongo.test.ts` | Unit tests |
| `tests/integration/payment-checkout.test.ts` | Integration tests |
| `e2e/payment.spec.ts` | E2E tests |

### Files to Modify

| File | Changes |
| ------ | --------- |
| `src/types/index.ts` | Add `'paymaya' \| 'card'` to `PaymentMethod`, add checkout types |
| `src/components/PaymentMethodSelector.tsx` | Add PayMaya, Card options; group by online/offline |
| `src/components/CartDrawer.tsx` | Handle online payment redirect flow |
| `src/hooks/useCart.ts` | Route online payments to `create-checkout` |
| `src/pages/Parent/OrderConfirmation.tsx` | Add payment polling for online payments |
| `src/pages/Parent/Balance.tsx` | Enable top-up button, add TopUpModal |
| `src/pages/Parent/Dashboard.tsx` | Show "Verifying payment" for awaiting_payment online orders |
| `src/services/orders.ts` | Add `createCheckout()` function |
| `src/components/OfflineIndicator.tsx` | Disable online payments when offline |
| `supabase/functions/process-order/index.ts` | Reject gcash/paymaya/card (use create-checkout) |
| `supabase/functions/refund-order/index.ts` | Add PayMongo refund API call |
| `supabase/functions/cleanup-timeout-orders/index.ts` | No changes needed (already handles awaiting_payment) |
| `supabase/consolidated_schema.sql` | Add new columns, table, constraints |
| `docs/API.md` | Document new endpoints |
| `docs/ARCHITECTURE.md` | Update architecture diagram |
| `docs/SECURITY.md` | Add PayMongo security section |

---

## Appendix A: PayMongo API Reference Quick Sheet

### Create Checkout Session

```text
POST https://api.paymongo.com/v1/checkout_sessions
Authorization: Basic base64(sk_key:)
Content-Type: application/json

{
  "data": {
    "attributes": {
      "send_email_receipt": true,
      "show_description": true,
      "show_line_items": true,
      "cancel_url": "https://app.com/cancel",
      "success_url": "https://app.com/success",
      "description": "Order description",
      "line_items": [
        {
          "name": "Chicken Adobo",
          "amount": 7500,        // â‚±75.00 in centavos
          "currency": "PHP",
          "quantity": 1
        }
      ],
      "payment_method_types": ["gcash", "paymaya", "card"],
      "metadata": {
        "order_id": "uuid",
        "type": "order"
      }
    }
  }
}
```

### Create Refund

```text
POST https://api.paymongo.com/v1/refunds
Authorization: Basic base64(sk_key:)
Content-Type: application/json

{
  "data": {
    "attributes": {
      "amount": 7500,           // centavos
      "payment_id": "pay_xxx",
      "reason": "requested_by_customer",
      "notes": "Order cancelled"
    }
  }
}
```

### Webhook Payload (`checkout_session.payment.paid`)

```json
{
  "data": {
    "id": "evt_xxx",
    "type": "event",
    "attributes": {
      "type": "checkout_session.payment.paid",
      "data": {
        "id": "cs_xxx",
        "type": "checkout_session",
        "attributes": {
          "status": "paid",
          "payment_intent": { "id": "pi_xxx" },
          "payments": [{
            "id": "pay_xxx",
            "type": "payment",
            "attributes": {
              "amount": 7500,
              "status": "paid",
              "source": { "type": "gcash" }
            }
          }],
          "metadata": {
            "order_id": "uuid",
            "parent_id": "uuid",
            "type": "order"
          }
        }
      }
    }
  }
}
```

---

## Appendix B: Parent-Facing Terminology

Keep messaging simple and Filipino-friendly:

| Internal Term | Parent-Facing |
| -------------- | --------------- |
| Checkout Session | "Redirecting to payment..." |
| `awaiting_payment` | "Waiting for your payment" |
| Webhook confirmed | "Payment received!" |
| Payment timeout | "Payment expired. Please try again." |
| Refund processing | "Your refund is being processed (1-10 business days)" |
| Wallet top-up | "Load your wallet" |
| PayMongo | Not shown to parents â€” they see "GCash", "PayMaya", or "Card" |

---

## Appendix C: FAQ

**Q: Can parents pay for multiple students/dates in one checkout?**
A: Phase 1 creates one checkout session per order (per student per date). If the cart has items for 2 students, two separate payment flows occur. Future: batch multiple orders into one checkout session with combined line items.

**Q: What if the parent uses GCash but has insufficient GCash balance?**
A: PayMongo handles this â€” shows error on their checkout page. Parent can switch to PayMaya or Card on the same page.

**Q: Can parents save their card for future payments?**
A: Not in MVP. PayMongo supports tokenization for saved cards, but this adds PCI DSS scope considerations. Planned for a future phase.

**Q: What about Maya Checkout (previously PayMaya Checkout)?**
A: PayMongo's unified checkout handles PayMaya/Maya payments. We don't need a separate Maya integration.

**Q: Do we need a separate GCash business account?**
A: No. PayMongo handles GCash payments on our behalf. Funds settle to our PayMongo account, then to our bank.

**Q: What's the settlement period?**
A: PayMongo settles to your bank account T+2 business days for e-wallets, T+7 for cards (default). Can be reduced with verified business account.
