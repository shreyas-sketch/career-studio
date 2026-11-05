import "server-only";

import { env } from "@/lib/env";

import { createFixtureProvider } from "./providers/fixture";
import { createTregProvider } from "./providers/treg";
import type { RetrievalProvider } from "./providers/types";

// The review's limits, from the server's variables, with cautious defaults.

export const USD = 1_000_000;

export const fdeConfig = () => ({
  runSpendLimitMicro: Math.round((env.FDE_RUN_SPEND_LIMIT_USD ?? 0.1) * USD),
  dailySpendLimitMicro: Math.round((env.FDE_DAILY_SPEND_LIMIT_USD ?? 25) * USD),
  accountDailyReports: env.FDE_ACCOUNT_DAILY_REPORTS ?? 10,
  shortlistSize: env.FDE_SHORTLIST_SIZE ?? 10,
  benchmarkMaxAgeHours: env.FDE_BENCHMARK_MAX_AGE_HOURS ?? 24,
  profileMaxAgeDays: env.FDE_PROFILE_MAX_AGE_DAYS ?? 7,
  retentionDays: env.FDE_RETENTION_DAYS ?? 90,
  linkedinDetailLimit: env.FDE_LINKEDIN_DETAIL_LIMIT ?? 10,
  modelUsdPerMillionTokens: env.FDE_MODEL_USD_PER_MILLION_TOKENS ?? null,
  fixtureMode: env.FDE_FIXTURE_MODE === "1",
});

/** One provider at a time: nothing switches to another by itself and spends its credits. */
export function retrievalProvider(): RetrievalProvider {
  if (env.FDE_FIXTURE_MODE === "1") return createFixtureProvider();
  return createTregProvider({ token: env.TREG_API_TOKEN, baseUrl: env.TREG_TEST_BASE_URL });
}
