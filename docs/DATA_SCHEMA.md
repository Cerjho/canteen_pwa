# Database Schema

## Overview

Supabase Postgres database with 9 core tables enforcing referential integrity and Row Level Security. The schema supports weekly pre-ordering with cash and online (PayMongo) payment methods. There is no wallet/balance system and no stock tracking.

---

## Entity Relationship Diagram

```text
┌──────────────────┐
│  user_profiles   │
└────────┬─────────┘
         │ 1
         │
         │ N
┌────────▼─────────┐     N ┌──────────────────┐
│ parent_students  ├───────►    students      │
└──────────────────┘       └──────────────────┘
         │                         │
         │                         │ 1
         │                         │
         │            ┌────────────▼─────────────┐
         │            │      weekly_orders       │
         │            └────────────┬─────────────┘
         │                         │ 1
         │                         │
         │                         │ N
         │                  ┌──────▼──────┐
         └─────────────────►│   orders    │
                            └──────┬──────┘
                                   │ 1
                                   │
                                   │ N
                            ┌──────▼──────────┐
                            │  order_items    │
                            └──────┬──────────┘
                                   │ N
                                   │ 1
                            ┌──────▼──────┐
                            │  products   │
                            └─────────────┘

┌──────────────┐      ┌──────────────────────┐
│   payments   │─────►│ payment_allocations  │  (linked to orders)
└──────────────┘      └──────────────────────┘

┌───────────────┐
│ surplus_items │───► products
└───────────────┘
```

---

## Tables

### **user_profiles**

Stores parent/guardian accounts. Synced with Supabase Auth via trigger.

| Column | Type | Constraints | Description |
| ------ | ---- | ----------- | ----------- |
| `id` | uuid | PRIMARY KEY | Matches `auth.users.id` |
| `email` | text | UNIQUE, NOT NULL | Parent email |
| `phone_number` | text | | Philippine mobile number |
| `first_name` | text | NOT NULL | |
| `last_name` | text | NOT NULL | |
| `role` | text | NOT NULL, DEFAULT 'parent' | 'parent', 'staff', 'admin' |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |

**Indexes**: `email`

**RLS**: Users can only read/update their own record. Admins can read all.

---

### **students**

Student profiles managed by school admin, linked by parents via `parent_students`.

| Column | Type | Constraints | Description |
| ------ | ---- | ----------- | ----------- |
| `id` | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | |
| `student_id` | text | UNIQUE, NOT NULL | Auto-generated ID (YY-XXXXX format) |
| `first_name` | text | NOT NULL | |
| `last_name` | text | NOT NULL | |
| `grade_level` | text | NOT NULL | e.g., "Grade 1" |
| `section` | text | | e.g., "A" |
| `dietary_restrictions` | text | | Allergies, preferences |
| `is_active` | boolean | DEFAULT true | Soft-delete flag |
| `created_by` | uuid | FOREIGN KEY → auth.users(id) | Admin who created the record |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |

**Indexes**: `student_id` (UNIQUE)

**RLS Policies**:

- **Admins**: Full CRUD access to all students
- **Parents**: Can view linked students, link unlinked students by student_id, update dietary info only
- **Staff**: Can view all students (for order processing)

**Note**: Students are added by school administrators only. Parents link to existing students using the Student ID provided by the school.

---

### **parent_students**

Join table linking parents to students (many-to-many).

| Column | Type | Constraints | Description |
| ------ | ---- | ----------- | ----------- |
| `id` | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | |
| `parent_id` | uuid | FOREIGN KEY → user_profiles(id), NOT NULL | |
| `student_id` | uuid | FOREIGN KEY → students(id), NOT NULL | |
| `relationship` | text | | e.g., "mother", "father", "guardian" |
| `is_primary` | boolean | DEFAULT true | Primary guardian flag |
| `linked_at` | timestamptz | DEFAULT now() | |

**Indexes**: `parent_id`, `student_id`

**Unique constraint**: `(parent_id, student_id)` — prevents duplicate links

