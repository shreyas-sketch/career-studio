import { describe, expect, it } from "vitest";

import { checkFormToken, decodeGuest, encodeGuest, hashIp, isGuestId, makeFormToken, newGuestId, newReference, ownerOf } from "./guest";

const key = new Uint8Array(32).fill(7);
const otherKey = new Uint8Array(32).fill(9);

describe("guest cookie", () => {
  it("round-trips a new guest id", () => {
    const id = newGuestId();
    expect(isGuestId(id)).toBe(true);
    expect(decodeGuest(encodeGuest(id, key), key)).toBe(id);
  });

  it("refuses a forged, altered or foreign cookie", () => {
    const id = newGuestId();
    const cookie = encodeGuest(id, key);
    expect(decodeGuest(cookie, otherKey)).toBeNull();
    expect(decodeGuest(cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A")), key)).toBeNull();
    // Someone else's id with this signature.
    expect(decodeGuest(`${newGuestId()}.${cookie.split(".")[1]}`, key)).toBeNull();
    expect(decodeGuest("not-a-cookie", key)).toBeNull();
    expect(decodeGuest(undefined, key)).toBeNull();
    expect(() => encodeGuest("g_short", key)).toThrow();
  });

  it("marks guest rows so they can't be taken for an account's", () => {
    expect(ownerOf("g_0123456789abcdef0123456789abcdef")).toBe("guest:g_0123456789abcdef0123456789abcdef");
  });
});

describe("form token", () => {
  const guest = newGuestId();
  const made = 1_800_000_000_000;

  it("accepts a token that's a moment old, for the guest it was made for", () => {
    expect(checkFormToken(makeFormToken(guest, made, key), guest, made + 5_000, key)).toBe("ok");
  });

  it("refuses an instant submit, a stale page, another guest's token and garbage", () => {
    const token = makeFormToken(guest, made, key);
    expect(checkFormToken(token, guest, made + 200, key)).toBe("too_fast");
    expect(checkFormToken(token, guest, made + 7 * 3_600_000, key)).toBe("expired");
    expect(checkFormToken(token, newGuestId(), made + 5_000, key)).toBe("invalid");
    expect(checkFormToken(`${token}.x`, guest, made + 5_000, key)).toBe("invalid");
    expect(checkFormToken(null, guest, made, key)).toBe("missing");
  });
});

describe("network hashing and references", () => {
  it("hashes an address the same way every time, without keeping it", () => {
    expect(hashIp("203.0.113.9", key)).toBe(hashIp("203.0.113.9", key));
    expect(hashIp("203.0.113.9", key)).not.toContain("203");
    expect(hashIp("203.0.113.9", key)).not.toBe(hashIp("203.0.113.10", key));
  });

  it("makes short references a visitor can quote", () => {
    expect(newReference()).toMatch(/^FDE-[0-9A-F]{8}$/);
  });
});
