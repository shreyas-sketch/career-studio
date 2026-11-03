import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { deriveKey } from "@/lib/keys";

// The session cookie: "<userId>.<sessionId>.<expires>.<persistent>.<mac>",
// with an HMAC-SHA256 under a key derived from DOSSIER_SECRET. It is signed,
// not encrypted: it holds no personal data, only ids. Checking it needs no
// database and no await, so the per-user database client can be chosen
// synchronously while a page renders (src/lib/tenancy). Whether the session
// still exists (signed out, or removed from Settings → Account) is checked
// against the sessions table by getSession().

export const SESSION_COOKIE = "cs_session";

const HOUR = 60 * 60;
/** How long a sign-in lasts: 24 hours, or 30 days with "Keep me signed in". */
export const SESSION_LIFETIME = { browser: 24 * HOUR, persistent: 30 * 24 * HOUR } as const;

export type SessionToken = {
  userId: string;
  sessionId: string;
  persistent: boolean;
  expiresAt: Date;
};

const ID = /^[a-z0-9_]{8,64}$/;

function mac(payload: string, key: Uint8Array): Buffer {
  return createHmac("sha256", key).update(payload, "utf8").digest();
}

export function encodeSessionToken(token: SessionToken, key = deriveKey("session")): string {
  if (!ID.test(token.userId) || !ID.test(token.sessionId)) throw new Error("Invalid session ids.");
  const payload = [
    token.userId,
    token.sessionId,
    String(Math.floor(token.expiresAt.getTime() / 1000)),
    token.persistent ? "1" : "0",
  ].join(".");
  return `${payload}.${mac(payload, key).toString("base64url")}`;
}

/** The token's contents when it is genuine and unexpired, else null. Never throws. */
export function decodeSessionToken(
  value: string | undefined | null,
  { key = deriveKey("session"), now = new Date() }: { key?: Uint8Array; now?: Date } = {},
): SessionToken | null {
  if (!value || value.length > 300) return null;
  const parts = value.split(".");
  if (parts.length !== 5) return null;
  const [userId, sessionId, expires, persistent, signature] = parts as [string, string, string, string, string];
  if (!ID.test(userId) || !ID.test(sessionId) || !/^\d{1,12}$/.test(expires) || !/^[01]$/.test(persistent)) return null;
  const expected = mac(parts.slice(0, 4).join("."), key);
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const expiresAt = new Date(Number(expires) * 1000);
  if (expiresAt.getTime() <= now.getTime()) return null;
  return { userId, sessionId, persistent: persistent === "1", expiresAt };
}