**RLS**: Parents can read/insert/delete their own links.

---

### **products**

Canteen menu items. No stock tracking — only an `available` boolean toggle.

| Column | Type | Constraints | Description |
| ------ | ---- | ----------- | ----------- |
| `id` | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | |
| `name` | text | NOT NULL | e.g., "Chicken Adobo" |
| `description` | text | | |
| `price` | numeric(10,2) | NOT NULL | Price in PHP |
| `category` | text | NOT NULL | "mains", "snacks", "drinks" |
| `image_url` | text | | Product photo URL |
| `available` | boolean | DEFAULT true | Whether item can be ordered |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |

**Indexes**: `category`, `available`

**RLS**: Public read, staff/admin write.

---

### **weekly_orders**

Aggregate container for a parent's weekly pre-order (Mon–Fri). Links to individual daily `orders`.

| Column | Type | Constraints | Description |
| ------ | ---- | ----------- | ----------- |
| `id` | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | |
| `parent_id` | uuid | FOREIGN KEY → user_profiles(id), NOT NULL | |
| `student_id` | uuid | FOREIGN KEY → students(id), NOT NULL | |
| `week_start` | date | NOT NULL | Monday of the order week |
| `status` | text | NOT NULL, DEFAULT 'submitted' | "submitted", "active", "completed", "cancelled" |
| `total_amount` | numeric(10,2) | NOT NULL | Sum of all daily orders |
| `payment_method` | text | NOT NULL | "cash", "gcash", "paymaya", "card" |
| `payment_status` | payment_status | DEFAULT 'awaiting_payment' | "awaiting_payment", "paid", "timeout", "refunded", "failed" |
| `paymongo_checkout_id` | text | | PayMongo checkout session ID |
| `paymongo_checkout_url` | text | | PayMongo redirect URL |
| `payment_due_at` | timestamptz | | Payment deadline |
| `notes` | text | | General order notes |
| `submitted_at` | timestamptz | | When parent submitted the order |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |

**Indexes**: `parent_id`, `student_id`, `week_start`, `status`

**Unique constraint**: `(parent_id, student_id, week_start)` — one weekly order per student per week

**RLS**: Parents see only their own weekly orders.

---

### **orders**

Individual daily orders. May belong to a `weekly_order` (pre-orders) or be standalone (surplus/walk-in).

| Column | Type | Constraints | Description |
| ------ | ---- | ----------- | ----------- |
| `id` | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | |
| `parent_id` | uuid | FOREIGN KEY → user_profiles(id), NOT NULL | |
| `student_id` | uuid | FOREIGN KEY → students(id), NOT NULL | |
| `client_order_id` | uuid | UNIQUE, NOT NULL | Idempotency key |
| `weekly_order_id` | uuid | FOREIGN KEY → weekly_orders(id) | NULL for surplus/walk-in |
| `order_type` | text | DEFAULT 'pre_order' | "pre_order", "surplus", "walk_in" |
| `status` | text | NOT NULL, DEFAULT 'pending' | "pending", "preparing", "ready", "completed", "cancelled", "awaiting_payment" |
| `total_amount` | numeric(10,2) | NOT NULL | |
| `payment_method` | text | NOT NULL | "cash", "gcash", "paymaya", "card" |
| `payment_status` | payment_status | DEFAULT 'paid' | "awaiting_payment", "paid", "timeout", "refunded", "failed" |
| `payment_due_at` | timestamptz | | Deadline for payment (cash: 4hrs, online: 30min) |
| `payment_group_id` | uuid | | Groups batch orders for shared payment tracking |
| `paymongo_checkout_id` | text | | PayMongo checkout session ID |
| `paymongo_payment_id` | text | | PayMongo payment ID (set after payment confirmed) |
| `notes` | text | | Special instructions |
| `scheduled_for` | date | NOT NULL | Delivery/preparation date |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |
| `completed_at` | timestamptz | | Fulfillment timestamp |

**Indexes**:

