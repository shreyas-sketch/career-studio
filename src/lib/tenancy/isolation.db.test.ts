import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Point the app's own database settings at the test database before anything reads them.
// (Synchronous, so it runs before the imports below; same rule as src/test/db.ts.)
vi.hoisted(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
  if (!process.env.TEST_DATABASE_URL) url.pathname = `${url.pathname}_test`;
  if (!url.pathname.endsWith("_test")) throw new Error("Refusing to run against a database whose name doesn't end in _test.");
  process.env.DATABASE_URL = url.toString();
  // These tests check what happens without an account, so no stand-in test account.
  process.env.CAREER_STUDIO_NO_TEST_USER = "1";
  process.env.DOSSIER_SECRET ??= "test-secret-test-secret-test-secret-1234";
});

import { accountsQuery, accountsPool } from "@/lib/accounts/db";
import { createAccount, deleteAccount, findAccount } from "@/lib/accounts/users";
import { decodeSessionToken, encodeSessionToken } from "@/lib/auth/session-token";
import { prisma } from "@/lib/prisma";
import { clientForUser } from "@/lib/tenancy/clients";
import { NoTenantError, runAsUser } from "@/lib/tenancy/context";
import { ACCOUNTS_SCHEMA, schemaForUser } from "@/lib/tenancy/schema-name";

const stamp = Date.now();
let a: string;
let b: string;

beforeAll(async () => {
  a = (await createAccount({ email: `a-${stamp}@example.com`, name: "Asha", password: "long-enough-1" })).id;
  b = (await createAccount({ email: `b-${stamp}@example.com`, name: "Ben", password: "long-enough-2" })).id;
}, 60_000);

afterAll(async () => {
  for (const id of [a, b]) if (id) await deleteAccount(id).catch(() => {});
  await accountsPool().end();
});

describe("tenancy", () => {
  it("gives every account its own schema with Dossier's tables and the built-in themes", async () => {
    for (const id of [a, b]) {
      const { rows } = await accountsQuery<{ n: string }>(
        `SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('Application', 'ProfileField', 'Theme', 'Job')`,
        [schemaForUser(id)],
      );
      expect(rows[0]!.n).toBe("4");
      const themes = await runAsUser(id, () => prisma.theme.count({ where: { builtIn: true } }));
      expect(themes).toBeGreaterThan(0);
    }
  });

  it("keeps one account's data out of the other's reach", async () => {
    await runAsUser(a, () => prisma.profileField.upsert({ where: { key: "name" }, create: { key: "name", value: "Asha Rao" }, update: { value: "Asha Rao" } }));
    await runAsUser(a, () => prisma.application.create({ data: { title: "Staff Designer", company: "Northwind" } }));

    expect(await runAsUser(b, () => prisma.profileField.findMany())).toEqual([]);
    expect(await runAsUser(b, () => prisma.application.count())).toBe(0);
    // Raw SQL resolves to the account's own schema too.
    const raw = await runAsUser(b, () => prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Application"`);
    expect(Number(raw[0]!.n)).toBe(0);

    expect(await runAsUser(a, () => prisma.application.count())).toBe(1);
  });

  it("refuses database calls made without an account", async () => {
    expect(() => prisma.application).toThrow(NoTenantError);
  });

  it("keeps each run's account even when runs interleave", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => {
        const id = i % 2 === 0 ? a : b;
        return runAsUser(id, async () => {
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
          return [id, await prisma.application.count()] as const;
        });
      }),
    );
    for (const [id, count] of results) expect(count).toBe(id === a ? 1 : 0);
  });

  it("deletes an account with all of its data", async () => {
    const c = await createAccount({ email: `c-${stamp}@example.com`, name: "Cy", password: "long-enough-3" });
    await deleteAccount(c.id);
    expect(await findAccount(c.id)).toBeNull();
    const { rows } = await accountsQuery(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [schemaForUser(c.id)]);
    expect(rows).toEqual([]);
  });

  it("won't create two accounts for one address", async () => {
    await expect(createAccount({ email: `A-${stamp}@Example.com`, name: "Again", password: "long-enough-4" })).rejects.toThrow(/already exists/);
  });

  it("runs against the test database", async () => {
    const { rows } = await accountsQuery<{ db: string }>(`SELECT current_database() AS db`);
    expect(rows[0]!.db).toMatch(/_test$/);
  });

  it("stores no password, only a hash", async () => {
    const { rows } = await accountsQuery<{ password_hash: string }>(`SELECT password_hash FROM ${ACCOUNTS_SCHEMA}.users WHERE id = $1`, [a]);
    expect(rows[0]!.password_hash).toMatch(/^argon2id:/);
    expect(rows[0]!.password_hash).not.toContain("long-enough-1");
  });
});

describe("session tokens", () => {
  const token = () => encodeSessionToken({ userId: a, sessionId: "0123456789abcdef", persistent: true, expiresAt: new Date(Date.now() + 60_000) });

  it("round-trips", () => {
    expect(decodeSessionToken(token())?.userId).toBe(a);
  });

  it("refuses a token naming another account", () => {
    const forged = token().replace(a, b);
    expect(decodeSessionToken(forged)).toBeNull();
  });

  it("refuses an expired or damaged token", () => {
    expect(decodeSessionToken(token(), { now: new Date(Date.now() + 120_000) })).toBeNull();
    expect(decodeSessionToken(token().slice(0, -2) + "xx")).toBeNull();
    expect(decodeSessionToken("garbage")).toBeNull();
  });
});
