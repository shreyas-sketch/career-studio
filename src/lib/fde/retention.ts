import "server-only";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

// Other people's profile data shouldn't sit around forever. Reports go after
// FDE_RETENTION_DAYS (90 by default), and then whatever only they used.

const DAY_MS = 86_400_000;

export async function sweepFdeData(now = new Date(), days = env.FDE_RETENTION_DAYS ?? 90): Promise<number> {
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const { count } = await prisma.fdeReport.deleteMany({ where: { createdAt: { lt: cutoff }, state: { not: "running" } } });
  await prisma.fdeProfileSnapshot.deleteMany({ where: { retrievedAt: { lt: cutoff }, reports: { none: {} } } });
  await prisma.fdeBenchmark.deleteMany({ where: { expiresAt: { lt: cutoff }, reports: { none: {} } } });
  await prisma.fdeUsage.deleteMany({ where: { at: { lt: cutoff } } });
  return count;
}
