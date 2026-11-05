import "server-only";

import { scopeKeyOf } from "@/lib/fde/review";
import { RUBRIC_VERSION } from "@/lib/fde/rubric";
import type { Role } from "@/lib/fde/types";
import { prisma } from "@/lib/prisma";

import { PUBLIC_FILTERS } from "./config";
import { asPublicTenant } from "./tenant";

/** The shared market sample, as a line on the landing page: public job data only, and nothing when there's none yet. */
export async function marketSummary(): Promise<{ roles: number; employers: number; names: string[]; checked: string } | null> {
  const benchmark = await asPublicTenant(() =>
    prisma.fdeBenchmark.findFirst({ where: { scopeKey: scopeKeyOf(PUBLIC_FILTERS), rubricVersion: RUBRIC_VERSION, expiresAt: { gt: new Date() } }, orderBy: { version: "desc" }, select: { roles: true, discoveredAt: true } }),
  );
  if (!benchmark) return null;
  const roles = benchmark.roles as unknown as Role[];
  const employers = [...new Set(roles.map((role) => role.employer))];
  return {
    roles: roles.length,
    employers: employers.length,
    names: employers.slice(0, 4),
    checked: benchmark.discoveredAt.toLocaleString("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }),
  };
}
