import "server-only";

import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

import { decodeSessionToken, SESSION_COOKIE } from "@/lib/auth/session-token";
import { PRINT_TOKEN_HEADER, readPrintToken } from "@/lib/pdf/print-token";

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
type HeaderBag = { get(name: string): string | null };

function requestStore(): { cookies: CookieJar | null; headers: HeaderBag | null } | null {
  try {
    const store = workUnitAsyncStorage.getStore() as { type?: string; cookies?: unknown; headers?: unknown } | undefined;
    if (!store || store.type !== "request") return null;
    const cookies = store.cookies as CookieJar | undefined;
    const headers = store.headers as HeaderBag | undefined;
    return {
      cookies: cookies && typeof cookies.get === "function" ? cookies : null,
      headers: headers && typeof headers.get === "function" ? headers : null,
    };
  } catch {
    return null;
  }
}

/**
 * The account of the request being rendered: from its session cookie, or for
 * the PDF renderer's headless browser, from its print token (which the print
 * page also checks against its own path).
 */
export function userIdFromRequestCookie(): string | null {
  const store = requestStore();
  if (!store) return null;
  const fromCookie = decodeSessionToken(store.cookies?.get(SESSION_COOKIE)?.value)?.userId;
  if (fromCookie) return fromCookie;
  return readPrintToken(store.headers?.get(PRINT_TOKEN_HEADER))?.userId ?? null;
}
