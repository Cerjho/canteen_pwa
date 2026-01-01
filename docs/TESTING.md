# Testing Guide

## Overview

Comprehensive testing strategy covering unit, integration, and end-to-end tests.

---

## Testing Stack

- **Unit/Integration**: Jest + React Testing Library
- **E2E**: Playwright
- **Coverage**: Jest Coverage

---

## Running Tests

```bash
# All tests
npm test

# Watch mode
npm test -- --watch

# Coverage
npm run test:coverage

# E2E tests
npm run test:e2e

# E2E in UI mode
npm run test:e2e -- --ui
```

---

## Unit Testing

### Component Tests

```typescript
// ProductCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ProductCard } from './ProductCard';

describe('ProductCard', () => {
  const mockProduct = {
    id: '1',
    name: 'Chicken Adobo',
    description: 'Filipino classic',
    price: 45.00,
    image_url: 'https://...',
    available: true
  };
  
  it('renders product information', () => {
    render(<ProductCard {...mockProduct} onAddToCart={jest.fn()} />);
    
    expect(screen.getByText('Chicken Adobo')).toBeInTheDocument();
    expect(screen.getByText('Filipino classic')).toBeInTheDocument();
    expect(screen.getByText('₱45.00')).toBeInTheDocument();
  });
  
  it('calls onAddToCart when button clicked', () => {
    const mockAddToCart = jest.fn();
    render(<ProductCard {...mockProduct} onAddToCart={mockAddToCart} />);
    
    fireEvent.click(screen.getByText('Add'));
    expect(mockAddToCart).toHaveBeenCalledWith('1');
  });
  
  it('disables button when out of stock', () => {
    render(<ProductCard {...mockProduct} available={false} onAddToCart={jest.fn()} />);
    
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Out of Stock');
  });
});
```

---

### Hook Tests

```typescript
// useAuth.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { useAuth } from './useAuth';

describe('useAuth', () => {
  it('returns null user when not authenticated', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.user).toBeNull();
  });
  
  it('logs in user successfully', async () => {
    const { result } = renderHook(() => useAuth());
    
    await result.current.signIn('parent@example.com', 'password123');
    
    await waitFor(() => {
      expect(result.current.user).not.toBeNull();
      expect(result.current.user?.email).toBe('parent@example.com');
    });
  });
});
```

---

### Service Tests

```typescript
// orders.test.ts
import { createOrder } from './orders';
import { supabase } from './supabaseClient';

jest.mock('./supabaseClient');

describe('createOrder', () => {
  it('creates order successfully', async () => {
    const mockResponse = { data: { order_id: '123', status: 'pending' }, error: null };
    (supabase.functions.invoke as jest.Mock).mockResolvedValue(mockResponse);
    
    const result = await createOrder({
      parent_id: 'parent-1',
      child_id: 'child-1',
      client_order_id: 'order-123',
      items: [{ product_id: 'prod-1', quantity: 2, price_at_order: 25.00 }],
      payment_method: 'cash'
    });
    
    expect(result.order_id).toBe('123');
    expect(supabase.functions.invoke).toHaveBeenCalledWith('process-order', {
      body: expect.objectContaining({ client_order_id: 'order-123' })
    });
  });
});
```

---

## Integration Testing

### Testing with Supabase

```typescript
// Setup test database
beforeAll(async () => {
  // Use Supabase local instance
  process.env.VITE_SUPABASE_URL = 'http://localhost:54321';
});

afterEach(async () => {
  // Clean up test data
  await supabase.from('orders').delete().neq('id', '');
});

test('parent can create order for their child', async () => {
  // Insert test parent and child
  const { data: parent } = await supabase.from('parents').insert({
    email: 'test@example.com',
    first_name: 'Test',
    last_name: 'Parent'
  }).select().single();
  
  const { data: child } = await supabase.from('children').insert({
    parent_id: parent.id,
    first_name: 'Test',
    last_name: 'Child',
    grade_level: 'Grade 1'
  }).select().single();
  
  // Create order
  const order = await createOrder({
    parent_id: parent.id,
    child_id: child.id,
    client_order_id: crypto.randomUUID(),
    items: [{ product_id: 'prod-1', quantity: 1, price_at_order: 45.00 }],
    payment_method: 'cash'
  });
  
  expect(order.status).toBe('pending');
});
```

---

## E2E Testing (Playwright)

### Setup

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } }
  ]
});
```

### Test Examples

```typescript
// e2e/order-flow.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Order Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login as parent
    await page.goto('/login');
    await page.fill('[name="email"]', 'parent@example.com');
    await page.fill('[name="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/menu');
  });
  
  test('parent can place order for child', async ({ page }) => {
    // Select child
    await page.selectOption('select', { label: 'Juan Dela Cruz - Grade 3' });
    
    // Add product to cart
    await page.click('button:has-text("Chicken Adobo")');
    await page.click('button:has-text("Add")');
    
    // Open cart
    await page.click('[aria-label="Cart"]');
    
    // Verify item in cart
    await expect(page.locator('text=Chicken Adobo')).toBeVisible();
    await expect(page.locator('text=₱45.00')).toBeVisible();
    
    // Checkout
    await page.click('button:has-text("Checkout")');
    
    // Verify success
    await expect(page.locator('text=Order placed successfully')).toBeVisible();
  });
  
  test('cannot place order without selecting child', async ({ page }) => {
    await page.click('button:has-text("Add")');
    await page.click('[aria-label="Cart"]');
    await page.click('button:has-text("Checkout")');
    
    await expect(page.locator('text=Please select a child')).toBeVisible();
  });
});
```

### Offline Testing

```typescript
test('queues order when offline', async ({ page, context }) => {
  // Go to menu
  await page.goto('/menu');
  await page.selectOption('select', { label: 'Juan Dela Cruz' });
  
  // Go offline
  await context.setOffline(true);
  
  // Add item and checkout
  await page.click('button:has-text("Add")');
  await page.click('[aria-label="Cart"]');
  await page.click('button:has-text("Checkout")');
  
  // Verify queued
  await expect(page.locator('text=Order queued')).toBeVisible();
  
  // Go online
  await context.setOffline(false);
  
  // Wait for sync
  await page.waitForTimeout(2000);
  
  // Verify order synced
  await page.goto('/orders');
  await expect(page.locator('text=Chicken Adobo')).toBeVisible();
});
```

---

## Test Coverage Goals

| Type | Target |
| ---- | ------ |
| Unit Tests | > 80% |
| Integration Tests | Critical paths |
| E2E Tests | Happy paths + error cases |

---

## CI Integration

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      
      - run: npm ci
      - run: npm test -- --coverage
      - run: npm run test:e2e
      
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
```

---

## Best Practices

1. **AAA Pattern**: Arrange, Act, Assert
2. **One Assertion**: Test one thing per test
3. **Descriptive Names**: `test('renders error message when API fails')`
4. **Mock External Deps**: Mock Supabase, avoid real API calls
5. **Clean Up**: Reset state between tests
6. **Fast Tests**: Unit tests < 100ms, E2E < 30s

---

## Debugging Tests

```bash
# Run single test file
npm test -- ProductCard.test.tsx

# Debug in VS Code
# Add breakpoint, then F5 with Jest configuration

# Playwright debug mode
npm run test:e2e -- --debug

# View Playwright trace
npx playwright show-trace trace.zip
```

---

## Resources

- [Jest Documentation](https://jestjs.io/)
- [React Testing Library](https://testing-library.com/react)
- [Playwright Documentation](https://playwright.dev/)
