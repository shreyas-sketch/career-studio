import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { PUBLIC_FDE_TENANT_ID, schemaForUser } from "@/lib/tenancy/schema-name";

// One Prisma client per active user, each bound to that user's schema twice
// over: Prisma qualifies its own queries with the schema, and every
// connection's search_path is the schema, so raw SQL and triggers resolve
// there too ("public" comes after it only for the citext extension's type).
// Clients for users who've gone quiet are closed, so connections stay few.

const MAX_CLIENTS = 50;
const POOL_SIZE = 3;
/** The public review's service tenant serves every visitor's polling and every worker's writes. */
const PUBLIC_POOL_SIZE = 12;

type Entry = { client: PrismaClient; lastUsed: number };
const globalForClients = globalThis as unknown as { tenantClients?: Map<string, Entry> };
const clients = (globalForClients.tenantClients ??= new Map());

/** A connection string whose sessions start with search_path set to `schema`. */
export function connectionStringForSchema(base: string, schema: string): string {
  const url = new URL(base);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  return url.toString();
}

export function createClientForSchema(schema: string, base = env.DATABASE_URL, max = POOL_SIZE): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: connectionStringForSchema(base, schema), max, idleTimeoutMillis: 30_000 },
      { schema },
    ),
  });
}

/** The database client for `userId`'s data. */
export function clientForUser(userId: string): PrismaClient {
  const schema = schemaForUser(userId);
  const found = clients.get(schema);
  if (found) {
    found.lastUsed = Date.now();
    return found.client;
  }
  const client = createClientForSchema(schema, env.DATABASE_URL, userId === PUBLIC_FDE_TENANT_ID ? PUBLIC_POOL_SIZE : POOL_SIZE);
  clients.set(schema, { client, lastUsed: Date.now() });
  evictIdle();
  return client;
}

function evictIdle() {
  if (clients.size <= MAX_CLIENTS) return;
  // The public review's client stays: closing it mid-burst would only open it again.
  const oldest = [...clients.entries()].filter(([schema]) => schema !== schemaForUser(PUBLIC_FDE_TENANT_ID)).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  for (const [schema, entry] of oldest.slice(0, clients.size - MAX_CLIENTS)) {
    clients.delete(schema);
    // Queries already running finish first; $disconnect waits for them.
    void entry.client.$disconnect().catch(() => {});
  }
}

/** Closes and forgets `userId`'s client, e.g. after their account is deleted. */
export async function dropClientForUser(userId: string): Promise<void> {
  const schema = schemaForUser(userId);
  const entry = clients.get(schema);
  clients.delete(schema);
  await entry?.client.$disconnect().catch(() => {});
}
