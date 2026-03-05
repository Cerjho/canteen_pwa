# API Reference

## Overview

The Loheca Canteen PWA backend runs on **Supabase Edge Functions** (Deno) and the **Supabase Client SDK**. All edge functions require JWT authentication via the `Authorization: Bearer <token>` header. The Supabase anon key is passed as `apikey` header.

**Base URL**: `https://<project-ref>.supabase.co/functions/v1`

**Payment methods**: `cash`, `gcash`, `paymaya`, `card` (no wallet/balance)

**Timezone**: All date/time logic uses `Asia/Manila` (UTC+8)

---

## Authentication

All API calls use Supabase Auth JWT tokens. Include both headers:

```text
Authorization: Bearer <user-jwt>
apikey: <supabase-anon-key>
```

---

## Edge Functions — Orders

### POST `/functions/v1/process-weekly-order`

Create a weekly pre-order (Mon–Fri) for a student. Enforces cutoff time.

**Auth**: Parent

**Body**:

```json
{
  "student_id": "uuid",
  "week_start": "2025-03-10",
  "payment_method": "cash",
  "items": {
    "2025-03-10": [{ "product_id": "uuid", "quantity": 1, "meal_period": "lunch" }],
    "2025-03-11": [{ "product_id": "uuid", "quantity": 2, "meal_period": "morning_snack" }]
  },
  "notes": "No peanuts please"
}
```

**Response** `200`:

```json
{
  "weekly_order_id": "uuid",
  "daily_order_ids": ["uuid", "uuid"],
  "total_amount": 150.00
}
```

**Errors**: `400` cutoff passed, `403` parent doesn't own student, `409` duplicate week

---

### POST `/functions/v1/create-weekly-checkout`

Create a PayMongo checkout session for a weekly order total.

**Auth**: Parent

**Body**:

```json
{
  "student_id": "uuid",
  "week_start": "2025-03-10",
  "payment_method": "gcash",
  "items": { ... },
  "success_url": "https://app.example.com/orders?status=success",
  "cancel_url": "https://app.example.com/orders?status=cancelled"
}
```

**Response** `200`:

```json
{
  "checkout_url": "https://checkout.paymongo.com/...",
  "weekly_order_id": "uuid",
  "checkout_id": "cs_xxx"
}
```

---

### POST `/functions/v1/process-batch-order`

Create multiple individual orders in a batch (non-weekly).

**Auth**: Parent

**Body**:

```json
{
  "orders": [
    {
      "student_id": "uuid",
      "items": [{ "product_id": "uuid", "quantity": 1, "meal_period": "lunch" }],
      "scheduled_for": "2025-03-12",
      "payment_method": "cash",
      "notes": ""
    }
  ]
}
```

---

### POST `/functions/v1/create-batch-checkout`

Create a PayMongo checkout session for a batch of orders.

**Auth**: Parent

**Body**:

```json
{
  "orders": [...],
  "payment_method": "gcash",
  "success_url": "...",
  "cancel_url": "..."
}
```

**Response** `200`:

```json
{
  "checkout_url": "https://checkout.paymongo.com/...",
  "checkout_id": "cs_xxx",
  "payment_group_id": "uuid",
  "order_ids": ["uuid", "uuid"]
}
```

---

### POST `/functions/v1/create-checkout`

Create a PayMongo checkout for a single order (surplus/walk-in).

**Auth**: Parent

**Body**:

```json
{
  "order_id": "uuid",
  "payment_method": "gcash",
  "success_url": "...",
  "cancel_url": "..."
}
```

---

### POST `/functions/v1/process-surplus-order`

Create an order for a surplus item (same-day, before 8 AM cutoff).

**Auth**: Parent

**Body**:

```json
{
  "student_id": "uuid",
  "surplus_item_id": "uuid",
  "quantity": 1,
  "payment_method": "cash"
}
```

---

### POST `/functions/v1/staff-place-order`

Staff creates an order on behalf of a student (walk-in/counter).

**Auth**: Staff/Admin

**Body**:

```json
{
  "student_id": "uuid",
  "items": [{ "product_id": "uuid", "quantity": 1, "meal_period": "lunch" }],
  "payment_method": "cash",
  "scheduled_for": "2025-03-12"
}
```

---

### POST `/functions/v1/retry-checkout`

Retry a failed/expired PayMongo checkout session.

