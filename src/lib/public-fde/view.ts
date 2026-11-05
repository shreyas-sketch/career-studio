import "server-only";

import { scopeKeyOf } from "@/lib/fde/review";
import { RUBRIC_EXPLAINED, RUBRIC_VERSION } from "@/lib/fde/rubric";
import { emptyResult, filtersSchema, normalizedProfileSchema, type Coverage, type FreelanceResult, type ProfileOrigin, type ReportResult, type ReportStage, type ReportView, type Role } from "@/lib/fde/types";
import { prisma } from "@/lib/prisma";

import { PUBLIC_FILTERS, publicFdeConfig } from "./config";
import { ownerOf } from "./guest";
import { modelConfigured } from "./model";
import { readControls } from "./ops";
import { jobFor, placeOf, type JobRow, type Place } from "./queue";
import { asPublicTenant } from "./tenant";

// What a visitor's page sees of their own report. It's built for a stranger's
// screen: no provider names, prices, keys, internal codes or stack traces,
// only what happened in plain words and, when something failed, a reference
// the operator can look up.

export type PublicPhase =
  | "queued_profile"
  | "reading_profile"
  | "queued_analysis"
  | "analysing"
  | "waiting"
  | "complete"
  | "partial"
  | "restricted"
  | "failed";

export type PublicStatus = {
  phase: PublicPhase;
  headline: string;
  detail: string;
  /** Where the report is in line, when it's waiting; an estimate only once real reports have finished. */
  place: Place | null;
  /** A reference to quote when asking for help; the details are on the operator's page. */
  ref: string | null;
  /** Whether "Try again" can help. */
  retryable: boolean;
  final: boolean;
};

export type PublicReportView = Omit<ReportView, "usage" | "refreshOf" | "newerReportId" | "errorMessage" | "errorCode"> & { status: PublicStatus; mediaBase: string };

const SECRETISH = /treg|harvest|token|balance|\$|usd|limit|anthropic|api key|provider|FDE_|PUBLIC_FDE|spend/i;

/** Progress text that's safe to show: counts and plain steps, never an internal cause. */
function safeDetail(stage: ReportStage): string {
  if (!stage.detail || SECRETISH.test(stage.detail)) return "";
  return stage.detail;
}

/** Strips the retrieval service's name and anything technical from text that came from it. */
function scrub<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value)
      .replace(/Treg \(HarvestAPI\)/g, "LinkedIn public profile")
      .replace(/through the job search provider/g, "job search")
      .replace(/TREG_API_TOKEN isn't set, so LinkedIn wasn't searched\./g, "LinkedIn wasn't searched this time."),
  ) as T;
}

function publicCoverage(coverage: Coverage): Coverage {
  return {
    ...coverage,
    sources: (coverage.sources ?? []).map((source) => ({ ...source, note: source.status === "ok" ? source.note : SECRETISH.test(source.note) ? "Couldn't be read this time." : source.note })),
  };
}

const MESSAGES: Record<string, { headline: string; detail: string; retryable: boolean }> = {
  inaccessible: {
    headline: "This profile couldn't be read",
    detail: "It may be private, restricted or not public. Nothing is guessed in its place. Check the address is your public profile URL, or try again later.",
    retryable: false,
  },
  identity_only: {
    headline: "Only the name on this profile could be read",
    detail: "That isn't enough to compare with anything, so no score is shown. Making more of the profile public would let it be read.",
    retryable: false,
  },
  unavailable: { headline: "This report couldn't be finished right now", detail: "A service it depends on stayed busy for too long. What was found is kept. Try again in a little while.", retryable: true },
  budget: { headline: "This report reached its processing limit", detail: "It stopped rather than run on. What was found so far is kept.", retryable: false },
  market_unavailable: { headline: "Current openings couldn't be gathered", detail: "No older or made-up sample is used instead. Try again in a little while.", retryable: true },
  discovery_failed: { headline: "Current openings couldn't be gathered", detail: "No older or made-up sample is used instead. Try again in a little while.", retryable: true },
  no_roles: { headline: "No verified open FDE role was found just now", detail: "So there was nothing to compare with, and no older sample was used. Try again later.", retryable: true },
  benchmark_failed: { headline: "The postings couldn't be read", detail: "The roles found are listed, but no comparison was made. Try again shortly.", retryable: true },
  worker_lost: { headline: "This report stopped unexpectedly", detail: "What was found is kept. Try again.", retryable: true },
  unexpected: { headline: "Something went wrong with this report", detail: "What was found is kept. Try again, and quote the reference if it happens again.", retryable: true },
};

