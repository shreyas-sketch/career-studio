import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { deriveKey } from "@/lib/keys";
import { requireUserId } from "@/lib/tenancy/context";
import { isUserId } from "@/lib/tenancy/schema-name";

// Headless Chromium has no session cookie. It reaches a print page with a
// short-lived token instead, signed with a key derived from DOSSIER_SECRET
// and bound to that one page, sent in a request header so it never shows up
// in a URL or a log.
//
// Career Studio: the token also names the account whose document is being
// printed, so the print page renders that account's data. It is checked
// synchronously (HMAC), because the per-account database client is chosen
// synchronously while the page renders (src/lib/tenancy/request-user.ts).

export const PRINT_TOKEN_HEADER = "x-dossier-print-token";
export const PRINT_TOKEN_LIFETIME_SECONDS = 60;

const mac = (payload: string, secret?: string) => createHmac("sha256", deriveKey("print-token", secret)).update(payload, "utf8").digest();

/** A token that opens `path` (e.g. "/print/base") for a minute, as the current account. */
export async function signPrintToken(path: string, secret?: string, { userId = requireUserId(), now = new Date() }: { userId?: string; now?: Date } = {}): Promise<string> {
  const expires = Math.floor(now.getTime() / 1000) + PRINT_TOKEN_LIFETIME_SECONDS;
  const payload = `${userId}.${expires}.${Buffer.from(path, "utf8").toString("base64url")}`;
  return `${payload}.${mac(payload, secret).toString("base64url")}`;
}

/** The token's account and page when it's genuine and unexpired, else null. Never throws. */
export function readPrintToken(token: string | null | undefined, { secret, now = new Date() }: { secret?: string; now?: Date } = {}): { userId: string; path: string } | null {
  if (!token || token.length > 1000) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [userId, expires, path, signature] = parts as [string, string, string, string];
  if (!isUserId(userId) || !/^\d{1,12}$/.test(expires)) return null;
  const expected = mac(parts.slice(0, 3).join("."), secret);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (Number(expires) * 1000 <= now.getTime()) return null;
  return { userId, path: Buffer.from(path, "base64url").toString("utf8") };
}

/** Whether `token` is a valid, unexpired print token for exactly `path`. */
export async function verifyPrintToken(
  token: string | null | undefined,
  path: string,
  options: { secret?: string; now?: Date } = {},
): Promise<boolean> {
  return readPrintToken(token, options)?.path === path;
}
