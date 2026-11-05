import "server-only";

import { accountsPool, ensureAccountsSchema } from "@/lib/accounts/db";
import { clientForUser } from "@/lib/tenancy/clients";
import { runAsUser } from "@/lib/tenancy/context";
import { migrateSchema } from "@/lib/tenancy/migrate";
import { PUBLIC_FDE_TENANT_ID, schemaForUser } from "@/lib/tenancy/schema-name";

import { seedBuiltIns } from "../../../prisma/seed/built-ins";

// Guest reports live in the service tenant's schema. Code that touches them
// always runs inside asPublicTenant(), set explicitly: a page is never left to
// resolve the tenant from whoever's cookie the request carries, so a signed-in
// owner opening /fde-review can't see guest data or put theirs there.

export function asPublicTenant<T>(fn: () => T): T {
  return runAsUser(PUBLIC_FDE_TENANT_ID, fn);
}

const globalForTenant = globalThis as unknown as { publicFdeTenant?: Promise<void> };

/** Creates the service tenant's schema and brings it up to date, once per process. */
export function ensurePublicTenant(): Promise<void> {
  globalForTenant.publicFdeTenant ??= (async () => {
    await ensureAccountsSchema();
    const connection = await accountsPool().connect();
    try {
      await migrateSchema(connection, schemaForUser(PUBLIC_FDE_TENANT_ID));
    } finally {
      connection.release();
    }
    await seedBuiltIns(clientForUser(PUBLIC_FDE_TENANT_ID));
  })().catch((error: unknown) => {
    globalForTenant.publicFdeTenant = undefined;
    throw error;
  });
  return globalForTenant.publicFdeTenant;
}
