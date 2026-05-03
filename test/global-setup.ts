/**
 * Playwright global setup — guaranteed by Playwright to run after the
 * webServer is up and responding. Seeds the instance with default fixtures,
 * then waits for the server to be healthy again (the dev server restarts in
 * watch mode when the SQLite file changes during populate).
 */

import { execSync } from 'child_process';
import { basename } from 'path';

function deriveHealthUrl(): string {
  if (process.env.BASE_URL) return `${process.env.BASE_URL}/health`;
  const dirName = basename(process.cwd());
  let hash = 5381;
  for (let i = 0; i < dirName.length; i++) {
    hash = (hash * 33) ^ dirName.charCodeAt(i);
  }
  const port = 10000 + (Math.abs(hash) % 10000);
  return `http://localhost:${port}/health`;
}

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let consecutiveOk = 0;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        consecutiveOk++;
        if (consecutiveOk >= 3) return; // stable across 3 checks ~1.5s apart
      } else {
        consecutiveOk = 0;
      }
    } catch {
      consecutiveOk = 0;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`[globalSetup] Server did not recover at ${url} within ${timeoutMs}ms`);
}

export default async function globalSetup() {
  console.log('\n[globalSetup] Populating dev data...');
  execSync('bun run scripts/populate-dev.ts', { stdio: 'inherit' });

  const healthUrl = deriveHealthUrl();
  console.log(`[globalSetup] Waiting for server to stabilise at ${healthUrl}...`);
  await waitForServer(healthUrl);
  console.log('[globalSetup] Server healthy — starting tests.\n');
}
