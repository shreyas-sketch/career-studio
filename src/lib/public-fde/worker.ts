import "server-only";

import { hostname } from "node:os";
import { randomBytes } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { DiscoveryFailed } from "@/lib/fde/market";
import { ProviderError } from "@/lib/fde/providers/types";
import { ensureBenchmark, readProfileForReport, runFreelance, runReview, scopeKeyOf } from "@/lib/fde/review";
import { RUBRIC_VERSION } from "@/lib/fde/rubric";
import type { ReportStage, StageKey, StageState } from "@/lib/fde/types";
import { logServerError, logServerWarning } from "@/lib/log";
import { prisma } from "@/lib/prisma";

import { HEARTBEAT_MS, MAX_ATTEMPTS, PUBLIC_FILTERS, USD, type Lane } from "./config";
import { queuePool } from "./db";
import { BudgetReached, isServiceFailure, JobLedger, modelConfigured, PublicMeter, publicModel, respectCooldown, ServiceBusy, ServiceUnavailable } from "./model";
import { autoPause, readControls, recordIncident, setCooldown } from "./ops";
import { claim, deferJob, failJob, finishJob, heartbeat, profileDone, reapExpiredLeases, releaseWorker, type JobRow } from "./queue";
import { sweepPublicFde } from "./retention";
import { asPublicTenant, ensurePublicTenant } from "./tenant";

// Runs inside the web process (Railway's one service), started from
// instrumentation.ts. Every limit is enforced in the database, so a second
// replica or a restart can't break them, and every job it takes is a lease
// that another process picks up if this one goes away.

export const WORKER_ID = `${hostname().slice(0, 24)}-${process.pid}-${randomBytes(3).toString("hex")}`;

/** After this many waits for a busy provider, a report stops waiting and says so. */
const MAX_DEFERRALS = 40;
/** What the shared market sample may spend on its own, apart from any one visitor's set-aside. */
const MARKET_CAP_MICRO = 1 * USD;

type WorkerState = { started: boolean; ticking: boolean; running: Map<string, { lane: Lane; controller: AbortController }>; timers: NodeJS.Timeout[] };
const globalForWorker = globalThis as unknown as { publicFdeWorker?: WorkerState };
const state: WorkerState = (globalForWorker.publicFdeWorker ??= { started: false, ticking: false, running: new Map(), timers: [] });

const runningIn = (lane: Lane) => [...state.running.values()].filter((entry) => entry.lane === lane).length;

export function startPublicFdeWorker(): void {
  if (state.started) return;
  state.started = true;
  void ensurePublicTenant().catch((error: unknown) => logServerError("public FDE tenant", error));
  state.timers.push(setInterval(() => void tick(), 1_000));
  state.timers.push(setInterval(() => void reap(), 15_000));
  state.timers.push(setInterval(() => void sweepPublicFde().catch((error: unknown) => logServerError("public FDE sweep", error)), 30 * 60_000));
  for (const timer of state.timers) timer.unref?.();
  // A redeploy: hand running jobs straight back instead of leaving them until their leases run out.
  process.once("SIGTERM", () => {
    for (const { controller } of state.running.values()) controller.abort(new Error("shutting down"));
    void releaseWorker(WORKER_ID).catch(() => {});
  });
}

async function reap(): Promise<void> {
  try {
    const { requeued, abandoned } = await reapExpiredLeases();
    if (requeued.length) logServerWarning("public FDE", `Took back ${requeued.length} job(s) whose worker stopped.`);
    for (const id of abandoned) {
      const ref = await recordIncident({ jobId: id, scope: "worker", code: "worker_lost", detail: `Stopped ${MAX_ATTEMPTS} times while running.` });
      await markReport(id, "failed", "worker_lost", ref);
    }
  } catch (error) {
    logServerError("public FDE reaper", error);
  }
}

