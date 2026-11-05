import "server-only";

import { findLatestJob, isFinished } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/tenancy/context";

import { reportJobKey } from "./review";
import { RUBRIC_EXPLAINED, RUBRIC_VERSION } from "./rubric";
import { filtersSchema, normalizedProfileSchema, emptyResult, type Coverage, type FreelanceResult, type ProfileOrigin, type ReportResult, type ReportStage, type ReportState, type ReportView, type Role, type UsageSummary } from "./types";

// What a report's page sees. Every read checks the owner, even inside the
// account's own schema, and the remote image addresses never leave the server:
// the page only knows which images exist.

export async function loadReportView(id: string): Promise<ReportView | null> {
  const row = await prisma.fdeReport.findUnique({ where: { id }, include: { snapshot: true, benchmark: true, usage: true } });
  if (!row || row.ownerUserId !== requireUserId()) return null;

  let state = row.state as ReportState;
  let errorCode = row.errorCode;
  let errorMessage = row.errorMessage;
  if (state === "running") {
    // A restart or a crash ends the job; the report shouldn't say it's still going.
    const job = await findLatestJob(reportJobKey(id));
    const inPilot = row.pilotId !== null;
    if (!inPilot && (!job || isFinished(job))) {
      state = "failed";
      errorCode = "interrupted";
      errorMessage = "This review stopped before it finished, for example because the server restarted. What was found so far is kept, and you can try again.";
    }
  }

  const stored = normalizedProfileSchema.safeParse(row.snapshot?.data);
  const profile = stored.success && row.snapshot
    ? (() => {
        const { images, ...rest } = stored.data;
        return { ...rest, imageKeys: Object.keys(images), snapshotId: row.snapshot.id, retrievedAt: row.snapshot.retrievedAt.toISOString(), isFixture: row.snapshot.provider.startsWith("Fixture") };
      })()
    : null;

  const usage = new Map<string, UsageSummary>();
  for (const entry of row.usage) {
    const summary = usage.get(entry.kind) ?? { kind: entry.kind, calls: 0, costMicro: 0, tokens: 0, estimated: false, cached: 0 };
    summary.calls++;
    summary.costMicro += entry.costMicro;
    summary.tokens += entry.tokens ?? 0;
    summary.estimated ||= entry.estimated;
    if (entry.cached) summary.cached++;
    usage.set(entry.kind, summary);
  }

  const newer = await prisma.fdeReport.findFirst({ where: { refreshOf: id }, orderBy: { createdAt: "desc" }, select: { id: true } });

  return {
    id: row.id,
    url: row.subjectProfileUrl,
    subjectName: row.subjectName,
    state,
    errorCode,
    errorMessage,
    filters: filtersSchema.parse(row.filters),
    stages: row.stages as unknown as ReportStage[],
    profileOrigin: row.profileOrigin as ProfileOrigin | null,
    benchmarkOrigin: row.benchmarkOrigin,
    profile,
    benchmark: row.benchmark
      ? { id: row.benchmark.id, version: row.benchmark.version, discoveredAt: row.benchmark.discoveredAt.toISOString(), expiresAt: row.benchmark.expiresAt.toISOString(), coverage: row.benchmark.coverage as unknown as Coverage, roles: row.benchmark.roles as unknown as Role[] }
      : null,
    result: (row.result as unknown as ReportResult | null) ?? emptyResult(),
    freelance: row.freelance as unknown as FreelanceResult | null,
    learningProgress: (row.learningProgress as unknown as string[]) ?? [],
    usage: [...usage.values()],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    refreshOf: row.refreshOf,
    newerReportId: newer?.id ?? null,
    rubric: row.rubricVersion || RUBRIC_VERSION,
    rubricExplained: RUBRIC_EXPLAINED,
  };
}

export type ReportListItem = { id: string; name: string; url: string; state: ReportState; score: number | null; provisional: boolean; roles: number; createdAt: string };

export async function listReports(limit = 40): Promise<ReportListItem[]> {
  const rows = await prisma.fdeReport.findMany({ where: { ownerUserId: requireUserId(), pilotId: null }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((row) => {
    const result = row.result as unknown as ReportResult | null;
    return {
      id: row.id,
      name: row.subjectName || row.subjectKey,
      url: row.subjectProfileUrl,
      state: row.state as ReportState,
      score: result?.market?.score ?? null,
      provisional: result?.market?.provisional ?? false,
      roles: result?.discovered?.length ?? 0,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

/** The whole report as data, for the owner to keep. */
export async function exportReport(id: string): Promise<unknown | null> {
  const view = await loadReportView(id);
  if (!view) return null;
  return { exportedAt: new Date().toISOString(), note: "A score describes evidence against this sourced market sample, not a hiring probability or a universal rating.", ...view };
}
