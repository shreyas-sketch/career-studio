import { describe, expect, it, vi } from "vitest";

import { deriveKey } from "@/lib/keys";

import { decodeSessionToken, encodeSessionToken } from "./session-token";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(32) } }));

const key = deriveKey("session", "s".repeat(32));
const token = { userId: "7e570000000000000000000a", sessionId: "0123456789abcdef", persistent: true, expiresAt: new Date("2026-12-01T00:00:00Z") };
const now = new Date("2026-11-03T00:00:00Z");

describe("session tokens", () => {
  it("round-trips the account, the session and when it ends", () => {
    expect(decodeSessionToken(encodeSessionToken(token, key), { key, now })).toEqual(token);
  });

  it("holds no personal data, only ids", () => {
    expect(encodeSessionToken(token, key)).not.toMatch(/@/);
  });

  it("refuses expired tokens, other keys, edits and junk", () => {
    const value = encodeSessionToken(token, key);
    expect(decodeSessionToken(value, { key, now: new Date("2026-12-02T00:00:00Z") })).toBeNull();
    expect(decodeSessionToken(value, { key: deriveKey("session", "t".repeat(32)), now })).toBeNull();
    expect(decodeSessionToken(value.replace(".1.", ".0."), { key, now })).toBeNull();
    for (const junk of ["", "a.b.c.d.e", "x".repeat(400), undefined, null]) expect(decodeSessionToken(junk, { key, now })).toBeNull();
  });

  it("refuses ids that aren't safe to use", () => {
    expect(() => encodeSessionToken({ ...token, userId: "../etc" }, key)).toThrow();
  });
});