/** One pass: fills each lane up to its limit with the oldest ready jobs. */
export async function tick(): Promise<void> {
  if (state.ticking) return;
  state.ticking = true;
  try {
    await ensurePublicTenant();
    const controls = await readControls();
    for (const lane of ["profile", "analysis"] as const) {
      if (lane === "profile" ? controls.profilePaused : controls.analysisPaused) continue;
      // Without the key, analysis doesn't start: queued reports wait, keeping their place, until it's set.
      if (lane === "analysis" && !modelConfigured()) continue;
      const limit = controls.lanes[lane];
      while (runningIn(lane) < limit) {
        const job = await claim(lane, limit, WORKER_ID);
        if (!job) break;
        launch(lane, job);
      }
    }
  } catch (error) {
    logServerError("public FDE worker", error);
  } finally {
    state.ticking = false;
  }
}

function launch(lane: Lane, job: JobRow): void {
  const controller = new AbortController();
  state.running.set(job.id, { lane, controller });
  const beat = setInterval(() => {
    void heartbeat(job.id, WORKER_ID)
      .then((held) => {
        if (!held) controller.abort(new Error("lease lost"));
      })
      .catch(() => {});
  }, HEARTBEAT_MS);
  beat.unref?.();
  const work = lane === "profile" ? runProfileLane(job, controller.signal) : runAnalysisLane(job, controller.signal);
  void work
    .catch((error: unknown) => logServerError(`public FDE ${lane} ${job.id}`, error))
    .finally(() => {
      clearInterval(beat);
      state.running.delete(job.id);
      void tick();
    });
}

// ─── Lane 1: reading the profile ──────────────────────────────

export async function runProfileLane(job: JobRow, signal: AbortSignal): Promise<void> {
  const ledger = new JobLedger(job.id, Number(job.reserved_micro), Number(job.spent_micro));
  try {
    await respectCooldown("treg", "profile", signal);
    const profile = await asPublicTenant(() => readProfileForReport(job.id, { meter: new PublicMeter(job.id, ledger), signal }));
    if (profile.quality === "identity") {
      await markReport(job.id, "restricted", "identity_only", null);
      await finishJob(job.id, WORKER_ID, "restricted", { errorCode: "identity_only" });
      return;
    }
    await profileDone(job.id, WORKER_ID);
  } catch (error) {
    if (signal.aborted) return; // the lease was lost or the process is stopping: another worker carries on
    await handleFailure("profile", job, error);
  }
}

// ─── Lane 2: market, comparison, insights, freelance ─────────

export async function runAnalysisLane(job: JobRow, signal: AbortSignal): Promise<void> {
  const ledger = new JobLedger(job.id, Number(job.reserved_micro), Number(job.spent_micro));
  try {
    const ai = publicModel(ledger);
    await ensureSharedBenchmark(job.id, signal);
    const outcome = await asPublicTenant(() =>
      runReview(job.id, { step: async () => {}, signal }, { freshProfile: false, freshMarket: false, withFreelance: false, ai, requireCachedBenchmark: true, isFatal: isServiceFailure }),
    );
    if (outcome === "complete" || outcome === "partial") {
      try {
        await asPublicTenant(() => runFreelance(job.id, { step: async () => {}, signal }, ai));
      } catch (error) {
        // The freelance listings are extra: the report stands without them, and says they couldn't be checked.
        if (!signal.aborted) logServerError("public FDE freelance", error);
      }
    }
    if (outcome === "failed" || outcome === "quota") {
      const row = await asPublicTenant(() => prisma.fdeReport.findUnique({ where: { id: job.id }, select: { errorCode: true, errorMessage: true } }));
      const ref = await recordIncident({ jobId: job.id, scope: "analysis", code: row?.errorCode ?? outcome, detail: row?.errorMessage ?? "" });
      await finishJob(job.id, WORKER_ID, outcome, { errorCode: row?.errorCode ?? outcome, ref });
      return;
    }
    await finishJob(job.id, WORKER_ID, outcome);
  } catch (error) {
    if (signal.aborted) return;
    await handleFailure("analysis", job, error);
  }
}

/**
 * The market sample every visitor is compared with, built once. The first
 * worker to need it builds it under a database lock; the others wait for it
 * (their pages say so) and then reuse it. Fifty visitors make one crawl.
 */