**Auth**: Parent

**Body**:

```json
{
  "order_id": "uuid",
  "payment_method": "gcash",
  "success_url": "...",
  "cancel_url": "..."
}
```

---

## Edge Functions — Order Management

### POST `/functions/v1/manage-order`

Update an order's status (prepare, ready, complete, cancel).

**Auth**: Staff/Admin

**Body**:

```json
{
  "order_id": "uuid",
  "action": "prepare" | "ready" | "complete" | "cancel",
  "staff_notes": "optional notes"
}
```

**Status transitions enforced**:

- `awaiting_payment` → `pending`, `cancelled`
- `pending` → `preparing`, `cancelled`
- `preparing` → `ready`, `cancelled`
- `ready` → `completed`, `cancelled`

---

### POST `/functions/v1/parent-cancel-order`

Parent cancels a specific day's order (before 8 AM cutoff on that day).

**Auth**: Parent

**Body**:

```json
{
  "order_id": "uuid"
}
```

**Errors**: `400` past 8 AM cutoff, `403` not parent's order

---

### POST `/functions/v1/confirm-cash-payment`

Staff confirms a cash payment was received.

**Auth**: Staff/Admin

**Body**:

```json
{
  "order_id": "uuid"
}
```

---

### POST `/functions/v1/refund-order`

Admin refunds an order. For online payments, initiates PayMongo refund.

**Auth**: Admin only

**Body**:

```json
{
  "order_id": "uuid",
  "reason": "Customer request"
}
```

---

## Edge Functions — Payments

### POST `/functions/v1/check-payment-status`

Self-healing: checks PayMongo for payment status and syncs to DB.

**Auth**: Parent or System

**Body**:

```json
{
  "order_id": "uuid"
}
```

**Response** `200`:

```json
{
  "status": "paid",
  "payment_method": "gcash"
}
```

---

### POST `/functions/v1/paymongo-webhook`

Receives PayMongo webhook events. Validates signature. Updates order/payment status.

**Auth**: PayMongo signature verification (no JWT)

**Events handled**:

- `checkout_session.payment.paid` → marks orders as paid
- `payment.failed` → marks orders as failed
- `payment.refunded` → marks orders as refunded

All orders sharing the same `payment_group_id` are updated together.

---

### POST `/functions/v1/cleanup-timeout-orders`

Cron job: expires unpaid orders past their `payment_due_at` deadline.

**Auth**: Service role (cron)

**Behavior**: Sets `status = 'cancelled'`, `payment_status = 'timeout'` for expired orders.

---

## Edge Functions — Students

### POST `/functions/v1/manage-student`

Admin-only student management (CRUD + CSV import).

**Auth**: Admin only

**Body (add)**:

```json
{
  "action": "add",
  "first_name": "Juan",
  "last_name": "Cruz",
  "grade_level": "Grade 1",
  "section": "A"
}
```

**Body (import)**:

```json
{
  "action": "import",
  "students": [
    { "first_name": "Juan", "last_name": "Cruz", "grade_level": "Grade 1", "section": "A" }
  ]
}
```

**Actions**: `add`, `update`, `delete`, `unlink`, `import`

---

### POST `/functions/v1/link-student`

Parent links/unlinks a student using their Student ID.

**Auth**: Parent

**Body (link)**:

```json
{
  "action": "link",
  "student_id_text": "25-00001"
}
```

**Body (unlink)**:

```json
{
  "action": "unlink",
  "student_uuid": "uuid"
}
```

---

### POST `/functions/v1/update-dietary`

Parent updates a linked student's dietary restrictions.

**Auth**: Parent

**Body**:

```json
{
  "student_id": "uuid",
  "dietary_restrictions": "No peanuts, lactose intolerant"
}
```

---

## Edge Functions — Products & Menu

### POST `/functions/v1/manage-product`

Staff/Admin creates or updates a product.

**Auth**: Staff/Admin

**Body**:

```json
{
  "action": "create" | "update" | "delete",
  "id": "uuid (for update/delete)",
  "name": "Chicken Adobo",
  "price": 45.00,
  "category": "mains",
  "available": true,
  "description": "...",
  "image_url": "..."
}
```

---

### POST `/functions/v1/manage-menu`

Manage weekly menu assignments (which products are available on which days).

**Auth**: Staff/Admin

---

