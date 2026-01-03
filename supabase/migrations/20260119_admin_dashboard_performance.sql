-- Migration: Admin Dashboard Performance Improvements
-- Adds indexes and functions needed for optimal dashboard queries

-- ============================================
-- PERFORMANCE INDEXES
-- ============================================

-- Composite index for date-filtered order queries (most common dashboard query)
CREATE INDEX IF NOT EXISTS idx_orders_scheduled_for_status 
  ON orders(scheduled_for, status);

-- Composite index for order items with product join
CREATE INDEX IF NOT EXISTS idx_order_items_product_id 
  ON order_items(product_id);

-- Index for counting parents (filter by role)
CREATE INDEX IF NOT EXISTS idx_user_profiles_role 
  ON user_profiles(role);

-- Index for active students
CREATE INDEX IF NOT EXISTS idx_students_is_active 
  ON students(is_active);

-- Index for products low stock alert
CREATE INDEX IF NOT EXISTS idx_products_stock_quantity 
  ON products(stock_quantity) 
  WHERE available = true AND stock_quantity <= 10;

-- ============================================
-- UPDATE get_dashboard_stats FUNCTION
-- ============================================

-- Use scheduled_for instead of created_at for accurate daily stats
-- This function can be used server-side for better performance

DROP FUNCTION IF EXISTS get_admin_dashboard_stats(DATE);

CREATE OR REPLACE FUNCTION get_admin_dashboard_stats(target_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
  today_orders BIGINT,
  today_revenue NUMERIC,
  pending_orders BIGINT,
  preparing_orders BIGINT,
  ready_orders BIGINT,
  awaiting_payment_orders BIGINT,
  completed_today BIGINT,
  cancelled_today BIGINT,
  total_parents BIGINT,
  total_students BIGINT,
  total_products BIGINT,
  low_stock_products BIGINT,
  out_of_stock_products BIGINT,
  yesterday_orders BIGINT,
  yesterday_revenue NUMERIC,
  week_orders BIGINT,
  week_revenue NUMERIC,
  month_orders BIGINT,
  month_revenue NUMERIC,
  future_orders BIGINT,
  active_parents_today BIGINT
) AS $$
DECLARE
  yesterday_date DATE := target_date - INTERVAL '1 day';
  week_start DATE := date_trunc('week', target_date)::DATE;
  month_start DATE := date_trunc('month', target_date)::DATE;
BEGIN
  RETURN QUERY
  SELECT
    -- Today's orders (scheduled for today)
    (SELECT COUNT(*) FROM orders WHERE scheduled_for = target_date)::BIGINT,
    -- Today's revenue (non-cancelled)
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE scheduled_for = target_date AND status != 'cancelled')::NUMERIC,
    -- Status counts for today
    (SELECT COUNT(*) FROM orders WHERE scheduled_for = target_date AND status = 'pending')::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for = target_date AND status = 'preparing')::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for = target_date AND status = 'ready')::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for = target_date AND status = 'awaiting_payment')::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for = target_date AND status = 'completed')::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE scheduled_for = target_date AND status = 'cancelled')::BIGINT,
    -- User counts
    (SELECT COUNT(*) FROM user_profiles WHERE role = 'parent')::BIGINT,
    (SELECT COUNT(*) FROM students WHERE is_active = true)::BIGINT,
    -- Product counts
    (SELECT COUNT(*) FROM products WHERE available = true)::BIGINT,
    (SELECT COUNT(*) FROM products WHERE stock_quantity <= 10 AND stock_quantity > 0 AND available = true)::BIGINT,
    (SELECT COUNT(*) FROM products WHERE stock_quantity = 0 OR available = false)::BIGINT,
    -- Yesterday comparison
    (SELECT COUNT(*) FROM orders WHERE scheduled_for = yesterday_date)::BIGINT,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE scheduled_for = yesterday_date AND status != 'cancelled')::NUMERIC,
    -- Week totals
    (SELECT COUNT(*) FROM orders WHERE scheduled_for >= week_start AND scheduled_for <= target_date)::BIGINT,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE scheduled_for >= week_start AND scheduled_for <= target_date AND status != 'cancelled')::NUMERIC,
    -- Month totals
    (SELECT COUNT(*) FROM orders WHERE scheduled_for >= month_start AND scheduled_for <= target_date)::BIGINT,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE scheduled_for >= month_start AND scheduled_for <= target_date AND status != 'cancelled')::NUMERIC,
    -- Future orders
    (SELECT COUNT(*) FROM orders WHERE scheduled_for > target_date AND status != 'cancelled')::BIGINT,
    -- Active parents today
    (SELECT COUNT(DISTINCT parent_id) FROM orders WHERE scheduled_for = target_date)::BIGINT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users (RLS will still apply)
GRANT EXECUTE ON FUNCTION get_admin_dashboard_stats(DATE) TO authenticated;

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON INDEX idx_orders_scheduled_for_status IS 'Composite index for admin dashboard date/status queries';
COMMENT ON FUNCTION get_admin_dashboard_stats IS 'Optimized function for admin dashboard stats with proper scheduled_for filtering';
