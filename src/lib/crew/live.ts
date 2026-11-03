import "server-only";

import { JobStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

import { CREW, jobRole, restingCrew, type CrewHandover, type CrewSnapshot } from "./crew";

/** A failure stays the member's news this long, unless newer work replaces it. */
const STUCK_MS = 30 * 60 * 1000;
const FINISHED_KEPT = 12;

/**
 * Where the crew stands, read only from the account's real jobs: nothing here
 * is made up to look busy. A member with no job in hand is resting.
 */
export async function loadCrew(now = new Date()): Promise<CrewSnapshot> {
  const select = { id: true, type: true, status: true, step: true, error: true, finishedAt: true, applicationId: true, application: { select: { company: true } } } as const;
  const [active, ended] = await Promise.all([
    prisma.job.findMany({ where: { status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } }, orderBy: { createdAt: "asc" }, take: 30, select }),
    prisma.job.findMany({ where: { status: { in: [JobStatus.DONE, JobStatus.FAILED] }, finishedAt: { not: null } }, orderBy: { finishedAt: "desc" }, take: 80, select }),
  ]);

  const members = restingCrew();
  const finished: CrewHandover[] = [];
  const heardFrom = new Set<string>();

  for (const job of ended) {
    const role = jobRole(job.type);
    if (!role) continue;
    const member = members[role.crew];
    const about = job.application?.company || null;
    const failed = job.status === JobStatus.FAILED;
    if (!failed && !member.last) member.last = { at: job.finishedAt!.toISOString(), what: role.did, about };
    // Only the newest ending counts: a failure followed by a success is over with.
    if (!heardFrom.has(role.crew)) {
      heardFrom.add(role.crew);
      if (failed && now.getTime() - job.finishedAt!.getTime() < STUCK_MS) {
        member.status = "stuck";
        member.error = job.error;
      }
    }
    if (finished.length < FINISHED_KEPT) {
      finished.push({
        jobId: job.id,
        crew: role.crew,
        what: role.did,
        about,
        href: job.applicationId ? `/applications/${job.applicationId}` : CREW[role.crew].href,
        error: failed ? (job.error ?? "This didn't finish.") : null,
        handsOver: role.handsOver === true || failed,
      });
    }
  }

  for (const job of active) {
    const role = jobRole(job.type);
    if (!role) continue;
    const member = members[role.crew];
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
