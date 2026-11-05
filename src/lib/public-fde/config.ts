import "server-only";

import { env } from "@/lib/env";
import type { FdeFilters } from "@/lib/fde/types";

// The public FDE Review's settings (docs/PUBLIC_FDE_REVIEW.md). Everything
// here is read on the server; the browser only ever sees what a page renders.

export const USD = 1_000_000;

/** The model the public review uses, fixed on the server. It never falls back to another one. */
export const DEFAULT_PUBLIC_MODEL = "claude-haiku-5-5";

/** The market every visitor is compared with: one shared, worldwide sample. */
export const PUBLIC_FILTERS: FdeFilters = { location: "", remoteOnly: false, seniority: "any" };

export const publicFdeConfig = () => ({
  enabled: env.PUBLIC_FDE_ENABLED !== "0",
  worker: env.PUBLIC_FDE_WORKER !== "0",
  apiKey: env.ANTHROPIC_API_KEY ?? null,
  model: env.PUBLIC_FDE_MODEL || DEFAULT_PUBLIC_MODEL,
  anthropicBaseUrl: env.PUBLIC_FDE_ANTHROPIC_TEST_BASE_URL ?? "https://api.anthropic.com",
  dailyBudgetMicro: Math.round((env.PUBLIC_FDE_DAILY_BUDGET_USD ?? 10) * USD),
  reservePerReportMicro: Math.round((env.PUBLIC_FDE_RESERVE_PER_REPORT_USD ?? 0.2) * USD),
  // Claude Haiku 5.5's published price for prompts up to 100K tokens, in dollars per million tokens.
  inputUsdPerMTok: env.PUBLIC_FDE_INPUT_USD_PER_MTOK ?? 0.1,
  outputUsdPerMTok: env.PUBLIC_FDE_OUTPUT_USD_PER_MTOK ?? 0.5,
  admins: (env.PUBLIC_FDE_ADMIN_EMAILS ?? "becomefde@gmail.com")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
  retentionHours: env.PUBLIC_FDE_RETENTION_HOURS ?? 72,
  guestDailyReports: env.PUBLIC_FDE_GUEST_DAILY_REPORTS ?? 2,
  maxOpenReports: env.PUBLIC_FDE_MAX_OPEN_REPORTS ?? 80,
  ipHourly: env.PUBLIC_FDE_IP_HOURLY ?? 60,
});

/** How many run at once, by lane, until an operator changes it on the live page. */
export const DEFAULT_LANES = { profile: 8, analysis: 6 } as const;
export type Lane = keyof typeof DEFAULT_LANES;

/** How long a claimed job is held without a heartbeat before another worker may take it. */
export const LEASE_SECONDS = 90;
export const HEARTBEAT_MS = 20_000;
/** Attempts at one lane before a job is given up on. Retries after a provider outage don't count (see queue.ts). */
export const MAX_ATTEMPTS = 3;
/** Longest a model request may take before it's abandoned. */
export const MODEL_TIMEOUT_MS = 120_000;
/** Prompts are kept under this many tokens: above 100K, Haiku 5.5 bills every token at a higher rate. */
export const MAX_PROMPT_TOKENS = 90_000;
