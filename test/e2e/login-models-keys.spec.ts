import { test, expect } from '@playwright/test';

test('login, browse providers, models, and keys', async ({ page }) => {
  await page.goto('/ui/login');
  await page.getByRole('textbox', { name: 'Admin key or API key secret' }).click();
  await expect(page.getByRole('textbox', { name: 'Admin key or API key secret' })).toBeVisible();
  await expect(page.getByRole('heading')).toContainText('Sign in');
  await page.getByRole('textbox', { name: 'Admin key or API key secret' }).click();
  await page.getByRole('textbox', { name: 'Admin key or API key secret' }).fill('password');
  await page.getByRole('button', { name: 'Access Dashboard' }).click();
  await expect(page.getByRole('main')).toContainText('Live Metrics');
  await page.getByRole('link', { name: 'Providers' }).click();
  await expect(page.locator('tbody')).toContainText('local-llamacpp');
  await expect(page.getByRole('main')).toContainText('Add Provider');
  await page.getByRole('link', { name: 'Models' }).click();
  await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Add Model');
  await expect(page.locator('tbody')).toContainText('balanced');
  await expect(page.locator('tbody')).toContainText('chat');
  await expect(page.locator('tbody')).toContainText('in_order / selector');
  await expect(page.locator('tbody')).toContainText('custom');
  await expect(page.locator('tbody')).toContainText('mock-openai → gpt-4o-mini');
  await page.getByRole('link', { name: 'Keys' }).click();
});
