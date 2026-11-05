import "server-only";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { getAiProvider, type AIProvider } from "@/lib/ai";
import { isAiUsable } from "@/lib/ai/config";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { assessEvidence, eligibilityAssessment } from "@/lib/ai/tasks/fde/evidence";
import { writeInsights } from "@/lib/ai/tasks/fde/insights";
import { extractRequirements } from "@/lib/ai/tasks/fde/requirements";
import { scoreOpportunity } from "@/lib/ai/tasks/career/freelance";
import { writeSkillPlan } from "@/lib/ai/tasks/career/skill-plan";
import { freelancePrefsSchema } from "@/lib/career/freelance-prefs";
import { relevant, searchKeywords } from "@/lib/career/freelance";
import { withoutUnbackedClaims } from "@/lib/career/freelance-relevance";
import { FREELANCE_SOURCES, searchFreelanceSources } from "@/lib/career/freelance-sources";
import { defineJob, startJob, type JobContext } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { experienceMonths } from "@/lib/profile";

import { fdeConfig, retrievalProvider } from "./config";
import { DiscoveryFailed, discoverMarket, inPool } from "./market";
import { previewOf, titleMatches } from "./market-filter";
import { isFreelanceWork, parsePay } from "./pay";
import { ESTIMATES_MICRO, ProviderError, type ProviderErrorCode } from "./providers/types";
import { demonstratedStrengths, priorityGaps, recurringRequirements, RUBRIC_VERSION, scoreMarket, scoreRole } from "./rubric";
import { SpendMeter } from "./spend";
import { profileSources, toProfileData } from "./subject";
import {
  emptyResult,
  filtersSchema,
  normalizedProfileSchema,
  STAGE_KEYS,
  type Assessment,
  type Coverage,
  type FdeFilters,
  type FreelanceResult,
  type LearningPlan,
  type NormalizedProfile,
  type ProfileOrigin,
  type ReportResult,
  type ReportStage,
  type ReportState,
  type Role,
  type StageKey,
  type StageState,
} from "./types";

// The review itself. Each stage writes what it found as soon as it has it, so a
// reload shows the same place and a failure later on keeps everything before it.
// Failures are reported as what they are: no generic rubric, old benchmark or
// other provider ever stands in for what couldn't be read.

const MODEL_CONCURRENCY = 3;

export const reportJobKey = (id: string) => `fde-report:${id}`;
export const freelanceJobKey = (id: string) => `fde-freelance:${id}`;
export const pilotJobKey = (id: string) => `fde-pilot:${id}`;

export function initialStages(): ReportStage[] {
  return STAGE_KEYS.map((key) => ({ key, state: "pending", detail: "", startedAt: null, finishedAt: null }));
}

class Tracker {
  constructor(
    private readonly id: string,
    private readonly stages: ReportStage[],
    private readonly step: JobContext["step"],
  ) {}

  private async save() {
    await prisma.fdeReport.update({ where: { id: this.id }, data: { stages: this.stages as unknown as Prisma.InputJsonValue } });
  }

  async begin(key: StageKey, detail: string) {
    const stage = this.stages.find((entry) => entry.key === key)!;
    stage.state = "running";
    stage.detail = detail;
    stage.startedAt = new Date().toISOString();
    stage.finishedAt = null;
    await this.save();
    await this.step(detail);
  }

  async note(key: StageKey, detail: string) {
    this.stages.find((entry) => entry.key === key)!.detail = detail;
    await this.save();
  }

  async end(key: StageKey, state: StageState, detail: string) {
    const stage = this.stages.find((entry) => entry.key === key)!;
    stage.state = state;
    stage.detail = detail;
    stage.finishedAt = new Date().toISOString();
    await this.save();
  }

  /** Stages that won't run, so the page never shows them as still to come. */
  async skipRemaining(reason: string) {
    for (const stage of this.stages) {
      if (stage.state === "pending") {
        stage.state = "skipped";
        stage.detail = reason;
      }
    }
    await this.save();
  }
}

const saveResult = (id: string, result: ReportResult) => prisma.fdeReport.update({ where: { id }, data: { result: result as unknown as Prisma.InputJsonValue } });

function stateOfError(code: ProviderErrorCode): ReportState {
  if (code === "inaccessible") return "restricted";
  if (code === "depleted" || code === "spend_limit") return "quota";
  return "failed";
}

