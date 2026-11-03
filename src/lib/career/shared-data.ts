import "server-only";

import type { ApplicationOption } from "@/components/career/job-source-field";
import { isAiConfigured } from "@/lib/ai/config";
import { findLatestJob, isFinished } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";

/** Applications with a posting, newest first, for the agents' job pickers. */
export async function applicationOptions(): Promise<ApplicationOption[]> {
  const rows = await prisma.application.findMany({
    where: { archivedAt: null, awaitingReview: false, postingText: { not: "" } },
    orderBy: { updatedAt: "desc" },
    take: 60,
    select: { id: true, title: true, company: true, role: true, postingText: true },
  });
  return rows.map((row) => ({
    id: row.id,
    company: row.company,
    role: row.role || row.title,
    label: [row.role || row.title, row.company].filter(Boolean).join(" at ") || "Untitled application",
    postingText: row.postingText,
  }));
}

/** The id of a job still running for `key`, so a reloaded page picks it up. */
export async function runningJob(key: string): Promise<string | null> {
  const job = await findLatestJob(key);
  return job && !isFinished(job) ? job.id : null;
}

/** The latest job for `key` when it failed, so its error and retry show after a reload. */
export async function openJob(key: string): Promise<string | null> {
  const job = await findLatestJob(key);
  return job && job.status !== "DONE" ? job.id : null;
}

export { isAiConfigured };