- `parent_id`, `student_id`, `status`, `created_at` (DESC)
- `client_order_id` (UNIQUE)
- `payment_status` WHERE `payment_status = 'awaiting_payment'`
- `payment_group_id` WHERE NOT NULL
- `paymongo_checkout_id` WHERE NOT NULL
- `weekly_order_id` WHERE NOT NULL
- `scheduled_for`

**RLS**: Parents see only their orders, staff/admin see all.

**Constraints**:

- CHECK: `status IN ('awaiting_payment', 'pending', 'preparing', 'ready', 'completed', 'cancelled')`
- CHECK: `payment_method IN ('cash', 'gcash', 'paymaya', 'card')`

**Triggers**:

- `validate_order_status_transition` — Enforces valid status transitions:
  - `awaiting_payment` → `pending`, `cancelled`
  - `pending` → `preparing`, `cancelled`
  - `preparing` → `ready`, `cancelled`
  - `ready` → `completed`, `cancelled`
  - `completed` and `cancelled` are terminal states

---

### **order_items**

Line items for each order.

| Column | Type | Constraints | Description |
| ------ | ---- | ----------- | ----------- |
| `id` | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | |
| `order_id` | uuid | FOREIGN KEY → orders(id), NOT NULL | |
| `product_id` | uuid | FOREIGN KEY → products(id), NOT NULL | |
| `quantity` | integer | NOT NULL, CHECK > 0 | |
| `price_at_order` | numeric(10,2) | NOT NULL | Historical price at time of order |
| `status` | text | DEFAULT 'confirmed' | "confirmed", "unavailable" |
| `meal_period` | text | | "morning_snack", "lunch", "afternoon_snack" |
| `created_at` | timestamptz | DEFAULT now() | |

**Indexes**: `order_id`

**Unique constraint**: `(order_id, product_id, meal_period)` — prevents duplicate items

**RLS**: Accessible via parent's orders.

---

### **surplus_items**

Leftover items marked by staff for same-day ordering.

| Column | Type | Constraints | Description |
| ------ | ---- | ----------- | ----------- |
| `id` | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | |
| `product_id` | uuid | FOREIGN KEY → products(id), NOT NULL | |
| `scheduled_date` | date | NOT NULL | Date the surplus is available |
| `meal_period` | text | | "morning_snack", "lunch", "afternoon_snack" |
| `quantity_available` | integer | NOT NULL, CHECK > 0 | |
| `marked_by` | uuid | FOREIGN KEY → auth.users(id) | Staff who marked the surplus |
| `is_active` | boolean | DEFAULT true | Whether still available |
| `created_at` | timestamptz | DEFAULT now() | |

**Indexes**: `product_id`, `scheduled_date`, `is_active`

**RLS**: Public read, staff/admin write.

---

### **payments**

One row per real money movement (payment or refund).

| Column | Type | Constraints | Description |
| ------ | ---- | ----------- | ----------- |
| `id` | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | |
| `parent_id` | uuid | FOREIGN KEY → user_profiles(id), NOT NULL | **Immutable** after insert |
| `type` | text | NOT NULL | "payment", "refund" — **immutable** after insert |
| `amount_total` | numeric(10,2) | NOT NULL | Total payment amount — **immutable** after insert |
| `method` | text | NOT NULL | "cash", "gcash", "paymaya", "card" |
| `status` | text | NOT NULL, DEFAULT 'pending' | "pending", "completed", "failed" — guarded transitions only |
| `external_ref` | text | | External reference (e.g. PAYMONGO-xxx) |
| `paymongo_checkout_id` | text | UNIQUE (partial, non-null) | PayMongo checkout session ID |
| `paymongo_payment_id` | text | UNIQUE (partial, non-null) | PayMongo payment ID |
| `paymongo_refund_id` | text | UNIQUE (partial, non-null) | PayMongo refund ID |
| `payment_group_id` | text | | Groups payments from batch checkout |
| `weekly_order_id` | uuid | FOREIGN KEY → weekly_orders(id) | Links payment to weekly order |
| `reference_id` | text | | Internal reference ID |
| `original_payment_id` | uuid | FOREIGN KEY → payments(id) | For refunds: links back to original payment |
| `metadata` | jsonb | DEFAULT '{}' | Flexible key-value data |
| `created_at` | timestamptz | DEFAULT now() | |