/** Counts a model's use. The providers don't report tokens here, so it's an estimate, and labelled so. */
function meteredAi(provider: AIProvider, meter: SpendMeter): AIProvider {
  const complete = async (request: Parameters<AIProvider["complete"]>[0]) => {
    const answer = await provider.complete(request as never);
    const characters = request.system.length + request.messages.reduce((sum, message) => sum + message.content.length, 0) + JSON.stringify(answer ?? "").length;
    const name = (request as { schemaName?: string }).schemaName ?? "text";
    await meter.recordModel(name, provider.kind, Math.ceil(characters / 4));
    return answer;
  };
  return { kind: provider.kind, model: provider.model, listModels: (signal) => provider.listModels(signal), test: (signal) => provider.test(signal), complete } as AIProvider;
}

const PLAN_HOURS = 5;
const PLAN_WEEKS = 8;

/** A plan is kept only if it really fits: at most 5 hours a week for 8 weeks, and no step above 5 hours. */
export function planFits(plan: LearningPlan["plan"], hoursPerWeek: number, weeks: number): boolean {
  const steps = plan.phases.flatMap((phase) => phase.steps);
  return steps.every((step) => step.hours <= hoursPerWeek) && steps.reduce((sum, step) => sum + step.hours, 0) <= hoursPerWeek * weeks;
}

export type ReviewOptions = { freshProfile: boolean; freshMarket: boolean; meter?: SpendMeter; withFreelance: boolean };

