import "server-only";

import pg from "pg";

import { env } from "@/lib/env";

// The public review's queue and controls, in a shared schema of their own
// ("cs_public_fde"), reached with plain SQL like the accounts schema. Nothing
// here holds profile data: that stays in the service tenant's FdeReport rows.
// Every limit that has to hold across processes (how many run at once, the
// day's budget, a provider's cool-down) is decided here, in the database.

export const Q = "cs_public_fde";

const globalForQueue = globalThis as unknown as { publicFdePool?: pg.Pool; publicFdeReady?: Promise<void> };

export function queuePool(): pg.Pool {
  globalForQueue.publicFdePool ??= new pg.Pool({ connectionString: env.DATABASE_URL, max: 8, idleTimeoutMillis: 30_000 });
  return globalForQueue.publicFdePool;
}

export const QUEUE_DDL = [
  `CREATE SCHEMA IF NOT EXISTS ${Q}`,
  // One row per report. Its id is the FdeReport's id in the service tenant.
  `CREATE TABLE IF NOT EXISTS ${Q}.jobs (
    id TEXT PRIMARY KEY,
    seq BIGSERIAL NOT NULL UNIQUE,
    guest_id TEXT NOT NULL,
    subject_key TEXT NOT NULL,
    client_key TEXT,
    stage TEXT NOT NULL,
    not_before TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0,
    deferrals INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT,
    lease_until TIMESTAMPTZ,
    reserved_micro BIGINT NOT NULL DEFAULT 0,
    spent_micro BIGINT NOT NULL DEFAULT 0,
    outcome TEXT,
    error_code TEXT,
    ref TEXT,
    ip_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    profile_started_at TIMESTAMPTZ,
    profile_done_at TIMESTAMPTZ,
    analysis_started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS jobs_client_key_idx ON ${Q}.jobs (guest_id, client_key) WHERE client_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS jobs_stage_idx ON ${Q}.jobs (stage, not_before, seq)`,
  `CREATE INDEX IF NOT EXISTS jobs_guest_idx ON ${Q}.jobs (guest_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS jobs_ip_idx ON ${Q}.jobs (ip_hash, created_at)`,
  // Operator switches: intake and each lane, and how many run at once.
  `CREATE TABLE IF NOT EXISTS ${Q}.controls (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT NOT NULL DEFAULT ''
  )`,
  // A provider that answered "too many requests": nobody calls it again before `until`.
  `CREATE TABLE IF NOT EXISTS ${Q}.cooldowns (
    provider TEXT PRIMARY KEY,
    until TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL DEFAULT ''
  )`,
  // What went wrong, for the operator, by the reference a visitor sees. Sanitized: no payloads, keys or profile data.
  `CREATE TABLE IF NOT EXISTS ${Q}.incidents (
    ref TEXT PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    job_id TEXT,
    scope TEXT NOT NULL,
    code TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS incidents_at_idx ON ${Q}.incidents (at)`,
  // What the public review spent each day, by kind (profile, market, model), whatever the job.
  `CREATE TABLE IF NOT EXISTS ${Q}.spend (
    day DATE NOT NULL,
    kind TEXT NOT NULL,
    cost_micro BIGINT NOT NULL DEFAULT 0,
    tokens_in BIGINT NOT NULL DEFAULT 0,
    tokens_out BIGINT NOT NULL DEFAULT 0,
    calls INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, kind)
  )`,
];

/** Creates the queue's schema once per process. */
export function ensureQueueSchema(pool = queuePool()): Promise<void> {
  globalForQueue.publicFdeReady ??= (async () => {
    for (const statement of QUEUE_DDL) await pool.query(statement);
  })().catch((error: unknown) => {
    globalForQueue.publicFdeReady = undefined;
    throw error;
  });
  return globalForQueue.publicFdeReady;
}

export async function q<R extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<pg.QueryResult<R>> {
  await ensureQueueSchema();
  return queuePool().query<R>(text, values);
}

/** Runs `fn` in one transaction on one connection. */
export async function inTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  await ensureQueueSchema();
  const client = await queuePool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
