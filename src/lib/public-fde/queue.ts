import "server-only";

import { randomBytes } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { parseProfileUrl } from "@/lib/fde/linkedin-url";
import { initialStages, scopeKeyOf } from "@/lib/fde/review";
import { prisma } from "@/lib/prisma";

import { LEASE_SECONDS, MAX_ATTEMPTS, PUBLIC_FILTERS, publicFdeConfig, type Lane } from "./config";
import { inTransaction, Q, q } from "./db";
import { ownerOf } from "./guest";
import { readControls } from "./ops";
import { asPublicTenant } from "./tenant";

// The public review's durable queue. A report is accepted in one transaction
// that also sets money aside for it, then moves through two lanes:
//
//   profile_queued → profile_running → analysis_queued → analysis_running → finished
//
// Workers claim jobs with FOR UPDATE SKIP LOCKED under a per-lane lock that
// also counts what's running, so the limit holds across processes. A claim is
// a lease: a worker that stops renewing it (a restart, a crash) loses the job
// to the next one, which carries on from what was saved.

export type Stage = "profile_queued" | "profile_running" | "analysis_queued" | "analysis_running" | "finished" | "failed";
export const OPEN_STAGES: readonly Stage[] = ["profile_queued", "profile_running", "analysis_queued", "analysis_running"];

export type JobRow = {
  id: string;
  seq: string;
  guest_id: string;
  subject_key: string;
  stage: Stage;
  not_before: Date;
  attempts: number;
  deferrals: number;
  reserved_micro: string;
  spent_micro: string;
  outcome: string | null;
  error_code: string | null;
  ref: string | null;
  created_at: Date;
  profile_started_at: Date | null;
  profile_done_at: Date | null;
  analysis_started_at: Date | null;
  finished_at: Date | null;
};

const LANE_STAGES: Record<Lane, { queued: Stage; running: Stage }> = {
  profile: { queued: "profile_queued", running: "profile_running" },
  analysis: { queued: "analysis_queued", running: "analysis_running" },
};

// ─── Accepting a report ───────────────────────────────────────

export type SubmitRefusal =
  | { code: "disabled"; status: 503 }
  | { code: "paused"; status: 503; retryAfter: number }
  | { code: "invalid_url"; status: 422; message: string }
  | { code: "guest_quota"; status: 429; retryAfter: number }
  | { code: "network_quota"; status: 429; retryAfter: number }
  | { code: "capacity"; status: 503; retryAfter: number }
  | { code: "budget"; status: 503; retryAfter: number };

export type SubmitResult = { ok: true; id: string; reused: boolean } | ({ ok: false } & SubmitRefusal);

const DAY_MS = 86_400_000;

/**
 * Accepts a report, or returns the one this guest already has for the same
 * address or the same click: a double click, a refresh or a reconnect never
 * makes (or pays for) a second one.
 */
