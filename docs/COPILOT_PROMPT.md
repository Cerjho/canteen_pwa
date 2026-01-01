# GitHub Copilot Instructions

This file provides context and instructions for GitHub Copilot when working in this codebase.

---

## Project Context

You are working on a **serverless Progressive Web App (PWA)** for a Philippine elementary school canteen. The app allows **parents** to manage food orders for their children.

**Key Points**:

- Parents are the PRIMARY end users
- Students DO NOT authenticate or place orders
- Built with React, TypeScript, Vite, Tailwind, and Supabase
- Offline-first with IndexedDB queue
- Security enforced via Supabase Row Level Security

---

## Architecture

```text
Frontend (React + Vite)
    ↓
Supabase Client SDK
    ↓
Supabase Backend
    ├── Postgres + RLS
    ├── Edge Functions (Deno)
    └── Auth
```

---

## Code Standards

### TypeScript

- **Always use TypeScript**, never `any`
- Define interfaces for all data structures
- Use type inference where obvious

```typescript
// ✅ Good
interface Order {
  id: string;
  parent_id: string;
  child_id: string;
  items: OrderItem[];
}

// ❌ Bad
const order: any = { ... };
```

### React

- Use **functional components** with hooks
- Extract reusable logic into custom hooks
- Props: Define explicit interfaces

```typescript
// ✅ Good
interface ProductCardProps {
  product: Product;
  onAddToCart: (id: string) => void;
}

export function ProductCard({ product, onAddToCart }: ProductCardProps) {
  // ...
}
```

### Supabase

- **Never bypass RLS** in client code
- Use Edge Functions for complex operations
- Always validate ownership

```typescript
// ✅ Good - Edge Function validates ownership
const { data } = await supabase.functions.invoke('process-order', {
  body: { parent_id: user.id, child_id, items }
});

// ❌ Bad - Client inserts directly (RLS will block, but still wrong pattern)
await supabase.from('orders').insert({ ... });
```

---

## Security Rules

### Critical: Parent-Child Ownership

**ALWAYS verify parent owns child before operations**:

```typescript
// In Edge Functions:
const { data: child } = await supabase
  .from('children')
  .select('parent_id')
  .eq('id', child_id)
  .single();

if (child.parent_id !== parent_id) {
  throw new Error('UNAUTHORIZED');
}
```

### Never Trust Client Input

```typescript
// ❌ Bad
const { parent_id } = await req.json();

// ✅ Good
const { data: { user } } = await supabaseClient.auth.getUser();
const parent_id = user.id;
```

---

## Offline Sync Pattern

When implementing features that modify data:

1. **Check connectivity**
2. **If online**: Call Supabase directly
3. **If offline**: Queue in IndexedDB with `client_order_id`
4. **On reconnect**: Process queue via Edge Function

```typescript
if (navigator.onLine) {
  await processOrder(order);
} else {
  await localQueue.enqueue({
    ...order,
    client_order_id: crypto.randomUUID()
  });
}
```

---

## Common Patterns

### Fetching Data

```typescript
// Use React Query
const { data: products, isLoading } = useQuery({
  queryKey: ['products'],
  queryFn: async () => {
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('available', true);
    return data;
  }
});
```

### Form Handling

```typescript
// Use react-hook-form + zod
const schema = z.object({
  first_name: z.string().min(2),
  grade_level: z.string()
});

const { register, handleSubmit, formState: { errors } } = useForm({
  resolver: zodResolver(schema)
});
```

### Error Handling

```typescript
try {
  const result = await createOrder(data);
  toast.success('Order placed!');
} catch (error) {
  if (error.message === 'INSUFFICIENT_STOCK') {
    toast.error('Product out of stock');
  } else {
    toast.error('Failed to place order');
  }
}
```

---

## Supabase Edge Functions

### Structure

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  try {
    // 1. Get authenticated user
    const authHeader = req.headers.get('Authorization')!;
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    
    const { data: { user } } = await supabaseClient.auth.getUser();
    
    // 2. Parse and validate input
    const body = await req.json();
    
    // 3. Verify ownership
    // 4. Perform operation
    // 5. Return result
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
```

---

## Database Queries

### Join Patterns

```typescript
// Fetch orders with child and product details
const { data } = await supabase
  .from('orders')
  .select(`
    *,
    child:children(first_name, last_name),
    items:order_items(
      quantity,
      price_at_order,
      product:products(name, image_url)
    )
  `)
  .eq('parent_id', parentId);
```

---

## Styling (Tailwind)

- Mobile-first responsive design
- Use Tailwind utility classes
- Extract repeated patterns into components

```tsx
// ✅ Good
<button className="bg-primary-600 hover:bg-primary-700 text-white font-medium py-2 px-4 rounded-lg">
  Place Order
</button>

// ❌ Bad (custom CSS)
<button style={{ backgroundColor: '#4F46E5', padding: '8px 16px' }}>
  Place Order
</button>
```

---

## File Organization

When creating new files:

```text
src/
├── components/       # Reusable UI: ProductCard.tsx
├── pages/           # Routes: Menu.tsx, Dashboard.tsx
├── hooks/           # Custom hooks: useOrders.ts
├── services/        # API calls: orders.ts
├── types/           # TypeScript: order.types.ts
└── utils/           # Helpers: formatCurrency.ts
```

---

## Testing

When adding features, include tests:

```typescript
describe('ProductCard', () => {
  it('renders product information', () => {
    render(<ProductCard {...mockProduct} />);
    expect(screen.getByText('Chicken Adobo')).toBeInTheDocument();
  });
});
```

---

## Documentation

Update docs when adding:

- New API endpoints → `API.md`
- New components → `COMPONENTS.md`
- Database changes → `DATA_SCHEMA.md`

---

## TODOs

When you see `// TODO:` comments:

- Implement following the patterns above
- Maintain security (RLS, ownership checks)
- Add tests
- Update documentation

---

## Resources

- [Supabase Docs](https://supabase.com/docs)
- [React Query Docs](https://tanstack.com/query/latest/docs/react/overview)
- [Tailwind Docs](https://tailwindcss.com/docs)

---

## Remember

1. **Security first**: Never trust client, always validate
2. **Parents only**: Students never authenticate
3. **Offline support**: Use IndexedDB queue
4. **Type safety**: TypeScript everywhere
5. **Test coverage**: Write tests for new features

---

**When in doubt, ask the human developer!**
