-- Add 'awaiting_payment' to orders status check constraint
-- This is needed for the cash payment confirmation flow

-- Drop the old constraint
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

-- Add new constraint with awaiting_payment
ALTER TABLE orders ADD CONSTRAINT orders_status_check 
  CHECK (status IN ('awaiting_payment', 'pending', 'preparing', 'ready', 'completed', 'cancelled'));

-- Comment for documentation
COMMENT ON COLUMN orders.status IS 'awaiting_payment=cash order waiting for payment, pending=ready for kitchen, preparing=being made, ready=pickup, completed=done, cancelled=cancelled';
