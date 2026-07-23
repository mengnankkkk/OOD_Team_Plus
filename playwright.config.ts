import { defineConfig, devices } from "@playwright/test";

if (!process.env.DEEPSEEK_API_KEY) {
  throw new Error(
    "缺少 DEEPSEEK_API_KEY：请通过终端、IDE、CI Secret 或 Doppler 安全注入后运行 live E2E。",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
