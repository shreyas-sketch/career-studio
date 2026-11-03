import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { userIdFromRequestCookie } from "@/lib/tenancy/request-user";

// Career Studio keeps each user's data in a Postgres schema of their own
// (docs/ARCHITECTURE.md §Tenancy). Every database call has to know whose
// schema it runs in, so the current user travels with the async call chain:
//
// - Server Actions, route handlers and background work run inside
//   runAsUser(), which puts the user in AsyncLocalStorage.
// - Server Components (pages and layouts) aren't wrapped by us, so when no
//   user was set explicitly, the signed session cookie of the request being
//   rendered decides (request-user.ts).
//
// With neither, there is no user and every query fails (NoTenantError): a
// mistake can never fall back to someone else's data or a shared table.

type TenantStore = { userId: string };

const storage = new AsyncLocalStorage<TenantStore>();

/** Thrown by a database call that runs without a signed-in user. */
export class NoTenantError extends Error {
  override name = "NoTenantError";
  constructor() {
    super("No signed-in user for this database call.");
  }
}

/** Runs `fn` as `userId`: every database call inside it uses that user's data. */
export function runAsUser<T>(userId: string, fn: () => T): T {
  return storage.run({ userId }, fn);
}

/** The user whose data this call works on, or null when there is none. */
export function currentUserId(): string | null {
  return storage.getStore()?.userId ?? userIdFromRequestCookie() ?? testUserId();
}

/**
 * Under Vitest only: Dossier's tests were written for one user and mock the
 * database client, so they run as a fixed test account. Never set in the app.
 */
export const TEST_USER_ID = "7e570000000000000000000a";
function testUserId(): string | null {
  return process.env.VITEST && process.env.CAREER_STUDIO_NO_TEST_USER !== "1" ? TEST_USER_ID : null;
}

/** The current user, or throws NoTenantError. */
export function requireUserId(): string {
  const userId = currentUserId();
  if (!userId) throw new NoTenantError();
  return userId;
}
