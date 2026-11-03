import "server-only";

import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

import { decodeSessionToken, SESSION_COOKIE } from "@/lib/auth/session-token";

// The signed-in user of the request being rendered, read synchronously.
//
// Server Components have no hook we can wrap, and Next.js only offers
// cookies() as a promise. Next keeps the request's cookies in its own
// request-scoped AsyncLocalStorage (the "work unit" store), which is what
// cookies() reads too; we read the same store directly. This is Next.js'
// internal API, pinned with the exact next version in package.json, and
// request-user.test.ts fails if its shape changes. If it ever can't be read,
// the answer is null: queries then fail closed (NoTenantError), never open.

type CookieJar = { get(name: string): { value: string } | undefined };

function requestCookies(): CookieJar | null {
  try {
    const store = workUnitAsyncStorage.getStore() as { type?: string; cookies?: unknown } | undefined;
    if (!store || store.type !== "request") return null;
    const cookies = store.cookies as CookieJar | undefined;
    return cookies && typeof cookies.get === "function" ? cookies : null;
  } catch {
    return null;
  }
}

/** The user id from the request's session cookie, when it's genuine and unexpired. */
export function userIdFromRequestCookie(): string | null {
  const cookies = requestCookies();
  if (!cookies) return null;
  return decodeSessionToken(cookies.get(SESSION_COOKIE)?.value)?.userId ?? null;
}
