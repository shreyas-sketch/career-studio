import "server-only";

import { accountsPool, ensureAccountsSchema } from "@/lib/accounts/db";
import { afterFailure, PER_IP, waitMs, type ThrottlePolicy, type ThrottleState } from "@/lib/auth/throttle";
import { ACCOUNTS_SCHEMA } from "@/lib/tenancy/schema-name";

// Sign-in and sign-up rate limiting, shared across users. Failures count per
// client IP and per email address, so guessing one account's password is
// slowed down without letting a stranger lock everyone else out (Dossier's
// single-user "all IPs" counter would do exactly that on a shared host).

/** Per address: a little looser than per IP, since people mistype. */
export const PER_EMAIL: ThrottlePolicy = { ...PER_IP, maxFailures: 8 };
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

export const ipKey = (ip: string) => `ip:${ip}`;
export const emailKey = (email: string) => `email:${email.trim().toLowerCase()}`;

type Row = { failures: number; window_start: Date; blocked_until: Date | null };
const toState = (row: Row): ThrottleState => ({ failures: row.failures, windowStart: row.window_start, blockedUntil: row.blocked_until });

/** Milliseconds to wait before another attempt for any of `keys`; 0 when allowed. */
export async function throttleWaitMs(keys: string[], now = new Date()): Promise<number> {
  await ensureAccountsSchema();
  const { rows } = await accountsPool().query<Row>(
    `SELECT failures, window_start, blocked_until FROM ${ACCOUNTS_SCHEMA}.login_throttle WHERE key = ANY($1)`,
    [keys],
  );
  return Math.max(0, ...rows.map((row) => waitMs(toState(row), now)));
}

/** Counts a failure for each key under its policy. */
export async function recordThrottleFailure(entries: [key: string, policy: ThrottlePolicy][], now = new Date()): Promise<void> {
  await ensureAccountsSchema();
  const client = await accountsPool().connect();
  try {
    await client.query("BEGIN");
    // Keys in a fixed order, so concurrent failures can't deadlock.
    for (const [key, policy] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
      await client.query(
        `INSERT INTO ${ACCOUNTS_SCHEMA}.login_throttle (key, window_start, updated_at) VALUES ($1, $2, $2) ON CONFLICT (key) DO NOTHING`,
        [key, now],
      );
      const { rows } = await client.query<Row>(
        `SELECT failures, window_start, blocked_until FROM ${ACCOUNTS_SCHEMA}.login_throttle WHERE key = $1 FOR UPDATE`,
        [key],
      );
      const row = rows[0]!;
      const next = afterFailure(row.failures === 0 ? null : toState(row), now, policy);
      await client.query(
        `UPDATE ${ACCOUNTS_SCHEMA}.login_throttle SET failures = $2, window_start = $3, blocked_until = $4, updated_at = $5 WHERE key = $1`,
        [key, next.failures, next.windowStart, next.blockedUntil, now],
      );
    }
    await client.query(`DELETE FROM ${ACCOUNTS_SCHEMA}.login_throttle WHERE updated_at < $1`, [new Date(now.getTime() - PRUNE_AFTER_MS)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function clearThrottle(keys: string[]): Promise<void> {
  await ensureAccountsSchema();
  await accountsPool().query(`DELETE FROM ${ACCOUNTS_SCHEMA}.login_throttle WHERE key = ANY($1)`, [keys]);
}
