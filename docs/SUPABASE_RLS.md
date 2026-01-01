# Row Level Security (RLS) Policies

## Overview

All tables enforce Row Level Security to ensure parents can only access their own data.

---

## RLS Architecture

```text
┌───────────────────────────────────────┐
│         Supabase Request              │
└───────────┬───────────────────────────┘
            │
    ┌───────▼────────┐
    │  Auth Check    │
    │  (JWT valid?)  │
    └───────┬────────┘
            │
    ┌───────▼────────┐
    │  RLS Policies  │
    │  (per table)   │
    └───────┬────────┘
            │
    ┌───────▼────────┐
    │  Row Filter    │
    │  Applied       │
    └───────┬────────┘
            │
    ┌───────▼────────┐
    │  Query Result  │
    └────────────────┘
```

---

## Policy Definitions

### **parents** Table

```sql
-- Parents can read their own record
CREATE POLICY "Parents can view own profile"
ON parents FOR SELECT
USING (auth.uid() = id);

-- Parents can update their own record
CREATE POLICY "Parents can update own profile"
ON parents FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- New parents can insert their record (on signup)
CREATE POLICY "Parents can insert own profile"
ON parents FOR INSERT
WITH CHECK (auth.uid() = id);
```

---

### **children** Table

```sql
-- Parents can view their own children
CREATE POLICY "Parents can view own children"
ON children FOR SELECT
USING (parent_id = auth.uid());

-- Parents can add children
CREATE POLICY "Parents can insert own children"
ON children FOR INSERT
WITH CHECK (parent_id = auth.uid());

-- Parents can update their children
CREATE POLICY "Parents can update own children"
ON children FOR UPDATE
USING (parent_id = auth.uid())
WITH CHECK (parent_id = auth.uid());

-- Parents can delete their children
CREATE POLICY "Parents can delete own children"
ON children FOR DELETE
USING (parent_id = auth.uid());

-- Staff can view all children (read-only)
CREATE POLICY "Staff can view all children"
ON children FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM auth.users
    WHERE auth.users.id = auth.uid()
    AND auth.users.raw_user_meta_data->>'role' IN ('staff', 'admin')
  )
);
```

---

### **products** Table

```sql
-- Public read access (anyone can view menu)
CREATE POLICY "Anyone can view products"
ON products FOR SELECT
USING (true);

-- Staff can manage products
CREATE POLICY "Staff can manage products"
ON products FOR ALL
USING (
EXISTS (
SELECT 1 FROM auth.users
WHERE auth.users.id = auth.uid()
AND auth.users.raw_user_meta_data->>'role' IN ('staff', 'admin')
)
);

---

### **orders** Table
```sql
-- Parents can view their own orders
CREATE POLICY "Parents can view own orders"
ON orders FOR SELECT
USING (parent_id = auth.uid());

-- Parents CANNOT insert orders directly (must use Edge Function)
-- Edge Function uses service_role key to bypass RLS

-- Staff can view all orders
CREATE POLICY "Staff can view all orders"
ON orders FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM auth.users
    WHERE auth.users.id = auth.uid()
    AND auth.users.raw_user_meta_data->>'role' IN ('staff', 'admin')
  )
);

-- Staff can update order status
CREATE POLICY "Staff can update order status"
ON orders FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM auth.users
    WHERE auth.users.id = auth.uid()
    AND auth.users.raw_user_meta_data->>'role' IN ('staff', 'admin')
  )
)
WITH CHECK (
  -- Staff can only update status field
  status IN ('pending', 'preparing', 'ready', 'completed', 'cancelled')
);
```

---

### **order_items** Table

```sql
-- Parents can view items for their orders
CREATE POLICY "Parents can view own order items"
ON order_items FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM orders
    WHERE orders.id = order_items.order_id
    AND orders.parent_id = auth.uid()
  )
);

-- Staff can view all order items
CREATE POLICY "Staff can view all order items"
ON order_items FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM auth.users
    WHERE auth.users.id = auth.uid()
    AND auth.users.raw_user_meta_data->>'role' IN ('staff', 'admin')
  )
);
```

---

### **transactions** Table

```sql
-- Parents can view their own transactions
CREATE POLICY "Parents can view own transactions"
ON transactions FOR SELECT
USING (parent_id = auth.uid());

