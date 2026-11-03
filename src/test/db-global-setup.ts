import { execFileSync } from "node:child_process";

import { testDatabaseUrl } from "./db";

/** Creates the test database if needed and applies all migrations, once per test run. */
export default function setup() {
  // CAREER_STUDIO_LOCAL_MIGRATE=1 applies the SQL directly, for machines where
  // Prisma's schema engine can't be downloaded (scripts/local-migrate.mjs).
  if (process.env.CAREER_STUDIO_LOCAL_MIGRATE === "1") {
    execFileSync("node", ["scripts/local-migrate.mjs", testDatabaseUrl()], { stdio: "pipe" });
    return;
  }
  execFileSync("yarn", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: "pipe",
  });
}
