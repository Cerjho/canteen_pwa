# System Architecture

## Overview

This PWA uses a serverless architecture with Supabase as the backend platform and a React frontend deployed on Vercel. The system implements a **weekly pre-ordering** model: parents place meal orders for the upcoming school week before a configurable cutoff (default: Friday 5 PM Manila time). There is no wallet/balance system — payments use cash or PayMongo (GCash, PayMaya, card) only.

## Architecture Diagram

```text
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT TIER                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │   React App (TypeScript + Vite + Tailwind)          │   │
│  │   - Weekly Menu Browsing (next week's items)         │   │
│  │   - Weekly Pre-Order Cart (grouped by day)           │   │
│  │   - Student Profiles (link via Student ID)           │   │
│  └───────────────────┬─────────────────────────────────┘   │
│                      │                                       │
│  ┌───────────────────▼─────────────────────────────────┐   │
│  │   Service Worker (Workbox)                          │   │
│  │   - Offline caching                                  │   │
│  │   - Background sync                                  │   │
│  └───────────────────┬─────────────────────────────────┘   │
│                      │                                       │
│  ┌───────────────────▼─────────────────────────────────┐   │
│  │   IndexedDB (idb)                                    │   │
│  │   - Offline order queue                              │   │
│  │   - Cached menu data                                 │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS / WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      SUPABASE TIER                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │   Supabase Auth                                      │   │
│  │   - Parent authentication                            │   │
│  │   - Staff/Admin role management                      │   │
│  └───────────────────┬─────────────────────────────────┘   │
│                      │                                       │
│  ┌───────────────────▼─────────────────────────────────┐   │
│  │   Postgres Database + RLS                           │   │
│  │   - user_profiles, students, parent_students         │   │
│  │   - products, weekly_orders, orders, order_items      │   │
│  │   - surplus_items                                    │   │
│  │   - Row Level Security policies                      │   │
│  └───────────────────┬─────────────────────────────────┘   │
│                      │                                       │
│  ┌───────────────────▼─────────────────────────────────┐   │
│  │   Edge Functions (Deno)                             │   │
│  │   - process-weekly-order (weekly batch creation)      │   │
│  │   - create-weekly-checkout (PayMongo weekly total)    │   │
│  │   - create-batch-checkout (PayMongo batch)            │   │
│  │   - paymongo-webhook (batch-aware)                    │   │
│  │   - check-payment-status (self-heal)                  │   │
│  │   - cleanup-timeout-orders (expire unpaid)            │   │
│  │   - confirm-cash-payment                              │   │
│  │   - manage-order (status transitions)                 │   │
│  │   - process-surplus-order (same-day surplus)          │   │
│  │   - staff-place-order (staff-initiated orders)        │   │
│  │   - notify (push/SMS)                                 │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   EXTERNAL SERVICES                          │
│  - PayMongo (GCash, PayMaya, Card payments)                  │
│  - Semaphore / Twilio (SMS)                                  │
│  - OneSignal (push notifications)                            │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Weekly Pre-Order Flow

1. Parent selects a student and browses next week's menu (Mon–Fri)
2. Cart groups items by day; cutoff countdown shows remaining time
3. At checkout, frontend calls `process-weekly-order` (cash) or `create-weekly-checkout` (online)
4. Edge Function:
   - Validates parent owns student (via `parent_students` join)
   - Validates cutoff not passed (default: Friday 5 PM Manila time)
   - Creates `weekly_order` record for the week
   - Creates individual `orders` + `order_items` for each day
   - For online payments: creates PayMongo checkout for the weekly total
   - Returns order confirmation (or checkout URL)
5. Frontend navigates to confirmation page and clears cart

### Day Cancellation Flow

1. Parent views upcoming orders on Dashboard
2. Before 8 AM on the day, they can cancel a specific day's order
3. Edge function `manage-order` validates time constraint and updates status
4. If online payment was used, refund is processed via PayMongo

### Surplus Order Flow

1. Staff marks leftover items as surplus (available today only)
2. Parents browse surplus items on a dedicated tab
3. Surplus orders bypass weekly cutoff but must be placed before 8 AM
4. Edge function `process-surplus-order` handles creation

### Order Creation (Offline)

1. Parent selects student and adds items to cart
2. Order queued in IndexedDB with `client_order_id`
3. Service Worker detects online connectivity
4. Background sync sends queued orders
5. Edge Function uses `client_order_id` for idempotency
6. IndexedDB queue cleared on success

### Order Fulfillment

1. Staff views today's pre-orders as a kitchen prep list
2. Staff marks order as "preparing" → "ready" → "completed"
3. Real-time subscription updates parent's UI
4. Notification sent via Edge Function `notify`

### Payment Webhook Flow

1. PayMongo sends webhook to `paymongo-webhook` Edge Function
2. Function verifies signature and event type (`checkout_session.payment.paid`)
3. Updates ALL orders sharing the same `payment_group_id` to `paid`
4. `check-payment-status` runs periodically as self-healing fallback

## Component Architecture

### Frontend Layers

```text
┌─────────────────────────────────────────┐
│            Pages (Routes)                │
│  - Menu, Dashboard, OrderHistory         │
│  - Staff Dashboard, Admin Panels         │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│          Components                      │
│  - ProductCard, CartBottomSheet          │
│  - WeeklyCartSummary, CutoffCountdown   │
│  - StudentSelector, PaymentMethod        │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│            Hooks                         │
│  - useAuth, useOrders, useProducts       │
│  - useCart, useStudents, useTheme         │
│  - useOrderSubscription, useFavorites    │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│          Services                        │
│  - supabaseClient, orders, payments      │
│  - products, students, localQueue        │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│      Supabase Client SDK                 │
└─────────────────────────────────────────┘
```

## Security Architecture

### Row Level Security (RLS)

All Postgres tables enforce RLS:

- **user_profiles**: Users can only read/update their own profile
- **students**: Accessible to parents who have linked them (via `parent_students`)
- **parent_students**: Parents can read/insert/delete their own links
- **orders**: Parents see only orders for their linked students
- **weekly_orders**: Parents see only their own weekly orders
- **products**: Public read, staff/admin write
- **order_items**: Accessible via parent's orders
- **surplus_items**: Public read, staff/admin write
- **system_settings**: Public read, admin write

### Role Hierarchy

```text
Admin (unrestricted)
  ↓
