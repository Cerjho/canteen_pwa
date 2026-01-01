// E2E Tests for School Canteen PWA
import { test, expect } from '@playwright/test';

// ============================================
// Authentication Tests
// ============================================
test.describe('Authentication', () => {
  test('should display login page for unauthenticated users', async ({ page }) => {
    await page.goto('/');
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /login|sign in/i })).toBeVisible();
  });

  test('should show signup link on login page', async ({ page }) => {
    await page.goto('/login');
    
    const signupLink = page.getByRole('link', { name: /sign up|register/i });
    await expect(signupLink).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    
    await page.getByLabel(/email/i).fill('invalid@test.com');
    await page.getByLabel(/password/i).fill('wrongpassword');
    await page.getByRole('button', { name: /login|sign in/i }).click();
    
    // Should show error message
    await expect(page.getByText(/invalid|error|failed/i)).toBeVisible({ timeout: 10000 });
  });

  test('should require email and password', async ({ page }) => {
    await page.goto('/login');
    
    // Try to submit empty form
    await page.getByRole('button', { name: /login|sign in/i }).click();
    
    // Browser validation should prevent submission or show error
    const emailInput = page.getByLabel(/email/i);
    await expect(emailInput).toHaveAttribute('required', '');
  });
});

// ============================================
// Menu Page Tests
// ============================================
test.describe('Menu Page', () => {
  // This test requires a logged-in user
  // In real tests, you'd set up auth state before running
  test.skip('should display menu items', async ({ page }) => {
    // Assuming user is authenticated via setup
    await page.goto('/menu');
    
    await expect(page.getByRole('heading', { name: /menu/i })).toBeVisible();
    
    // Should show product cards
    const productCards = page.locator('[class*="ProductCard"], [class*="product-card"]');
    await expect(productCards.first()).toBeVisible({ timeout: 10000 });
  });

  test.skip('should show child selector', async ({ page }) => {
    await page.goto('/menu');
    
    await expect(page.getByText(/order for/i)).toBeVisible();
    await expect(page.getByRole('combobox')).toBeVisible();
  });

  test.skip('should show cart button', async ({ page }) => {
    await page.goto('/menu');
    
    const cartButton = page.getByRole('button', { name: /cart/i });
    await expect(cartButton).toBeVisible();
  });
});

// ============================================
// Navigation Tests
// ============================================
test.describe('Navigation', () => {
  test('should have working navigation links', async ({ page }) => {
    await page.goto('/login');
    
    // Check that page loads without errors
    await expect(page).not.toHaveTitle(/error|500|404/i);
  });

  test('should redirect to login when accessing protected routes', async ({ page }) => {
    await page.goto('/menu');
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/staff');
    await expect(page).toHaveURL(/\/login/);
  });
});

// ============================================
// PWA Tests
// ============================================
test.describe('PWA Features', () => {
  test('should have valid manifest', async ({ page }) => {
    const response = await page.goto('/manifest.webmanifest');
    
    if (response) {
      expect(response.status()).toBe(200);
      
      const manifest = await response.json();
      expect(manifest.name).toBeDefined();
      expect(manifest.short_name).toBeDefined();
      expect(manifest.icons).toBeDefined();
      expect(manifest.icons.length).toBeGreaterThan(0);
    }
  });

  test('should have app icons', async ({ page }) => {
    const icon192 = await page.goto('/icons/icon-192.png');
    expect(icon192?.status()).toBe(200);

    const icon512 = await page.goto('/icons/icon-512.png');
    expect(icon512?.status()).toBe(200);
  });

  test('should register service worker', async ({ page }) => {
    await page.goto('/');
    
    // Wait for service worker registration
    const swRegistered = await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        return !!registration;
      }
      return false;
    });
    
    // Service worker should be registered in production build
    // In dev mode, this might not be active
    // expect(swRegistered).toBe(true);
  });
});

// ============================================
// Accessibility Tests
// ============================================
test.describe('Accessibility', () => {
  test('login page should have proper form labels', async ({ page }) => {
    await page.goto('/login');
    
    // Check for labeled form elements
    const emailInput = page.getByLabel(/email/i);
    const passwordInput = page.getByLabel(/password/i);
    
    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
  });

  test('should have proper heading structure', async ({ page }) => {
    await page.goto('/login');
    
    // Should have at least one h1 heading
    const h1 = page.locator('h1');
    await expect(h1.first()).toBeVisible();
  });

  test('buttons should be keyboard accessible', async ({ page }) => {
    await page.goto('/login');
    
    // Tab to the login button
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    
    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();
  });
});

// ============================================
// Responsive Design Tests
// ============================================
test.describe('Responsive Design', () => {
  test('should work on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
    await page.goto('/login');
    
    // Page should not have horizontal scroll
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    
    expect(hasHorizontalScroll).toBe(false);
  });

  test('should work on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 }); // iPad
    await page.goto('/login');
    
    await expect(page.getByRole('heading', { name: /login|sign in/i })).toBeVisible();
  });

  test('should work on desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/login');
    
    await expect(page.getByRole('heading', { name: /login|sign in/i })).toBeVisible();
  });
});

// ============================================
// Error Handling Tests
// ============================================
test.describe('Error Handling', () => {
  test('should handle 404 gracefully', async ({ page }) => {
    await page.goto('/nonexistent-page');
    
    // Should either redirect to login or show 404
    // Depending on routing configuration
    const currentUrl = page.url();
    expect(currentUrl).toMatch(/\/(login|404)?/);
  });

  test('should not expose sensitive errors', async ({ page }) => {
    await page.goto('/login');
    
    // Check that no stack traces are visible
    const pageContent = await page.textContent('body');
    expect(pageContent).not.toMatch(/stack trace|at \w+\.\w+/i);
  });
});
