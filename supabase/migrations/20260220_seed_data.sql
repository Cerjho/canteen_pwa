-- ============================================
-- SEED DATA: School Canteen PWA
-- Provides realistic demo data for all tables
-- Uses the 3 existing auth users:
--   admin:  afd318a4-f9c4-4fef-ac9e-79751269c4d0
--   staff:  3c08a040-01a5-459c-a6e5-069d8d5dbad2
--   parent: d25cf9ff-183b-4670-a893-99c7cdb80ac1
-- ============================================

-- ============================================
-- 1. PRODUCTS (15 items across 3 categories)
-- ============================================

INSERT INTO products (id, name, description, price, category, available, stock_quantity) VALUES
  -- MAINS (5)
  ('a0000001-0000-0000-0000-000000000001', 'Chicken Adobo Rice Bowl', 'Classic Filipino adobo with steamed rice', 65.00, 'mains', true, 50),
  ('a0000001-0000-0000-0000-000000000002', 'Spaghetti Bolognese', 'Filipino-style spaghetti with meat sauce', 55.00, 'mains', true, 40),
  ('a0000001-0000-0000-0000-000000000003', 'Pork Sisig Rice', 'Sizzling sisig served with garlic rice', 70.00, 'mains', true, 35),
  ('a0000001-0000-0000-0000-000000000004', 'Beef Tapa Meal', 'Cured beef tapa with egg and fried rice', 75.00, 'mains', true, 30),
  ('a0000001-0000-0000-0000-000000000005', 'Chicken Inasal Plate', 'Grilled chicken with java rice and atchara', 68.00, 'mains', true, 45),
  -- SNACKS (5)
  ('a0000002-0000-0000-0000-000000000001', 'Lumpiang Shanghai', '6 pcs crispy spring rolls with sweet chili sauce', 35.00, 'snacks', true, 60),
  ('a0000002-0000-0000-0000-000000000002', 'Cheese Sticks', '5 pcs golden fried cheese sticks', 25.00, 'snacks', true, 80),
  ('a0000002-0000-0000-0000-000000000003', 'Banana Cue', 'Caramelized saba bananas on a stick (2 pcs)', 20.00, 'snacks', true, 100),
  ('a0000002-0000-0000-0000-000000000004', 'Chicken Empanada', 'Flaky pastry stuffed with chicken filling', 30.00, 'snacks', true, 55),
  ('a0000002-0000-0000-0000-000000000005', 'French Fries', 'Crispy fries with ketchup', 40.00, 'snacks', true, 70),
  -- DRINKS (5)
  ('a0000003-0000-0000-0000-000000000001', 'Mango Shake', 'Fresh Philippine mango blended with ice', 35.00, 'drinks', true, 50),
  ('a0000003-0000-0000-0000-000000000002', 'Buko Juice', 'Fresh young coconut water with coconut strips', 25.00, 'drinks', true, 60),
  ('a0000003-0000-0000-0000-000000000003', 'Iced Tea', 'House-brewed iced tea (large)', 20.00, 'drinks', true, 100),
  ('a0000003-0000-0000-0000-000000000004', 'Calamansi Juice', 'Fresh calamansi with honey', 25.00, 'drinks', true, 70),
  ('a0000003-0000-0000-0000-000000000005', 'Hot Chocolate', 'Rich tablea hot chocolate', 30.00, 'drinks', true, 40)
ON CONFLICT (id) DO NOTHING;


-- ============================================
-- 2. STUDENTS (6 students)
-- ============================================

INSERT INTO students (id, student_id, first_name, last_name, grade_level, section, dietary_restrictions, is_active, created_by) VALUES
  ('b0000001-0000-0000-0000-000000000001', 'STU-2026-0001', 'Miguel', 'Santos', 'Grade 4', 'Section A', NULL, true, 'afd318a4-f9c4-4fef-ac9e-79751269c4d0'),
  ('b0000001-0000-0000-0000-000000000002', 'STU-2026-0002', 'Sofia', 'Santos', 'Grade 2', 'Section B', 'No peanuts', true, 'afd318a4-f9c4-4fef-ac9e-79751269c4d0'),
  ('b0000001-0000-0000-0000-000000000003', 'STU-2026-0003', 'Carlos', 'Reyes', 'Grade 6', 'Section A', NULL, true, 'afd318a4-f9c4-4fef-ac9e-79751269c4d0'),
  ('b0000001-0000-0000-0000-000000000004', 'STU-2026-0004', 'Isabella', 'Cruz', 'Grade 3', 'Section C', 'Lactose intolerant', true, 'afd318a4-f9c4-4fef-ac9e-79751269c4d0'),
  ('b0000001-0000-0000-0000-000000000005', 'STU-2026-0005', 'Lucas', 'Garcia', 'Grade 5', 'Section B', NULL, true, 'afd318a4-f9c4-4fef-ac9e-79751269c4d0'),
  ('b0000001-0000-0000-0000-000000000006', 'STU-2026-0006', 'Maria', 'Fernandez', 'Grade 1', 'Section A', NULL, true, 'afd318a4-f9c4-4fef-ac9e-79751269c4d0')