Staff (read orders, manage products, process orders, manage surplus)
  ↓
Parent (link students, place weekly orders, view own orders)
  ↓
Student (represented as data, no auth - managed by admin)
```

**Student Management Flow**:

1. Admin adds students (individually or CSV import)
2. System generates unique Student ID (YY-XXXXX format)
3. School provides Student ID to parents
4. Parent links student using Student ID in Profile page

## Deployment Architecture

### Frontend (Vercel)

- Static build deployed to CDN
- Service Worker served from root
- Environment variables injected at build time

### Backend (Supabase)

- Managed Postgres instance
- Edge Functions deployed via Supabase CLI
- Connection pooling via Supavisor

### CI/CD Pipeline

```text
GitHub Push → GitHub Actions → Tests → Build → Deploy
                                  ↓
                            Supabase Migrations
```

## Scalability Considerations

- **Horizontal**: Supabase handles scaling automatically
- **Caching**: Menu cached in service worker for 1 hour
- **Database**: Indexed on `parent_id`, `student_id`, `scheduled_for`, `created_at`
- **Queue**: IndexedDB handles thousands of queued orders per client

## Technology Choices Rationale

| Technology | Reason |
| ---------- | ------ |
| Supabase | Managed Postgres + Auth + Edge Functions in one platform |
| TanStack React Query v5 | Declarative data fetching with caching/mutations |
| IndexedDB (idb) | Robust offline storage (5MB+ quota) |
| Vite | Fast builds and HMR |
| Tailwind CSS | Utility-first CSS, small bundle |
| TypeScript | Type safety across frontend/backend |
| PayMongo | Philippine payment gateway (GCash, PayMaya, card) |

## Key Business Rules

- **Weekly cutoff**: Orders for next week must be placed before Friday 5 PM (configurable via `system_settings`)
- **Day cancellation**: Individual days can be cancelled before 8 AM on that day
- **Surplus**: Staff can post leftover items; parents order before 8 AM same-day
- **Payment methods**: Cash, GCash, PayMaya, Card (no wallet/balance)
- **Minimum online payment**: ₱20.00 (PayMongo requirement)
- **Timezone**: All date/time logic uses `Asia/Manila` (UTC+8)
