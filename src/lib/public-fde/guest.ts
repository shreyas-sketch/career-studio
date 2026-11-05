import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { deriveKey } from "@/lib/keys";

// A visitor to the public review is an anonymous guest: a random id in a
// signed, HttpOnly cookie. It's never an account, never the owner's session,
// and it's the only thing that grants access to a guest's reports.

export const GUEST_COOKIE = "cs_fde_guest";
/** A guest lasts as long as their reports can (see retention). */
export const GUEST_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

const GUEST_ID = /^g_[a-f0-9]{32}$/;

const mac = (payload: string, key: Uint8Array) => createHmac("sha256", key).update(payload, "utf8").digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function newGuestId(): string {
  return `g_${randomBytes(16).toString("hex")}`;
}

export function isGuestId(value: string): boolean {
  return GUEST_ID.test(value);
}

/** The owner recorded on a guest's rows, so they can never be mistaken for an account's. */
export const ownerOf = (guestId: string) => `guest:${guestId}`;

export function encodeGuest(guestId: string, key = deriveKey("public-fde-guest")): string {
  if (!isGuestId(guestId)) throw new Error("Invalid guest id.");
  return `${guestId}.${mac(guestId, key)}`;
}

/** The guest id in a cookie value, or null when it's missing or forged. */
export function decodeGuest(value: string | undefined | null, key = deriveKey("public-fde-guest")): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const guestId = value.slice(0, dot);
  if (!isGuestId(guestId)) return null;
  return safeEqual(value.slice(dot + 1), mac(guestId, key)) ? guestId : null;
}

/**
 * A token the landing page renders into its form, bound to the guest and the
 * time it was made. A submission needs one that's at least a moment old and
 * not too stale: it stops scripts that post blindly, without getting in the
 * way of a person (the page re-fetches a fresh one when it's reopened).
 */
const FORM_MIN_AGE_MS = 1_500;
const FORM_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function makeFormToken(guestId: string, now = Date.now(), key = deriveKey("public-fde-form")): string {
  const stamp = now.toString(36);
  return `${stamp}.${mac(`${guestId}.${stamp}`, key)}`;
}

export type FormCheck = "ok" | "missing" | "invalid" | "too_fast" | "expired";

export function checkFormToken(token: string | null | undefined, guestId: string, now = Date.now(), key = deriveKey("public-fde-form")): FormCheck {
  if (!token) return "missing";
  const [stamp, signature, extra] = token.split(".");
  if (!stamp || !signature || extra !== undefined) return "invalid";
  if (!safeEqual(signature, mac(`${guestId}.${stamp}`, key))) return "invalid";
  const age = now - parseInt(stamp, 36);
  if (!Number.isFinite(age) || age < 0) return "invalid";
  if (age < FORM_MIN_AGE_MS) return "too_fast";
  if (age > FORM_MAX_AGE_MS) return "expired";
  return "ok";
}

/** A keyed hash of the client address: enough to count requests from one network, never the address itself. */
export function hashIp(ip: string, key = deriveKey("public-fde-ip")): string {
  return mac(ip, key).slice(0, 22);
}

/** A short reference a visitor can quote, which the operator finds on the live page. */
export function newReference(): string {
  return `FDE-${randomBytes(4).toString("hex").toUpperCase()}`;
}
