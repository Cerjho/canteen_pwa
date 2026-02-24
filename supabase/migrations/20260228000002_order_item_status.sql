-- Phase 2: Per-item status for partial fulfillment
-- Staff can mark individual items as unavailable, triggering partial stock
-- restore and partial refund.

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'confirmed'
  CHECK (status IN ('confirmed', 'unavailable'));
