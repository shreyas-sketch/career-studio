import "server-only";

import { logServerWarning } from "@/lib/log";

import { DEFAULT_LANES, type Lane } from "./config";
import { Q, q } from "./db";
import { newReference } from "./guest";

// Operator controls, provider cool-downs, incidents and spend, all in the
// database so every process sees the same thing at once.

export type Controls = {
  intakePaused: boolean;
  profilePaused: boolean;
  analysisPaused: boolean;
  /** Why a lane was paused, for the live page; set by the operator or by a credential failure. */
  pauseReason: string;
  lanes: Record<Lane, number>;
};

const DEFAULTS: Controls = { intakePaused: false, profilePaused: false, analysisPaused: false, pauseReason: "", lanes: { ...DEFAULT_LANES } };

let cache: { at: number; value: Controls } | null = null;

export async function readControls(fresh = false): Promise<Controls> {
  if (!fresh && cache && Date.now() - cache.at < 1_000) return cache.value;
  const { rows } = await q<{ value: Partial<Controls> }>(`SELECT value FROM ${Q}.controls WHERE key = 'main'`);
  const saved = rows[0]?.value ?? {};
  const value: Controls = { ...DEFAULTS, ...saved, lanes: { ...DEFAULTS.lanes, ...(saved.lanes ?? {}) } };
  cache = { at: Date.now(), value };
  return value;
}

export type ControlsChange = Partial<Omit<Controls, "lanes">> & { lanes?: Partial<Record<Lane, number>> };

export async function updateControls(change: ControlsChange, by: string): Promise<Controls> {
  const current = await readControls(true);
  const next: Controls = { ...current, ...change, lanes: { ...current.lanes, ...(change.lanes ?? {}) } };
  next.lanes.profile = clamp(next.lanes.profile, 0, 20);
  next.lanes.analysis = clamp(next.lanes.analysis, 0, 20);
  await q(
    `INSERT INTO ${Q}.controls (key, value, updated_at, updated_by) VALUES ('main', $1, now(), $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(next), by.slice(0, 120)],
  );
  cache = null;
  // Resuming a lane lets the reports that waited while it was paused go straight away, in their order.
  const resumed = [current.profilePaused && !next.profilePaused ? "profile_queued" : null, current.analysisPaused && !next.analysisPaused ? "analysis_queued" : null].filter(Boolean);
  if (resumed.length > 0) await q(`UPDATE ${Q}.jobs SET not_before = now() WHERE stage = ANY($1::text[]) AND not_before > now()`, [resumed]);
  return next;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value : min)));

/** Stops a lane after a failure that retrying won't fix, so queued reports wait instead of failing one by one. */
export async function autoPause(lane: Lane, reason: string): Promise<void> {
  const current = await readControls(true);
  const already = lane === "profile" ? current.profilePaused : current.analysisPaused;
  if (already) return;
  logServerWarning("public FDE", `Paused the ${lane} lane: ${reason}`);
  await updateControls(lane === "profile" ? { profilePaused: true, pauseReason: reason } : { analysisPaused: true, pauseReason: reason }, "automatic");
}

// ─── Cool-downs ───────────────────────────────────────────────

export type Upstream = "anthropic" | "treg";

export async function cooldownUntil(provider: Upstream): Promise<Date | null> {
  const { rows } = await q<{ until: Date }>(`SELECT until FROM ${Q}.cooldowns WHERE provider = $1 AND until > now()`, [provider]);
  return rows[0]?.until ?? null;
}

/** Nobody calls `provider` for `ms`; a longer cool-down already set stays. */
export async function setCooldown(provider: Upstream, ms: number, reason: string): Promise<void> {
  await q(
    `INSERT INTO ${Q}.cooldowns (provider, until, reason) VALUES ($1, now() + ($2::text || ' milliseconds')::interval, $3)
     ON CONFLICT (provider) DO UPDATE SET until = GREATEST(${Q}.cooldowns.until, EXCLUDED.until), reason = EXCLUDED.reason`,
    [provider, String(Math.round(ms)), reason.slice(0, 200)],
  );
}

// ─── Incidents ────────────────────────────────────────────────

/** Records what went wrong, sanitized, and returns the reference the visitor is shown. */
export async function recordIncident(input: { jobId: string | null; scope: string; code: string; detail: string }): Promise<string> {
  const ref = newReference();
  await q(`INSERT INTO ${Q}.incidents (ref, job_id, scope, code, detail) VALUES ($1, $2, $3, $4, $5)`, [
    ref,
    input.jobId,
    input.scope.slice(0, 40),
    input.code.slice(0, 60),
    sanitize(input.detail).slice(0, 500),
  ]).catch(() => {});
  return ref;
}

/** Strips anything that looks like a key, token or address with credentials, just in case one reaches a detail. */
export function sanitize(text: string): string {
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[key]")
    .replace(/\b(?:Bearer|token|api[-_ ]?key)\s*[:=]?\s*[A-Za-z0-9._-]{12,}/gi, "[credential]")
    .replace(/https?:\/\/[^\s/]*:[^\s/]*@/g, "https://[credentials]@");
}

// ─── Spend ────────────────────────────────────────────────────

export type SpendKind = "profile" | "market" | "model";

export async function addSpend(kind: SpendKind, costMicro: number, tokens: { input?: number; output?: number } = {}): Promise<void> {
  await q(
    `INSERT INTO ${Q}.spend (day, kind, cost_micro, tokens_in, tokens_out, calls) VALUES (current_date, $1, $2, $3, $4, 1)
     ON CONFLICT (day, kind) DO UPDATE SET cost_micro = ${Q}.spend.cost_micro + EXCLUDED.cost_micro,
       tokens_in = ${Q}.spend.tokens_in + EXCLUDED.tokens_in, tokens_out = ${Q}.spend.tokens_out + EXCLUDED.tokens_out, calls = ${Q}.spend.calls + 1`,
    [kind, Math.max(0, Math.round(costMicro)), tokens.input ?? 0, tokens.output ?? 0],
  );
}

export async function spendToday(): Promise<{ kind: SpendKind; costMicro: number; tokensIn: number; tokensOut: number; calls: number }[]> {
  const { rows } = await q<{ kind: SpendKind; cost_micro: string; tokens_in: string; tokens_out: string; calls: number }>(
    `SELECT kind, cost_micro, tokens_in, tokens_out, calls FROM ${Q}.spend WHERE day = current_date ORDER BY kind`,
  );
  return rows.map((row) => ({ kind: row.kind, costMicro: Number(row.cost_micro), tokensIn: Number(row.tokens_in), tokensOut: Number(row.tokens_out), calls: row.calls }));
}
