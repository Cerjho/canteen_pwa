-- Admin Enhancements Migration
-- Adds: Audit logs, system settings, improved aggregation functions

-- ============================================
-- SYSTEM SETTINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

-- Default settings
INSERT INTO system_settings (key, value, description) VALUES
  ('canteen_name', '"School Canteen"', 'Name of the canteen displayed in the app'),
  ('operating_hours', '{"open": "07:00", "close": "15:00"}', 'Operating hours for the canteen'),
  ('order_cutoff_time', '"10:00"', 'Daily cutoff time for placing orders'),
  ('allow_future_orders', 'true', 'Allow parents to order for future dates'),
  ('max_future_days', '5', 'Maximum days ahead for future orders'),
  ('low_stock_threshold', '10', 'Threshold for low stock warnings'),
  ('auto_complete_orders', 'false', 'Automatically complete orders after pickup'),
  ('notification_email', 'null', 'Email for admin notifications'),
  ('maintenance_mode', 'false', 'Put the app in maintenance mode')
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- AUDIT LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);

-- ============================================
-- RLS POLICIES
-- ============================================

-- System Settings policies
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view settings"
  ON system_settings FOR SELECT
  USING (TRUE);

CREATE POLICY "Admins can update settings"
  ON system_settings FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Admins can insert settings"
  ON system_settings FOR INSERT
  WITH CHECK (is_admin());

-- Audit Logs policies
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit logs"
  ON audit_logs FOR SELECT
  USING (is_admin());

CREATE POLICY "System can insert audit logs"
  ON audit_logs FOR INSERT
  WITH CHECK (TRUE); -- Inserted via service_role or triggers

-- ============================================
-- HELPER FUNCTIONS FOR REPORTING
-- ============================================

-- Get daily sales summary
CREATE OR REPLACE FUNCTION get_daily_sales_summary(start_date DATE, end_date DATE)
RETURNS TABLE (
  sale_date DATE,
  total_revenue NUMERIC,
  order_count BIGINT,
  avg_order_value NUMERIC,
  cash_revenue NUMERIC,
  balance_revenue NUMERIC,
  gcash_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    DATE(o.created_at) as sale_date,
    COALESCE(SUM(o.total_amount), 0) as total_revenue,
    COUNT(*) as order_count,
    COALESCE(AVG(o.total_amount), 0) as avg_order_value,
    COALESCE(SUM(CASE WHEN o.payment_method = 'cash' THEN o.total_amount ELSE 0 END), 0) as cash_revenue,
    COALESCE(SUM(CASE WHEN o.payment_method = 'balance' THEN o.total_amount ELSE 0 END), 0) as balance_revenue,
    COALESCE(SUM(CASE WHEN o.payment_method = 'gcash' THEN o.total_amount ELSE 0 END), 0) as gcash_revenue
  FROM orders o
  WHERE DATE(o.created_at) BETWEEN start_date AND end_date
    AND o.status NOT IN ('cancelled')
  GROUP BY DATE(o.created_at)
  ORDER BY sale_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get top selling products
CREATE OR REPLACE FUNCTION get_top_products(start_date DATE, end_date DATE, limit_count INT DEFAULT 10)
RETURNS TABLE (
  product_id UUID,
  product_name TEXT,
  category TEXT,
  total_quantity BIGINT,
  total_revenue NUMERIC,
  order_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id as product_id,
    p.name as product_name,
    p.category,
    COALESCE(SUM(oi.quantity), 0) as total_quantity,
    COALESCE(SUM(oi.quantity * oi.price_at_order), 0) as total_revenue,
    COUNT(DISTINCT o.id) as order_count
  FROM products p
  LEFT JOIN order_items oi ON oi.product_id = p.id
  LEFT JOIN orders o ON o.id = oi.order_id 
    AND DATE(o.created_at) BETWEEN start_date AND end_date
    AND o.status NOT IN ('cancelled')
  GROUP BY p.id, p.name, p.category
  ORDER BY total_quantity DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get dashboard stats
CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS TABLE (
  today_orders BIGINT,
  today_revenue NUMERIC,
  pending_orders BIGINT,
  preparing_orders BIGINT,
  ready_orders BIGINT,
  total_parents BIGINT,
  total_students BIGINT,
  total_products BIGINT,
  low_stock_products BIGINT,
  week_revenue NUMERIC,
  month_revenue NUMERIC
) AS $$
DECLARE
  today_start TIMESTAMPTZ := DATE_TRUNC('day', NOW());
  week_start TIMESTAMPTZ := DATE_TRUNC('week', NOW());
  month_start TIMESTAMPTZ := DATE_TRUNC('month', NOW());
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM orders WHERE created_at >= today_start AND status != 'cancelled')::BIGINT,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE created_at >= today_start AND status != 'cancelled')::NUMERIC,
    (SELECT COUNT(*) FROM orders WHERE status = 'pending')::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE status = 'preparing')::BIGINT,
    (SELECT COUNT(*) FROM orders WHERE status = 'ready')::BIGINT,
    (SELECT COUNT(*) FROM parents)::BIGINT,
    (SELECT COUNT(*) FROM children)::BIGINT,
    (SELECT COUNT(*) FROM products WHERE available = true)::BIGINT,
    (SELECT COUNT(*) FROM products WHERE stock_quantity < 10 AND available = true)::BIGINT,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE created_at >= week_start AND status != 'cancelled')::NUMERIC,
    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE created_at >= month_start AND status != 'cancelled')::NUMERIC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get hourly order distribution
CREATE OR REPLACE FUNCTION get_hourly_distribution(target_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
  hour INT,
  order_count BIGINT,
  revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    EXTRACT(HOUR FROM o.created_at)::INT as hour,
    COUNT(*) as order_count,
    COALESCE(SUM(o.total_amount), 0) as revenue
  FROM orders o
  WHERE DATE(o.created_at) = target_date
    AND o.status != 'cancelled'
  GROUP BY EXTRACT(HOUR FROM o.created_at)
  ORDER BY hour;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Audit log trigger function
CREATE OR REPLACE FUNCTION log_audit_action()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_data)
    VALUES (auth.uid(), 'CREATE', TG_TABLE_NAME, NEW.id, to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_data, new_data)
    VALUES (auth.uid(), 'UPDATE', TG_TABLE_NAME, NEW.id, to_jsonb(OLD), to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_data)
    VALUES (auth.uid(), 'DELETE', TG_TABLE_NAME, OLD.id, to_jsonb(OLD));
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create audit triggers for important tables
CREATE TRIGGER audit_products
  AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION log_audit_action();

CREATE TRIGGER audit_orders_status
  AFTER UPDATE ON orders
  FOR EACH ROW 
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION log_audit_action();

-- ============================================
-- STORAGE BUCKET FOR PRODUCT IMAGES
-- ============================================
-- Note: Run this in the Supabase Dashboard under Storage
-- INSERT INTO storage.buckets (id, name, public) VALUES ('product-images', 'product-images', true);
