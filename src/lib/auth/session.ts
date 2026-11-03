import "server-only";

import { randomBytes } from "node:crypto";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { accountsQuery } from "@/lib/accounts/db";
import { decodeSessionToken, encodeSessionToken, SESSION_COOKIE, SESSION_LIFETIME } from "@/lib/auth/session-token";
import { ACCOUNTS_SCHEMA } from "@/lib/tenancy/schema-name";

// Career Studio has accounts: a session belongs to one user. The cookie is a
// signed token with the user's and the session's ids (session-token.ts); the
// session itself is a row in cs_accounts.sessions, so signing out, or
// removing a session from Settings → Account, ends it at once.

export { SESSION_COOKIE, SESSION_LIFETIME };

/** A signed-in session. */
export type Session = {
  userId: string;
  sessionId: string;
  /** Signed in with "Keep me signed in". */
  persistent: boolean;
  expiresAt: Date;
};

/** Whether the browser reached us over HTTPS, as the reverse proxy reports it. */
async function isHttps(): Promise<boolean> {
  const proto = (await headers()).get("x-forwarded-proto");
  return proto?.split(",")[0]?.trim() === "https";
}

/** Signs `userId` in: stores a session and sets its cookie. Call from a Server Action or route handler. */
export async function startSession({ userId, persistent }: { userId: string; persistent: boolean }): Promise<void> {
  const sessionId = randomBytes(16).toString("hex");
  const lifetime = SESSION_LIFETIME[persistent ? "persistent" : "browser"];
  const expiresAt = new Date(Date.now() + lifetime * 1000);
  const userAgent = ((await headers()).get("user-agent") ?? "").slice(0, 200);
  await accountsQuery(
    `INSERT INTO ${ACCOUNTS_SCHEMA}.sessions (id, user_id, persistent, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, userId, persistent, userAgent, expiresAt],
  );
  const token = encodeSessionToken({ userId, sessionId, persistent, expiresAt });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: await isHttps(),
    ...(persistent ? { maxAge: lifetime } : {}),
  });
}

/** Whether the session row still exists and hasn't expired. Touches last_seen_at at most every 10 minutes. */
async function sessionIsLive(userId: string, sessionId: string): Promise<boolean> {
  const { rows } = await accountsQuery<{ last_seen_at: Date }>(
    `SELECT last_seen_at FROM ${ACCOUNTS_SCHEMA}.sessions WHERE id = $1 AND user_id = $2 AND expires_at > now()`,
    [sessionId, userId],
  );
  const row = rows[0];
  if (!row) return false;
  if (Date.now() - row.last_seen_at.getTime() > 10 * 60 * 1000) {
    await accountsQuery(`UPDATE ${ACCOUNTS_SCHEMA}.sessions SET last_seen_at = now() WHERE id = $1`, [sessionId]).catch(() => {});
  }
  return true;
}

/** The session from a cookie value, checked against the sessions table. */
export async function sessionFromToken(value: string | undefined): Promise<Session | null> {
  const token = decodeSessionToken(value);
  if (!token) return null;
  if (!(await sessionIsLive(token.userId, token.sessionId))) return null;
  return token;
}

/** The current session, or null when the request isn't signed in. Cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  return sessionFromToken((await cookies()).get(SESSION_COOKIE)?.value);
});

/**
 * The current session, for pages and layouts: sends the visitor to /login
 * when there is none. Proxy (src/proxy.ts) usually redirects first; this is
 * the check that counts, next to the data.
 */
export async function verifySession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Signs out this browser: removes the session and its cookie. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = decodeSessionToken(jar.get(SESSION_COOKIE)?.value);
  if (token) await accountsQuery(`DELETE FROM ${ACCOUNTS_SCHEMA}.sessions WHERE id = $1`, [token.sessionId]).catch(() => {});
  jar.delete(SESSION_COOKIE);
}

/** Ends every session of `userId`, e.g. after a password change; keeps `except` when given. */
export async function endAllSessions(userId: string, except?: string): Promise<void> {
  await accountsQuery(
    `DELETE FROM ${ACCOUNTS_SCHEMA}.sessions WHERE user_id = $1 AND ($2::text IS NULL OR id <> $2)`,
    [userId, except ?? null],
  );
}

/** Removes expired sessions. */
export async function sweepExpiredSessions(): Promise<void> {
  await accountsQuery(`DELETE FROM ${ACCOUNTS_SCHEMA}.sessions WHERE expires_at <= now()`);
}