ON CONFLICT (id) DO NOTHING;


-- ============================================
-- 3. PARENT-STUDENT LINKS
-- Parent d25cf9ff has 2 children: Miguel & Sofia Santos
-- ============================================

INSERT INTO parent_students (parent_id, student_id, relationship, is_primary) VALUES
  ('d25cf9ff-183b-4670-a893-99c7cdb80ac1', 'b0000001-0000-0000-0000-000000000001', 'parent', true),
  ('d25cf9ff-183b-4670-a893-99c7cdb80ac1', 'b0000001-0000-0000-0000-000000000002', 'parent', true)
ON CONFLICT (parent_id, student_id) DO NOTHING;


-- ============================================
-- 4. WALLET TOP-UP for parent
-- ============================================

UPDATE wallets SET balance = 500.00 WHERE user_id = 'd25cf9ff-183b-4670-a893-99c7cdb80ac1';


-- ============================================
-- 5. MENU SCHEDULES (weekly template: what's available each day)
-- day_of_week: 1=Monday, 2=Tuesday, ..., 5=Friday
-- ============================================

-- Monday: All mains + some snacks + some drinks
INSERT INTO menu_schedules (product_id, day_of_week, is_active) VALUES
  ('a0000001-0000-0000-0000-000000000001', 1, true),  -- Chicken Adobo
  ('a0000001-0000-0000-0000-000000000002', 1, true),  -- Spaghetti
  ('a0000001-0000-0000-0000-000000000005', 1, true),  -- Chicken Inasal
  ('a0000002-0000-0000-0000-000000000001', 1, true),  -- Lumpia
  ('a0000002-0000-0000-0000-000000000002', 1, true),  -- Cheese Sticks
  ('a0000002-0000-0000-0000-000000000005', 1, true),  -- French Fries
  ('a0000003-0000-0000-0000-000000000001', 1, true),  -- Mango Shake
  ('a0000003-0000-0000-0000-000000000003', 1, true),  -- Iced Tea
  ('a0000003-0000-0000-0000-000000000004', 1, true)   -- Calamansi
ON CONFLICT DO NOTHING;

-- Tuesday
INSERT INTO menu_schedules (product_id, day_of_week, is_active) VALUES
  ('a0000001-0000-0000-0000-000000000003', 2, true),  -- Pork Sisig
  ('a0000001-0000-0000-0000-000000000004', 2, true),  -- Beef Tapa
  ('a0000001-0000-0000-0000-000000000001', 2, true),  -- Chicken Adobo
  ('a0000002-0000-0000-0000-000000000003', 2, true),  -- Banana Cue
  ('a0000002-0000-0000-0000-000000000004', 2, true),  -- Empanada
  ('a0000003-0000-0000-0000-000000000002', 2, true),  -- Buko Juice
  ('a0000003-0000-0000-0000-000000000003', 2, true),  -- Iced Tea
  ('a0000003-0000-0000-0000-000000000005', 2, true)   -- Hot Choco
ON CONFLICT DO NOTHING;

-- Wednesday
INSERT INTO menu_schedules (product_id, day_of_week, is_active) VALUES
  ('a0000001-0000-0000-0000-000000000002', 3, true),  -- Spaghetti
  ('a0000001-0000-0000-0000-000000000005', 3, true),  -- Chicken Inasal
  ('a0000001-0000-0000-0000-000000000003', 3, true),  -- Pork Sisig
  ('a0000002-0000-0000-0000-000000000001', 3, true),  -- Lumpia
  ('a0000002-0000-0000-0000-000000000005', 3, true),  -- French Fries
  ('a0000002-0000-0000-0000-000000000002', 3, true),  -- Cheese Sticks
  ('a0000003-0000-0000-0000-000000000001', 3, true),  -- Mango Shake
  ('a0000003-0000-0000-0000-000000000004', 3, true)   -- Calamansi
ON CONFLICT DO NOTHING;

-- Thursday
INSERT INTO menu_schedules (product_id, day_of_week, is_active) VALUES
  ('a0000001-0000-0000-0000-000000000001', 4, true),  -- Chicken Adobo
  ('a0000001-0000-0000-0000-000000000004', 4, true),  -- Beef Tapa
  ('a0000001-0000-0000-0000-000000000005', 4, true),  -- Chicken Inasal
  ('a0000002-0000-0000-0000-000000000003', 4, true),  -- Banana Cue
  ('a0000002-0000-0000-0000-000000000004', 4, true),  -- Empanada
  ('a0000002-0000-0000-0000-000000000001', 4, true),  -- Lumpia
  ('a0000003-0000-0000-0000-000000000002', 4, true),  -- Buko Juice
  ('a0000003-0000-0000-0000-000000000003', 4, true),  -- Iced Tea
  ('a0000003-0000-0000-0000-000000000005', 4, true)   -- Hot Choco
ON CONFLICT DO NOTHING;

-- Friday
INSERT INTO menu_schedules (product_id, day_of_week, is_active) VALUES
  ('a0000001-0000-0000-0000-000000000002', 5, true),  -- Spaghetti
  ('a0000001-0000-0000-0000-000000000003', 5, true),  -- Pork Sisig
  ('a0000001-0000-0000-0000-000000000004', 5, true),  -- Beef Tapa
  ('a0000002-0000-0000-0000-000000000002', 5, true),  -- Cheese Sticks
  ('a0000002-0000-0000-0000-000000000005', 5, true),  -- French Fries
  ('a0000002-0000-0000-0000-000000000003', 5, true),  -- Banana Cue
  ('a0000003-0000-0000-0000-000000000001', 5, true),  -- Mango Shake
  ('a0000003-0000-0000-0000-000000000002', 5, true),  -- Buko Juice
  ('a0000003-0000-0000-0000-000000000004', 5, true)   -- Calamansi
ON CONFLICT DO NOTHING;


-- ============================================
-- 6. HOLIDAYS (2026 Philippine school holidays)
-- ============================================

INSERT INTO holidays (name, date, description, is_recurring, created_by) VALUES
  ('New Year''s Day',        '2026-01-01', 'National holiday', true,  'afd318a4-f9c4-4fef-ac9e-79751269c4d0'),
  ('EDSA Revolution',        '2026-02-25', 'People Power Anniversary', true, 'afd318a4-f9c4-4fef-ac9e-79751269c4d0'),
  ('Araw ng Kagitingan',     '2026-04-09', 'Day of Valor', true,  'afd318a4-f9c4-4fef-ac9e-79751269c4d0'),
  ('Holy Thursday',          '2026-04-02', 'Maundy Thursday', false, 'afd318a4-f9c4-4fef-ac9e-79751269c4d0'),
  ('Good Friday',            '2026-04-03', 'Good Friday', false, 'afd318a4-f9c4-4fef-ac9e-79751269c4d0'),
  ('Labor Day',              '2026-05-01', 'International Labor Day', true, 'afd318a4-f9c4-4fef-ac9e-79751269c4d0'),
  ('Independence Day',       '2026-06-12', 'Philippine Independence Day', true, 'afd318a4-f9c4-4fef-ac9e-79751269c4d0'),
  ('Ninoy Aquino Day',       '2026-08-21', 'Ninoy Aquino Day', true, 'afd318a4-f9c4-4fef-ac9e-79751269c4d0'),
  ('National Heroes Day',    '2026-08-31', 'National Heroes Day', false, 'afd318a4-f9c4-4fef-ac9e-79751269c4d0'),
  ('Bonifacio Day',          '2026-11-30', 'Andres Bonifacio Day', true, 'afd318a4-f9c4-4fef-ac9e-79751269c4d0'),
  ('Christmas Day',          '2026-12-25', 'Christmas Day', true,  'afd318a4-f9c4-4fef-ac9e-79751269c4d0'),
  ('Rizal Day',              '2026-12-30', 'Jose Rizal Day', true,  'afd318a4-f9c4-4fef-ac9e-79751269c4d0')
ON CONFLICT (date) DO NOTHING;


-- ============================================
-- 7. ORDERS (12 orders over the past 2 weeks with various statuses)
-- All use the parent: d25cf9ff and child: Miguel (b0000001-..01)
-- ============================================

-- Helper: the parent user ID
-- d25cf9ff-183b-4670-a893-99c7cdb80ac1

-- Order 1: Completed 12 days ago (balance payment)
INSERT INTO orders (id, parent_id, student_id, client_order_id, status, total_amount, payment_method, payment_status, scheduled_for, created_at, completed_at, notes) VALUES
  ('c0000001-0000-0000-0000-000000000001',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'b0000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000001',
   'completed', 120.00, 'balance', 'paid',
   (CURRENT_DATE - INTERVAL '12 days')::date,
   NOW() - INTERVAL '12 days 4 hours',
   NOW() - INTERVAL '12 days 2 hours',
   NULL)
ON CONFLICT (id) DO NOTHING;

-- Order 2: Completed 11 days ago (cash payment)
INSERT INTO orders (id, parent_id, student_id, client_order_id, status, total_amount, payment_method, payment_status, scheduled_for, created_at, completed_at, notes) VALUES
  ('c0000001-0000-0000-0000-000000000002',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'b0000001-0000-0000-0000-000000000002',
   'c1000001-0000-0000-0000-000000000002',
   'completed', 90.00, 'cash', 'paid',
   (CURRENT_DATE - INTERVAL '11 days')::date,
   NOW() - INTERVAL '11 days 5 hours',
   NOW() - INTERVAL '11 days 3 hours',
   NULL)
ON CONFLICT (id) DO NOTHING;

-- Order 3: Completed 9 days ago (balance)
INSERT INTO orders (id, parent_id, student_id, client_order_id, status, total_amount, payment_method, payment_status, scheduled_for, created_at, completed_at, notes) VALUES
  ('c0000001-0000-0000-0000-000000000003',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'b0000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000003',
   'completed', 155.00, 'balance', 'paid',
   (CURRENT_DATE - INTERVAL '9 days')::date,
   NOW() - INTERVAL '9 days 6 hours',
   NOW() - INTERVAL '9 days 4 hours',
   NULL)
ON CONFLICT (id) DO NOTHING;

-- Order 4: Completed 7 days ago (cash)
INSERT INTO orders (id, parent_id, student_id, client_order_id, status, total_amount, payment_method, payment_status, scheduled_for, created_at, completed_at, notes) VALUES
  ('c0000001-0000-0000-0000-000000000004',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'b0000001-0000-0000-0000-000000000002',
   'c1000001-0000-0000-0000-000000000004',
   'completed', 85.00, 'cash', 'paid',
   (CURRENT_DATE - INTERVAL '7 days')::date,
   NOW() - INTERVAL '7 days 3 hours',
   NOW() - INTERVAL '7 days 1 hour',
   NULL)
ON CONFLICT (id) DO NOTHING;

-- Order 5: Completed 5 days ago (balance)
INSERT INTO orders (id, parent_id, student_id, client_order_id, status, total_amount, payment_method, payment_status, scheduled_for, created_at, completed_at, notes) VALUES
  ('c0000001-0000-0000-0000-000000000005',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'b0000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000005',
   'completed', 200.00, 'balance', 'paid',
   (CURRENT_DATE - INTERVAL '5 days')::date,
   NOW() - INTERVAL '5 days 4 hours',
   NOW() - INTERVAL '5 days 2 hours',
   'Extra rice please')
ON CONFLICT (id) DO NOTHING;

-- Order 6: Completed 4 days ago (cash)
INSERT INTO orders (id, parent_id, student_id, client_order_id, status, total_amount, payment_method, payment_status, scheduled_for, created_at, completed_at, notes) VALUES
  ('c0000001-0000-0000-0000-000000000006',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'b0000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000006',
   'completed', 95.00, 'cash', 'paid',
   (CURRENT_DATE - INTERVAL '4 days')::date,
   NOW() - INTERVAL '4 days 5 hours',
   NOW() - INTERVAL '4 days 3 hours',
   NULL)
ON CONFLICT (id) DO NOTHING;

-- Order 7: Completed 3 days ago (balance)
INSERT INTO orders (id, parent_id, student_id, client_order_id, status, total_amount, payment_method, payment_status, scheduled_for, created_at, completed_at, notes) VALUES
  ('c0000001-0000-0000-0000-000000000007',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'b0000001-0000-0000-0000-000000000002',
   'c1000001-0000-0000-0000-000000000007',
   'completed', 175.00, 'balance', 'paid',
   (CURRENT_DATE - INTERVAL '3 days')::date,
   NOW() - INTERVAL '3 days 6 hours',
   NOW() - INTERVAL '3 days 4 hours',
   NULL)
ON CONFLICT (id) DO NOTHING;

-- Order 8: Completed 2 days ago (gcash)
INSERT INTO orders (id, parent_id, student_id, client_order_id, status, total_amount, payment_method, payment_status, scheduled_for, created_at, completed_at, notes) VALUES
  ('c0000001-0000-0000-0000-000000000008',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'b0000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000008',
   'completed', 130.00, 'gcash', 'paid',
   (CURRENT_DATE - INTERVAL '2 days')::date,
   NOW() - INTERVAL '2 days 5 hours',
   NOW() - INTERVAL '2 days 3 hours',
   NULL)
ON CONFLICT (id) DO NOTHING;

-- Order 9: Completed yesterday (balance)
INSERT INTO orders (id, parent_id, student_id, client_order_id, status, total_amount, payment_method, payment_status, scheduled_for, created_at, completed_at, notes) VALUES
  ('c0000001-0000-0000-0000-000000000009',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'b0000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000009',
   'completed', 145.00, 'balance', 'paid',
   (CURRENT_DATE - INTERVAL '1 day')::date,
   NOW() - INTERVAL '1 day 4 hours',
   NOW() - INTERVAL '1 day 2 hours',
   NULL)
ON CONFLICT (id) DO NOTHING;

-- Order 10: Completed today (cash)
INSERT INTO orders (id, parent_id, student_id, client_order_id, status, total_amount, payment_method, payment_status, scheduled_for, created_at, completed_at, notes) VALUES
  ('c0000001-0000-0000-0000-000000000010',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'b0000001-0000-0000-0000-000000000002',
   'c1000001-0000-0000-0000-000000000010',
   'completed', 110.00, 'cash', 'paid',
   CURRENT_DATE,
   NOW() - INTERVAL '3 hours',
   NOW() - INTERVAL '1 hour',
   NULL)
ON CONFLICT (id) DO NOTHING;

-- Order 11: Pending (today, balance - currently being prepared)
INSERT INTO orders (id, parent_id, student_id, client_order_id, status, total_amount, payment_method, payment_status, scheduled_for, created_at, completed_at, notes) VALUES
  ('c0000001-0000-0000-0000-000000000011',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'b0000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000011',
   'preparing', 160.00, 'balance', 'paid',
   CURRENT_DATE,
   NOW() - INTERVAL '30 minutes',
   NULL,
   'No spicy please')
ON CONFLICT (id) DO NOTHING;

-- Order 12: Cancelled/refunded 6 days ago
INSERT INTO orders (id, parent_id, student_id, client_order_id, status, total_amount, payment_method, payment_status, scheduled_for, created_at, completed_at, notes) VALUES
  ('c0000001-0000-0000-0000-000000000012',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'b0000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000012',
   'cancelled', 75.00, 'balance', 'refunded',
   (CURRENT_DATE - INTERVAL '6 days')::date,
   NOW() - INTERVAL '6 days 4 hours',
   NULL,
   'Cancelled: Student absent')
ON CONFLICT (id) DO NOTHING;


-- ============================================
-- 8. ORDER ITEMS (for each order above)
-- ============================================

-- Order 1: Chicken Adobo (65) + Mango Shake (35) + Banana Cue (20) = 120
INSERT INTO order_items (order_id, product_id, quantity, price_at_order) VALUES
  ('c0000001-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 1, 65.00),
  ('c0000001-0000-0000-0000-000000000001', 'a0000003-0000-0000-0000-000000000001', 1, 35.00),
  ('c0000001-0000-0000-0000-000000000001', 'a0000002-0000-0000-0000-000000000003', 1, 20.00)
ON CONFLICT DO NOTHING;

-- Order 2: Spaghetti (55) + Lumpia (35) = 90
INSERT INTO order_items (order_id, product_id, quantity, price_at_order) VALUES
  ('c0000001-0000-0000-0000-000000000002', 'a0000001-0000-0000-0000-000000000002', 1, 55.00),
  ('c0000001-0000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000001', 1, 35.00)
ON CONFLICT DO NOTHING;

-- Order 3: Pork Sisig (70) + Beef Tapa (75) + Iced Tea (10 for size? no, 20 actually) = let me recalculate
-- Pork Sisig (70) + French Fries (40) + Buko Juice x2 (25*2) - hmm. Let me do: Sisig (70) + Inasal (68) + Iced Tea (20) - 3 = 158 not 155
-- Let's just match: Pork Sisig (70) + Cheese Sticks x2 (25*2) + Mango Shake (35) = 155
INSERT INTO order_items (order_id, product_id, quantity, price_at_order) VALUES
  ('c0000001-0000-0000-0000-000000000003', 'a0000001-0000-0000-0000-000000000003', 1, 70.00),
  ('c0000001-0000-0000-0000-000000000003', 'a0000002-0000-0000-0000-000000000002', 2, 25.00),
  ('c0000001-0000-0000-0000-000000000003', 'a0000003-0000-0000-0000-000000000001', 1, 35.00)
ON CONFLICT DO NOTHING;

-- Order 4: Beef Tapa (75) + Iced Tea (10? no 20) - wait 85. Let's do: Spaghetti (55) + Empanada (30) = 85
INSERT INTO order_items (order_id, product_id, quantity, price_at_order) VALUES
  ('c0000001-0000-0000-0000-000000000004', 'a0000001-0000-0000-0000-000000000002', 1, 55.00),
  ('c0000001-0000-0000-0000-000000000004', 'a0000002-0000-0000-0000-000000000004', 1, 30.00)
ON CONFLICT DO NOTHING;

-- Order 5: Chicken Adobo (65) + Pork Sisig (70) + Lumpia (35) + Calamansi (25) + Cheese Sticks (25) - nah let me just make it work
-- 200 = Adobo (65) + Inasal (68) + Lumpia (35) + Iced Tea x1 (20) + Banana Cue x1 (12? no it's 20) - 65+68+35+20+12 = 200? 
-- Simpler: Adobo (65) + Sisig (70) + Mango Shake (35) + Empanada (30) = 200
INSERT INTO order_items (order_id, product_id, quantity, price_at_order) VALUES
  ('c0000001-0000-0000-0000-000000000005', 'a0000001-0000-0000-0000-000000000001', 1, 65.00),
  ('c0000001-0000-0000-0000-000000000005', 'a0000001-0000-0000-0000-000000000003', 1, 70.00),
  ('c0000001-0000-0000-0000-000000000005', 'a0000003-0000-0000-0000-000000000001', 1, 35.00),
  ('c0000001-0000-0000-0000-000000000005', 'a0000002-0000-0000-0000-000000000004', 1, 30.00)
ON CONFLICT DO NOTHING;

-- Order 6: Beef Tapa (75) + Iced Tea (20) = 95
INSERT INTO order_items (order_id, product_id, quantity, price_at_order) VALUES
  ('c0000001-0000-0000-0000-000000000006', 'a0000001-0000-0000-0000-000000000004', 1, 75.00),
  ('c0000001-0000-0000-0000-000000000006', 'a0000003-0000-0000-0000-000000000003', 1, 20.00)
ON CONFLICT DO NOTHING;

-- Order 7: Inasal (68) + Spaghetti (55) + Buko Juice (25) + Cheese Sticks (25) + Banana Cue (20) - wait 193 not 175
-- 175 = Sisig (70) + Tapa (75) + Calamansi (25) + Cheese Sticks (5? no 25) = 195 nope
-- 175 = Adobo (65) + Inasal (68) + French Fries (40) + Buko Juice (25) - 198 nope
-- 175 = Tapa (75) + Fries (40) + Lumpia (35) + Calamansi (25) = 175 ✓
INSERT INTO order_items (order_id, product_id, quantity, price_at_order) VALUES
  ('c0000001-0000-0000-0000-000000000007', 'a0000001-0000-0000-0000-000000000004', 1, 75.00),
  ('c0000001-0000-0000-0000-000000000007', 'a0000002-0000-0000-0000-000000000005', 1, 40.00),
  ('c0000001-0000-0000-0000-000000000007', 'a0000002-0000-0000-0000-000000000001', 1, 35.00),
  ('c0000001-0000-0000-0000-000000000007', 'a0000003-0000-0000-0000-000000000004', 1, 25.00)
ON CONFLICT DO NOTHING;

-- Order 8: Adobo (65) + Lumpia (35) + Hot Choco (30) = 130
INSERT INTO order_items (order_id, product_id, quantity, price_at_order) VALUES
  ('c0000001-0000-0000-0000-000000000008', 'a0000001-0000-0000-0000-000000000001', 1, 65.00),
  ('c0000001-0000-0000-0000-000000000008', 'a0000002-0000-0000-0000-000000000001', 1, 35.00),
  ('c0000001-0000-0000-0000-000000000008', 'a0000003-0000-0000-0000-000000000005', 1, 30.00)
ON CONFLICT DO NOTHING;

-- Order 9: Inasal (68) + Empanada (30) + Buko Juice x2 - wait too much. 
-- 145 = Inasal (68) + Fries (40) + Mango Shake (35) + Banana Cue (20) - 163 nope
-- 145 = Tapa (75) + Fries (40) + Hot Choco (30) = 145 ✓
INSERT INTO order_items (order_id, product_id, quantity, price_at_order) VALUES
  ('c0000001-0000-0000-0000-000000000009', 'a0000001-0000-0000-0000-000000000004', 1, 75.00),
  ('c0000001-0000-0000-0000-000000000009', 'a0000002-0000-0000-0000-000000000005', 1, 40.00),
  ('c0000001-0000-0000-0000-000000000009', 'a0000003-0000-0000-0000-000000000005', 1, 30.00)
ON CONFLICT DO NOTHING;

-- Order 10: Spaghetti (55) + Cheese Sticks x2 (25*2) + Calamansi (25) - wait that's 130
-- 110 = Spaghetti (55) + Cheese Sticks (25) + Hot Choco (30) = 110 ✓
INSERT INTO order_items (order_id, product_id, quantity, price_at_order) VALUES
  ('c0000001-0000-0000-0000-000000000010', 'a0000001-0000-0000-0000-000000000002', 1, 55.00),
  ('c0000001-0000-0000-0000-000000000010', 'a0000002-0000-0000-0000-000000000002', 1, 25.00),
  ('c0000001-0000-0000-0000-000000000010', 'a0000003-0000-0000-0000-000000000005', 1, 30.00)
ON CONFLICT DO NOTHING;

-- Order 11 (preparing): Adobo (65) + Sisig (70) + Calamansi (25) = 160
INSERT INTO order_items (order_id, product_id, quantity, price_at_order) VALUES
  ('c0000001-0000-0000-0000-000000000011', 'a0000001-0000-0000-0000-000000000001', 1, 65.00),
  ('c0000001-0000-0000-0000-000000000011', 'a0000001-0000-0000-0000-000000000003', 1, 70.00),
  ('c0000001-0000-0000-0000-000000000011', 'a0000003-0000-0000-0000-000000000004', 1, 25.00)
ON CONFLICT DO NOTHING;

-- Order 12 (cancelled): Tapa (75)
INSERT INTO order_items (order_id, product_id, quantity, price_at_order) VALUES
  ('c0000001-0000-0000-0000-000000000012', 'a0000001-0000-0000-0000-000000000004', 1, 75.00)
ON CONFLICT DO NOTHING;


-- ============================================
-- 9. TRANSACTIONS (matching orders + a wallet top-up)
-- ============================================

-- Top-up: ₱1000 added to wallet 14 days ago
INSERT INTO transactions (id, parent_id, order_id, type, amount, method, status, created_at) VALUES
  ('d0000001-0000-0000-0000-000000000000',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   NULL, 'topup', 1000.00, 'cash', 'completed',
   NOW() - INTERVAL '14 days')
ON CONFLICT (id) DO NOTHING;

-- Payment transactions for each completed order
INSERT INTO transactions (id, parent_id, order_id, type, amount, method, status, created_at) VALUES
  ('d0000001-0000-0000-0000-000000000001',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'c0000001-0000-0000-0000-000000000001',
   'payment', 120.00, 'balance', 'completed',
   NOW() - INTERVAL '12 days 4 hours'),
  ('d0000001-0000-0000-0000-000000000002',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'c0000001-0000-0000-0000-000000000002',
   'payment', 90.00, 'cash', 'completed',
   NOW() - INTERVAL '11 days 5 hours'),
  ('d0000001-0000-0000-0000-000000000003',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'c0000001-0000-0000-0000-000000000003',
   'payment', 155.00, 'balance', 'completed',
   NOW() - INTERVAL '9 days 6 hours'),
  ('d0000001-0000-0000-0000-000000000004',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'c0000001-0000-0000-0000-000000000004',
   'payment', 85.00, 'cash', 'completed',
   NOW() - INTERVAL '7 days 3 hours'),
  ('d0000001-0000-0000-0000-000000000005',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'c0000001-0000-0000-0000-000000000005',
   'payment', 200.00, 'balance', 'completed',
   NOW() - INTERVAL '5 days 4 hours'),
  ('d0000001-0000-0000-0000-000000000006',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'c0000001-0000-0000-0000-000000000006',
   'payment', 95.00, 'cash', 'completed',
   NOW() - INTERVAL '4 days 5 hours'),
  ('d0000001-0000-0000-0000-000000000007',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'c0000001-0000-0000-0000-000000000007',
   'payment', 175.00, 'balance', 'completed',
   NOW() - INTERVAL '3 days 6 hours'),
  ('d0000001-0000-0000-0000-000000000008',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'c0000001-0000-0000-0000-000000000008',
   'payment', 130.00, 'gcash', 'completed',
   NOW() - INTERVAL '2 days 5 hours'),
  ('d0000001-0000-0000-0000-000000000009',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'c0000001-0000-0000-0000-000000000009',
   'payment', 145.00, 'balance', 'completed',
   NOW() - INTERVAL '1 day 4 hours'),
  ('d0000001-0000-0000-0000-000000000010',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'c0000001-0000-0000-0000-000000000010',
   'payment', 110.00, 'cash', 'completed',
   NOW() - INTERVAL '3 hours'),
  ('d0000001-0000-0000-0000-000000000011',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'c0000001-0000-0000-0000-000000000011',
   'payment', 160.00, 'balance', 'completed',
   NOW() - INTERVAL '30 minutes')
ON CONFLICT (id) DO NOTHING;

-- Refund transaction for cancelled order 12
INSERT INTO transactions (id, parent_id, order_id, type, amount, method, status, reference_id, created_at) VALUES
  ('d0000001-0000-0000-0000-000000000012',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   'c0000001-0000-0000-0000-000000000012',
   'refund', 75.00, 'balance', 'completed',
   'CANCEL-c0000001',
   NOW() - INTERVAL '6 days 3 hours')
ON CONFLICT (id) DO NOTHING;

-- Second top-up: ₱500 added 7 days ago
INSERT INTO transactions (id, parent_id, order_id, type, amount, method, status, created_at) VALUES
  ('d0000001-0000-0000-0000-000000000013',
   'd25cf9ff-183b-4670-a893-99c7cdb80ac1',
   NULL, 'topup', 500.00, 'cash', 'completed',
   NOW() - INTERVAL '7 days')
ON CONFLICT (id) DO NOTHING;


-- ============================================
-- 10. AUDIT LOGS (recent activity)
-- ============================================

INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_data, created_at) VALUES
  ('afd318a4-f9c4-4fef-ac9e-79751269c4d0', 'create', 'product', 'a0000001-0000-0000-0000-000000000001',
   '{"name": "Chicken Adobo Rice Bowl", "price": 65.00}'::jsonb, NOW() - INTERVAL '30 days'),
  ('afd318a4-f9c4-4fef-ac9e-79751269c4d0', 'create', 'student', 'b0000001-0000-0000-0000-000000000001',
   '{"name": "Miguel Santos", "grade": "Grade 4"}'::jsonb, NOW() - INTERVAL '28 days'),
  ('afd318a4-f9c4-4fef-ac9e-79751269c4d0', 'topup', 'wallet', NULL,
   '{"amount": 1000.00, "parent": "d25cf9ff-183b-4670-a893-99c7cdb80ac1"}'::jsonb, NOW() - INTERVAL '14 days'),
  ('3c08a040-01a5-459c-a6e5-069d8d5dbad2', 'update_status', 'order', 'c0000001-0000-0000-0000-000000000001',
   '{"from": "pending", "to": "completed"}'::jsonb, NOW() - INTERVAL '12 days 2 hours'),
  ('3c08a040-01a5-459c-a6e5-069d8d5dbad2', 'update_status', 'order', 'c0000001-0000-0000-0000-000000000005',
   '{"from": "preparing", "to": "completed"}'::jsonb, NOW() - INTERVAL '5 days 2 hours'),
  ('afd318a4-f9c4-4fef-ac9e-79751269c4d0', 'refund', 'order', 'c0000001-0000-0000-0000-000000000012',
   '{"amount": 75.00, "reason": "Student absent"}'::jsonb, NOW() - INTERVAL '6 days 3 hours'),
  ('afd318a4-f9c4-4fef-ac9e-79751269c4d0', 'topup', 'wallet', NULL,
   '{"amount": 500.00, "parent": "d25cf9ff-183b-4670-a893-99c7cdb80ac1"}'::jsonb, NOW() - INTERVAL '7 days'),
  ('3c08a040-01a5-459c-a6e5-069d8d5dbad2', 'update_status', 'order', 'c0000001-0000-0000-0000-000000000010',
   '{"from": "pending", "to": "completed"}'::jsonb, NOW() - INTERVAL '1 hour'),
  ('afd318a4-f9c4-4fef-ac9e-79751269c4d0', 'update', 'settings', NULL,
   '{"key": "order_cutoff_time", "value": "10:00"}'::jsonb, NOW() - INTERVAL '20 days')
ON CONFLICT DO NOTHING;


-- ============================================
-- 11. FAVORITES (parent's favorite products)
-- ============================================

INSERT INTO favorites (user_id, product_id) VALUES
  ('d25cf9ff-183b-4670-a893-99c7cdb80ac1', 'a0000001-0000-0000-0000-000000000001'),  -- Chicken Adobo
  ('d25cf9ff-183b-4670-a893-99c7cdb80ac1', 'a0000001-0000-0000-0000-000000000003'),  -- Pork Sisig
  ('d25cf9ff-183b-4670-a893-99c7cdb80ac1', 'a0000003-0000-0000-0000-000000000001'),  -- Mango Shake
  ('d25cf9ff-183b-4670-a893-99c7cdb80ac1', 'a0000002-0000-0000-0000-000000000001')   -- Lumpia
ON CONFLICT (user_id, product_id) DO NOTHING;


-- ============================================
-- 12. Summary of seeded data
-- ============================================
-- Products:      15 (5 mains, 5 snacks, 5 drinks)
-- Students:       6 (2 linked to parent user)
-- Orders:        12 (10 completed, 1 preparing, 1 cancelled)
-- Transactions:  14 (11 payments, 1 refund, 2 top-ups)
-- Menu Schedule: 44 entries across Mon-Fri
-- Holidays:      12 Philippine holidays
-- Audit Logs:     9 entries
-- Favorites:      4 saved by parent
-- Wallet:       ₱500 balance for parent
-- ============================================
