-- Add payment_status and payment_due_at columns to orders table
-- This supports the cash payment confirmation flow with timeout

-- Add payment_status enum type
DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('awaiting_payment', 'paid', 'timeout', 'refunded');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add columns to orders table
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS payment_status payment_status DEFAULT 'paid',
ADD COLUMN IF NOT EXISTS payment_due_at TIMESTAMPTZ;

-- Update existing orders to have correct payment_status based on payment_method
UPDATE orders 
SET payment_status = 'paid' 
WHERE payment_status IS NULL;

-- Add index for querying orders by payment status (for timeout cleanup)
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status) WHERE payment_status = 'awaiting_payment';
CREATE INDEX IF NOT EXISTS idx_orders_payment_due_at ON orders(payment_due_at) WHERE payment_due_at IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN orders.payment_status IS 'awaiting_payment=cash not yet received, paid=payment confirmed, timeout=auto-cancelled due to no payment, refunded=money returned';
COMMENT ON COLUMN orders.payment_due_at IS 'Deadline for cash payment. After this time, order can be auto-cancelled.';
