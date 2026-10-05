import { defineConfig, devices } from "@playwright/test";

// Starts the sync server (port 1234, throwaway database) and the Vite dev server (port 5173).
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1400, height: 900 },
  },
  webServer: [
    {
      command: "npm run dev",
      cwd: "../server",
      env: { DB_PATH: "./data/e2e.sqlite", PORT: "1234", SAVE_DEBOUNCE_MS: "200" },
      url: "http://localhost:1234/api/health",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev -- --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