export async function runReview(id: string, { step, signal }: Pick<JobContext, "step" | "signal">, options: ReviewOptions): Promise<ReportState> {
  const report = await prisma.fdeReport.findUniqueOrThrow({ where: { id } });
  const filters = filtersSchema.parse(report.filters);
  const stages = initialStages();
  const tracker = new Tracker(id, stages, step);
  const meter = options.meter ? options.meter.forReport(id) : new SpendMeter(id);
  const provider = retrievalProvider();
  const result = emptyResult();
  await prisma.fdeReport.update({
    where: { id },
    data: { state: "running", errorCode: null, errorMessage: null, stages: stages as unknown as Prisma.InputJsonValue, result: result as unknown as Prisma.InputJsonValue },
  });

  const finish = async (state: ReportState, code: string | null, message: string | null) => {
    await tracker.skipRemaining(message ?? "Not needed.");
    await prisma.fdeReport.update({ where: { id }, data: { state, errorCode: code, errorMessage: message } });
    return state;
  };

  // ── 1. The profile ──
  await tracker.begin("reading_profile", "Reading the public profile");
  let profile: NormalizedProfile | null = null;
  let profileError: ProviderError | null = null;
  try {
    const existing = report.snapshotId ? await prisma.fdeProfileSnapshot.findUnique({ where: { id: report.snapshotId } }) : null;
    const cutoff = new Date(Date.now() - fdeConfig().profileMaxAgeDays * 86_400_000);
    const reusable =
      existing ??
      (options.freshProfile ? null : await prisma.fdeProfileSnapshot.findFirst({ where: { subjectKey: report.subjectKey, provider: provider.label, retrievedAt: { gte: cutoff } }, orderBy: { retrievedAt: "desc" } }));
    let snapshotId: string;
    let origin: ProfileOrigin;
    if (reusable) {
      profile = normalizedProfileSchema.parse(reusable.data);
      snapshotId = reusable.id;
      origin = "cached";
    } else {
      await meter.authorize(ESTIMATES_MICRO.profile);
      const read = await provider.readProfile(report.subjectProfileUrl, { fresh: options.freshProfile, signal });
      await meter.record("profile", read.charge);
      profile = read.profile;
      const snapshot = await prisma.fdeProfileSnapshot.create({
        data: {
          ownerUserId: report.ownerUserId,
          subjectProfileId: profile.providerProfileId,
          subjectProfileUrl: report.subjectProfileUrl,
          subjectKey: report.subjectKey,
          provider: provider.label,
          data: profile as unknown as Prisma.InputJsonValue,
          quality: profile.quality,
          costMicro: read.charge.costMicro,
        },
      });
      snapshotId = snapshot.id;
      origin = options.freshProfile ? "refreshed" : "first_fetch";
    }
    await prisma.fdeReport.update({ where: { id }, data: { snapshotId, profileOrigin: origin, subjectName: profile.name, subjectProfileId: profile.providerProfileId } });
    await tracker.end("reading_profile", profile.quality === "full" ? "done" : "partial", origin === "cached" ? "Used a recent read of this profile." : `Read from ${provider.label}.`);
    if (options.withFreelance && profile.quality !== "identity") {
      await startJob(fdeFreelanceJob, { id }, { key: freelanceJobKey(id) });
    }
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    profileError = error;
    await tracker.end("reading_profile", "failed", error.message);
  }

  // ── 2 and 3. The market ──
  const credentialTrouble = profileError && ["not_configured", "invalid_credentials", "permission", "depleted", "spend_limit"].includes(profileError.code) ? "The provider's token or balance has a problem, so nothing further was charged." : null;
  await tracker.begin("discovering_roles", "Searching employers' boards and job listings");
  let roles: Role[] = [];
  let coverage: Coverage | null = null;
  let benchmarkId: string | null = report.benchmarkId;
  let benchmarkOrigin: string | null = null;
  try {
    const reusable = benchmarkId
      ? await prisma.fdeBenchmark.findUnique({ where: { id: benchmarkId } })
      : options.freshMarket
        ? null
        : await prisma.fdeBenchmark.findFirst({ where: { scopeKey: report.scopeKey, rubricVersion: RUBRIC_VERSION, expiresAt: { gt: new Date() } }, orderBy: { version: "desc" } });
    if (reusable) {
      roles = reusable.roles as unknown as Role[];
      coverage = reusable.coverage as unknown as Coverage;
      benchmarkId = reusable.id;
      benchmarkOrigin = "cached";
      result.discovered = roles.map(previewOf);
      await saveResult(id, result);
      await tracker.end("discovering_roles", "done", `Reused the benchmark from ${reusable.discoveredAt.toISOString().slice(0, 16).replace("T", " ")} UTC, version ${reusable.version}.`);
      await tracker.end("verifying_openings", "done", `${roles.length} roles were verified open when that benchmark was built.`);
    } else {
      const found = await discoverMarket(filters, {
        provider,
        meter,
        fresh: options.freshMarket,
        skipPaid: credentialTrouble,
        signal,
        onFound: async (candidates, checked, total) => {
          result.discovered = candidates
            .filter((candidate) => titleMatches(candidate.title).match)
            .slice(0, 30)
            .map((candidate) => ({ id: `${candidate.source}:${candidate.externalId}`, title: candidate.title, employer: candidate.employer, location: candidate.location, sourceLabel: candidate.sourceLabel, status: candidate.status, url: candidate.url, seniority: "" }));
          await saveResult(id, result);
          await tracker.note("discovering_roles", `Checked ${checked} of ${total} employers' boards; ${candidates.length} possible roles so far.`);
        },
      });
      roles = found.roles;
      coverage = found.coverage;
      benchmarkOrigin = options.freshMarket ? "refreshed" : "discovered";
      await tracker.end("discovering_roles", "done", `Found ${found.coverage.candidates} possible roles across ${found.coverage.sources.filter((source) => source.status === "ok").length} sources.`);
      await tracker.begin("verifying_openings", "Checking each opening and removing copies");
      result.discovered = roles.map(previewOf);
      await saveResult(id, result);
      await tracker.end(
        "verifying_openings",
        found.coverage.limits.some((limit) => limit.startsWith("Only") || limit.startsWith("The sample")) ? "partial" : "done",
        `${roles.length} verified open across ${new Set(roles.map((role) => role.employer)).size} employers; ${found.coverage.duplicatesMerged} duplicates merged, ${found.coverage.excluded.length} left out.`,
      );
    }
  } catch (error) {
    if (error instanceof DiscoveryFailed) {
      await tracker.end("discovering_roles", "failed", error.message);
      return finish("failed", "discovery_failed", error.message);
    }
    if (!(error instanceof ProviderError)) throw error;
    await tracker.end("discovering_roles", "failed", error.message);
    return finish(stateOfError(error.code), error.code, error.message);
  }

  result.searchCoverage = coverage;
  await saveResult(id, result);

  // Without a readable profile, the market is all this report can show.
  if (profileError) return finish(stateOfError(profileError.code), profileError.code, profileError.message);
  if (!profile) throw new Error("No profile and no error");
  if (profile.quality === "identity") {
    return finish("restricted", "identity_only", "Only name-level data came back for this profile, so it can't be compared with anything. The score is withheld.");
  }
  if (roles.length === 0) {
    return finish("partial", "no_roles", "No verified open role matched this search, so there's nothing to compare with. No older sample was used in its place. Widen the filters or try again later.");
  }
  if (!(await isAiUsable())) {
    return finish("partial", "ai_not_configured", "No AI model is connected, so the roles were found but can't be compared yet. Connect one in Settings and try again.");
  }

  const [rawAi, taskOptions] = await Promise.all([getAiProvider(), loadTaskOptions()]);
  const ai = meteredAi(rawAi, meter);
  const aiOptions = { ...taskOptions, signal };

  // ── 4. The benchmark: what each posting asks for ──
  if (benchmarkOrigin === "cached") {
    await tracker.end("building_benchmark", "done", "Each posting's requirements were read when this benchmark was built.");
  } else {
    await tracker.begin("building_benchmark", `Reading what ${roles.length} postings ask for`);
    let done = 0;
    const notFde: { role: Role; note: string }[] = [];
    await inPool(roles, MODEL_CONCURRENCY, async (role) => {
      try {
        const { data } = await extractRequirements(ai, { roleId: role.id, title: role.title, employer: role.employer, description: role.description }, aiOptions);
        role.requirements = data.requirements;
        result.checks.requirementsDropped += data.dropped;
        if (!data.isCustomerFacingEngineering) notFde.push({ role, note: "Read in full, the posting doesn't describe hands-on engineering with customers." });
        else if (data.requirements.length === 0) role.extractionError = "No requirement could be read from this posting.";
      } catch (error) {
        logServerError("FDE requirements", error);
        role.extractionError = "This posting couldn't be read.";
      }
      done++;
      await tracker.note("building_benchmark", `Read ${done} of ${roles.length} postings`);
    });
    for (const { role, note } of notFde) {
      roles = roles.filter((entry) => entry !== role);
      coverage?.excluded.unshift({ title: role.title, employer: role.employer, reason: note, url: role.url });
    }
    const readable = roles.filter((role) => !role.extractionError);
    if (readable.length === 0) {
      await tracker.end("building_benchmark", "failed", "None of the postings could be read.");
      return finish("partial", "benchmark_failed", "The AI model couldn't read the postings, so no comparison was made. The roles are listed; try again.");
    }
    result.discovered = roles.map(previewOf);
    await saveResult(id, result);
    benchmarkId = await saveBenchmark(report.scopeKey, filters, roles, coverage!);
    await tracker.end("building_benchmark", readable.length === roles.length ? "done" : "partial", `${readable.length} of ${roles.length} postings read, saved as a new benchmark version.`);
  }
  await prisma.fdeReport.update({ where: { id }, data: { benchmarkId, benchmarkOrigin, rubricVersion: RUBRIC_VERSION } });

  // ── 5. The comparison ──
  const comparable = roles.filter((role) => role.requirements.length > 0);
  await tracker.begin("matching_evidence", `Comparing the profile with ${comparable.length} roles`);
  const subject = toProfileData(profile);
  const sources = profileSources(profile);
  const today = new Date();
  const hasDates = profile.experience.some((job) => job.start?.year);
  const months = hasDates ? experienceMonths(subject, today) : null;
  result.monthsOfExperience = months;
  const assessments: Assessment[] = [];
  const languages = profile.languages.map((language) => language.name);
  let compared = 0;
  await inPool(comparable, MODEL_CONCURRENCY, async (role) => {
    const eligibility = role.requirements.flatMap((requirement) => eligibilityAssessment(requirement, { profile: subject, monthsOfExperience: months, languages, today }) ?? []);
    const technical = role.requirements.filter((requirement) => !requirement.eligibility);
    let found: Assessment[] = [];
    try {
      const { data } = await assessEvidence(ai, { roleId: role.id, title: role.title, employer: role.employer, requirements: technical, sources }, aiOptions);
      found = data.assessments;
      result.checks.claimsDowngraded += data.downgraded;
    } catch (error) {
      logServerError("FDE evidence", error);
      result.checks.failedRoles.push(role.id);
      found = technical.map((requirement) => ({ requirementId: requirement.id, roleId: role.id, status: "cannot_assess", evidence: [], note: "The comparison for this role failed, so this wasn't assessed.", action: "" }));
    }
    assessments.push(...eligibility, ...found);
    compared++;
    await tracker.note("matching_evidence", `Compared ${compared} of ${comparable.length} roles`);
  });

  const partialProfile = profile.quality !== "full";
  result.assessments = assessments;
  result.roleScores = comparable.map((role) => scoreRole(role, assessments, { partialProfile, monthsOfExperience: months }));
  result.market = scoreMarket(comparable, result.roleScores, { profileQuality: profile.quality });
  const shared = recurringRequirements(comparable, assessments);
  result.recurring = shared.recurring;
  result.employerSpecific = shared.employerSpecific.slice(0, 40);
  result.gaps = priorityGaps(comparable, assessments);
  result.strengths = demonstratedStrengths(comparable, assessments);
  await saveResult(id, result);
  await tracker.end("matching_evidence", result.checks.failedRoles.length > 0 ? "partial" : "done", `${comparable.length - result.checks.failedRoles.length} of ${comparable.length} roles compared.`);

  // ── 6. Insights and a plan ──
  await tracker.begin("writing_insights", "Writing suggestions and a learning plan");
  try {
    const { data, promptVersion } = await writeInsights(
      ai,
      {
        name: profile.name,
        sources,
        gaps: result.gaps,
        strengths: result.strengths,
        recurring: result.recurring.map(({ label, count, analyzed }) => ({ label, count, analyzed })),
        score: result.market.score,
        provisional: result.market.provisional,
        writtenWith: `${rawAi.model ?? rawAi.kind}, ${RUBRIC_VERSION}`,
      },
      aiOptions,
    );
    result.insights = { ...data, writtenWith: `${data.writtenWith}, ${promptVersion}` };
  } catch (error) {
    logServerError("FDE insights", error);
    result.checks.insightsFailed = true;
  }
  await saveResult(id, result);

  try {
    const skill = result.gaps[0]?.label ?? "Customer-facing deployment work";
    const { data } = await writeSkillPlan(
      ai,
      {
        targetRole: "Forward Deployed Engineer",
        jobDescription: "",
        skill,
        hoursPerWeek: PLAN_HOURS,
        weeks: PLAN_WEEKS,
        context: `Other things the sampled roles ask for that this profile doesn't show: ${result.gaps.slice(1, 4).map((gap) => gap.label).join(", ") || "none listed"}.`,
        profile: subject,
        today,
      },
      aiOptions,
    );
    const plan = data.plan as unknown as LearningPlan["plan"];
    if (planFits(plan, PLAN_HOURS, PLAN_WEEKS)) {
      result.plan = {
        skill,
        hoursPerWeek: PLAN_HOURS,
        weeks: PLAN_WEEKS,
        totalHours: plan.phases.flatMap((phase) => phase.steps).reduce((sum, entry) => sum + entry.hours, 0),
        assessment: data.assessment as unknown as LearningPlan["assessment"],
        plan,
      };
    } else {
      result.checks.planFailed = true;
    }
  } catch (error) {
    logServerError("FDE plan", error);
    result.checks.planFailed = true;
  }
  await saveResult(id, result);
  await tracker.end("writing_insights", result.checks.insightsFailed || result.checks.planFailed ? "partial" : "done", result.checks.insightsFailed || result.checks.planFailed ? "Part of this couldn't be written. The scores aren't affected." : "Done.");

  const partial = partialProfile || result.checks.failedRoles.length > 0 || result.checks.insightsFailed || result.checks.planFailed || comparable.length < roles.length;
  return finish(partial ? "partial" : "complete", null, null);
}

