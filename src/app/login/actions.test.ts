import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearThrottle, recordThrottleFailure, throttleWaitMs } from "@/lib/accounts/throttle";
import { AccountError, createAccount, findAccountByEmail, provisionAccount } from "@/lib/accounts/users";
import { verifyPassword } from "@/lib/auth/password-hash";
import { startSession } from "@/lib/auth/session";
import { env } from "@/lib/env";

import { signIn, signInWithForm, signUp } from "./actions";
import { loginMessages } from "./messages";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.1, 203.0.113.7" }),
}));
vi.mock("next/navigation", () => ({
  unstable_rethrow: () => {},
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(), startSession: vi.fn() }));
vi.mock("@/lib/auth/password-hash", () => ({ verifyPassword: vi.fn(), hashPassword: async () => "argon2id:dummy" }));
vi.mock("@/lib/accounts/throttle", async (original) => ({
  ...(await original<typeof import("@/lib/accounts/throttle")>()),
  throttleWaitMs: vi.fn(),
  recordThrottleFailure: vi.fn(),
  clearThrottle: vi.fn(),
}));
vi.mock("@/lib/accounts/users", async (original) => ({
  AccountError: (await original<typeof import("@/lib/accounts/users")>()).AccountError,
  findAccountByEmail: vi.fn(),
  createAccount: vi.fn(),
  provisionAccount: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ env: { CAREER_STUDIO_SIGNUPS: "open", CAREER_STUDIO_INVITE_CODE: undefined } }));

const ASHA = { id: "7e570000000000000000000a", email: "asha@example.com", name: "Asha Rao", createdAt: new Date(), provisionedAt: new Date(), passwordHash: "argon2id:real" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(throttleWaitMs).mockResolvedValue(0);
  vi.mocked(findAccountByEmail).mockImplementation(async (email) => (email.trim().toLowerCase() === ASHA.email ? ASHA : null));
  vi.mocked(verifyPassword).mockImplementation(async (candidate, hash) => hash === ASHA.passwordHash && candidate === "correct horse battery");
  Object.assign(env, { CAREER_STUDIO_SIGNUPS: "open", CAREER_STUDIO_INVITE_CODE: undefined });
});

describe("signIn", () => {
  it("asks for the email and password before checking anything", async () => {
    expect(await signIn({ email: "", password: "x", remember: false })).toEqual({ ok: false, error: loginMessages.noEmail });
    expect(await signIn({ email: "asha@example.com", password: "", remember: false })).toEqual({ ok: false, error: loginMessages.empty });
    expect(recordThrottleFailure).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it("signs in to the account, brings its data up to date, and welcomes by first name", async () => {
    const result = await signIn({ email: " Asha@Example.com ", password: "correct horse battery", remember: true, next: "/jobs" });
    expect(result).toEqual({ ok: true, data: { redirectTo: "/jobs" }, toast: "Welcome back, Asha." });
    expect(provisionAccount).toHaveBeenCalledWith(ASHA.id);
    expect(startSession).toHaveBeenCalledWith({ userId: ASHA.id, persistent: true });
    expect(clearThrottle).toHaveBeenCalledWith(["ip:203.0.113.7", "email:asha@example.com"]);
  });

  it("gives the same answer for a wrong password and an unknown address, and counts both", async () => {
    const wrong = await signIn({ email: "asha@example.com", password: "nope", remember: false });
    const unknown = await signIn({ email: "nobody@example.com", password: "nope", remember: false });
    expect(wrong).toEqual({ ok: false, error: loginMessages.wrong });
    expect(unknown).toEqual(wrong);
    // An unknown address is still checked against a hash, so it takes as long.
    expect(verifyPassword).toHaveBeenCalledTimes(2);
    expect(recordThrottleFailure).toHaveBeenCalledTimes(2);
    expect(startSession).not.toHaveBeenCalled();
  });

  it("refuses to check the password while the IP or address is blocked", async () => {
    vi.mocked(throttleWaitMs).mockResolvedValue(90_000);
    const result = await signIn({ email: "asha@example.com", password: "correct horse battery", remember: false });
    expect(result.ok).toBe(false);
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("ignores unsafe redirects", async () => {
    const result = await signIn({ email: "asha@example.com", password: "correct horse battery", remember: false, next: "https://evil.example" });
    expect(result).toMatchObject({ ok: true, data: { redirectTo: "/" } });
  });
});

describe("signInWithForm", () => {
  it("goes on to the next page, or returns the error for the page to show", async () => {
    const form = (fields: Record<string, string>) => {
      const data = new FormData();
      for (const [key, value] of Object.entries(fields)) data.set(key, value);
      return data;
    };
    await expect(signInWithForm(null, form({ email: "asha@example.com", password: "correct horse battery", next: "/jobs" }))).rejects.toThrow("redirect /jobs");
    expect(await signInWithForm(null, form({ email: "asha@example.com", password: "nope" }))).toEqual({ error: loginMessages.wrong });
  });
});

describe("signUp", () => {
  beforeEach(() => {
    vi.mocked(createAccount).mockImplementation(async ({ email, name }) => ({ ...ASHA, email, name }));
  });

  it("creates the account and signs it in", async () => {
    const result = await signUp({ name: "Asha Rao", email: "asha@example.com", password: "correct horse battery" });
    expect(result).toMatchObject({ ok: true, data: { redirectTo: "/" } });
    expect(createAccount).toHaveBeenCalledWith({ email: "asha@example.com", name: "Asha Rao", password: "correct horse battery" });
    expect(startSession).toHaveBeenCalledWith({ userId: ASHA.id, persistent: true });
  });

  it("passes on what's wrong with the details as written", async () => {
    vi.mocked(createAccount).mockRejectedValue(new AccountError("An account with that email already exists."));
    expect(await signUp({ name: "Asha", email: "asha@example.com", password: "correct horse battery" })).toEqual({
      ok: false,
      error: "An account with that email already exists.",
    });
    expect(await signUp({ name: " ", email: "x@example.com", password: "correct horse battery" })).toEqual({ ok: false, error: loginMessages.noName });
  });

  it("needs the invite code when one is set, and nothing when sign-ups are closed", async () => {
    Object.assign(env, { CAREER_STUDIO_INVITE_CODE: "team-2026" });
    expect(await signUp({ name: "Asha", email: "a@example.com", password: "correct horse battery", invite: "guess" })).toEqual({ ok: false, error: loginMessages.wrongInvite });
    expect(recordThrottleFailure).toHaveBeenCalled();
    expect((await signUp({ name: "Asha", email: "a@example.com", password: "correct horse battery", invite: "team-2026" })).ok).toBe(true);

    Object.assign(env, { CAREER_STUDIO_SIGNUPS: "closed" });
    expect(await signUp({ name: "Asha", email: "a@example.com", password: "correct horse battery", invite: "team-2026" })).toEqual({ ok: false, error: loginMessages.signupsClosed });
  });
});
