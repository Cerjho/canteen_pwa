-- BUG-037: cart_state.payment_method CHECK constraint doesn't include 'paymaya' or 'card'
-- The frontend PaymentMethod type allows these values but the DB constraint rejects them.

ALTER TABLE cart_state
  DROP CONSTRAINT IF EXISTS cart_state_payment_method_check;

ALTER TABLE cart_state
  ADD CONSTRAINT cart_state_payment_method_check
  CHECK (payment_method IN ('cash', 'gcash', 'paymaya', 'card', 'balance'));