async function saveBenchmark(scopeKey: string, filters: FdeFilters, roles: Role[], coverage: Coverage): Promise<string> {
  const maxAge = fdeConfig().benchmarkMaxAgeHours * 3_600_000;
  for (let attempt = 0; ; attempt++) {
    const latest = await prisma.fdeBenchmark.findFirst({ where: { scopeKey }, orderBy: { version: "desc" }, select: { version: true } });
    try {
      const saved = await prisma.fdeBenchmark.create({
        data: {
          scopeKey,
          version: (latest?.version ?? 0) + 1,
          filters: filters as unknown as Prisma.InputJsonValue,
          roles: roles as unknown as Prisma.InputJsonValue,
          coverage: coverage as unknown as Prisma.InputJsonValue,
          rubricVersion: RUBRIC_VERSION,
          expiresAt: new Date(Date.now() + maxAge),
        },
      });
      return saved.id;
    } catch (error) {
      if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    }
  }
}

export const fdeReviewJob = defineJob({
  type: "fde-review",
  input: z.object({ id: z.string(), freshProfile: z.boolean(), freshMarket: z.boolean() }),
  result: z.object({ id: z.string(), state: z.string() }),
  async run({ id, freshProfile, freshMarket }, context) {
    try {
      const state = await runReview(id, context, { freshProfile, freshMarket, withFreelance: true });
      return { id, state };
    } catch (error) {
      // What's already saved stays. The page says what happened and offers a retry.
      await prisma.fdeReport.update({ where: { id }, data: { state: "failed", errorCode: "unexpected", errorMessage: "Something went wrong during this review. What was found so far is kept, and you can try again." } }).catch(() => {});
      throw error;
    }
  },
});