export async function ensureSharedBenchmark(jobId: string | null, signal: AbortSignal): Promise<void> {
  const ready = () => asPublicTenant(() => prisma.fdeBenchmark.findFirst({ where: { scopeKey: scopeKeyOf(PUBLIC_FILTERS), rubricVersion: RUBRIC_VERSION, expiresAt: { gt: new Date() } }, select: { id: true } }));
  if (await ready()) return;
  if (jobId) await noteStage(jobId, "discovering_roles", "running", "Preparing the shared market sample that every report in this session uses");
  // Waiters don't hold a connection while they wait: only the builder keeps one, for its lock.
  let holder: Awaited<ReturnType<ReturnType<typeof queuePool>["connect"]>> | null = null;
  while (!holder) {
    if (signal.aborted) throw signal.reason;
    const client = await queuePool().connect();
    const { rows } = await client.query<{ got: boolean }>(`SELECT pg_try_advisory_lock(hashtext('public-fde-benchmark')) AS got`).catch(() => ({ rows: [] as { got: boolean }[] }));
    if (rows[0]?.got) {
      holder = client;
      break;
    }
    client.release();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    // Built by whoever held the lock while this one waited.
    if (await ready()) return;
  }
  try {
    if (await ready()) return;
    const marketLedger = new JobLedger(null, MARKET_CAP_MICRO);
    await respectCooldown("treg", "market", signal, 5 * 60_000);
    await asPublicTenant(() =>
      ensureBenchmark(PUBLIC_FILTERS, {
        meter: new PublicMeter(null, marketLedger, "market"),
        ai: publicModel(marketLedger),
        signal,
        isFatal: isServiceFailure,
        onProgress: async (detail) => {
          if (jobId) await noteStage(jobId, "discovering_roles", "running", detail);
        },
      }),
    );
  } finally {
    await holder.query(`SELECT pg_advisory_unlock(hashtext('public-fde-benchmark'))`).catch(() => {});
    holder.release();
  }
}

/**
 * What a failure means for this job. Provider trouble keeps its place in
 * line; a bad credential pauses the lane for everyone instead of failing every
 * queued report in turn; anything else is retried a couple of times, then
 * ends with a reference the operator can look up.
 */
async function handleFailure(lane: Lane, job: JobRow, error: unknown): Promise<void> {
  const service = lane === "profile" ? "profile" : "model";
  if (job.deferrals >= MAX_DEFERRALS) {
    const ref = await recordIncident({ jobId: job.id, scope: lane, code: "gave_up_waiting", detail: describe(error) });
    await failJob(job.id, WORKER_ID, "unavailable", ref);
    await markReport(job.id, "failed", "unavailable", ref);
    return;
  }

  if (error instanceof ProviderError) {
    if (error.code === "inaccessible") {
      await markReport(job.id, "restricted", "inaccessible", null);
      await finishJob(job.id, WORKER_ID, "restricted", { errorCode: "inaccessible" });
      return;
    }
    if (error.code === "rate_limited" || error.code === "timeout" || error.code === "provider_down") {
      const wait = Math.max((error.retryAfterSeconds ?? 0) * 1000, 20_000);
      if (error.code === "rate_limited") await setCooldown("treg", wait, "rate limited");
      await deferJob(job.id, WORKER_ID, lane, wait, `${service}_busy`);
      return;
    }
    if (["not_configured", "invalid_credentials", "permission", "depleted", "spend_limit"].includes(error.code)) {
      const ref = await recordIncident({ jobId: job.id, scope: lane, code: error.code, detail: error.message });
      await autoPause(lane, `Profile/market data: ${error.code} (see ${ref}). Fix it, then resume this lane.`);
      await deferJob(job.id, WORKER_ID, lane, 60_000, "data_unavailable");
      return;
    }
  }
  if (error instanceof ServiceUnavailable) {
    const ref = await recordIncident({ jobId: job.id, scope: lane, code: `${error.service}_${error.code}`, detail: error.detail });
    await autoPause("analysis", `The model is unavailable: ${error.code} (see ${ref}). Fix it, then resume analysis.`);
    await deferJob(job.id, WORKER_ID, lane, 60_000, "model_unavailable");
    return;
  }
  if (error instanceof ServiceBusy) {
    await deferJob(job.id, WORKER_ID, lane, error.retryAfterMs, `${error.service}_busy`);
    return;
  }
  if (error instanceof BudgetReached) {
    const ref = await recordIncident({ jobId: job.id, scope: lane, code: "report_budget", detail: error.message });
    await failJob(job.id, WORKER_ID, "budget", ref);
    await markReport(job.id, "failed", "budget", ref);
    return;
  }
  if (error instanceof DiscoveryFailed) {
    // The market couldn't be sampled: try again later rather than compare with nothing.
    const ref = await recordIncident({ jobId: job.id, scope: lane, code: "discovery_failed", detail: error.message });
    if (job.attempts < MAX_ATTEMPTS) {
      await deferJob(job.id, WORKER_ID, lane, 120_000, "market_unavailable");
      return;
    }
    await failJob(job.id, WORKER_ID, "market_unavailable", ref);
    await markReport(job.id, "failed", "market_unavailable", ref);
    return;
  }

  const ref = await recordIncident({ jobId: job.id, scope: lane, code: "unexpected", detail: describe(error) });
  logServerError(`public FDE ${lane} (${ref})`, error);
  if (job.attempts < MAX_ATTEMPTS) {
    await deferJob(job.id, WORKER_ID, lane, 15_000 * job.attempts, "retrying");
    return;
  }
  await failJob(job.id, WORKER_ID, "unexpected", ref);
  await markReport(job.id, "failed", "unexpected", ref);
}

