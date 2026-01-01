# System Architecture

## Overview

This PWA uses a serverless architecture with Supabase as the backend platform and a React frontend deployed on Vercel/Netlify.

## Architecture Diagram

```text
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT TIER                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │   React App (TypeScript + Vite + Tailwind)          │   │
│  │   - Menu Browsing                                    │   │
│  │   - Order Management                                 │   │
│  │   - Child Profiles                                   │   │
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
│  │   - parents, children, orders, products              │   │
│  │   - Row Level Security policies                      │   │
│  └───────────────────┬─────────────────────────────────┘   │
│                      │                                       │
│  ┌───────────────────▼─────────────────────────────────┐   │
│  │   Edge Functions (Deno)                             │   │
│  │   - process-order (idempotent)                       │   │
│  │   - refund-order                                     │   │
│  │   - notify (push/SMS)                                │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   EXTERNAL SERVICES                          │
│  - GCash / PayMongo (payments)                              │
│  - Semaphore / Twilio (SMS)                                  │
│  - OneSignal (push notifications)                            │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Order Creation (Online)

1. Parent selects child and adds items to cart
2. Cart generates `client_order_id` (UUID v4)
3. Frontend calls Supabase Edge Function `process-order`
4. Edge Function:
   - Validates parent owns child
   - Checks inventory
   - Creates order + order_items in transaction
   - Deducts stock
   - Returns order confirmation
5. Frontend updates UI and clears cart

### Order Creation (Offline)

1. Parent selects child and adds items to cart
2. Order queued in IndexedDB with `client_order_id`
3. Service Worker detects online connectivity
4. Background sync sends queued orders to `process-order`
5. Edge Function uses `client_order_id` for idempotency
6. IndexedDB queue cleared on success

### Order Fulfillment

1. Staff views pending orders dashboard
2. Staff marks order as "preparing" → "ready"
3. Real-time subscription updates parent's UI
4. Notification sent via Edge Function `notify`

## Component Architecture

### Frontend Layers

```text
┌─────────────────────────────────────────┐
│            Pages (Routes)                │
│  - Menu, Parent Dashboard, Staff Panel  │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│          Components                      │
│  - ProductCard, CartDrawer, etc.        │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│            Hooks                         │
│  - useAuth, useOrders, useProducts       │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│          Services                        │
│  - supabaseClient, orders, localQueue    │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│      Supabase Client SDK                 │
└─────────────────────────────────────────┘
```

## Security Architecture

### Row Level Security (RLS)

All Postgres tables enforce RLS:

- **parents**: Users can only read/update their own record
- **children**: Parents can only manage their own children
- **orders**: Parents see only orders for their children
- **products**: Public read, staff/admin write
- **order_items**: Accessible via parent's orders

### Role Hierarchy

```text
Admin (unrestricted)
  ↓
Staff (read orders, manage inventory, view students)
  ↓
Parent (link/view own children, place orders)
  ↓
Child/Student (represented as data, no auth - managed by admin)
```

**Student Management Flow**:
1. Admin adds students (individually or CSV import)
2. System generates unique Student ID (YY-XXXXX format)
3. School provides Student ID to parents
4. Parent links child using Student ID in Profile page

## Deployment Architecture

### Frontend (Vercel/Netlify)

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
- **Database**: Indexed on `parent_id`, `child_id`, `created_at`
- **Queue**: IndexedDB handles thousands of queued orders per client

## Technology Choices Rationale

| Technology | Reason |
| ---------- | ------ |
| Supabase | Managed Postgres + Auth + Edge Functions in one platform |
| React Query | Declarative data fetching with caching |
| IndexedDB | Robust offline storage (5MB+ quota) |
| Vite | Fast builds and HMR |
| Tailwind | Utility-first CSS, small bundle |
| TypeScript | Type safety across frontend/backend |

## Future Enhancements

- Real-time order updates via Supabase Realtime
- Scheduled reports via cron Edge Functions
- Multi-language support (Filipino, English)
- Mobile app wrapper (Capacitor)
