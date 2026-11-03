import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { clientForUser } from "@/lib/tenancy/clients";
import { requireUserId } from "@/lib/tenancy/context";

/**
 * The database client for the signed-in user's own data. It looks the user
 * up on every access (src/lib/tenancy/context.ts) and uses the client bound
 * to their schema, so code written for Dossier's single user works per user
 * unchanged. Without a user it throws NoTenantError rather than touch any
 * data. The shared tables (accounts, sessions) are reached with
 * src/lib/accounts/db.ts instead.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_, key) {
    const target = clientForUser(requireUserId());
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
