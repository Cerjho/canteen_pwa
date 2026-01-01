# API Reference

## Overview

All backend logic runs on Supabase Edge Functions (Deno runtime). Frontend communicates via:

1. **Supabase Client SDK** for database CRUD
2. **Edge Functions** for complex operations
3. **Realtime Subscriptions** for live updates

## Authentication

All requests require a valid Supabase JWT token in the `Authorization` header:

```text
Authorization: Bearer <jwt_token>
```

Tokens obtained via Supabase Auth SDK after parent login.

---

## Edge Functions

### 1. **POST /functions/v1/process-order**

Process a new order with idempotency.

**Request Body**:

```json
{
  "parent_id": "uuid",
  "child_id": "uuid",
  "client_order_id": "uuid",
  "items": [
    {
      "product_id": "uuid",
      "quantity": 2,
      "price_at_order": 25.00
    }
  ],
  "payment_method": "cash",
  "notes": "No onions"
}
```

**Response (200 OK)**:

```json
{
  "success": true,
  "order_id": "uuid",
  "status": "pending",
  "total_amount": 50.00
}
```

**Error Responses**:

- **400 Bad Request**:

```json
  {
    "error": "INSUFFICIENT_STOCK",
    "message": "Product 'Pancit' out of stock",
    "product_id": "uuid"
  }
```

- **401 Unauthorized**:

```json
  {
    "error": "UNAUTHORIZED",
    "message": "Parent does not own this child"
  }
```

- **409 Conflict**:

```json
  {
    "error": "DUPLICATE_ORDER",
    "message": "Order with this client_order_id already exists",
    "existing_order_id": "uuid"
  }
```

**Idempotency**: If `client_order_id` already exists, returns existing order details with 409 status.

---

### 2. **POST /functions/v1/refund-order**

Refund an order and restore inventory (admin only).

**Request Body**:

```json
{
  "order_id": "uuid",
  "reason": "Customer request"
}
```

**Response (200 OK)**:

```json
{
  "success": true,
  "refunded_amount": 50.00,
  "transaction_id": "uuid"
}
```

**Error Responses**:

- **403 Forbidden**: Non-admin user
- **404 Not Found**: Order not found
- **400 Bad Request**: Order already refunded

---

### 3. **POST /functions/v1/notify**

Send notification to parent (push/SMS).

**Request Body**:

```json
{
  "parent_id": "uuid",
  "type": "order_ready",
  "order_id": "uuid",
  "message": "Your order #1234 is ready for pickup"
}
```

**Response (200 OK)**:

```json
{
  "success": true,
  "channels": ["push", "sms"],
  "message_id": "uuid"
}
```

**Notification Types**:

- `order_received`
- `order_preparing`
- `order_ready`
- `order_cancelled`
- `low_balance`

---

### 4. **POST /functions/v1/manage-student**

Admin-only student management (add, update, delete, unlink, import).

**Request Body** (Add):

```json
{
  "action": "add",
  "data": {
    "first_name": "John",
    "last_name": "Doe",
    "grade_level": "Grade 1",
    "section": "A",
    "dietary_restrictions": "None"
  }
}
```

**Request Body** (Update):

```json
{
  "action": "update",
  "student_id": "uuid",
  "data": {
    "first_name": "John",
    "last_name": "Doe",
    "grade_level": "Grade 2",
    "section": "B"
  }
}
```

**Request Body** (Delete):

```json
{
  "action": "delete",
  "student_id": "uuid"
}
```

**Request Body** (Unlink):

```json
{
  "action": "unlink",
  "student_id": "uuid"
}
```

**Request Body** (Import):

```json
{
  "action": "import",
  "students": [
    { "first_name": "John", "last_name": "Doe", "grade_level": "Grade 1", "section": "A" },
    { "first_name": "Jane", "last_name": "Smith", "grade_level": "Grade 2" }
  ]
}
```

**Response (200 OK)**:

```json
{
  "success": true,
  "student": { "id": "uuid", "student_id": "26-00001", ... }
}
```

**Import Response**:

```json
{
  "success": true,
  "imported": 10,
  "failed": 2,
  "errors": ["Row 5: Invalid grade level"]
}
```

**Error Responses**:

- **403 Forbidden**: Non-admin user
- **400 Bad Request**: Validation error
- **404 Not Found**: Student not found
- **400 Constraint Error**: Cannot delete student with orders

**Security**:
- Validates admin role from JWT token
- Sanitizes all input strings
- Server-side student ID generation
- Validates grade levels against whitelist

---

### 5. **POST /functions/v1/link-student**

Parent linking/unlinking students.

**Request Body** (Link):

```json
{
  "action": "link",
  "student_id": "26-00001"
}
```

**Request Body** (Unlink):

