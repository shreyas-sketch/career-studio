import "server-only";

import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { type NextRequest, NextResponse } from "next/server";

import { logServerError } from "@/lib/log";
import { isSameOrigin } from "@/lib/route";

import { decodeGuest, encodeGuest, GUEST_COOKIE, GUEST_LIFETIME_SECONDS, newGuestId } from "./guest";
import { recordIncident } from "./ops";
import { asPublicTenant } from "./tenant";

// Route handlers the public review exposes, and nothing else. They never
// look at an account session: a visitor is only ever their guest cookie.

export const PUBLIC_HEADERS: Record<string, string> = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...PUBLIC_HEADERS, ...extra } });
}

/** The guest of this request, if its cookie is valid. */
export async function currentGuest(): Promise<string | null> {
  return decodeGuest((await cookies()).get(GUEST_COOKIE)?.value);
}

/** The guest of this request, made now if there's none. Only from a route handler, which can set cookies. */
export async function ensureGuest(request: NextRequest): Promise<string> {
  const existing = await currentGuest();
  if (existing) return existing;
  const guestId = newGuestId();
  const https = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" || request.nextUrl.protocol === "https:";
  (await cookies()).set(GUEST_COOKIE, encodeGuest(guestId), { httpOnly: true, sameSite: "lax", secure: https, path: "/", maxAge: GUEST_LIFETIME_SECONDS });
  return guestId;
}

export function publicRoute<Context = unknown>(handler: (request: NextRequest, context: Context) => Promise<Response>): (request: NextRequest, context: Context) => Promise<Response> {
  return async (request, context) => {
    if (!isSameOrigin(request)) return json({ error: "This request has to come from the FDE review page itself." }, 403);
    try {
      const response = await asPublicTenant(() => handler(request, context));
      for (const [name, value] of Object.entries(PUBLIC_HEADERS)) if (!response.headers.has(name)) response.headers.set(name, value);
      return response;
    } catch (error) {
      unstable_rethrow(error);
      const ref = await recordIncident({ jobId: null, scope: "http", code: "unexpected", detail: `${request.method} ${request.nextUrl.pathname}: ${error instanceof Error ? `${error.name}: ${error.message}` : "error"}` });
      logServerError(`public FDE ${request.method} ${request.nextUrl.pathname} (${ref})`, error);
      return json({ error: "Something went wrong on our side. Try again in a moment.", ref }, 500);
    }
  };
}
