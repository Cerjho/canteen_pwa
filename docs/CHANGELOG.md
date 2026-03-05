# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Weekly Pre-Order Refactor

- **Weekly Pre-Order System**: Complete overhaul from daily to weekly ordering model
  - Parents order Mon–Fri meals for the upcoming week before configurable cutoff (default: Friday 5 PM)
  - Cart groups items by day with cutoff countdown timer
  - Day-level cancellation allowed before 8 AM on the day
  - `weekly_orders` table as aggregate container for daily orders
  - `surplus_items` table for staff-posted leftover items
  - New edge functions: `process-weekly-order`, `create-weekly-checkout`, `process-surplus-order`, `staff-place-order`

### Removed — Weekly Pre-Order Refactor

- **Wallet/Balance System**: Completely removed
  - Removed `balance` column from `user_profiles`
  - Removed `'balance'` from `PaymentMethod` type
  - Removed `deduct_balance_with_payment()` and `credit_balance_with_payment()` RPCs
  - Removed `admin-topup`, `create-topup-checkout` edge functions
  - Removed `TopUpModal` component and Balance page
- **Stock Tracking**: Completely removed
  - Removed `stock_quantity` column from `products`
  - Removed `decrement_stock()` and `increment_stock()` RPCs
  - Products now use simple `available: boolean` toggle
- **Legacy Types**: Renamed `Child` → `Student`, `children` references → `students` throughout

### Changed — Weekly Pre-Order Refactor

- `PaymentMethod` type: now `'cash' | 'gcash' | 'paymaya' | 'card'` only
- `orders` table: `child_id` → `student_id`, added `weekly_order_id`, `order_type`
- `students` table: replaces `children`, uses `parent_students` join table for many-to-many
- All components/hooks/services updated to use `student` terminology
- Payment model: `payments` + `payment_allocations` tables (replaces `transactions`)

---

### Added (Previous)

- **Financial Hardening**: DB-level invariants for payment integrity
  - Allocation integrity trigger: `SUM(allocated_amount) ≤ amount_total` enforced on every insert/update/delete
  - Amount immutability triggers: `amount_total`, `type`, `parent_id` cannot be modified after insert
  - Allocation immutability triggers: `allocated_amount`, `payment_id`, `order_id` cannot be modified
  - Payment status transition guard: only `pending → completed` or `pending → failed` allowed
  - Webhook idempotency: UNIQUE partial indexes on `paymongo_payment_id`, `paymongo_checkout_id`, `paymongo_refund_id`
  - Refund lineage: `original_payment_id` column on `payments` table for refund-to-payment traceability
  - Atomic wallet RPCs: `deduct_balance_with_payment()` and `credit_balance_with_payment()` wrap wallet+payment+allocation in a single DB transaction
  - Legacy table lockdown: `transactions_legacy` is now read-only (trigger + REVOKE)
  - All edge functions updated to use atomic RPCs for balance operations (process-order, process-batch-order, refund-order, parent-cancel-order, manage-order, cleanup-timeout-orders, admin-topup)
  - All refund functions now populate `original_payment_id` for full audit trail

- **Payment-centric data model**: Replaced per-order `transactions` table with `payments` + `payment_allocations`
  - `payments` table: one row per real money movement (payment, refund, top-up)
  - `payment_allocations` table: links a payment to one or more orders (enables batch payments)
  - Old `transactions` table renamed to `transactions_legacy` (data preserved, not dropped)
  - Migration backfills existing transaction data into new tables
  - New `Payment` and `PaymentAllocation` TypeScript interfaces in `src/types/index.ts`
  - All 12 edge functions updated to use new model
  - Balance page now shows one line per real payment (not per-order)
  - Admin reports query `payments` table with `amount_total` field

- **Ordering Flow Overhaul**: Comprehensive backend + frontend reliability improvements
  - Atomic `increment_stock`/`decrement_stock` RPC functions with `FOR UPDATE` row locks (eliminates stock race conditions)
  - `payment_group_id` UUID column on orders table for batch order tracking
  - `'failed'` value added to `payment_status` ENUM (for PayMongo payment rejections)
  - `validate_order_status_transition` trigger enforcing valid order state machine at DB level
  - Frontend support for `'failed'` payment status (toasts, badges, dashboard, order history)

### Fixed

- **Stock race conditions**: All edge functions now use atomic RPCs instead of read-then-write patterns
- **Batch checkout**: `paymongo_checkout_id` now saved on ALL batch orders (was only first order)
- **Batch payment failure**: Webhook now cancels ALL orders in a `payment_group_id` group (was only cancelling one)
- **Batch self-healing**: `check-payment-status` now heals ALL batch siblings (was only the queried order)
- **Balance refund on timeout**: `cleanup-timeout-orders` now refunds wallet for balance-paid orders that expire
- **confirm-cash-payment**: Removed write to non-existent `updated_at` column on transactions table
- **manage-order refund logic**: Wallet refund only applied when `payment_status === 'paid'` (no longer refunds unpaid orders)
- **Cash order timeout**: Increased from 15 minutes to 4 hours
- **Proper rollback**: All edge functions track reserved products and roll back stock on any failure path

- **Student Management System**: Admin-only student registration
  - Admin can add students manually or via CSV import
  - Auto-generated Student IDs (YY-XXXXX format)
  - Admin Students page with search, filter, and bulk actions
  - Parents link to students using Student ID (no longer add directly)
- Student ID column in children table
- `created_by` tracking for student records
- CSV import with template download feature

- Cart drawer animation glitch
- Product price formatting

### Changed

- `children.parent_id` is now nullable (students exist before parent links)
- Profile page redesigned for linking flow instead of adding children
- Admin nav updated with "Students" menu item
- Improved mobile navigation
- Updated color scheme

### Security

- New RLS policies for student management:
  - Admins: Full CRUD on all students
  - Parents: View linked children, link unlinked students, update dietary info
  - Staff: View all students for order processing
- Implemented RLS on all tables
- Added input validation
- HTTPS enforced

## [1.0.0] - 2026-01-15

### Added in 1.0.0

- PWA with offline support
- Supabase backend integration
- Row Level Security policies
- Payment method selection
- Order history
- Real-time order status updates
- Push notifications
- E2E testing suite

## [0.2.0] - 2026-01-08

### Added in 0.2.0

- Cart functionality
- Child selector component
- Product cards with images
- Responsive design

## [0.1.0] - 2026-01-01

### Added in 0.1.0

- Project scaffold
- Basic routing
- Supabase setup
- Initial database schema

---

## Version Format

**Major.Minor.Patch** (e.g., 1.2.3)

- **Major**: Breaking changes
- **Minor**: New features (backward compatible)
- **Patch**: Bug fixes

## Categories

- **Added**: New features
- **Changed**: Changes to existing functionality
- **Deprecated**: Features to be removed
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Security improvements