export async function submitReport(input: { guestId: string; url: string; clientKey: string | null; ipHash: string }): Promise<SubmitResult> {
  const config = publicFdeConfig();
  if (!config.enabled) return { ok: false, code: "disabled", status: 503 };
  const parsed = parseProfileUrl(input.url);
  if (!parsed.ok) return { ok: false, code: "invalid_url", status: 422, message: parsed.error };
  const controls = await readControls(true);
  if (controls.intakePaused) return { ok: false, code: "paused", status: 503, retryAfter: 60 };

  const clientKey = input.clientKey && /^[A-Za-z0-9_-]{8,64}$/.test(input.clientKey) ? input.clientKey : null;
  const decision = await inTransaction(async (client) => {
    // One admission at a time, so the counts and the budget below can't be overtaken by a parallel one.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('public-fde-admit'))`);
    const same = await client.query<{ id: string }>(
      `SELECT id FROM ${Q}.jobs WHERE guest_id = $1 AND stage <> 'failed'
         AND (($2::text IS NOT NULL AND client_key = $2) OR (subject_key = $3 AND created_at > now() - interval '1 day'))
       ORDER BY created_at DESC LIMIT 1`,
      [input.guestId, clientKey, parsed.slug],
    );
    if (same.rows[0]) return { ok: true as const, id: same.rows[0].id, reused: true as const };

    const guestCount = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${Q}.jobs WHERE guest_id = $1 AND created_at > now() - interval '1 day'`, [input.guestId]);
    if ((guestCount.rows[0]?.n ?? 0) >= config.guestDailyReports) return { ok: false as const, code: "guest_quota" as const, status: 429 as const, retryAfter: 3600 };

    // Shared networks (a conference, an office) are fine: this is a generous ceiling against scripted floods, not a per-person limit.
    const ipCount = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${Q}.jobs WHERE ip_hash = $1 AND created_at > now() - interval '1 hour'`, [input.ipHash]);
    if ((ipCount.rows[0]?.n ?? 0) >= config.ipHourly) return { ok: false as const, code: "network_quota" as const, status: 429 as const, retryAfter: 900 };

    const open = await client.query<{ n: number; outstanding: string }>(
      `SELECT count(*)::int AS n, coalesce(sum(GREATEST(reserved_micro - spent_micro, 0)), 0)::text AS outstanding
         FROM ${Q}.jobs WHERE stage = ANY($1::text[])`,
      [OPEN_STAGES],
    );
    if ((open.rows[0]?.n ?? 0) >= config.maxOpenReports) return { ok: false as const, code: "capacity" as const, status: 503 as const, retryAfter: 120 };

    // Today's spend so far, plus what's still set aside for accepted reports, plus this one, must fit the day's budget.
    const spent = await client.query<{ total: string }>(`SELECT coalesce(sum(cost_micro), 0)::text AS total FROM ${Q}.spend WHERE day = current_date`);
    const committed = Number(spent.rows[0]?.total ?? 0) + Number(open.rows[0]?.outstanding ?? 0);
    if (committed + config.reservePerReportMicro > config.dailyBudgetMicro) return { ok: false as const, code: "budget" as const, status: 503 as const, retryAfter: 3600 };

    const id = `pf${randomBytes(12).toString("hex")}`;
    await client.query(
      `INSERT INTO ${Q}.jobs (id, guest_id, subject_key, client_key, stage, reserved_micro, ip_hash) VALUES ($1, $2, $3, $4, 'profile_queued', $5, $6)`,
      [id, input.guestId, parsed.slug, clientKey, config.reservePerReportMicro, input.ipHash],
    );
    return { ok: true as const, id, reused: false as const, url: parsed.url, slug: parsed.slug };
  });

  if (!decision.ok || decision.reused) return decision;
  // The report the page will show, in the service tenant. If this fails, the job is dropped too, so nothing is left half-made.
  try {
    await asPublicTenant(() =>
      prisma.fdeReport.create({
        data: {
          id: decision.id,
          ownerUserId: ownerOf(input.guestId),
          subjectProfileUrl: decision.url,
          subjectKey: decision.slug,
          state: "running",
          filters: PUBLIC_FILTERS as unknown as Prisma.InputJsonValue,
          scopeKey: scopeKeyOf(PUBLIC_FILTERS),
          stages: initialStages() as unknown as Prisma.InputJsonValue,
          learningProgress: [],
        },
      }),
    );
  } catch (error) {
    await q(`DELETE FROM ${Q}.jobs WHERE id = $1`, [decision.id]);
    throw error;
  }
  return { ok: true, id: decision.id, reused: false };
}

// ─── Claiming and leases ──────────────────────────────────────

