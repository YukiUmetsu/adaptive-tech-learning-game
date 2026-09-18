import { defineConfig, devices } from "@playwright/test";

const apiPort = Number(process.env.E2E_API_PORT ?? 8080);
const webPort = Number(process.env.E2E_WEB_PORT ?? 5173);

// E2E requires PostgreSQL. Prefer a dedicated database via E2E_DATABASE_URL so
// test missions and events never touch development or production data.
const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://app:app@localhost:5432/app";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "cargo run -p adaptive-learn-api",
      cwd: "../..",
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        APP_ENV: "test",
        BIND_ADDR: `127.0.0.1:${apiPort}`,
        DATABASE_URL: databaseUrl,
        RUN_MIGRATIONS: "true",
        CORS_ALLOWED_ORIGINS: `http://localhost:${webPort}`,
        RUST_LOG: "warn",
      },
    },
    {
      command: `pnpm dev --port ${webPort} --strictPort`,
      url: `http://localhost:${webPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
      },
    },
  ],
});