**Indexes**: `parent_id`, `status`, `type`, `payment_group_id`, `paymongo_checkout_id`, `paymongo_payment_id`, `original_payment_id`, `created_at`

**Unique indexes**: `paymongo_payment_id`, `paymongo_checkout_id`, `paymongo_refund_id` (partial, WHERE NOT NULL — prevents webhook double-insert)

**Triggers**:

- `trg_prevent_amount_mutation`: blocks UPDATE of `amount_total`, `type`, `parent_id`
- `trg_guard_payment_status`: only allows `pending → completed` or `pending → failed`

**RLS**: Parents see only their own payments. Staff/admin can view all.

---

### **payment_allocations**

Links a payment to one or more orders. Enables batch payments (1 payment → N orders).

| Column | Type | Constraints | Description |
| ------ | ---- | ----------- | ----------- |
| `id` | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | |
| `payment_id` | uuid | FOREIGN KEY → payments(id) ON DELETE CASCADE, NOT NULL | **Immutable** after insert |
| `order_id` | uuid | FOREIGN KEY → orders(id) ON DELETE CASCADE, NOT NULL | **Immutable** after insert |
| `allocated_amount` | numeric(10,2) | NOT NULL | Amount allocated to this order — **immutable** after insert |
| `created_at` | timestamptz | DEFAULT now() | |

**Indexes**: `payment_id`, `order_id`

**Triggers**:

- `trg_check_allocation_integrity`: `SUM(allocated_amount) ≤ payment.amount_total` (deferred constraint)
- `trg_prevent_allocation_amount_mutation`: blocks UPDATE of `allocated_amount`, `payment_id`, `order_id`

**RLS**: Parents see allocations for their own payments. Staff/admin can view all.

---

### **system_settings**

Global configuration values managed by admin.

| Column | Type | Constraints | Description |
| ------ | ---- | ----------- | ----------- |
| `key` | text | PRIMARY KEY | Setting identifier |
| `value` | jsonb | NOT NULL | Setting value (type varies) |
| `updated_at` | timestamptz | DEFAULT now() | |
| `updated_by` | uuid | FOREIGN KEY → auth.users(id) | Admin who last modified |

**Known keys**: `weekly_cutoff_day`, `weekly_cutoff_time`, `maintenance_mode`, `school_name`, `allowed_payment_methods`

**RLS**: Public read, admin write.

---

## Data Types Reference

- `uuid`: Universally unique identifier
- `text`: Variable-length string
- `numeric(10,2)`: Decimal with 10 total digits, 2 after decimal
- `integer`: Whole number
- `boolean`: true/false
- `date`: Calendar date (no time component)
- `timestamptz`: Timestamp with timezone
- `jsonb`: Binary JSON

---

## Sample Data

### Products

```sql
INSERT INTO products (name, description, price, category, available) VALUES
('Chicken Adobo', 'Filipino classic with rice', 45.00, 'mains', true),
('Pancit Canton', 'Stir-fried noodles', 30.00, 'mains', true),
('Lumpia', '3 pieces spring rolls', 25.00, 'snacks', true),
('Turon', 'Banana spring roll', 15.00, 'snacks', true),
('Gulaman', 'Refreshing jelly drink', 10.00, 'drinks', true);
```

---

## Naming Conventions

- Table names: lowercase, plural (or snake_case compound)
- Column names: snake_case
- Foreign keys: `<table_singular>_id`
- Timestamps: `_at` suffix
- Boolean flags: `is_` prefix or bare adjective (e.g., `available`)

---

## Migration Strategy

All schema changes via Supabase migrations:

```bash
supabase migration new add_allergens_to_products
```

Never modify production schema directly.
