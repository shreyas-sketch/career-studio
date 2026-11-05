import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { ActionError } from "@/lib/action";
import { startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/tenancy/context";

import { fdeConfig } from "./config";
import { parseProfileUrl } from "./linkedin-url";
import { fdeReviewJob, initialStages, reportJobKey, scopeKeyOf } from "./review";
import type { FdeFilters } from "./types";

// Starting a review. The report exists before anything is fetched, so a reload,
// a notification or a failure always has one page to open.

const DAY_MS = 86_400_000;

async function checkQuota(): Promise<void> {
  const limit = fdeConfig().accountDailyReports;
  const recent = await prisma.fdeReport.count({ where: { createdAt: { gte: new Date(Date.now() - DAY_MS) }, pilotId: null } });
  if (recent >= limit) throw new ActionError(`This account has started its ${limit} reviews for today. Try again tomorrow, or raise FDE_ACCOUNT_DAILY_REPORTS on the server.`);
}

/** Starts a review, or opens the one already there: a second click never pays twice. */
export async function startReview(input: { url: string; filters: FdeFilters }): Promise<{ id: string; reused: boolean }> {
  const parsed = parseProfileUrl(input.url);
  if (!parsed.ok) throw new ActionError(parsed.error);
  const ownerUserId = requireUserId();
  const scopeKey = scopeKeyOf(input.filters);
  const cutoff = new Date(Date.now() - fdeConfig().profileMaxAgeDays * DAY_MS);

  const { id, reused } = await prisma.$transaction(async (tx) => {
    // Two clicks at once wait for each other here, so only one report is made.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fde:${parsed.slug}:${scopeKey}`}))::text`;
    const existing = await tx.fdeReport.findFirst({
      where: { subjectKey: parsed.slug, scopeKey, pilotId: null, createdAt: { gte: cutoff }, state: { in: ["running", "complete", "partial"] }, errorCode: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (existing) return { id: existing.id, reused: true };
    await checkQuota();
    const report = await tx.fdeReport.create({
      data: {
        ownerUserId,
        subjectProfileUrl: parsed.url,
        subjectKey: parsed.slug,
        state: "running",
        filters: input.filters as unknown as Prisma.InputJsonValue,
        scopeKey,
        stages: initialStages() as unknown as Prisma.InputJsonValue,
        learningProgress: [],
      },
      select: { id: true },
    });
    return { id: report.id, reused: false };
  });
  if (!reused) await startJob(fdeReviewJob, { id, freshProfile: false, freshMarket: false }, { key: reportJobKey(id) });
  return { id, reused };
}

/** A new read of the profile, in a new report; the old one is left exactly as it was. */
export async function refreshReview(input: { id: string; refreshMarket: boolean }): Promise<{ id: string }> {
  const source = await prisma.fdeReport.findUnique({ where: { id: input.id } });
  if (!source || source.ownerUserId !== requireUserId()) throw new ActionError("That report doesn't exist.");
  await checkQuota();
  const report = await prisma.fdeReport.create({
    data: {
      ownerUserId: source.ownerUserId,
      subjectProfileUrl: source.subjectProfileUrl,
      subjectKey: source.subjectKey,
      subjectName: source.subjectName,
      state: "running",
      filters: source.filters as Prisma.InputJsonValue,
      scopeKey: source.scopeKey,
      stages: initialStages() as unknown as Prisma.InputJsonValue,
      learningProgress: [],
      refreshOf: source.id,
    },
    select: { id: true },
  });
  await startJob(fdeReviewJob, { id: report.id, freshProfile: true, freshMarket: input.refreshMarket }, { key: reportJobKey(report.id) });
  return { id: report.id };
}

/** Runs a stopped or failed review again, in the same report. */
export async function retryReview(id: string): Promise<void> {
  const source = await prisma.fdeReport.findUnique({ where: { id } });
  if (!source || source.ownerUserId !== requireUserId()) throw new ActionError("That report doesn't exist.");
  if (source.state === "complete") throw new ActionError("This review is already complete.");
  await startJob(fdeReviewJob, { id, freshProfile: false, freshMarket: false }, { key: reportJobKey(id) });
}
