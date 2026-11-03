// Applies prisma/migrations/*/migration.sql in order and records them in
// _prisma_migrations the way `prisma migrate deploy` does (same checksum), so a
// later `prisma migrate deploy` sees them as applied. For environments where
// Prisma's schema engine binary can't be downloaded. Usage:
//   node scripts/local-migrate.mjs <database-url>
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";

const url = process.argv[2] ?? process.env.DATABASE_URL;
if (!url) throw new Error("Pass a database URL.");

const dir = new URL("../prisma/migrations/", import.meta.url).pathname;
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
const { rows } = await client.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`);
const applied = new Set(rows.map((r) => r.migration_name));

let count = 0;
for (const name of readdirSync(dir).sort()) {
  const file = join(dir, name, "migration.sql");
  if (!existsSync(file) || applied.has(name)) continue;
  const sql = readFileSync(file, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1,$2,now(),$3,1)`,
      [randomUUID(), checksum, name],
    );
    await client.query("COMMIT");
    count++;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`Migration ${name} failed:`, error.message);
    process.exit(1);
  }
}
console.log(`Applied ${count} migration(s).`);
await client.end();
