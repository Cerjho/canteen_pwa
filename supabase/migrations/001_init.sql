-- Initial migration for School Canteen PWA
-- Supabase Postgres with Row Level Security
-- Uses gen_random_uuid() which is built into Postgres 13+

-- ============================================
-- TABLES
-- ============================================

-- Parents table (linked to Supabase Auth)
CREATE TABLE parents (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  phone_number TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  balance NUMERIC(10,2) DEFAULT 0.00,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Children table (managed by parents)
CREATE TABLE children (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  grade_level TEXT NOT NULL,
  section TEXT,
  dietary_restrictions TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products table (menu items)
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  category TEXT NOT NULL,
  image_url TEXT,
  available BOOLEAN DEFAULT TRUE,
  stock_quantity INTEGER DEFAULT 0 CHECK (stock_quantity >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Orders table
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES parents(id) ON DELETE RESTRICT,
  child_id UUID NOT NULL REFERENCES children(id) ON DELETE RESTRICT,
  client_order_id UUID UNIQUE NOT NULL, -- Idempotency key
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'preparing', 'ready', 'completed', 'cancelled')),
  total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
  payment_method TEXT NOT NULL 
    CHECK (payment_method IN ('cash', 'balance', 'gcash', 'paymongo')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Order items table
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_at_order NUMERIC(10,2) NOT NULL CHECK (price_at_order >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions table (payments/refunds)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES parents(id) ON DELETE RESTRICT,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('payment', 'refund', 'topup')),
  amount NUMERIC(10,2) NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash', 'gcash', 'paymongo', 'balance')),
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'completed', 'failed')),
  reference_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_parents_email ON parents(email);
CREATE INDEX idx_children_parent_id ON children(parent_id);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_available ON products(available);
CREATE INDEX idx_orders_parent_id ON orders(parent_id);
CREATE INDEX idx_orders_child_id ON orders(child_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_orders_client_order_id ON orders(client_order_id);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_transactions_parent_id ON transactions(parent_id);
CREATE INDEX idx_transactions_order_id ON transactions(order_id);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_parents_updated_at
  BEFORE UPDATE ON parents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_children_updated_at
  BEFORE UPDATE ON children
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to check if user is staff/admin
CREATE OR REPLACE FUNCTION is_staff_or_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    SELECT COALESCE(
      (auth.jwt() -> 'user_metadata' ->> 'role') IN ('staff', 'admin'),
      FALSE
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    SELECT COALESCE(
      (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin',
      FALSE
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Enable RLS on all tables
ALTER TABLE parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE children ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- PARENTS policies
CREATE POLICY "Parents can view own profile"
  ON parents FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Parents can update own profile"
  ON parents FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Parents can insert own profile on signup"
  ON parents FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Staff can view all parents"
  ON parents FOR SELECT
  USING (is_staff_or_admin());

-- CHILDREN policies
CREATE POLICY "Parents can view own children"
  ON children FOR SELECT
  USING (parent_id = auth.uid());

CREATE POLICY "Parents can insert own children"
  ON children FOR INSERT
  WITH CHECK (parent_id = auth.uid());

CREATE POLICY "Parents can update own children"
  ON children FOR UPDATE
  USING (parent_id = auth.uid())
  WITH CHECK (parent_id = auth.uid());

CREATE POLICY "Parents can delete own children"
  ON children FOR DELETE
  USING (parent_id = auth.uid());

CREATE POLICY "Staff can view all children"
  ON children FOR SELECT
  USING (is_staff_or_admin());

-- PRODUCTS policies
CREATE POLICY "Anyone can view available products"
  ON products FOR SELECT
  USING (TRUE);

CREATE POLICY "Staff can insert products"
  ON products FOR INSERT
  WITH CHECK (is_staff_or_admin());

CREATE POLICY "Staff can update products"
  ON products FOR UPDATE
  USING (is_staff_or_admin());

CREATE POLICY "Admin can delete products"
  ON products FOR DELETE
  USING (is_admin());

-- ORDERS policies
CREATE POLICY "Parents can view own orders"
  ON orders FOR SELECT
  USING (parent_id = auth.uid());

CREATE POLICY "Staff can view all orders"
  ON orders FOR SELECT
  USING (is_staff_or_admin());

CREATE POLICY "Staff can update order status"
  ON orders FOR UPDATE
  USING (is_staff_or_admin());

-- Note: Orders are inserted via Edge Function with service_role key

-- ORDER_ITEMS policies
CREATE POLICY "Parents can view own order items"
  ON order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items.order_id
      AND orders.parent_id = auth.uid()
    )
  );

CREATE POLICY "Staff can view all order items"
  ON order_items FOR SELECT
  USING (is_staff_or_admin());

-- TRANSACTIONS policies
CREATE POLICY "Parents can view own transactions"
  ON transactions FOR SELECT
  USING (parent_id = auth.uid());

CREATE POLICY "Staff can view all transactions"
  ON transactions FOR SELECT
  USING (is_staff_or_admin());

CREATE POLICY "Admin can insert transactions"
  ON transactions FOR INSERT
  WITH CHECK (is_admin());

-- ============================================
-- SEED DATA (Optional)
-- ============================================

-- Sample categories for menu
INSERT INTO products (name, description, price, category, image_url, available, stock_quantity)
VALUES
  ('Chicken Adobo', 'Classic Filipino chicken adobo with rice', 65.00, 'mains', 'https://placehold.co/400x300?text=Adobo', TRUE, 50),
  ('Pancit Canton', 'Stir-fried noodles with vegetables', 45.00, 'mains', 'https://placehold.co/400x300?text=Pancit', TRUE, 40),
  ('Siopao Asado', 'Steamed bun with pork filling', 25.00, 'snacks', 'https://placehold.co/400x300?text=Siopao', TRUE, 100),
  ('Banana Cue', 'Caramelized banana on stick', 15.00, 'snacks', 'https://placehold.co/400x300?text=Banana+Cue', TRUE, 60),
  ('Bottled Water', '500ml purified water', 15.00, 'drinks', 'https://placehold.co/400x300?text=Water', TRUE, 200),
  ('Juice Box', 'Assorted fruit juice 250ml', 20.00, 'drinks', 'https://placehold.co/400x300?text=Juice', TRUE, 150),
  ('Arroz Caldo', 'Rice porridge with chicken', 40.00, 'mains', 'https://placehold.co/400x300?text=Arroz+Caldo', TRUE, 30),
  ('Turon', 'Fried banana spring roll', 10.00, 'snacks', 'https://placehold.co/400x300?text=Turon', TRUE, 80);
