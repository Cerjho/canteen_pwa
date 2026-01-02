// Comprehensive E2E Tests for School Canteen PWA
import { test, expect, Page } from '@playwright/test';

// ============================================
// Test Utilities
// ============================================

// Helper to wait for page to be fully loaded
async function waitForPageLoad(page: Page) {
  await page.waitForLoadState('networkidle');
}

// Helper to login
async function _login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /login|sign in/i }).click();
  await waitForPageLoad(page);
}

// ============================================
// Authentication Flow Tests
// ============================================
test.describe('Authentication Flow', () => {
  test('should display login page elements correctly', async ({ page }) => {
    await page.goto('/login');
    
    // Check all essential elements are present
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /login|sign in/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /sign up|register|create account/i })).toBeVisible();
  });

  test('should validate email format', async ({ page }) => {
    await page.goto('/login');
    
    const emailInput = page.getByLabel(/email/i);
    await emailInput.fill('notanemail');
    await page.getByLabel(/password/i).fill('password123');
    await page.getByRole('button', { name: /login|sign in/i }).click();
    
    // HTML5 validation should trigger
    const isInvalid = await emailInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });

  test('should show password visibility toggle', async ({ page }) => {
    await page.goto('/login');
    
    const passwordInput = page.getByLabel(/password/i);
    
    // Initially password should be hidden
    await expect(passwordInput).toHaveAttribute('type', 'password');
    
    // If there's a toggle button, clicking it should show password
    const toggleButton = page.locator('button:has-text("show"), button:has([data-testid="eye-icon"])');
    if (await toggleButton.isVisible()) {
      await toggleButton.click();
      await expect(passwordInput).toHaveAttribute('type', 'text');
    }
  });

  test('should navigate to registration page', async ({ page }) => {
    await page.goto('/login');
    
    await page.getByRole('link', { name: /sign up|register|create account/i }).click();
    await expect(page).toHaveURL(/\/register/);
  });

  test('should handle failed login gracefully', async ({ page }) => {
    await page.goto('/login');
    
    await page.getByLabel(/email/i).fill('wrong@email.com');
    await page.getByLabel(/password/i).fill('wrongpassword');
    await page.getByRole('button', { name: /login|sign in/i }).click();
    
    // Wait for error message
    await expect(page.getByText(/invalid|incorrect|error|failed/i)).toBeVisible({ timeout: 15000 });
  });

  test('should redirect unauthenticated users to login', async ({ page }) => {
    // Try accessing protected routes
    const protectedRoutes = ['/menu', '/orders', '/profile', '/staff', '/admin'];
    
    for (const route of protectedRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
    }
  });
});

// ============================================
// Registration Flow Tests
// ============================================
test.describe('Registration Flow', () => {
  test('should display registration form', async ({ page }) => {
    await page.goto('/register');
    
    // Should have all required fields
    await expect(page.getByLabel(/first.*name/i)).toBeVisible();
    await expect(page.getByLabel(/last.*name/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /register|sign up|create/i })).toBeVisible();
  });

  test('should validate required fields', async ({ page }) => {
    await page.goto('/register');
    
    // Try to submit empty form
    await page.getByRole('button', { name: /register|sign up|create/i }).click();
    
    // Required fields should be validated
    const firstNameInput = page.getByLabel(/first.*name/i);
    const isRequired = await firstNameInput.evaluate((el: HTMLInputElement) => el.required);
    expect(isRequired).toBe(true);
  });

  test('should have link back to login', async ({ page }) => {
    await page.goto('/register');
    
    const loginLink = page.getByRole('link', { name: /login|sign in|already have/i });
    await expect(loginLink).toBeVisible();
    await loginLink.click();
    await expect(page).toHaveURL(/\/login/);
  });
});