### POST `/functions/v1/manage-calendar`

Manage school calendar (holidays, special events affecting ordering).

**Auth**: Admin

---

### POST `/functions/v1/staff-product`

Staff-specific product operations (toggle availability, etc.).

**Auth**: Staff

---

## Edge Functions — User Management

### POST `/functions/v1/register`

Register a new parent account.

**Body**:

```json
{
  "email": "parent@example.com",
  "password": "securePassword123",
  "first_name": "Maria",
  "last_name": "Cruz",
  "phone_number": "09171234567"
}
```

---

### POST `/functions/v1/create-user`

Admin creates a new staff or admin user.

**Auth**: Admin only

**Body**:

```json
{
  "email": "staff@school.edu",
  "password": "tempPassword123",
  "first_name": "Staff",
  "last_name": "Member",
  "role": "staff"
}
```

---

### POST `/functions/v1/manage-profile`

Update user profile information.

**Auth**: Authenticated user

---

### POST `/functions/v1/list-staff`

List all staff/admin users.

**Auth**: Admin only

---

### POST `/functions/v1/send-invites`

Send invitation emails to prospective parents.

**Auth**: Admin

---

### POST `/functions/v1/verify-invitation`

Verify an invitation code during registration.

---

## Edge Functions — System

### POST `/functions/v1/manage-settings`

Admin manages system settings (cutoff times, maintenance mode, etc.).

**Auth**: Admin only

**Body**:

```json
{
  "action": "update",
  "key": "weekly_cutoff_time",
  "value": "17:00"
}
```

---

### POST `/functions/v1/notify`

Send push/SMS notification to a parent.

**Auth**: Staff/Admin

**Body**:

```json
{
  "parent_id": "uuid",
  "title": "Order Ready",
  "message": "Your child's lunch order is ready for pickup",
  "channel": "push"
}
```

---

## Database Access (Supabase Client SDK)

These queries use the Supabase JS client directly (not edge functions).

### Fetch Products

```typescript
const { data } = await supabase
  .from('products')
  .select('*')
  .eq('available', true)
  .order('category');
```

### Fetch Linked Students

```typescript
const { data } = await supabase
  .from('parent_students')
  .select('*, student:students(*)')
  .eq('parent_id', userId);
```

### Fetch Order History

```typescript
const { data } = await supabase
  .from('orders')
  .select(`
    *,
    student:students!orders_student_id_fkey(id, first_name, last_name),
    items:order_items(*, product:products(name, image_url, category))
  `)
  .eq('parent_id', userId)
  .order('created_at', { ascending: false });
```

### Fetch Weekly Orders

```typescript
const { data } = await supabase
  .from('weekly_orders')
  .select(`
    *,
    student:students(*),
    daily_orders:orders(*, items:order_items(*, product:products(*)))
  `)
  .eq('parent_id', userId)
  .order('week_start', { ascending: false });
```

---

## Realtime Subscriptions

### Order Status Updates

```typescript
supabase
  .channel('order-updates')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'orders',
    filter: `parent_id=eq.${userId}`,
  }, (payload) => {
    // Handle status change
  })
  .subscribe();
```

---

## Error Codes

| Code | Meaning |
| ---- | ------- |
| `400` | Bad request / validation error / cutoff passed |
| `401` | Unauthorized (missing or invalid JWT) |
| `403` | Forbidden (role check failed, not owner) |
| `404` | Resource not found |
| `409` | Conflict (duplicate order, idempotency) |
| `422` | Unprocessable entity |
| `429` | Rate limited |
| `500` | Internal server error |

---

## Rate Limiting

Supabase imposes default rate limits on Edge Functions. Custom rate limiting is not currently implemented at the application level. PayMongo webhook endpoint has no rate limit (signature verification provides security).

---

## Payment Status Values

| Status | Meaning |
| ------ | ------- |
| `awaiting_payment` | Order created, waiting for payment |
| `paid` | Payment confirmed |
| `timeout` | Payment deadline passed without confirmation |
| `refunded` | Payment refunded |
| `failed` | Payment attempt failed |

---

## Order Status Transitions (DB-Enforced)

```text
awaiting_payment ──► pending ──► preparing ──► ready ──► completed
       │                │           │          │
       └── cancelled ◄──┴───────────┴──────────┘
```

Enforced by `validate_order_status_transition` trigger at the database level.
