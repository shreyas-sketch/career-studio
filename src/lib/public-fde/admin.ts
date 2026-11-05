import "server-only";

import { getSession } from "@/lib/auth/session";
import { findAccount } from "@/lib/accounts/users";
import { createTregProvider } from "@/lib/fde/providers/treg";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { RUBRIC_VERSION } from "@/lib/fde/rubric";
import { scopeKeyOf } from "@/lib/fde/review";

import { PUBLIC_FILTERS, publicFdeConfig } from "./config";
import { Q, q } from "./db";
import { checkModel, modelConfigured } from "./model";
import { readControls, spendToday, type Controls } from "./ops";
import { asPublicTenant } from "./tenant";

// The operator's live page (/fde/live): who may open it, and what it shows.
// Sanitized throughout: counts, ages, totals and incident summaries, never a
// visitor's profile, a key or a provider's raw answer.

/** The signed-in account's email when it's one of PUBLIC_FDE_ADMIN_EMAILS, otherwise null. */
export async function adminEmail(): Promise<string | null> {
  const session = await getSession();
  if (!session) return null;
  const account = await findAccount(session.userId);
  const email = account?.email?.toLowerCase() ?? null;
  return email && publicFdeConfig().admins.includes(email) ? email : null;
}

export type LiveStatus = {
  controls: Controls;
  config: { enabled: boolean; model: string; modelKeySet: boolean; tregTokenSet: boolean; dailyBudgetUsd: number; reservePerReportUsd: number; maxOpenReports: number; guestDailyReports: number; retentionHours: number; workerInThisProcess: boolean };
  counts: Record<string, number>;
  outcomes: Record<string, number>;
  oldestWaitingSeconds: number | null;
  medianAnalysisSeconds: number | null;
  medianTotalSeconds: number | null;
  finishedLastHour: number;
  spend: { kind: string; usd: number; tokensIn: number; tokensOut: number; calls: number }[];
  spentTodayUsd: number;
  reservedUsd: number;
  budgetLeftUsd: number;
  cooldowns: { provider: string; until: string; reason: string }[];
  incidents: { ref: string; at: string; scope: string; code: string; detail: string }[];
  benchmark: { version: number; roles: number; employers: number; discoveredAt: string; expiresAt: string } | null;
};

export async function liveStatus(): Promise<LiveStatus> {
  const config = publicFdeConfig();
  const controls = await readControls(true);
  const counts = await q<{ stage: string; n: number }>(`SELECT stage, count(*)::int AS n FROM ${Q}.jobs WHERE created_at > now() - interval '1 day' GROUP BY stage`);
  const outcomes = await q<{ outcome: string; n: number }>(`SELECT coalesce(outcome, 'open') AS outcome, count(*)::int AS n FROM ${Q}.jobs WHERE created_at > now() - interval '1 day' GROUP BY 1`);
  const oldest = await q<{ s: number | null }>(`SELECT extract(epoch FROM now() - min(created_at))::float AS s FROM ${Q}.jobs WHERE stage IN ('profile_queued', 'analysis_queued')`);
  const timing = await q<{ analysis: number | null; total: number | null; n: number }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM finished_at - analysis_started_at))::float AS analysis,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM finished_at - created_at))::float AS total,
            count(*)::int AS n
       FROM ${Q}.jobs WHERE stage = 'finished' AND outcome IN ('complete', 'partial') AND finished_at > now() - interval '1 hour'`,
  );
  const reserved = await q<{ r: string }>(
    `SELECT coalesce(sum(GREATEST(reserved_micro - spent_micro, 0)), 0)::text AS r FROM ${Q}.jobs WHERE stage IN ('profile_queued', 'profile_running', 'analysis_queued', 'analysis_running')`,
  );
  const cooldowns = await q<{ provider: string; until: Date; reason: string }>(`SELECT provider, until, reason FROM ${Q}.cooldowns WHERE until > now()`);
  const incidents = await q<{ ref: string; at: Date; scope: string; code: string; detail: string }>(`SELECT ref, at, scope, code, detail FROM ${Q}.incidents ORDER BY at DESC LIMIT 25`);
  const spend = await spendToday();
  const spentMicro = spend.reduce((sum, row) => sum + row.costMicro, 0);
  const reservedMicro = Number(reserved.rows[0]?.r ?? 0);
  const benchmark = await asPublicTenant(() =>
    prisma.fdeBenchmark.findFirst({ where: { scopeKey: scopeKeyOf(PUBLIC_FILTERS), rubricVersion: RUBRIC_VERSION }, orderBy: { version: "desc" }, select: { version: true, roles: true, discoveredAt: true, expiresAt: true } }),
  );
  const roles = (benchmark?.roles as { employer: string }[] | undefined) ?? [];
  return {
    controls,
    config: {
      enabled: config.enabled,
      model: config.model,
      modelKeySet: modelConfigured(),
      tregTokenSet: Boolean(env.TREG_API_TOKEN),
      dailyBudgetUsd: config.dailyBudgetMicro / 1e6,
      reservePerReportUsd: config.reservePerReportMicro / 1e6,
      maxOpenReports: config.maxOpenReports,
      guestDailyReports: config.guestDailyReports,
      retentionHours: config.retentionHours,
      workerInThisProcess: config.worker,
    },
    counts: Object.fromEntries(counts.rows.map((row) => [row.stage, row.n])),
    outcomes: Object.fromEntries(outcomes.rows.map((row) => [row.outcome, row.n])),
    oldestWaitingSeconds: oldest.rows[0]?.s ?? null,
    medianAnalysisSeconds: timing.rows[0]?.analysis ?? null,
    medianTotalSeconds: timing.rows[0]?.total ?? null,
    finishedLastHour: timing.rows[0]?.n ?? 0,
    spend: spend.map((row) => ({ kind: row.kind, usd: row.costMicro / 1e6, tokensIn: row.tokensIn, tokensOut: row.tokensOut, calls: row.calls })),
    spentTodayUsd: spentMicro / 1e6,
    reservedUsd: reservedMicro / 1e6,
    budgetLeftUsd: Math.max(0, (config.dailyBudgetMicro - spentMicro - reservedMicro) / 1e6),
    cooldowns: cooldowns.rows.map((row) => ({ provider: row.provider, until: row.until.toISOString(), reason: row.reason })),
    incidents: incidents.rows.map((row) => ({ ...row, at: row.at.toISOString() })),
    benchmark: benchmark
      ? { version: benchmark.version, roles: roles.length, employers: new Set(roles.map((role) => role.employer)).size, discoveredAt: benchmark.discoveredAt.toISOString(), expiresAt: benchmark.expiresAt.toISOString() }
      : null,
  };
}

/** Free checks of both services, from the server: Treg's free location search, and Anthropic's Models API. */
export async function checkServices(): Promise<{ model: { ok: boolean; message: string }; data: { ok: boolean; message: string } }> {
  const [model, data] = await Promise.all([
    checkModel(),
    createTregProvider({ token: env.TREG_API_TOKEN, baseUrl: env.TREG_TEST_BASE_URL })
      .checkConnection(AbortSignal.timeout(20_000))
      .then((check) => ({ ok: check.ok, message: check.message })),
  ]);
  return { model, data };
}
