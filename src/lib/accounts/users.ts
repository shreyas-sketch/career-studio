import "server-only";

import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

import { seedBuiltIns } from "../../../prisma/seed/built-ins";
import { accountsPool, accountsQuery } from "@/lib/accounts/db";
import { hashPassword } from "@/lib/auth/password-hash";
import { env } from "@/lib/env";
import { clientForUser, dropClientForUser } from "@/lib/tenancy/clients";
import { migrateSchema } from "@/lib/tenancy/migrate";
import { ACCOUNTS_SCHEMA, schemaForUser } from "@/lib/tenancy/schema-name";

export type Account = { id: string; email: string; name: string; createdAt: Date; provisionedAt: Date | null };

type Row = { id: string; email: string; name: string; created_at: Date; provisioned_at: Date | null };
const toAccount = (row: Row): Account => ({
  id: row.id,
  email: row.email,
  name: row.name,
  createdAt: row.created_at,
  provisionedAt: row.provisioned_at,
});

export const PASSWORD_MIN_LENGTH = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AccountError extends Error {
  override name = "AccountError";
}

export function newUserId(): string {
  return randomBytes(12).toString("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findAccountByEmail(email: string): Promise<(Account & { passwordHash: string }) | null> {
  const { rows } = await accountsQuery<Row & { password_hash: string }>(
    `SELECT * FROM ${ACCOUNTS_SCHEMA}.users WHERE email = $1`,
    [normalizeEmail(email)],
  );
  const row = rows[0];
  return row ? { ...toAccount(row), passwordHash: row.password_hash } : null;
}

export async function findAccount(id: string): Promise<Account | null> {
  const { rows } = await accountsQuery<Row>(`SELECT * FROM ${ACCOUNTS_SCHEMA}.users WHERE id = $1`, [id]);
  return rows[0] ? toAccount(rows[0]) : null;
}

export async function countAccounts(): Promise<number> {
  const { rows } = await accountsQuery<{ n: string }>(`SELECT count(*)::text AS n FROM ${ACCOUNTS_SCHEMA}.users`);
  return Number(rows[0]?.n ?? 0);
}

/** Every account's id, for background work that runs per user. */
export async function listAccountIds(): Promise<string[]> {
  const { rows } = await accountsQuery<{ id: string }>(
    `SELECT id FROM ${ACCOUNTS_SCHEMA}.users WHERE provisioned_at IS NOT NULL ORDER BY created_at`,
  );
  return rows.map((row) => row.id);
}

/** Creates an account and its own schema with Dossier's tables and the built-in themes. */
export async function createAccount({ email, name, password }: { email: string; name: string; password: string }): Promise<Account> {
  const address = normalizeEmail(email);
  if (!EMAIL.test(address) || address.length > 254) throw new AccountError("Enter a valid email address.");
  if (password.length < PASSWORD_MIN_LENGTH) throw new AccountError(`Use a password of at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (password.length > 200) throw new AccountError("That password is too long.");
  const id = newUserId();
  const passwordHash = await hashPassword(password);
  try {
    await accountsQuery(
      `INSERT INTO ${ACCOUNTS_SCHEMA}.users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)`,
      [id, address, name.trim().slice(0, 120), passwordHash],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new AccountError("An account with that email already exists.");
    throw error;
  }
  await provisionAccount(id);
  return (await findAccount(id))!;
}

/** Brings the user's schema up to date. Safe to call again; runs on every sign-in. */
export async function provisionAccount(id: string): Promise<void> {
  const connection = await accountsPool().connect();
  try {
    await migrateSchema(connection, schemaForUser(id));
  } finally {
    connection.release();
  }
  await seedBuiltIns(clientForUser(id));
  await accountsQuery(`UPDATE ${ACCOUNTS_SCHEMA}.users SET provisioned_at = coalesce(provisioned_at, now()) WHERE id = $1`, [id]);
}

export async function changePassword(id: string, password: string): Promise<void> {
  if (password.length < PASSWORD_MIN_LENGTH) throw new AccountError(`Use a password of at least ${PASSWORD_MIN_LENGTH} characters.`);
  await accountsQuery(`UPDATE ${ACCOUNTS_SCHEMA}.users SET password_hash = $2, updated_at = now() WHERE id = $1`, [id, await hashPassword(password)]);
}

export async function updateAccountName(id: string, name: string): Promise<void> {
  await accountsQuery(`UPDATE ${ACCOUNTS_SCHEMA}.users SET name = $2, updated_at = now() WHERE id = $1`, [id, name.trim().slice(0, 120)]);
}

/** Deletes the account, every session, and the whole schema with the user's data. Can't be undone. */
export async function deleteAccount(id: string): Promise<void> {
  const schema = schemaForUser(id);
  await dropClientForUser(id);
  const connection = await accountsPool().connect();
  try {
    await connection.query("BEGIN");
    await connection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await connection.query(`DELETE FROM ${ACCOUNTS_SCHEMA}.users WHERE id = $1`, [id]);
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
  // Backups and downloads kept on disk for the account.
  await rm(path.join(env.DOSSIER_DATA_DIR, "accounts", id), { recursive: true, force: true }).catch(() => {});
}