async function statusOf(job: JobRow, reportState: string, reportCode: string | null): Promise<PublicStatus> {
  const controls = await readControls();
  const place = await placeOf(job);
  const base = { place, ref: job.ref, retryable: false, final: false };
  const busy = job.error_code?.endsWith("_busy") || job.error_code === "data_unavailable" || job.error_code === "model_unavailable";

  if (job.stage === "profile_queued") {
    if (controls.profilePaused || busy) return { ...base, phase: "waiting", headline: "Your report is in line and keeps its place", detail: "Profile reading is paused for a moment. It carries on by itself; you can keep this page open or come back to it." };
    return { ...base, phase: "queued_profile", headline: "In line to read your profile", detail: "Reports are handled a few at a time so each one gets full attention." };
  }
  if (job.stage === "profile_running") return { ...base, phase: "reading_profile", headline: "Reading your public profile", detail: "Only what's publicly visible on LinkedIn." };
  if (job.stage === "analysis_queued") {
    if (controls.analysisPaused || !modelConfigured() || busy) return { ...base, phase: "waiting", headline: "Your profile is in. The analysis keeps your place in line", detail: "Analysis is paused for a moment. It carries on by itself; you can keep this page open or come back to it." };
    return { ...base, phase: "queued_analysis", headline: "Your profile is in. Next: comparing it with current FDE openings", detail: "You're in line for the analysis. Your profile is shown below while you wait." };
  }
  if (job.stage === "analysis_running") return { ...base, phase: "analysing", headline: "Comparing your profile with current FDE openings", detail: "Each step below is real progress on your report." };

  const code = job.error_code ?? reportCode ?? "";
  const known = MESSAGES[code];
  if (job.outcome === "complete") return { ...base, phase: "complete", headline: "Your FDE review is ready", detail: "", final: true };
  if (job.outcome === "partial" || reportState === "partial") {
    return { ...base, phase: "partial", headline: "Your FDE review is ready, with gaps", detail: known?.detail ?? "Some parts couldn't be completed. They're marked where they'd be, and nothing is made up in their place.", final: true };
  }
  if (job.outcome === "restricted") {
    const message = MESSAGES[code] ?? MESSAGES.inaccessible!;
    return { ...base, phase: "restricted", headline: message.headline, detail: message.detail, final: true };
  }
  const message = known ?? MESSAGES.unexpected!;
  return { ...base, phase: "failed", headline: message.headline, detail: message.detail, retryable: message.retryable, final: true };
}

/** A guest's own report, or null for anyone else's, however its id was obtained. */
export async function loadPublicReport(id: string, guestId: string): Promise<PublicReportView | null> {
  if (!/^pf[a-f0-9]{24}$/.test(id)) return null;
  const job = await jobFor(id, guestId);
  if (!job) return null;
  return asPublicTenant(async () => {
    const row = await prisma.fdeReport.findUnique({ where: { id }, include: { snapshot: true, benchmark: true } });
    if (!row || row.ownerUserId !== ownerOf(guestId)) return null;
    const stored = normalizedProfileSchema.safeParse(row.snapshot?.data);
    const profile =
      stored.success && row.snapshot && row.snapshot.ownerUserId === ownerOf(guestId)
        ? (() => {
            const { images, ...rest } = stored.data;
            return { ...rest, imageKeys: Object.keys(images), snapshotId: row.snapshot.id, retrievedAt: row.snapshot.retrievedAt.toISOString(), isFixture: row.snapshot.provider.startsWith("Fixture") };
          })()
        : null;
    const status = await statusOf(job, row.state, row.errorCode);
    // While a report waits for its comparison, it already shows the shared sample: public job postings, the same for everyone.
    const benchmarkRow =
      row.benchmark ??
      (status.final ? null : await prisma.fdeBenchmark.findFirst({ where: { scopeKey: scopeKeyOf(PUBLIC_FILTERS), rubricVersion: RUBRIC_VERSION, expiresAt: { gt: new Date() } }, orderBy: { version: "desc" } }));
    const stages = (row.stages as unknown as ReportStage[]).map((stage) => ({ ...stage, detail: safeDetail(stage) }));
    const view: PublicReportView = {
      id: row.id,
      url: row.subjectProfileUrl,
      subjectName: row.subjectName,
      state: row.state as ReportView["state"],
      filters: filtersSchema.parse(row.filters),
      stages,
      profileOrigin: row.profileOrigin as ProfileOrigin | null,
      benchmarkOrigin: row.benchmarkOrigin,
      profile,
      benchmark: benchmarkRow
        ? {
            id: benchmarkRow.id,
            version: benchmarkRow.version,
            discoveredAt: benchmarkRow.discoveredAt.toISOString(),
            expiresAt: benchmarkRow.expiresAt.toISOString(),
            coverage: publicCoverage(benchmarkRow.coverage as unknown as Coverage),
            roles: benchmarkRow.roles as unknown as Role[],
          }
        : null,
      result: (row.result as unknown as ReportResult | null) ?? emptyResult(),
      freelance: row.freelance as unknown as FreelanceResult | null,
      learningProgress: [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      rubric: row.rubricVersion || RUBRIC_VERSION,
      rubricExplained: RUBRIC_EXPLAINED,
      status,
      mediaBase: `/api/public/fde/reports/${row.id}/media`,
    };
    if (view.result.searchCoverage) view.result.searchCoverage = publicCoverage(view.result.searchCoverage);
    return scrub(view);
  });
}

/** What the landing page needs to know before anyone submits. */
export async function intakeState(): Promise<{ open: boolean; reason: "ok" | "disabled" | "paused" }> {
  if (!publicFdeConfig().enabled) return { open: false, reason: "disabled" };
  const controls = await readControls();
  if (controls.intakePaused) return { open: false, reason: "paused" };
  return { open: true, reason: "ok" };
}
