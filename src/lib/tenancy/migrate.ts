import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { PoolClient } from "pg";

// Creates a user's schema and brings it up to date with prisma/migrations,
// the same SQL Dossier's single database gets from `prisma migrate deploy`.
// Applied migrations are recorded in the schema's own _prisma_migrations
// table (with Prisma's checksum), so each schema can be checked on its own.

export type Migration = { name: string; sql: string; checksum: string };

function migrationsDir(): string {
  // The app runs from the project root in development and from the image's
  // working directory in production; the Dockerfile copies prisma/ there.
  return path.join(process.cwd(), "prisma", "migrations");
}

let cached: Migration[] | null = null;

export function loadMigrations(dir = migrationsDir()): Migration[] {
  if (cached && dir === migrationsDir()) return cached;
  const list = readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const file = path.join(dir, name, "migration.sql");
      if (!existsSync(file)) return [];
      const sql = readFileSync(file, "utf8");
      return [{ name, sql, checksum: createHash("sha256").update(sql).digest("hex") }];
    });
  if (dir === migrationsDir()) cached = list;
  return list;
}

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

/**
 * Brings `schema` up to date, creating it first if needed. Runs on a
 * dedicated connection holding an advisory lock on the schema, so two
 * requests can't migrate the same user at once. Returns how many ran.
 */
export async function migrateSchema(client: PoolClient, schema: string, migrations = loadMigrations()): Promise<number> {
  const lock = createHash("sha256").update(`migrate:${schema}`).digest().readBigInt64BE(0);
  await client.query("SELECT pg_advisory_lock($1)", [lock.toString()]);
  try {
    await client.query(`CREATE EXTENSION IF NOT EXISTS citext SCHEMA public`);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quote(schema)}`);
    await client.query(`SET search_path TO ${quote(schema)}, public`);
    await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
    const { rows } = await client.query<{ migration_name: string }>(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    );
    const applied = new Set(rows.map((row) => row.migration_name));
    let count = 0;
    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1, $2, now(), $3, 1)`,
          [randomUUID(), migration.checksum, migration.name],
        );
        await client.query("COMMIT");
        count++;
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${migration.name} failed in ${schema}: ${(error as Error).message}`);
      }
    }
    return count;
  } finally {
    await client.query("RESET search_path").catch(() => {});
    await client.query("SELECT pg_advisory_unlock($1)", [lock.toString()]).catch(() => {});
  }
}
