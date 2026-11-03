import "server-only";

import pg from "pg";

import { env } from "@/lib/env";
import { ACCOUNTS_SCHEMA } from "@/lib/tenancy/schema-name";

// The one place data shared across users lives: the "cs_accounts" schema with
// accounts, sessions and sign-in throttling. Plain SQL through pg, so none of
// it is reachable through the per-user Prisma client.

const globalForAccounts = globalThis as unknown as { accountsPool?: pg.Pool; accountsReady?: Promise<void> };

export function accountsPool(): pg.Pool {
  globalForAccounts.accountsPool ??= new pg.Pool({ connectionString: env.DATABASE_URL, max: 5, idleTimeoutMillis: 30_000 });
  return globalForAccounts.accountsPool;
}

/** Statements that create the shared schema; each is safe to run again. */
export const ACCOUNTS_DDL = [
  `CREATE EXTENSION IF NOT EXISTS citext SCHEMA public`,
  `CREATE SCHEMA IF NOT EXISTS ${ACCOUNTS_SCHEMA}`,
  `CREATE TABLE IF NOT EXISTS ${ACCOUNTS_SCHEMA}.users (
    id TEXT PRIMARY KEY,
    email public.citext NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    provisioned_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS ${ACCOUNTS_SCHEMA}.sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES ${ACCOUNTS_SCHEMA}.users(id) ON DELETE CASCADE,
    persistent BOOLEAN NOT NULL DEFAULT false,
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON ${ACCOUNTS_SCHEMA}.sessions (user_id)`,
  `CREATE TABLE IF NOT EXISTS ${ACCOUNTS_SCHEMA}.login_throttle (
    key TEXT PRIMARY KEY,
    failures INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL,
    blocked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // Public listings fetched for every account (Career Studio's freelance
  // sources), cached so each source is polled within its limits.
  `CREATE SCHEMA IF NOT EXISTS cs_shared`,
  `CREATE TABLE IF NOT EXISTS cs_shared.feed_cache (
    key TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL
  )`,
];

/** Creates the shared schema once per process. */
export function ensureAccountsSchema(pool = accountsPool()): Promise<void> {
  globalForAccounts.accountsReady ??= (async () => {
    for (const statement of ACCOUNTS_DDL) await pool.query(statement);
  })().catch((error: unknown) => {
    globalForAccounts.accountsReady = undefined;
    throw error;
  });
  return globalForAccounts.accountsReady;
}

/** Runs a query against the shared schema, creating it first if needed. */
export async function accountsQuery<R extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<pg.QueryResult<R>> {
  await ensureAccountsSchema();
  return accountsPool().query<R>(text, values);
}
