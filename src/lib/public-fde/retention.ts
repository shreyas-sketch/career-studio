import "server-only";

import { prisma } from "@/lib/prisma";

import { publicFdeConfig } from "./config";
import { Q, q } from "./db";
import { ownerOf } from "./guest";
import { asPublicTenant } from "./tenant";

// Guests' reports hold someone's profile. They go after
// PUBLIC_FDE_RETENTION_HOURS (72 by default), and a visitor can delete theirs
// at once. The shared market sample holds only public job postings.

const GUEST_OWNER = { startsWith: "guest:" };

export async function sweepPublicFde(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - publicFdeConfig().retentionHours * 3_600_000);
  const { rows } = await q<{ id: string }>(
    `DELETE FROM ${Q}.jobs WHERE created_at < $1 AND stage IN ('finished', 'failed') RETURNING id`,
    [cutoff],
  );
  const count = await asPublicTenant(async () => {
    const { count: reports } = await prisma.fdeReport.deleteMany({ where: { ownerUserId: GUEST_OWNER, createdAt: { lt: cutoff } } });
    await prisma.fdeProfileSnapshot.deleteMany({ where: { ownerUserId: GUEST_OWNER, retrievedAt: { lt: cutoff }, reports: { none: {} } } });
    await prisma.fdeUsage.deleteMany({ where: { at: { lt: cutoff } } });
    await prisma.fdeBenchmark.deleteMany({ where: { expiresAt: { lt: cutoff }, reports: { none: {} } } });
    return reports;
  });
  await q(`DELETE FROM ${Q}.incidents WHERE at < now() - interval '14 days'`);
  await q(`DELETE FROM ${Q}.spend WHERE day < current_date - 60`);
  return Math.max(count, rows.length);
}

/** A visitor deleting their own report: the report, its profile read and its queue entry, now. */
export async function deleteGuestReport(id: string, guestId: string): Promise<boolean> {
  const owner = ownerOf(guestId);
  const deleted = await asPublicTenant(async () => {
    const report = await prisma.fdeReport.findUnique({ where: { id }, select: { ownerUserId: true, snapshotId: true } });
    if (!report || report.ownerUserId !== owner) return false;
    await prisma.fdeReport.delete({ where: { id } });
    if (report.snapshotId) await prisma.fdeProfileSnapshot.deleteMany({ where: { id: report.snapshotId, ownerUserId: owner, reports: { none: {} } } });
    return true;
  });
  // A running job notices on its next heartbeat that its row is gone and stops.
  if (deleted) await q(`DELETE FROM ${Q}.jobs WHERE id = $1 AND guest_id = $2`, [id, guestId]);
  return deleted;
}