const UNPAID = /\b(unpaid|volunteer(?:ing)? (?:role|position)|equity[-\s]only|no pay|for exposure)\b/i;
const MATCH_LIMIT = 8;
const SCORE_LIMIT = 5;

const emptyFreelance = (): FreelanceResult => ({ state: "running", keywords: [], preferences: "Unknown: this person's rate, hours and availability aren't known here.", matches: [], sources: [], error: null });

/** "Stop": real listings for the person under review, from what their own profile shows. */
export const fdeFreelanceJob = defineJob({
  type: "fde-freelance",
  input: z.object({ id: z.string() }),
  result: z.object({ id: z.string(), matches: z.number() }),
  async run({ id }, { step, signal }) {
    const save = (result: FreelanceResult) => prisma.fdeReport.update({ where: { id }, data: { freelance: result as unknown as Prisma.InputJsonValue } });
    const result = emptyFreelance();
    await save(result);
    try {
      const report = await prisma.fdeReport.findUniqueOrThrow({ where: { id }, select: { snapshotId: true } });
      const snapshot = report.snapshotId ? await prisma.fdeProfileSnapshot.findUnique({ where: { id: report.snapshotId } }) : null;
      if (!snapshot) throw new Error("No profile to match against");
      const subject = toProfileData(normalizedProfileSchema.parse(snapshot.data));
      // Neutral preferences: never the account owner's rate, hours or location.
      const prefs = freelancePrefsSchema.parse({});
      // "Engineer at Acme" searches for the job, not for listings that mention Acme.
      result.keywords = [...new Set(searchKeywords(prefs, subject).map((word) => word.replace(/\s+(?:at|@)\s+.*$/i, "").trim()))].filter(Boolean);
      await step("Checking freelance sources");
      const found = await searchFreelanceSources(result.keywords, signal);
      result.sources = found.map((source) => ({ source: FREELANCE_SOURCES[source.source].name, found: source.items.length, error: source.error, stale: source.stale, fetchedAt: source.fetchedAt?.toISOString() ?? null }));
      const fetchedAt = new Map(found.map((source) => [source.source, source.fetchedAt?.toISOString() ?? null]));
      const matches = relevant(found.flatMap((source) => source.items), prefs, result.keywords)
        .filter(({ item }) => !UNPAID.test(`${item.title} ${item.description}`))
        .filter(({ item }) => isFreelanceWork(item.kind, parsePay(item.budget)))
        .filter(({ relevance }) => relevance.tier !== "low")
        .slice(0, MATCH_LIMIT);
      result.matches = matches.map(({ item, relevance }) => ({
        id: `${item.source}:${item.externalId}`,
        source: FREELANCE_SOURCES[item.source].name,
        title: item.title,
        client: item.client,
        url: item.url,
        kind: item.kind,
        location: item.location,
        pay: parsePay(item.budget),
        postedAt: item.postedAt,
        fetchedAt: fetchedAt.get(item.source) ?? null,
        status: "Listed when last fetched",
        relevance: relevance.tier,
        relevanceWhy: relevance.why,
        fit: null,
      }));
      await save(result);
      if (result.matches.length > 0 && (await isAiUsable())) {
        await step("Checking the best matches' fit");
        const [provider, options] = await Promise.all([getAiProvider(), loadTaskOptions()]);
        for (const [index, { item }] of matches.slice(0, SCORE_LIMIT).entries()) {
          try {
            const { data } = await scoreOpportunity(provider, { opportunity: { ...item, source: FREELANCE_SOURCES[item.source].name }, profile: subject, preferences: "" }, { ...options, signal });
            const fit = withoutUnbackedClaims(data, subject, { minimumHourlyUsd: null, hoursPerWeek: null });
            result.matches[index].fit = { score: fit.score, verdict: fit.verdict, reasons: fit.reasons, concerns: fit.concerns };
            await save(result);
          } catch (error) {
            logServerError("FDE freelance fit", error);
          }
        }
      }
      result.state = "done";
      await save(result);
      return { id, matches: result.matches.length };
    } catch (error) {
      result.state = "failed";
      result.error = "The freelance sources couldn't be checked. Nothing is shown in place of real listings.";
      await save(result);
      throw error;
    }
  },
});