-- Staff can view all transactions
CREATE POLICY "Staff can view all transactions"
ON transactions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM auth.users
    WHERE auth.users.id = auth.uid()
    AND auth.users.raw_user_meta_data->>'role' IN ('staff', 'admin')
  )
);
```

---

## Role Management

### Setting User Role

Roles stored in `auth.users.raw_user_meta_data`:

```sql
-- Make user staff
UPDATE auth.users
SET raw_user_meta_data = jsonb_set(
  COALESCE(raw_user_meta_data, '{}'::jsonb),
  '{role}',
  '"staff"'
)
WHERE email = 'staff@example.com';

-- Make user admin
UPDATE auth.users
SET raw_user_meta_data = jsonb_set(
  COALESCE(raw_user_meta_data, '{}'::jsonb),
  '{role}',
  '"admin"'
)
WHERE email = 'admin@example.com';
```

### Checking Role in Edge Function

```typescript
const { data: { user } } = await supabaseClient.auth.getUser();
const role = user?.user_metadata?.role || 'parent';

if (role !== 'admin') {
  return new Response(
    JSON.stringify({ error: 'UNAUTHORIZED' }),
    { status: 403 }
  );
}
```

---

## Security Best Practices

### 1. **Never Trust Client Input**

Always validate in Edge Functions:

```typescript
// ❌ Bad: Trust client's parent_id
const { parent_id } = await req.json();

// ✅ Good: Get from authenticated user
const { data: { user } } = await supabaseClient.auth.getUser();
const parent_id = user.id;
```

### 2. **Use Service Role Key Carefully**

Edge Functions use `service_role` key to bypass RLS:

```typescript
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
```

**Only use for**:

- Creating orders (after validation)
- Admin operations
- System tasks

### 3. **Validate Ownership**

Always check parent owns child before creating order:

```typescript
const { data: child } = await supabaseAdmin
  .from('children')
  .select('parent_id')
  .eq('id', child_id)
  .single();

if (child.parent_id !== parent_id) {
  throw new Error('UNAUTHORIZED');
}
```

---

## Testing RLS Policies

### 1. Test as Parent

```sql
-- Set session to parent user
SET request.jwt.claims.sub = '<parent_uuid>';

-- Try to access another parent's child (should fail)
SELECT * FROM children WHERE parent_id = '<other_parent_uuid>';
-- Result: 0 rows

-- Access own child (should succeed)
SELECT * FROM children WHERE parent_id = '<parent_uuid>';
-- Result: rows returned
```

### 2. Test as Staff

```sql
SET request.jwt.claims.sub = '<staff_uuid>';

-- Should see all orders
SELECT COUNT(*) FROM orders;
-- Result: all orders

-- Cannot insert child
INSERT INTO children (parent_id, first_name, last_name, grade_level)
VALUES ('<parent_uuid>', 'Test', 'Child', 'Grade 1');
-- Result: Error (no INSERT policy for staff)
```

### 3. Automated Tests

```typescript
test('parent cannot access other parent children', async () => {
  const { data, error } = await supabase
    .from('children')
    .select('*')
    .eq('parent_id', otherParentId);
  
  expect(data).toHaveLength(0);
});
```

---

## Debugging RLS Issues

### Enable RLS Logging

```sql
-- In Supabase SQL Editor
SET log_statement = 'all';
SET client_min_messages = 'log';
```

### Common Issues

**Issue**: Query returns 0 rows unexpectedly

**Debug**:

1. Check if RLS is enabled: `SELECT * FROM pg_tables WHERE tablename = 'children';`
2. List policies: `SELECT * FROM pg_policies WHERE tablename = 'children';`
3. Verify JWT: Check `auth.uid()` returns expected user ID

**Issue**: "permission denied for table X"

**Solution**: Enable RLS on table:

```sql
ALTER TABLE children ENABLE ROW LEVEL SECURITY;
```

---

## Performance Considerations

### Index on Foreign Keys

```sql
CREATE INDEX idx_children_parent_id ON children(parent_id);
CREATE INDEX idx_orders_parent_id ON orders(parent_id);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
```

### Avoid Complex Policies

Keep policies simple. Use Edge Functions for complex authorization logic.

---

## Future Enhancements

- [ ] Add `children.allergies` and enforce dietary restrictions
- [ ] Implement spending limits per child
- [ ] Add order approval workflow for large orders
