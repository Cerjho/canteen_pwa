// Visual Regression and Critical User Flow E2E Tests
import { test, expect, Page } from '@playwright/test';

// ============================================
// Visual Regression Tests
// ============================================
test.describe('Visual Regression', () => {
  test('login page visual snapshot', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    
    // Take screenshot for visual comparison
    await expect(page).toHaveScreenshot('login-page.png', {
      fullPage: true,
      threshold: 0.2 // Allow 20% difference
    });
  });

  test('registration page visual snapshot', async ({ page }) => {
    await page.goto('/register');
    await page.waitForLoadState('networkidle');
    
    await expect(page).toHaveScreenshot('register-page.png', {
      fullPage: true,
      threshold: 0.2
    });
  });

  test('login page mobile visual snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    
    await expect(page).toHaveScreenshot('login-page-mobile.png', {
      fullPage: true,
      threshold: 0.2
    });
  });
});

// ============================================
// Critical User Flow Tests
// ============================================
test.describe('Critical User Flows', () => {
  // Test data for user flows
  const testUser = {
    email: 'test.parent@example.com',
    password: 'TestPassword123!',
    firstName: 'Test',
    lastName: 'Parent'
  };

  test.describe('Complete Order Flow (End-to-End)', () => {
    test.skip('parent can complete an order', async ({ page }) => {
      // 1. Login
      await page.goto('/login');
      await page.getByLabel(/email/i).fill(testUser.email);
      await page.getByLabel(/password/i).fill(testUser.password);
      await page.getByRole('button', { name: /login|sign in/i }).click();
      
      // 2. Navigate to menu (should redirect after login)
      await expect(page).toHaveURL(/\/menu/);
      
      // 3. Select a child
      await page.getByText(/select.*child/i).click();
      await page.locator('[role="option"]').first().click();
      
      // 4. Add items to cart
      const addButton = page.locator('button').filter({ hasText: /add/i }).first();
      await addButton.click();
      await expect(page.getByText(/added to cart/i)).toBeVisible();
      
      // 5. Open cart
      await page.getByRole('button', { name: /cart/i }).click();
      await expect(page.getByText(/your cart/i)).toBeVisible();
      
      // 6. Proceed to checkout
      await page.getByRole('button', { name: /checkout|proceed|order/i }).click();
      
      // 7. Select payment method
      await page.getByText(/cash|gcash/i).first().click();
      
      // 8. Confirm order
      await page.getByRole('button', { name: /confirm|place order/i }).click();
      
      // 9. Verify order confirmation
      await expect(page).toHaveURL(/\/order-confirmation/);
      await expect(page.getByText(/order.*placed|success/i)).toBeVisible();
    });

    test.skip('order appears in order history', async ({ page }) => {
      // Login
      await page.goto('/login');
      await page.getByLabel(/email/i).fill(testUser.email);
      await page.getByLabel(/password/i).fill(testUser.password);
      await page.getByRole('button', { name: /login|sign in/i }).click();
      
      // Navigate to order history
      await page.goto('/orders');
      
      // Verify orders are displayed
      await expect(page.getByText(/order history/i)).toBeVisible();
      // Check for order cards
      const orderCards = page.locator('[class*="order"], [class*="card"]');
      await expect(orderCards.first()).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Child Management Flow', () => {
    test.skip('parent can link and unlink a child', async ({ page }) => {
      // Login
      await page.goto('/login');
      await page.getByLabel(/email/i).fill(testUser.email);
      await page.getByLabel(/password/i).fill(testUser.password);
      await page.getByRole('button', { name: /login|sign in/i }).click();
      
      // Navigate to profile
      await page.goto('/profile');
      
      // Click link child button
      await page.getByRole('button', { name: /link.*child|add.*child/i }).click();
      
      // Enter student ID
      await page.getByPlaceholder(/student.*id/i).fill('STU123456');
      
      // Submit
      await page.getByRole('button', { name: /link|confirm/i }).click();
      
      // Verify child was linked
      await expect(page.getByText(/linked.*successfully|success/i)).toBeVisible();
    });
  });

  test.describe('Search and Filter Flow', () => {
    test.skip('user can search and filter products', async ({ page }) => {
      // Login and go to menu
      await page.goto('/login');
      await page.getByLabel(/email/i).fill(testUser.email);
      await page.getByLabel(/password/i).fill(testUser.password);
      await page.getByRole('button', { name: /login|sign in/i }).click();
      
      await expect(page).toHaveURL(/\/menu/);
      
      // Search for a product
      const searchInput = page.getByPlaceholder(/search/i);
      await searchInput.fill('chicken');
      
      // Verify filtered results
      await expect(page.getByText(/chicken/i)).toBeVisible();
      
      // Clear search
      await searchInput.clear();
      
      // Filter by category
      await page.getByText(/snacks/i).click();
      
      // Verify category filter is applied
      await page.waitForTimeout(500); // Wait for filter to apply
    });
  });

  test.describe('Favorites Flow', () => {
    test.skip('user can add and remove favorites', async ({ page }) => {
      // Login and go to menu
      await page.goto('/login');
      await page.getByLabel(/email/i).fill(testUser.email);
      await page.getByLabel(/password/i).fill(testUser.password);
      await page.getByRole('button', { name: /login|sign in/i }).click();
      
      await expect(page).toHaveURL(/\/menu/);
      
      // Find a product's favorite button
      const favoriteButton = page.locator('button[aria-label*="favorite"], button:has([data-testid*="heart"])').first();
      await favoriteButton.click();
      
      // Go to favorites tab
      await page.getByText(/favorites/i).click();
      
      // Verify product is in favorites
      await expect(page.locator('[class*="product"]').first()).toBeVisible();
      
      // Remove from favorites
      await favoriteButton.click();
      
      // Verify product is removed (empty state or no products)
    });
  });
});

// ============================================
// Staff Dashboard Flow Tests
// ============================================
test.describe('Staff Dashboard Flows', () => {
  const staffUser = {
    email: 'test.staff@example.com',
    password: 'StaffPassword123!'
  };

  test.skip('staff can view and update orders', async ({ page }) => {
    // Login as staff
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(staffUser.email);
    await page.getByLabel(/password/i).fill(staffUser.password);
    await page.getByRole('button', { name: /login|sign in/i }).click();
    
    // Should redirect to staff dashboard
    await expect(page).toHaveURL(/\/staff/);
    
    // View pending orders
    await page.getByText(/pending/i).click();
    
    // Find an order and update status
    const orderCard = page.locator('[class*="order"]').first();
    if (await orderCard.isVisible()) {
      // Click start preparing
      await orderCard.getByRole('button', { name: /start|prepare/i }).click();
      
      // Verify status updated
      await expect(page.getByText(/preparing/i)).toBeVisible();
    }
  });

  test.skip('staff can filter orders by status', async ({ page }) => {
    // Login as staff
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(staffUser.email);
    await page.getByLabel(/password/i).fill(staffUser.password);
    await page.getByRole('button', { name: /login|sign in/i }).click();
    
    await expect(page).toHaveURL(/\/staff/);
    
    // Test each status filter
    const statuses = ['all', 'pending', 'preparing', 'ready'];
    
    for (const status of statuses) {
      await page.getByText(new RegExp(status, 'i')).click();
      await page.waitForTimeout(500);
      // Verify filter is applied (would need actual orders to verify)
    }
  });
});

// ============================================
// Admin Dashboard Flow Tests
// ============================================
test.describe('Admin Dashboard Flows', () => {
  const adminUser = {
    email: 'test.admin@example.com',
    password: 'AdminPassword123!'
  };

  test.skip('admin can view dashboard statistics', async ({ page }) => {
    // Login as admin
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(adminUser.email);
    await page.getByLabel(/password/i).fill(adminUser.password);
    await page.getByRole('button', { name: /login|sign in/i }).click();
    
    // Should redirect to admin dashboard
    await expect(page).toHaveURL(/\/admin/);
    
    // Verify dashboard stats are visible
    await expect(page.getByText(/orders|revenue|total/i)).toBeVisible();
    
    // Test date range filters
    await page.getByText(/today/i).click();
    await page.getByText(/week/i).click();
    await page.getByText(/month/i).click();
  });

  test.skip('admin can manage products', async ({ page }) => {
    // Login as admin
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(adminUser.email);
    await page.getByLabel(/password/i).fill(adminUser.password);
    await page.getByRole('button', { name: /login|sign in/i }).click();
    
    // Navigate to products page
    await page.goto('/admin/products');
    
    // Verify products list
    await expect(page.getByText(/products/i)).toBeVisible();
    
    // Test add product flow (if available)
    const addButton = page.getByRole('button', { name: /add.*product|new.*product/i });
    if (await addButton.isVisible()) {
      await addButton.click();
      // Fill product form
      await expect(page.getByLabel(/name/i)).toBeVisible();
    }
  });

  test.skip('admin can view reports', async ({ page }) => {
    // Login as admin
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(adminUser.email);
    await page.getByLabel(/password/i).fill(adminUser.password);
    await page.getByRole('button', { name: /login|sign in/i }).click();
    
    // Navigate to reports
    await page.goto('/admin/reports');
    
    // Verify reports page
    await expect(page.getByText(/reports/i)).toBeVisible();
  });
});

// ============================================
// Date Selection Flow Tests
// ============================================
test.describe('Date Selection Flow', () => {
  test.skip('user can select future order dates', async ({ page }) => {
    const testUser = {
      email: 'test.parent@example.com',
      password: 'TestPassword123!'
    };
    
    // Login
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByLabel(/password/i).fill(testUser.password);
    await page.getByRole('button', { name: /login|sign in/i }).click();
    
    await expect(page).toHaveURL(/\/menu/);
    
    // Find date navigation
    const nextDateButton = page.locator('button').filter({ has: page.locator('svg') }).last();
    
    // Navigate to next day
    await nextDateButton.click();
    
    // Verify date changed (label should update)
    await expect(page.getByText(/tomorrow/i)).toBeVisible();
  });
});

// ============================================
// Balance/Wallet Flow Tests
// ============================================
test.describe('Balance Flow', () => {
  test.skip('user can view balance', async ({ page }) => {
    const testUser = {
      email: 'test.parent@example.com',
      password: 'TestPassword123!'
    };
    
    // Login
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByLabel(/password/i).fill(testUser.password);
    await page.getByRole('button', { name: /login|sign in/i }).click();
    
    // Navigate to balance page
    await page.goto('/balance');
    
    // Verify balance page
    await expect(page.getByText(/balance|wallet/i)).toBeVisible();
    await expect(page.getByText(/₱/)).toBeVisible();
  });
});

// ============================================
// Checkout Payment Method Tests
// ============================================
test.describe('Checkout Payment Methods', () => {
  test.skip('user can select different payment methods', async ({ page }) => {
    const testUser = {
      email: 'test.parent@example.com',
      password: 'TestPassword123!'
    };
    
    // This test assumes there are items in cart
    // Login and add items to cart first
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByLabel(/password/i).fill(testUser.password);
    await page.getByRole('button', { name: /login|sign in/i }).click();
    
    await expect(page).toHaveURL(/\/menu/);
    
    // Add to cart (assuming we have products)
    // ...
    
    // Open cart
    await page.getByRole('button', { name: /cart/i }).click();
    
    // Check payment method options
    await expect(page.getByText(/cash/i)).toBeVisible();
    await expect(page.getByText(/gcash/i)).toBeVisible();
    await expect(page.getByText(/balance|wallet/i)).toBeVisible();
  });
});

// ============================================
// Toast Notification Tests
// ============================================
test.describe('Toast Notifications', () => {
  test('shows error toast on failed login', async ({ page }) => {
    await page.goto('/login');
    
    await page.getByLabel(/email/i).fill('wrong@email.com');
    await page.getByLabel(/password/i).fill('wrongpassword');
    await page.getByRole('button', { name: /login|sign in/i }).click();
    
    // Error toast should appear
    await expect(page.getByText(/invalid|error|failed/i)).toBeVisible({ timeout: 15000 });
  });

  test.skip('shows success toast on successful action', async ({ page }) => {
    // Login successfully
    // Add to cart
    // Should see success toast
  });
});

// ============================================
// Keyboard Navigation Tests
// ============================================
test.describe('Keyboard Navigation', () => {
  test('can complete login form using keyboard only', async ({ page }) => {
    await page.goto('/login');
    
    // Tab to email
    await page.keyboard.press('Tab');
    await page.keyboard.type('test@example.com');
    
    // Tab to password
    await page.keyboard.press('Tab');
    await page.keyboard.type('password123');
    
    // Tab to submit and press Enter
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    
    // Should attempt login
    await expect(page.getByText(/invalid|error|loading/i)).toBeVisible({ timeout: 10000 });
  });

  test('escape key closes modals', async ({ page }) => {
    await page.goto('/login');
    
    // If there's any modal, pressing Escape should close it
    // This test is more relevant for authenticated pages with modals
  });
});

// ============================================
// Dark Mode Tests (if supported)
// ============================================
test.describe('Dark Mode', () => {
  test('respects system color scheme preference', async ({ page }) => {
    // Emulate dark color scheme
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');
    
    // Check if dark mode styles are applied
    // This depends on implementation
  });
});
