import { beforeEach, describe, expect, it, vi } from "vitest";

import { endSession, getSession, SESSION_COOKIE, SESSION_LIFETIME, startSession, verifySession } from "./session";

const jar = vi.hoisted(() => ({ values: new Map<string, string>(), set: vi.fn(), remove: vi.fn(), proto: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name)! } : undefined),
    set: (name: string, value: string, options: object) => {
      jar.values.set(name, value);
      jar.set(name, value, options);
    },
    delete: (name: string) => {
      jar.values.delete(name);
      jar.remove(name);
    },
  }),
  headers: async () => new Headers(jar.proto ? { "x-forwarded-proto": jar.proto } : {}),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(32), DOSSIER_PASSWORD: "correct horse" } }));
// The sessions table, as a map: id → user id.
const sessions = vi.hoisted(() => new Map<string, string>());
vi.mock("@/lib/accounts/db", () => ({
  accountsQuery: async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith("INSERT")) sessions.set(values[0] as string, values[1] as string);
    if (sql.startsWith("DELETE") && sql.includes("WHERE id = $1")) sessions.delete(values[0] as string);
    if (sql.startsWith("SELECT last_seen_at")) {
      const live = sessions.get(values[0] as string) === values[1];
      return { rows: live ? [{ last_seen_at: new Date() }] : [] };
    }
    return { rows: [] };
  },
}));
const USER = "7e570000000000000000000a";
// React's per-request cache would keep the first answer across tests.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

beforeEach(() => {
  sessions.clear();
  jar.values.clear();
  jar.set.mockClear();
  jar.remove.mockClear();
  jar.proto = null;
});

describe("the session cookie (E3-1)", () => {
  it("starts a browser session: an HTTP-only, same-site cookie without an expiry", async () => {
    await startSession({ userId: USER, persistent: false });
    expect(jar.set).toHaveBeenCalledWith(SESSION_COOKIE, expect.any(String), { httpOnly: true, sameSite: "lax", path: "/", secure: false });
    expect(await getSession()).toMatchObject({ userId: USER, persistent: false });
  });

  it("keeps a remembered session for 30 days, secure behind an HTTPS proxy", async () => {
    jar.proto = "https, http";
    await startSession({ userId: USER, persistent: true });
    expect(jar.set).toHaveBeenCalledWith(SESSION_COOKIE, expect.any(String), expect.objectContaining({ secure: true, maxAge: SESSION_LIFETIME.persistent }));
  });

  it("reads no session from a missing or forged cookie", async () => {
    expect(await getSession()).toBeNull();
    jar.values.set(SESSION_COOKIE, "not-a-token");
    expect(await getSession()).toBeNull();
  });

  it("sends visitors without a session to the sign-in page", async () => {
    await expect(verifySession()).rejects.toThrow("redirect /login");
    await startSession({ userId: USER, persistent: false });
    await expect(verifySession()).resolves.toMatchObject({ persistent: false });
  });

  it("ends the session by deleting the cookie and its row", async () => {
    await startSession({ userId: USER, persistent: false });
    await endSession();
    expect(jar.remove).toHaveBeenCalledWith(SESSION_COOKIE);
    expect(sessions.size).toBe(0);
    expect(await getSession()).toBeNull();
  });

  it("treats a genuine cookie whose session was removed (signed out elsewhere) as signed out", async () => {
    await startSession({ userId: USER, persistent: true });
    const token = jar.values.get(SESSION_COOKIE)!;
    sessions.clear();
    jar.values.set(SESSION_COOKIE, token);
    expect(await getSession()).toBeNull();
  });
});