```json
{
  "action": "unlink",
  "student_id": "uuid"
}
```

**Response (200 OK)**:

```json
{
  "success": true,
  "student": {
    "id": "uuid",
    "student_id": "26-00001",
    "first_name": "John",
    "last_name": "Doe",
    "grade_level": "Grade 1"
  }
}
```

**Error Responses**:

- **404 Not Found**: Student ID not found
- **400 Already Linked**: Student already linked to parent
- **400 Limit Reached**: Max 10 children per parent
- **403 Forbidden**: Attempting to unlink other's child

**Security**:
- Verifies parent role from JWT
- Prevents linking already-linked students
- Race condition protection on link operation
- Only allows unlinking own children
- Logs security events

---

### 6. **POST /functions/v1/update-dietary**

Parent updates child's dietary restrictions.

**Request Body**:

```json
{
  "child_id": "uuid",
  "dietary_restrictions": "No peanuts, lactose intolerant"
}
```

**Response (200 OK)**:

```json
{
  "success": true,
  "child": {
    "id": "uuid",
    "student_id": "26-00001",
    "first_name": "John",
    "dietary_restrictions": "No peanuts, lactose intolerant"
  }
}
```

**Error Responses**:

- **403 Forbidden**: Not the child's parent
- **404 Not Found**: Child not found

**Security**:
- Verifies parent owns the child
- Sanitizes input (max 500 chars, strips HTML)
- Only allows dietary_restrictions update

---

## Database Access (Supabase Client SDK)

### Products

**Fetch Menu**:

```typescript
const { data, error } = await supabase
  .from('products')
  .select('*')
  .eq('available', true)
  .order('category', { ascending: true });
```

**Response**:

```json
[
  {
    "id": "uuid",
    "name": "Chicken Adobo",
    "description": "Classic Filipino dish",
    "price": 45.00,
    "category": "mains",
    "image_url": "https://...",
    "available": true,
    "stock_quantity": 20
  }
]
```

---

### Children

**Fetch Parent's Children**:

```typescript
const { data, error } = await supabase
  .from('children')
  .select('*')
  .eq('parent_id', parentId);
```

**Response**:

```json
[
  {
    "id": "uuid",
    "parent_id": "uuid",
    "first_name": "Juan",
    "last_name": "Dela Cruz",
    "grade_level": "Grade 3",
    "section": "A",
    "dietary_restrictions": "No shellfish"
  }
]
```

**Add Child**:

```typescript
const { data, error } = await supabase
  .from('children')
  .insert({
    parent_id: parentId,
    first_name: 'Maria',
    last_name: 'Santos',
    grade_level: 'Grade 1',
    section: 'B'
  })
  .select()
  .single();
```

---

### Orders

**Fetch Order History**:

```typescript
const { data, error } = await supabase
  .from('orders')
  .select(`
    *,
    child:children(first_name, last_name),
    items:order_items(
      *,
      product:products(name, image_url)
    )
  `)
  .eq('parent_id', parentId)
  .order('created_at', { ascending: false })
  .limit(20);
```

**Response**:

```json
[
  {
    "id": "uuid",
    "parent_id": "uuid",
    "child_id": "uuid",
    "client_order_id": "uuid",
    "status": "ready",
    "total_amount": 50.00,
    "payment_method": "cash",
    "created_at": "2026-01-01T08:00:00Z",
    "child": {
      "first_name": "Juan",
      "last_name": "Dela Cruz"
    },
    "items": [
      {
        "product_id": "uuid",
        "quantity": 2,
        "price_at_order": 25.00,
        "product": {
          "name": "Pancit Canton",
          "image_url": "https://..."
        }
      }
    ]
  }
]
```

---

## Realtime Subscriptions

**Subscribe to Order Updates**:

```typescript
const subscription = supabase
  .channel('order_updates')
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'orders',
      filter: `parent_id=eq.${parentId}`
    },
    (payload) => {
      console.log('Order updated:', payload.new);
    }
  )
  .subscribe();
```

---

## Error Codes

| Code | Description |
| ---- | ----------- |
| `INSUFFICIENT_STOCK` | Product out of stock |
| `UNAUTHORIZED` | User lacks permission |
| `DUPLICATE_ORDER` | Order already processed |
| `INVALID_CHILD` | Child does not belong to parent |
| `PAYMENT_FAILED` | Payment processing error |
| `VALIDATION_ERROR` | Invalid request data |

---

## Rate Limiting

Edge Functions are rate-limited to:

- 100 requests/minute per user
- 1000 requests/hour per IP

Clients should implement exponential backoff on 429 responses.

---

## Webhooks (Future)

Placeholder for payment provider webhooks:

- **POST /functions/v1/webhook/gcash**
- **POST /functions/v1/webhook/paymongo**

TODO: Implement webhook signature verification.
