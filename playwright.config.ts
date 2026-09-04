import { defineConfig, devices } from "@playwright/test";

/**
 * E2E multi-contexto contra um projeto Supabase real (não há mocks aqui).
 * Requer: NEXT_PUBLIC_SUPABASE_URL/ANON_KEY no app, E2E_PRESENTER_SECRET e (opcional) E2E_BASE_URL.
 */
export default defineConfig({
  testDir: process.env.PW_TEST_DIR ?? "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // ambientes com proxy de saída (ex.: sandbox): PLAYWRIGHT_PROXY=http://127.0.0.1:port
    ...(process.env.PLAYWRIGHT_PROXY ? { proxy: { server: process.env.PLAYWRIGHT_PROXY, bypass: "localhost,127.0.0.1" }, ignoreHTTPSErrors: true } : {}),
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "pnpm start -p 3000", url: "http://localhost:3000", reuseExistingServer: true, timeout: 60_000 },
});