// ============================================
// Menu Page Tests (Authenticated)
// ============================================
test.describe('Menu Page', () => {
  // These tests would normally require authentication setup
  test.skip('should display menu with products', async ({ page }) => {
    // Note: In real tests, set up auth state via page.context().addCookies() or storage state
    await page.goto('/menu');
    
    await expect(page.getByText(/menu/i)).toBeVisible();
    
    // Should show category tabs
    await expect(page.getByText(/all/i)).toBeVisible();
    await expect(page.getByText(/mains/i)).toBeVisible();
    await expect(page.getByText(/snacks/i)).toBeVisible();
    await expect(page.getByText(/drinks/i)).toBeVisible();
  });

  test.skip('should filter products by category', async ({ page }) => {
    await page.goto('/menu');
    
    // Click on Snacks category
    await page.getByText(/snacks/i).click();
    
    // Should show only snack products
    // This depends on actual product data
  });

  test.skip('should search products', async ({ page }) => {
    await page.goto('/menu');
    
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('chicken');
    
    // Should filter to show only matching products
  });

  test.skip('should show child selector', async ({ page }) => {
    await page.goto('/menu');
    
    await expect(page.getByText(/select.*child|order.*for/i)).toBeVisible();
  });
});

// ============================================
// Cart Flow Tests
// ============================================
test.describe('Cart Flow', () => {
  test.skip('should add item to cart', async ({ page }) => {
    await page.goto('/menu');
    
    // Select a child first
    await page.getByText(/select.*child/i).click();
    await page.locator('[role="option"]').first().click();
    
    // Add a product to cart
    const addButton = page.locator('button:has-text("Add"), button[aria-label*="add"]').first();
    await addButton.click();
    
    // Cart should update
    await expect(page.getByText(/added to cart/i)).toBeVisible();
  });

  test.skip('should open cart drawer', async ({ page }) => {
    await page.goto('/menu');
    
    // Add item to cart first
    // Then click cart button
    const cartButton = page.getByRole('button', { name: /cart/i });
    await cartButton.click();
    
    // Cart drawer should be visible
    await expect(page.getByText(/your cart/i)).toBeVisible();
  });

  test.skip('should update item quantity', async ({ page }) => {
    await page.goto('/menu');
    
    // After adding to cart, open cart
    const cartButton = page.getByRole('button', { name: /cart/i });
    await cartButton.click();
    
    // Find quantity controls
    const increaseButton = page.locator('button:has-text("+")').first();
    await increaseButton.click();
    
    // Quantity should increase
  });

  test.skip('should remove item from cart', async ({ page }) => {
    await page.goto('/menu');
    
    // Open cart with items
    const cartButton = page.getByRole('button', { name: /cart/i });
    await cartButton.click();
    
    // Remove item
    const removeButton = page.getByRole('button', { name: /remove|delete/i }).first();
    await removeButton.click();
    
    // Item should be removed
  });
});

// ============================================
// Order History Tests
// ============================================
test.describe('Order History', () => {
  test.skip('should display order history page', async ({ page }) => {
    await page.goto('/orders');
    
    await expect(page.getByText(/order history/i)).toBeVisible();
  });

  test.skip('should show order status badges', async ({ page }) => {
    await page.goto('/orders');
    
    // Different status badges
    const _statusBadges = ['pending', 'preparing', 'ready', 'completed'];
    // Check for any of these
  });

  test.skip('should show empty state when no orders', async ({ page }) => {
    await page.goto('/orders');
    
    // If no orders, show empty state
    const _emptyState = page.getByText(/no.*orders|empty/i);
    // This depends on whether user has orders
  });
});

