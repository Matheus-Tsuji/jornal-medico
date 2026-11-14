import { defineConfig, devices } from '@playwright/test';

// Opcional: usar um Chromium já instalado (ex.: PW_CHROMIUM=.../chrome-headless-shell.exe) em vez de baixar outro.
const executablePath = process.env.PW_CHROMIUM || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:8799', trace: 'retain-on-failure', ...devices['Desktop Chrome'], launchOptions: { executablePath } },
  webServer: { command: 'node scripts/e2e-server.mjs', url: 'http://127.0.0.1:8799/health', reuseExistingServer: false, timeout: 120_000 },
});
