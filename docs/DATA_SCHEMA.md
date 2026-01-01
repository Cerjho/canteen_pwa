# Database Schema

## Overview

Supabase Postgres database with 6 core tables enforcing referential integrity and Row Level Security.

---

## Entity Relationship Diagram

```text
┌─────────────┐
│   parents   │
└──────┬──────┘
       │ 1
       │
       │ N
┌──────▼──────┐     N ┌─────────────┐
│  children   ├───────►   orders    │
└─────────────┘       └──────┬──────┘
                             │ 1
                             │
                             │ N
                      ┌──────▼──────────┐
                      │  order_items    │
                      └──────┬──────────┘
                             │ N
                             │
                             │ 1
                      ┌──────▼──────┐
                      │  products   │
                      └─────────────┘

┌─────────────┐
│transactions │  (linked to orders)
└─────────────┘
```

---

## Tables

### **parents**

Stores parent/guardian accounts.

| Column | Type | Constraints | Description |
| ------ | ---- | ----------- | ----------- |
| `id` | uuid | PRIMARY KEY, DEFAULT uuid_generate_v4() | User ID (matches Supabase Auth) |
| `email` | text | UNIQUE, NOT NULL | Parent email |
| `phone_number` | text | | Philippine mobile number |
| `first_name` | text | NOT NULL | |
| `last_name` | text | NOT NULL | |
| `balance` | numeric(10,2) | DEFAULT 0.00 | Prepaid balance (PHP) |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |

**Indexes**:

- `idx_parents_email` on `email`

**RLS**: Parents can only read/update their own record.

---

### **children**

Stores student profiles (managed by parents).

| Column | Type | Constraints | Description |
| ------ | ---- | ----------- | ----------- |
| `id` | uuid | PRIMARY KEY | |
| `parent_id` | uuid | FOREIGN KEY → parents(id), NOT NULL | |
| `first_name` | text | NOT NULL | |
| `last_name` | text | NOT NULL | |
| `grade_level` | text | NOT NULL | e.g., "Grade 1" |
| `section` | text | | e.g., "A" |
| `dietary_restrictions` | text | | Allergies, preferences |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |

**Indexes**:

- `idx_children_parent_id` on `parent_id`

**RLS**: Parents can only manage their own children.

---

### **products**

Canteen menu items.

| Column | Type | Constraints | Description |
| ------ | ---- | ----------- | ----------- |
| `id` | uuid | PRIMARY KEY | |
| `name` | text | NOT NULL | e.g., "Chicken Adobo" |
| `description` | text | | |
| `price` | numeric(10,2) | NOT NULL | Price in PHP |
| `category` | text | NOT NULL | "mains", "snacks", "drinks" |
| `image_url` | text | | Product photo URL |
| `available` | boolean | DEFAULT true | In stock flag |
| `stock_quantity` | integer | DEFAULT 0 | Current inventory |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |

**Indexes**:

- `idx_products_category` on `category`
- `idx_products_available` on `available`

**RLS**: Public read, staff/admin write.

---

### **orders**

Parent orders for children.

| Column | Type | Constraints | Description |
| ------ | ---- | ----------- | ----------- |
| `id` | uuid | PRIMARY KEY | |
| `parent_id` | uuid | FOREIGN KEY → parents(id), NOT NULL | |
| `child_id` | uuid | FOREIGN KEY → children(id), NOT NULL | |
| `client_order_id` | uuid | UNIQUE, NOT NULL | Idempotency key |
| `status` | text | NOT NULL, DEFAULT 'pending' | "pending", "preparing", "ready", "completed", "cancelled" |
| `total_amount` | numeric(10,2) | NOT NULL | |
| `payment_method` | text | NOT NULL | "cash", "balance", "gcash" |
| `notes` | text | | Special instructions |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |
| `completed_at` | timestamptz | | Fulfillment timestamp |

**Indexes**:

- `idx_orders_parent_id` on `parent_id`
- `idx_orders_child_id` on `child_id`
- `idx_orders_status` on `status`
- `idx_orders_created_at` on `created_at` (DESC)
- `idx_orders_client_order_id` on `client_order_id` (UNIQUE)

**RLS**: Parents see only their orders, staff see all.

**Constraints**:

- CHECK: `status IN ('pending', 'preparing', 'ready', 'completed', 'cancelled')`
- CHECK: `payment_method IN ('cash', 'balance', 'gcash', 'paymongo')`

---

### **order_items**

Line items for each order.

| Column | Type | Constraints | Description |
| ------ | ---- | ----------- | ----------- |
| `id` | uuid | PRIMARY KEY | |
| `order_id` | uuid | FOREIGN KEY → orders(id), NOT NULL | |
| `product_id` | uuid | FOREIGN KEY → products(id), NOT NULL | |
| `quantity` | integer | NOT NULL, CHECK > 0 | |
| `price_at_order` | numeric(10,2) | NOT NULL | Historical price |
| `created_at` | timestamptz | DEFAULT now() | |

**Indexes**:

- `idx_order_items_order_id` on `order_id`

**RLS**: Accessible via parent's orders.

---

### **transactions**

Payment/refund records.

| Column | Type | Constraints | Description |
| ------ | ---- | ----------- | ----------- |
| `id` | uuid | PRIMARY KEY | |
| `parent_id` | uuid | FOREIGN KEY → parents(id), NOT NULL | |
| `order_id` | uuid | FOREIGN KEY → orders(id), NULL | |
| `type` | text | NOT NULL | "payment", "refund", "topup" |
| `amount` | numeric(10,2) | NOT NULL | |
| `method` | text | NOT NULL | "cash", "gcash", "paymongo" |
| `status` | text | NOT NULL, DEFAULT 'pending' | "pending", "completed", "failed" |
| `reference_id` | text | | External transaction ID |
| `created_at` | timestamptz | DEFAULT now() | |

**Indexes**:

- `idx_transactions_parent_id` on `parent_id`
- `idx_transactions_order_id` on `order_id`

**RLS**: Parents see only their transactions.

---

## Data Types Reference

- `uuid`: Universally unique identifier
- `text`: Variable-length string
- `numeric(10,2)`: Decimal with 10 total digits, 2 after decimal
- `integer`: Whole number
- `boolean`: true/false
- `timestamptz`: Timestamp with timezone

---

## Sample Data

### Products

```sql
INSERT INTO products (name, description, price, category, available, stock_quantity) VALUES
('Chicken Adobo', 'Filipino classic with rice', 45.00, 'mains', true, 20),
('Pancit Canton', 'Stir-fried noodles', 30.00, 'mains', true, 15),
('Lumpia', '3 pieces spring rolls', 25.00, 'snacks', true, 30),
('Turon', 'Banana spring roll', 15.00, 'snacks', true, 25),
('Gulaman', 'Refreshing jelly drink', 10.00, 'drinks', true, 50);
```

---

## Naming Conventions

- Table names: lowercase, plural
- Column names: snake_case
- Foreign keys: `<table_singular>_id`
- Timestamps: `_at` suffix
- Boolean flags: `is_` or bare adjective (e.g., `available`)

---

## Migration Strategy

All schema changes via Supabase migrations:

```bash
supabase migration new add_allergens_to_products
```

Never modify production schema directly.