// ─── The pilot ───────────────────────────────────────────────

export type PilotItem = { url: string; slug: string; state: "pending" | "running" | "complete" | "partial" | "inaccessible" | "failed"; reportId: string | null; note: string };

const STOP_BATCH: ReadonlySet<string> = new Set(["not_configured", "invalid_credentials", "permission", "depleted", "spend_limit"]);

/**
 * A few reviews at a time. The first runs alone so the rest reuse its benchmark,
 * and a credential or spending problem stops the batch rather than repeating it
 * for every remaining address.
 */
export const fdePilotJob = defineJob({
  type: "fde-pilot",
  input: z.object({ id: z.string(), count: z.number().int().min(1).max(200) }),
  result: z.object({ id: z.string(), state: z.string() }),
  async run({ id, count }, { step, signal }) {
    const pilot = await prisma.fdePilot.findUniqueOrThrow({ where: { id } });
    const items = pilot.items as unknown as PilotItem[];
    const filters = filtersSchema.parse(pilot.filters);
    const scopeKey = scopeKeyOf(filters);
    const spentBefore = await prisma.fdeUsage.aggregate({ _sum: { costMicro: true }, where: { report: { pilotId: id }, estimated: false } });
    const meter = new SpendMeter(null, pilot.spendLimitMicro, undefined, { spent: spentBefore._sum.costMicro ?? 0 });
    let stopReason: string | null = null;
    const save = (state: string) => prisma.fdePilot.update({ where: { id }, data: { items: items as unknown as Prisma.InputJsonValue, state, stopReason } });
    await prisma.fdePilot.update({ where: { id }, data: { state: "running", stopReason: null } });
    for (const item of items) if (item.state === "running") item.state = "pending";

    const batch = items.filter((item) => item.state === "pending").slice(0, count);
    const runOne = async (item: PilotItem) => {
      if (stopReason || signal.aborted) return;
      item.state = "running";
      await save("running");
      const report = await prisma.fdeReport.create({
        data: { ownerUserId: pilot.ownerUserId, subjectProfileUrl: item.url, subjectKey: item.slug, state: "running", filters: filters as unknown as Prisma.InputJsonValue, scopeKey, stages: initialStages() as unknown as Prisma.InputJsonValue, learningProgress: [], pilotId: id },
      });
      item.reportId = report.id;
      try {
        await step(`Reviewing ${item.slug}`);
        await runReview(report.id, { step: async () => {}, signal }, { freshProfile: false, freshMarket: false, meter, withFreelance: false });
        const after = await prisma.fdeReport.findUniqueOrThrow({ where: { id: report.id }, select: { state: true, errorCode: true, errorMessage: true } });
        item.state = after.state === "complete" ? "complete" : after.state === "partial" ? "partial" : after.state === "restricted" ? "inaccessible" : "failed";
        item.note = after.errorMessage ?? "";
        if (after.errorCode && STOP_BATCH.has(after.errorCode)) stopReason = after.errorMessage ?? "A credential or spending limit stopped the batch.";
      } catch (error) {
        logServerError("FDE pilot", error);
        item.state = "failed";
        item.note = "This review failed unexpectedly.";
      }
      await save("running");
    };

    if (batch[0]) await runOne(batch[0]);
    await inPool(batch.slice(1), Math.min(pilot.concurrency, 3), runOne);
    for (const item of items) if (item.state === "running") item.state = "pending";
    const remaining = items.some((item) => item.state === "pending");
    const state = stopReason ? "stopped" : remaining ? "paused" : "done";
    await save(state);
    return { id, state };
  },
});

/** The same filters always make the same key, in any order. */
export function scopeKeyOf(filters: FdeFilters): string {
  return JSON.stringify([RUBRIC_VERSION, filters.location.toLowerCase(), filters.remoteOnly, filters.seniority]);
}