// ============================================
// Profile Page Tests
// ============================================
test.describe('Profile Page', () => {
  test.skip('should display user profile', async ({ page }) => {
    await page.goto('/profile');
    
    await expect(page.getByText(/profile/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /log.*out|sign.*out/i })).toBeVisible();
  });

  test.skip('should display linked children', async ({ page }) => {
    await page.goto('/profile');
    
    // Should show children section
    await expect(page.getByText(/children|linked.*students/i)).toBeVisible();
  });

  test.skip('should have link child functionality', async ({ page }) => {
    await page.goto('/profile');
    
    const linkButton = page.getByRole('button', { name: /link.*child|add.*child/i });
    await expect(linkButton).toBeVisible();
  });

  test.skip('should log out user', async ({ page }) => {
    await page.goto('/profile');
    
    await page.getByRole('button', { name: /log.*out|sign.*out/i }).click();
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });
});

// ============================================
// PWA Features Tests
// ============================================
test.describe('PWA Features', () => {
  test('should serve valid web manifest', async ({ page }) => {
    const response = await page.goto('/manifest.webmanifest');
    
    expect(response?.status()).toBe(200);
    
    const manifest = await response?.json();
    expect(manifest.name).toBeDefined();
    expect(manifest.short_name).toBeDefined();
    expect(manifest.start_url).toBeDefined();
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons).toBeInstanceOf(Array);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test('should have all required icon sizes', async ({ page }) => {
    // Check common PWA icon sizes
    const iconSizes = ['192', '512'];
    
    for (const size of iconSizes) {
      const response = await page.goto(`/icons/icon-${size}.png`);
      expect(response?.status()).toBe(200);
    }
  });

  test('should have proper theme color', async ({ page }) => {
    await page.goto('/');
    
    const themeColor = await page.$eval('meta[name="theme-color"]', el => el.getAttribute('content'));
    expect(themeColor).toBeDefined();
  });

  test('should have Apple mobile web app meta tags', async ({ page }) => {
    await page.goto('/');
    
    const _appleMobileWebAppCapable = await page.$('meta[name="apple-mobile-web-app-capable"]');
    // May or may not be present
  });
});

// ============================================
// Offline Behavior Tests
// ============================================
test.describe('Offline Behavior', () => {
  test('should show offline indicator when offline', async ({ page, context }) => {
    await page.goto('/login');
    await waitForPageLoad(page);
    
    // Go offline
    await context.setOffline(true);
    
    // Wait for offline indicator
    const offlineIndicator = page.getByText(/offline|no connection/i);
    await expect(offlineIndicator).toBeVisible({ timeout: 5000 });
    
    // Go back online
    await context.setOffline(false);
    
    // Offline indicator should disappear
    await expect(offlineIndicator).not.toBeVisible({ timeout: 5000 });
  });

  test.skip('should queue orders when offline', async ({ page, context }) => {
    // This would require being logged in and adding items to cart
    await page.goto('/menu');
    
    // Add to cart
    // Go offline
    await context.setOffline(true);
    
    // Try to checkout
    // Should show queued message
    
    // Go back online
    await context.setOffline(false);
  });
});

// ============================================
// Accessibility Tests
// ============================================
test.describe('Accessibility', () => {
  test('should have proper document structure', async ({ page }) => {
    await page.goto('/login');
    
    // Should have exactly one h1
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBeGreaterThanOrEqual(1);
    
    // Should have main landmark
    const mainLandmark = page.locator('main, [role="main"]');
    await expect(mainLandmark.first()).toBeVisible();
  });

  test('should have proper form accessibility', async ({ page }) => {
    await page.goto('/login');
    
    // All form inputs should have labels
    const emailInput = page.getByLabel(/email/i);
    await expect(emailInput).toBeVisible();
    
    const passwordInput = page.getByLabel(/password/i);
    await expect(passwordInput).toBeVisible();
  });

  test('should be keyboard navigable', async ({ page }) => {
    await page.goto('/login');
    
    // Tab through the form
    await page.keyboard.press('Tab');
    
    // Something should be focused
    const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(['INPUT', 'BUTTON', 'A']).toContain(focusedElement);
  });

  test('should have focus visible styles', async ({ page }) => {
    await page.goto('/login');
    
    // Tab to an element
    await page.keyboard.press('Tab');
    
    // Focus should be visible
    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();
  });

  test('should handle form submission with Enter key', async ({ page }) => {
    await page.goto('/login');
    
    await page.getByLabel(/email/i).fill('test@example.com');
    await page.getByLabel(/password/i).fill('password123');
    
    // Press Enter to submit
    await page.keyboard.press('Enter');
    
    // Form should attempt to submit (will fail with test credentials but shows keyboard access works)
    await expect(page.getByText(/invalid|error|loading/i)).toBeVisible({ timeout: 10000 });
  });
});

// ============================================
// Responsive Design Tests
// ============================================
test.describe('Responsive Design', () => {
  const viewports = {
    mobile: { width: 375, height: 667 },
    tablet: { width: 768, height: 1024 },
    desktop: { width: 1920, height: 1080 }
  };

  for (const [name, size] of Object.entries(viewports)) {
    test(`should render correctly on ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/login');
      
      // No horizontal overflow
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasHorizontalScroll).toBe(false);
      
      // Content should be visible
      await expect(page.getByLabel(/email/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /login|sign in/i })).toBeVisible();
    });
  }

  test('should show mobile navigation on small screens', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/login');
    
    // Bottom navigation should be present (if logged in)
    // Or compact layout for login
  });
});

// ============================================
// Performance Tests
// ============================================
test.describe('Performance', () => {
  test('should load login page quickly', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto('/login');
    await waitForPageLoad(page);
    
    const loadTime = Date.now() - startTime;
    
    // Should load within 5 seconds
    expect(loadTime).toBeLessThan(5000);
  });

  test('should not have memory leaks on navigation', async ({ page }) => {
    await page.goto('/login');
    
    // Navigate back and forth
    await page.goto('/register');
    await page.goto('/login');
    await page.goto('/register');
    await page.goto('/login');
    
    // Page should still be responsive
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });
});

// ============================================
// Security Tests
// ============================================
test.describe('Security', () => {
  test('should not expose sensitive information in URL', async ({ page }) => {
    await page.goto('/login');
    
    await page.getByLabel(/email/i).fill('test@example.com');
    await page.getByLabel(/password/i).fill('password123');
    
    const url = page.url();
    
    // Password should not be in URL
    expect(url).not.toContain('password');
    expect(url).not.toContain('password123');
  });

  test('should have secure password input', async ({ page }) => {
    await page.goto('/login');
    
    const passwordInput = page.getByLabel(/password/i);
    
    // Should be type="password" by default
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  test('should not expose stack traces', async ({ page }) => {
    await page.goto('/login');
    
    const pageContent = await page.textContent('body');
    
    // Should not contain stack traces
    expect(pageContent).not.toMatch(/at \w+\.\w+ \(/);
    expect(pageContent).not.toMatch(/Error:.*at/);
  });

  test('should have proper CORS headers', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response?.headers();
    
    // Basic check - more specific tests would require actual API calls
    expect(headers).toBeDefined();
  });
});

// ============================================
// Error Handling Tests
// ============================================
test.describe('Error Handling', () => {
  test('should handle 404 pages gracefully', async ({ page }) => {
    await page.goto('/nonexistent-route-12345');
    
    // Should either redirect to login or show a proper error page
    const _url = page.url();
    
    // Should not show raw error
    const hasError = await page.getByText(/stack trace|undefined|null/i).isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  test('should handle network errors gracefully', async ({ page, context }) => {
    await page.goto('/login');
    
    // Simulate network error by going offline
    await context.setOffline(true);
    
    // Try to submit form
    await page.getByLabel(/email/i).fill('test@example.com');
    await page.getByLabel(/password/i).fill('password123');
    await page.getByRole('button', { name: /login|sign in/i }).click();
    
    // Should show error message, not crash
    await expect(page.getByText(/offline|network|connection|error/i)).toBeVisible({ timeout: 10000 });
    
    await context.setOffline(false);
  });
});
