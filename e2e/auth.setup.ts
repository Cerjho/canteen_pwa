/**
 * Playwright Global Auth Setup
 *
 * Logs in once with test credentials and saves session state
 * so all dependent tests start authenticated.
 *
 * Required env vars (set in .env.test or CI secrets):
 *   PLAYWRIGHT_TEST_EMAIL     – test parent account email
 *   PLAYWRIGHT_TEST_PASSWORD  – test parent account password
 *   PLAYWRIGHT_BASE_URL       – defaults to http://localhost:5173
 */
import { test as setup, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const authFile = path.join(__dirname, '.auth', 'user.json');

setup('authenticate', async ({ page }) => {
  const email = process.env.PLAYWRIGHT_TEST_EMAIL;
  const password = process.env.PLAYWRIGHT_TEST_PASSWORD;

  if (!email || !password) {
    console.warn(
      '⚠️  PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD not set — skipping auth setup.\n' +
      '   Tests that depend on authenticated state will be skipped.'
    );
    // Save empty storage state so dependent tests don't crash
    await page.context().storageState({ path: authFile });
    return;
  }

  await page.goto('/login');

  // Fill login form
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /login|sign in/i }).click();

  // Wait for successful redirect away from /login
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });

  // Verify we landed on an authenticated page
  await page.waitForLoadState('networkidle');

  // Save signed-in state for reuse
  await page.context().storageState({ path: authFile });
});