/** Takes the oldest ready job in `lane` if fewer than `limit` are running there, across all processes. */
export async function claim(lane: Lane, limit: number, worker: string): Promise<JobRow | null> {
  if (limit <= 0) return null;
  const { queued, running } = LANE_STAGES[lane];
  return inTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`public-fde-claim-${lane}`]);
    const busy = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${Q}.jobs WHERE stage = $1`, [running]);
    if ((busy.rows[0]?.n ?? 0) >= limit) return null;
    const startedColumn = lane === "profile" ? "profile_started_at" : "analysis_started_at";
    const { rows } = await client.query<JobRow>(
      `UPDATE ${Q}.jobs SET stage = $2, lease_owner = $3, lease_until = now() + ($4::text || ' seconds')::interval,
              attempts = attempts + 1, ${startedColumn} = coalesce(${startedColumn}, now())
        WHERE id = (SELECT id FROM ${Q}.jobs WHERE stage = $1 AND not_before <= now() ORDER BY seq FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING *`,
      [queued, running, worker, String(LEASE_SECONDS)],
    );
    return rows[0] ?? null;
  });
}

/** Renews a lease; false means another worker has the job now and this one must stop. */
export async function heartbeat(id: string, worker: string): Promise<boolean> {
  const { rowCount } = await q(`UPDATE ${Q}.jobs SET lease_until = now() + ($3::text || ' seconds')::interval WHERE id = $1 AND lease_owner = $2 AND stage LIKE '%_running'`, [
    id,
    worker,
    String(LEASE_SECONDS),
  ]);
  return (rowCount ?? 0) > 0;
}

/** The profile is read: on to the analysis queue, keeping the job's place (its seq). */
export async function profileDone(id: string, worker: string): Promise<boolean> {
  const { rowCount } = await q(
    `UPDATE ${Q}.jobs SET stage = 'analysis_queued', attempts = 0, lease_owner = NULL, lease_until = NULL, profile_done_at = now(), not_before = now()
      WHERE id = $1 AND lease_owner = $2 AND stage = 'profile_running'`,
    [id, worker],
  );
  return (rowCount ?? 0) > 0;
}

/** Done, one way or another. What's left of the set-aside goes back to the day's budget. */
export async function finishJob(id: string, worker: string, outcome: string, extra: { errorCode?: string | null; ref?: string | null } = {}): Promise<void> {
  await q(
    `UPDATE ${Q}.jobs SET stage = 'finished', outcome = $3, error_code = $4, ref = $5, reserved_micro = spent_micro, lease_owner = NULL, lease_until = NULL, finished_at = now()
      WHERE id = $1 AND lease_owner = $2`,
    [id, worker, outcome, extra.errorCode ?? null, extra.ref ?? null],
  );
}

/** Given up on. The report says why; the reference leads to the details on the live page. */
export async function failJob(id: string, worker: string | null, errorCode: string, ref: string): Promise<void> {
  await q(
    `UPDATE ${Q}.jobs SET stage = 'failed', outcome = 'failed', error_code = $3, ref = $4, reserved_micro = spent_micro, lease_owner = NULL, lease_until = NULL, finished_at = now()
      WHERE id = $1 AND ($2::text IS NULL OR lease_owner = $2)`,
    [id, worker, errorCode, ref],
  );
}

/**
 * Back to its lane's queue to try again after `delayMs`, at the same place in
 * line. A wait caused by a provider (rate limits, an outage) isn't the job's
 * fault, so it doesn't use up one of its attempts.
 */
export async function deferJob(id: string, worker: string, lane: Lane, delayMs: number, errorCode: string): Promise<void> {
  await q(
    `UPDATE ${Q}.jobs SET stage = $3, not_before = now() + ($4::text || ' milliseconds')::interval, attempts = GREATEST(attempts - 1, 0), deferrals = deferrals + 1,
            error_code = $5, lease_owner = NULL, lease_until = NULL
      WHERE id = $1 AND lease_owner = $2`,
    [id, worker, LANE_STAGES[lane].queued, String(Math.round(delayMs)), errorCode],
  );
}

/** Jobs whose worker stopped renewing: back in line, or given up after MAX_ATTEMPTS. Safe to run from every process. */
export async function reapExpiredLeases(): Promise<{ requeued: string[]; abandoned: string[] }> {
  const requeued: string[] = [];
  const abandoned: string[] = [];
  for (const lane of ["profile", "analysis"] as const) {
    const { queued, running } = LANE_STAGES[lane];
    const back = await q<{ id: string }>(
      `UPDATE ${Q}.jobs SET stage = $2, lease_owner = NULL, lease_until = NULL, not_before = now()
        WHERE stage = $1 AND lease_until < now() AND attempts < $3 RETURNING id`,
      [running, queued, MAX_ATTEMPTS],
    );
    requeued.push(...back.rows.map((row) => row.id));
    const gone = await q<{ id: string }>(
      `UPDATE ${Q}.jobs SET stage = 'failed', outcome = 'failed', error_code = 'worker_lost', reserved_micro = spent_micro, lease_owner = NULL, lease_until = NULL, finished_at = now()
        WHERE stage = $1 AND lease_until < now() AND attempts >= $2 RETURNING id`,
      [running, MAX_ATTEMPTS],
    );
    abandoned.push(...gone.rows.map((row) => row.id));
  }
  return { requeued, abandoned };
}

/** On a clean shutdown (a redeploy), hands this worker's jobs straight back rather than waiting for their leases to run out. */
export async function releaseWorker(worker: string): Promise<number> {
  const { rowCount } = await q(
    `UPDATE ${Q}.jobs SET stage = CASE stage WHEN 'profile_running' THEN 'profile_queued' ELSE 'analysis_queued' END,
            attempts = GREATEST(attempts - 1, 0), lease_owner = NULL, lease_until = NULL, not_before = now()
      WHERE lease_owner = $1 AND stage LIKE '%_running'`,
    [worker],
  );
  return rowCount ?? 0;
}

// ─── Reading ──────────────────────────────────────────────────

export async function jobFor(id: string, guestId: string): Promise<JobRow | null> {
  const { rows } = await q<JobRow>(`SELECT * FROM ${Q}.jobs WHERE id = $1 AND guest_id = $2`, [id, guestId]);
  return rows[0] ?? null;
}

export type Place = {
  /** Reports ahead of this one, in its current lane. */
  ahead: number;
  /** An estimate in seconds, only when enough reports finished recently to base one on. */
  etaSeconds: number | null;
  /** How many recent reports the estimate is based on. */
  basis: number;
};

/** Where a waiting report is in line, and, once there's real data, roughly how long it has left. */
export async function placeOf(job: JobRow): Promise<Place | null> {
  if (job.stage !== "profile_queued" && job.stage !== "analysis_queued" && job.stage !== "profile_running" && job.stage !== "analysis_running") return null;
  const lane: Lane = job.stage.startsWith("profile") ? "profile" : "analysis";
  const { rows } = await q<{ ahead: number }>(`SELECT count(*)::int AS ahead FROM ${Q}.jobs WHERE stage = $1 AND seq < $2`, [LANE_STAGES[lane].queued, job.seq]);
  const ahead = job.stage.endsWith("_running") ? 0 : (rows[0]?.ahead ?? 0);
  // The median analysis time of reports finished in the last two hours. Fewer than 3: no estimate.
  const recent = await q<{ seconds: number }>(
    `SELECT extract(epoch FROM finished_at - analysis_started_at)::float AS seconds FROM ${Q}.jobs
      WHERE stage = 'finished' AND outcome IN ('complete', 'partial') AND analysis_started_at IS NOT NULL AND finished_at > now() - interval '2 hours'
      ORDER BY finished_at DESC LIMIT 30`,
  );
  const basis = recent.rows.length;
  if (basis < 3) return { ahead, etaSeconds: null, basis };
  const sorted = recent.rows.map((row) => row.seconds).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const lanes = (await readControls()).lanes.analysis || 1;
  const analysisAhead = lane === "analysis" ? ahead : ahead + (await q<{ n: number }>(`SELECT count(*)::int AS n FROM ${Q}.jobs WHERE stage = 'analysis_queued'`)).rows[0]!.n;
  const rounds = Math.floor(analysisAhead / lanes) + 1;
  return { ahead, etaSeconds: Math.round(rounds * median), basis };
}

export const isOpen = (stage: Stage) => OPEN_STAGES.includes(stage);
export { DAY_MS };

const RETRYABLE_CODES = new Set(["unavailable", "market_unavailable", "discovery_failed", "no_roles", "benchmark_failed", "worker_lost", "unexpected", "failed", "quota"]);

/**
 * "Try again" on a report that ended in a way retrying can help. It goes back
 * in line where it stopped (a profile already read isn't read or paid for
 * again) and sets money aside for the new attempt, within today's budget.
 */
export async function retryReport(id: string, guestId: string): Promise<{ ok: true } | { ok: false; code: "not_found" | "not_retryable" | "paused" | "budget"; status: number }> {
  const config = publicFdeConfig();
  if ((await readControls(true)).intakePaused) return { ok: false, code: "paused", status: 503 };
  return inTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('public-fde-admit'))`);
    const { rows } = await client.query<JobRow>(`SELECT * FROM ${Q}.jobs WHERE id = $1 AND guest_id = $2 FOR UPDATE`, [id, guestId]);
    const job = rows[0];
    if (!job) return { ok: false as const, code: "not_found" as const, status: 404 };
    const ended = job.stage === "failed" || (job.stage === "finished" && (job.outcome === "failed" || job.outcome === "quota"));
    if (!ended || !RETRYABLE_CODES.has(job.error_code ?? job.outcome ?? "")) return { ok: false as const, code: "not_retryable" as const, status: 409 };
    const open = await client.query<{ outstanding: string }>(
      `SELECT coalesce(sum(GREATEST(reserved_micro - spent_micro, 0)), 0)::text AS outstanding FROM ${Q}.jobs WHERE stage = ANY($1::text[])`,
      [OPEN_STAGES],
    );
    const spent = await client.query<{ total: string }>(`SELECT coalesce(sum(cost_micro), 0)::text AS total FROM ${Q}.spend WHERE day = current_date`);
    if (Number(spent.rows[0]?.total ?? 0) + Number(open.rows[0]?.outstanding ?? 0) + config.reservePerReportMicro > config.dailyBudgetMicro) {
      return { ok: false as const, code: "budget" as const, status: 503 };
    }
    await client.query(
      `UPDATE ${Q}.jobs SET stage = CASE WHEN profile_done_at IS NULL THEN 'profile_queued' ELSE 'analysis_queued' END,
              attempts = 0, deferrals = 0, outcome = NULL, error_code = NULL, ref = NULL, finished_at = NULL, not_before = now(),
              reserved_micro = spent_micro + $2
        WHERE id = $1`,
      [id, config.reservePerReportMicro],
    );
    return { ok: true as const };
  });
}
