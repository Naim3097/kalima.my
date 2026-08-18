import { defineConfig, devices } from "@playwright/test";

/*
  End-to-end tests for the checkout — the one screen where a mistake costs
  money rather than looking wrong.

  AGAINST A REAL DATABASE, deliberately. The rules being tested (the new-member
  discount, its eligibility, the no-stacking rule) live in Postgres functions,
  so a mocked backend would assert that the mock behaves as written and prove
  nothing about the shop. The environment comes from .env.local, which points at
  the staging project.

  That is also why every fixture is namespaced `@kalima.test` and torn down: the
  suite shares a database with whoever else is using staging.

  SERIAL, single worker. The tests place orders for the same seeded members, and
  the whole point of the eligibility rule is that one order changes what the
  next one costs — parallel workers would race each other through exactly the
  state under test.
*/
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,

  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  /*
    Next refuses to run a second dev server for the same project directory —
    whatever port it is given — so this cannot simply start its own alongside
    the one a developer already has open. Two ways through, and both are
    ordinary:

      E2E_BASE_URL=http://localhost:3002 npm run test:e2e
          run against the server already up. No webServer is managed at all.

      npm run test:e2e
          no server running, so start one and wait for it.
  */
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: "npm run dev",
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});
