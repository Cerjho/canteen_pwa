# GitHub Copilot Instructions

This file provides context and instructions for GitHub Copilot when working in this codebase.

---

## Project Context

You are working on a **serverless Progressive Web App (PWA)** for LOHECA Canteen. The app allows **parents** to place **weekly pre-orders** for their students' school meals.

**Key Points**:

- Parents are the PRIMARY end users
- Students DO NOT authenticate or place orders — they are managed as data by school admins
- **Weekly pre-ordering model**: parents order Mon–Fri meals for the upcoming week before a cutoff (default: Friday 5 PM)
- **No wallet/balance system** — payments are cash, GCash, PayMaya, or card only
- **No stock tracking** — products have an `available: boolean` toggle only
- Built with React, TypeScript, Vite, Tailwind CSS, and Supabase
- Offline-first with IndexedDB queue
- Security enforced via Supabase Row Level Security
- All date/time logic uses `Asia/Manila` (UTC+8)

---

## Architecture

```text
Frontend (React + Vite + TanStack Query v5)
    ↓
Supabase Client SDK
    ↓
Supabase Backend
    ├── Postgres + RLS
    ├── Edge Functions (Deno)
    └── Auth
    ↓
PayMongo (GCash, PayMaya, Card payments)
```

---

## Business Rules

### Ordering

- Parents can only order for **linked students** (via `parent_students` join table)
- Weekly orders must be submitted before **Friday 5 PM** (configurable via `system_settings`)
- Individual days can be cancelled before **8 AM** on that day
- Surplus items (staff-posted leftovers) can be ordered before **8 AM** same-day
- Cart groups items by day (Mon–Fri) within a week

### Payment

- **Payment methods**: `'cash' | 'gcash' | 'paymaya' | 'card'` — NO 'balance'
- Online methods use PayMongo Checkout Sessions (server-side only)
- Amounts sent to PayMongo in **centavos** (₱45.00 = 4500)
- Minimum online payment: **₱20.00** (PayMongo requirement)
- `ONLINE_PAYMENT_METHODS = ['gcash', 'paymaya', 'card']`
- Cash orders need staff confirmation via `confirm-cash-payment`

### Students

- School admin adds students (individually or CSV import)
- System generates unique Student ID (`YY-XXXXX` format)
- Parents link students by entering the Student ID

---

## Code Standards

### TypeScript

- **Always use TypeScript**, never `any`
- Define interfaces for all data structures
- Use type inference where obvious

```typescript
// ✅ Good
interface Order {
  id: string;
  parent_id: string;
  student_id: string; // NOT child_id
  items: OrderItem[];
}

// ❌ Bad — deprecated terminology
interface Order {
  child_id: string;  // WRONG: use student_id
  balance: number;   // WRONG: no balance system
}
```

### React

- Functional components only
- TanStack React Query v5 for data fetching (useQuery, useMutation)
- Custom hooks for business logic (`useCart`, `useOrders`, `useStudents`)
- Tailwind CSS for styling (no CSS modules)
- Use `lucide-react` for icons

### Data Fetching

```typescript
// ✅ Good — TanStack Query v5 pattern
const { data, isLoading } = useQuery({
  queryKey: ['products'],
  queryFn: getProducts,
});

// ✅ Good — mutations
const mutation = useMutation({
  mutationFn: (data) => createWeeklyOrder(data),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['weekly-orders'] }),
});
```

### Supabase Edge Functions

- Written in Deno/TypeScript
- Use `_shared/` for common utilities (cors, auth, supabase client)
- Always validate auth and ownership
- Use service role client for admin operations

```typescript
// ✅ Good — edge function pattern
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  // ... handler logic
});
```

---

## Key Types

```typescript
type PaymentMethod = 'cash' | 'gcash' | 'paymaya' | 'card';
type OrderStatus = 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled' | 'awaiting_payment';
type PaymentStatus = 'awaiting_payment' | 'paid' | 'timeout' | 'refunded' | 'failed';
type OrderType = 'pre_order' | 'surplus' | 'walk_in';
type WeeklyOrderStatus = 'submitted' | 'active' | 'completed' | 'cancelled';
type ProductCategory = 'mains' | 'snacks' | 'drinks';
type MealPeriod = 'morning_snack' | 'lunch' | 'afternoon_snack';
type UserRole = 'parent' | 'staff' | 'admin';
```

---

## Database Tables

| Table | Description |
| ----- | ----------- |
| `user_profiles` | Parent/staff/admin accounts (not `parents`) |
| `students` | Student records (not `children`) |
| `parent_students` | Many-to-many link between parents and students |
| `products` | Menu items (no `stock_quantity` column) |
| `weekly_orders` | Weekly order aggregate (Mon–Fri) |
| `orders` | Individual daily orders |
| `order_items` | Line items for each order |
| `surplus_items` | Staff-posted leftover items |
| `payments` | Payment records (payment or refund) |
| `payment_allocations` | Links payments to orders (1:N) |
| `system_settings` | Configurable system settings |

---

## Naming Conventions

### Terminology

| ✅ Use | ❌ Don't Use |
| ------ | ------------ |
| `student` | `child` (in code/types) |
| `student_id` | `child_id` |
| `useStudents` | `useChildren` |
| `StudentSelector` | `ChildSelector` |
| `available` | `stock_quantity`, `in_stock` |
| `payment_method: 'cash'` | `payment_method: 'balance'` |

### Code Style

- File names: PascalCase for components, camelCase for utilities
- Table names: lowercase, snake_case, plural
- Column names: snake_case
- Foreign keys: `<table_singular>_id`
- Hooks: `use` prefix (`useCart`, `useOrders`)
- Services: plain functions exported from `src/services/`

---

## File Structure

```text
src/
├── components/    # Reusable UI components
├── config/        # App configuration
├── hooks/         # Custom React hooks
├── pages/         # Route pages (Parent/, Staff/, Admin/)
├── pwa/           # Service worker
├── services/      # Supabase API calls
├── types/         # TypeScript types
└── utils/         # Utility functions
supabase/
├── functions/     # Edge functions (Deno)
├── migrations/    # SQL migration files
└── config.toml    # Supabase configuration
tests/
├── unit/          # Vitest unit tests
├── integration/   # Integration tests
├── mocks/         # Test mocks and fixtures
└── utils/         # Test utilities
```

---

## Common Patterns

### Date Handling

Always use `Asia/Manila` timezone:

```typescript
import { formatDateLocal, formatTimeLocal } from '../utils/dateUtils';

// ✅ Good
const manilaDate = formatDateLocal(new Date()); // "2025-03-10"

// ❌ Bad — uses system timezone
const date = new Date().toLocaleDateString();
```

### Error Handling in Edge Functions

```typescript
try {
  // ... logic
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
} catch (error) {
  return new Response(JSON.stringify({ error: error.message }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
```

### Payment Amount Conversion

```typescript
// PayMongo expects centavos
const amountCentavos = Math.round(totalAmount * 100);
// Minimum ₱20.00 = 2000 centavos
```

---

## Things That DON'T Exist

Do not reference or create code for:

- ❌ Wallet / balance system
- ❌ Top-up sessions or `createTopupCheckout`
- ❌ `stock_quantity` on products
- ❌ `decrement_stock` / `increment_stock` RPCs
- ❌ `children` table (it's `students` + `parent_students`)
- ❌ `Child` type (it's `Student`)
- ❌ `balance` as a payment method
- ❌ `transactions` table (it's `payments` + `payment_allocations`)
- ❌ `process-order` edge function (replaced by `process-weekly-order`)
