import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

const port = 3011;
const origin = `http://127.0.0.1:${port}`;
const e2eDbPath = join(tmpdir(), `money-whisperer-e2e-${process.pid}.db`);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: origin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: `pnpm build && pnpm exec next start --port ${port}`,
    url: origin,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      DB_PATH: e2eDbPath,
      NEXT_DIST_DIR: ".next-e2e",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      APP_ORIGIN: origin,
      ALLOW_REGISTRATION: "true",
      ADMIN_USERNAME: "e2e_admin",
      ADMIN_INITIAL_PASSWORD: "e2e_admin_password_123",
      DEEPSEEK_API_KEY: "",
    },
  },
});
