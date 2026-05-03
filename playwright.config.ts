import { defineConfig, devices } from '@playwright/test';
import { basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Replicate the same stable port derivation used in scripts/dev.ts so that
// `bun run test:e2e` always targets whichever port the dev server is already
// listening on for this worktree. Override with PORT=<n> bun run test:e2e.
function derivePort(): string {
  if (process.env.PORT) return process.env.PORT;
  const dirName = basename(process.cwd());
  let hash = 5381;
  for (let i = 0; i < dirName.length; i++) {
    hash = (hash * 33) ^ dirName.charCodeAt(i);
  }
  return String(10000 + (Math.abs(hash) % 10000));
}

const PORT = derivePort();
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './test/e2e',
  globalSetup: './test/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Start the dev server before running tests; 120s to allow cold Bun installs
  webServer: {
    command: 'bun run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
