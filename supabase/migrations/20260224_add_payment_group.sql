-- Add payment_group_id to orders table
-- Allows multiple orders to share a single PayMongo checkout session,
-- so parents pay one transaction fee instead of N fees.
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS payment_group_id UUID;

-- Index for quick lookup when webhook fires for a payment group
CREATE INDEX IF NOT EXISTS idx_orders_payment_group
ON orders (payment_group_id) WHERE payment_group_id IS NOT NULL;
