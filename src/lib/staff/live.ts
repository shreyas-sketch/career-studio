import "server-only";

import { JobStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

import { idleStaff, jobRole, STAFF, type StaffReport, type StaffSnapshot } from "./staff";

/** A failure stays the member's news this long, unless newer work replaces it. */
const STUCK_MS = 30 * 60 * 1000;
const REPORTS_KEPT = 12;

/**
 * Where the staff stands, read only from the account's real jobs: nothing here
 * is made up to look busy. A member with no job in hand is idle.
 */
export async function loadStaff(now = new Date()): Promise<StaffSnapshot> {
  const select = { id: true, type: true, status: true, step: true, error: true, finishedAt: true, applicationId: true, application: { select: { company: true } } } as const;
  const [active, ended] = await Promise.all([
    prisma.job.findMany({ where: { status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } }, orderBy: { createdAt: "asc" }, take: 30, select }),
    prisma.job.findMany({ where: { status: { in: [JobStatus.DONE, JobStatus.FAILED] }, finishedAt: { not: null } }, orderBy: { finishedAt: "desc" }, take: 80, select }),
  ]);

  const members = idleStaff();
  const finished: StaffReport[] = [];
  const heardFrom = new Set<string>();

  for (const job of ended) {
    const role = jobRole(job.type);
    if (!role) continue;
    const member = members[role.staff];
    const about = job.application?.company || null;
    const finishedAt = job.finishedAt!;
    const failed = job.status === JobStatus.FAILED;
    if (!failed && !member.last) member.last = { at: finishedAt.toISOString(), what: role.did, about };
    // Only the newest ending counts: a failure followed by a success is over with.
    if (!heardFrom.has(role.staff)) {
      heardFrom.add(role.staff);
      if (failed && now.getTime() - finishedAt.getTime() < STUCK_MS) {
        member.status = "stuck";
        member.error = job.error;
      }
    }
    if (finished.length < REPORTS_KEPT) {
      finished.push({
        jobId: job.id,
        staff: role.staff,
        what: role.did,
        about,
        href: job.applicationId ? `/applications/${job.applicationId}` : STAFF[role.staff].href,
        error: failed ? (job.error ?? "This didn't finish.") : null,
        reports: role.reports === true || failed,
      });
    }
  }

  for (const job of active) {
    const role = jobRole(job.type);
    if (!role) continue;
    const member = members[role.staff];
    member.jobs += 1;
    member.error = null;
    // The job furthest along speaks for them; a waiting one only if nothing's running.
    if (job.status === JobStatus.RUNNING && member.status !== "working") {
      member.status = "working";
      member.step = job.step;
      member.about = job.application?.company || null;
    } else if (member.status !== "working") {
      member.status = "queued";
      member.about = job.application?.company || null;
    }
  }

  return { members, finished };
}