/** The error's kind and message for the operator's log. Payloads never get this far: adapters already reduce them. */
function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 400);
  return String(error).slice(0, 400);
}

/** Ends the report's own row in a state the page can explain, without touching what it already found. */
async function markReport(id: string, reportState: "failed" | "restricted", code: string, ref: string | null): Promise<void> {
  await asPublicTenant(async () => {
    const row = await prisma.fdeReport.findUnique({ where: { id }, select: { stages: true } });
    if (!row) return;
    const stages = (row.stages as unknown as ReportStage[]).map((stage) =>
      stage.state === "running" ? { ...stage, state: "failed" as StageState, finishedAt: new Date().toISOString() } : stage.state === "pending" ? { ...stage, state: "skipped" as StageState } : stage,
    );
    await prisma.fdeReport.update({ where: { id }, data: { state: reportState, errorCode: code, errorMessage: ref ? `ref ${ref}` : null, stages: stages as unknown as Prisma.InputJsonValue } });
  }).catch((error: unknown) => logServerError("public FDE report state", error));
}

async function noteStage(id: string, key: StageKey, stageState: StageState, detail: string): Promise<void> {
  await asPublicTenant(async () => {
    const row = await prisma.fdeReport.findUnique({ where: { id }, select: { stages: true } });
    if (!row) return;
    const stages = (row.stages as unknown as ReportStage[]).map((stage) =>
      stage.key === key ? { ...stage, state: stageState, detail, startedAt: stage.startedAt ?? new Date().toISOString() } : stage,
    );
    await prisma.fdeReport.update({ where: { id }, data: { stages: stages as unknown as Prisma.InputJsonValue } });
  }).catch(() => {});
}

/**
 * The operator's "Prepare market now", before the call: builds the shared
 * sample once so the first visitors don't wait for it. Returns what went
 * wrong, for the operator, rather than throwing.
 */
export async function prepareMarket(): Promise<{ ok: boolean; message: string }> {
  try {
    await ensurePublicTenant();
    await ensureSharedBenchmark(null, AbortSignal.timeout(15 * 60_000));
    return { ok: true, message: "The shared market sample is ready." };
  } catch (error) {
    const ref = await recordIncident({ jobId: null, scope: "market", code: error instanceof ProviderError ? error.code : error instanceof ServiceUnavailable ? `model_${error.code}` : "prepare_failed", detail: describe(error) });
    return { ok: false, message: `The market sample couldn't be prepared (${ref}). See the incidents below.` };
  }
}
