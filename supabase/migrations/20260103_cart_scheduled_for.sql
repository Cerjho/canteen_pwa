-- Add scheduled_for field to cart_items
-- Each cart item knows which date it's for

ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS scheduled_for DATE NOT NULL DEFAULT CURRENT_DATE;

-- Update existing cart items to use today's date (they'll need to be re-added for proper dates)
UPDATE cart_items SET scheduled_for = CURRENT_DATE WHERE scheduled_for IS NULL;
