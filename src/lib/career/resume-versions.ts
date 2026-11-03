import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { getAiProvider } from "@/lib/ai";
import { coachResume, coachSchema, improveUnit } from "@/lib/ai/tasks/career/resume-coach";
import { extractPosting, matchRequirements, tailorResume } from "@/lib/ai/tasks";
import { resumeUnits } from "@/lib/ai/tasks/tailor-resume";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { unitsSchema, type Unit } from "@/lib/application-data";
import { documentLabels } from "@/lib/document-labels";
import { defineJob, startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import type { ProfileData } from "@/lib/profile";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { inEditorOrder } from "@/lib/skill-groups";

// Resume versions (agent 2): named resumes built from the profile, each with
// its own text, theme and history, printed by Dossier's resume renderer.

export const versionJobKey = (id: string) => `resume-version:${id}`;
const MAX_SNAPSHOTS = 30;

/** The profile as resume units, word for word: what a new version starts from. */
export function profileUnits(profile: ProfileData, language: string | null = null): Unit[] {
  return resumeUnits(
    profile,
    { summary: profile.basics.summary, roles: [], projects: [], education: [], skills: inEditorOrder(profile.skills).map((skill) => skill.name) } as never,
    documentLabels(language),
  );
}

export async function createResumeVersion(input: { name: string; target: string; copyOf?: string | null; applicationId?: string | null }): Promise<string> {
  const settings = await loadSettings();
  let units: Unit[];
  let themeId: string | null = settings.baseThemeId;
  if (input.copyOf) {
    const source = await prisma.resumeVersion.findUniqueOrThrow({ where: { id: input.copyOf } });
    units = unitsSchema.parse(source.units);
    themeId = source.themeId;
  } else {
    units = profileUnits(await loadProfile(), settings.resumeLanguage);
  }
  const version = await prisma.resumeVersion.create({
    data: {
      name: input.name.trim().slice(0, 120) || "Untitled resume",
      target: input.target.trim().slice(0, 300),
      units,
      themeId,
      applicationId: input.applicationId ?? null,
      snapshots: { create: { units, cause: input.copyOf ? "Copied" : "Started from your profile" } },
    },
    select: { id: true },
  });
  return version.id;
}

async function snapshot(tx: Prisma.TransactionClient, versionId: string, units: Unit[], cause: string): Promise<void> {
  await tx.resumeVersionSnapshot.create({ data: { versionId, units, cause } });
  const old = await tx.resumeVersionSnapshot.findMany({ where: { versionId }, orderBy: { createdAt: "desc" }, skip: MAX_SNAPSHOTS, select: { id: true } });
  if (old.length > 0) await tx.resumeVersionSnapshot.deleteMany({ where: { id: { in: old.map(({ id }) => id) } } });
}

/** Replaces a version's units, keeping the earlier ones as a snapshot. */
export async function setVersionUnits(versionId: string, units: Unit[], cause: string, writtenWith?: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.resumeVersion.findUniqueOrThrow({ where: { id: versionId }, select: { units: true } });
    await snapshot(tx, versionId, unitsSchema.parse(current.units), `Before: ${cause}`);
    await tx.resumeVersion.update({ where: { id: versionId }, data: { units: unitsSchema.parse(units), ...(writtenWith ? { writtenWith } : {}) } });
  });
}

/** An edit by hand to one part; no snapshot per keystroke. */
export async function editVersionUnit(versionId: string, unitId: string, text: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.resumeVersion.findUniqueOrThrow({ where: { id: versionId }, select: { units: true } });
    const units = unitsSchema.parse(current.units).map((unit) => (unit.id === unitId ? { id: unit.id, label: unit.label, text: text.slice(0, 6000) } : unit));
    await tx.resumeVersion.update({ where: { id: versionId }, data: { units } });
  });
}

/** Leaves a part out of the version, or puts it back from the profile. */
export async function toggleVersionUnit(versionId: string, unitId: string, include: boolean): Promise<void> {
  const [record, profile, settings] = await Promise.all([prisma.resumeVersion.findUniqueOrThrow({ where: { id: versionId } }), loadProfile(), loadSettings()]);
  const units = unitsSchema.parse(record.units);
  if (!include) return setVersionUnits(versionId, units.filter((unit) => unit.id !== unitId), "Left a part out");
  if (units.some((unit) => unit.id === unitId)) return;
  const all = profileUnits(profile, settings.resumeLanguage);
  const order = all.map((unit) => unit.id);
  const added = all.find((unit) => unit.id === unitId);
  if (!added) return;
  const next = [...units, added].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return setVersionUnits(versionId, next, "Put a part back");
}

export async function restoreSnapshot(versionId: string, snapshotId: string): Promise<void> {
  const snap = await prisma.resumeVersionSnapshot.findFirstOrThrow({ where: { id: snapshotId, versionId } });
  await setVersionUnits(versionId, unitsSchema.parse(snap.units), "Restored an earlier version");
}

/** Starts the version over from the current profile. */
export async function refreshFromProfile(versionId: string): Promise<void> {
  const [profile, settings] = await Promise.all([loadProfile(), loadSettings()]);
  await setVersionUnits(versionId, profileUnits(profile, settings.resumeLanguage), "Refreshed from your profile");
}

// ─── AI work ────────────────────────────────────────────────────────────────

export const tailorVersionJob = defineJob({
  type: "resume-version-tailor",
  input: z.object({ id: z.string(), jobDescription: z.string().min(1).max(30_000) }),
  result: z.object({ done: z.boolean() }),
  async run({ id, jobDescription }, { step, signal }) {
    const [provider, options, profile] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile()]);
    await step("Reading the job description");
    const extracted = await extractPosting(provider, { posting: jobDescription }, { ...options, signal });
    await step("Matching it to your profile");
    const match = await matchRequirements(provider, { requirements: extracted.data.requirements, profile }, { ...options, signal });
    await step("Tailoring the resume");
    const tailored = await tailorResume(provider, { profile, extracted: extracted.data, match: match.data, facts: [], posting: jobDescription }, { ...options, signal });
    await prisma.resumeVersion.update({ where: { id }, data: { jobDescription, target: extracted.data.title || extracted.data.role || undefined } });
    await setVersionUnits(id, tailored.data, "Tailored to a job description", tailored.promptVersion);
    return { done: true };
  },
});

export const coachVersionJob = defineJob({
  type: "resume-version-coach",
  input: z.object({ id: z.string() }),
  result: z.object({ questions: z.number() }),
  async run({ id }, { step, signal }) {
    await step("Reviewing your resume");
    const [record, provider, options, profile] = await Promise.all([prisma.resumeVersion.findUniqueOrThrow({ where: { id } }), getAiProvider(), loadTaskOptions(), loadProfile()]);
    const { data, promptVersion } = await coachResume(
      provider,
      { units: unitsSchema.parse(record.units), target: record.target, jobDescription: record.jobDescription, profile },
      { ...options, signal },
    );
    await prisma.resumeVersion.update({ where: { id }, data: { coach: data as Prisma.InputJsonValue, coachedWith: promptVersion } });
    return { questions: data.questions.length };
  },
});

export const improveVersionUnitJob = defineJob({
  type: "resume-version-improve",
  input: z.object({ id: z.string(), unitId: z.string(), instruction: z.string().min(1).max(1500) }),
  result: z.object({ unverified: z.array(z.string()) }),
  async run({ id, unitId, instruction }, { step, signal }) {
    await step("Rewriting that part");
    const [record, provider, options, profile] = await Promise.all([prisma.resumeVersion.findUniqueOrThrow({ where: { id } }), getAiProvider(), loadTaskOptions(), loadProfile()]);
    const units = unitsSchema.parse(record.units);
    const unit = units.find((candidate) => candidate.id === unitId);
    if (!unit) throw new Error("That part isn't in this resume any more.");
    const { data, promptVersion } = await improveUnit(provider, { unit, units, target: record.target, jobDescription: record.jobDescription, instruction, profile }, { ...options, signal });
    await setVersionUnits(id, units.map((candidate) => (candidate.id === unitId ? data : candidate)), `Rewrote ${unit.label}`, promptVersion);
    return { unverified: data.unverified ?? [] };
  },
});

/**
 * Answers a coach question: the answer becomes one of the profile's "Facts
 * about me" (so every document can use it), the question is marked answered,
 * and the part it was about is rewritten with it.
 */
export async function answerCoachQuestion(versionId: string, questionId: string, answer: string): Promise<string> {
  const record = await prisma.resumeVersion.findUniqueOrThrow({ where: { id: versionId } });
  const coaching = coachSchema.parse(record.coach);
  const question = coaching.questions.find((candidate) => candidate.id === questionId);
  if (!question) throw new Error("That question isn't open any more.");
  const fact = `${question.question.replace(/\?+$/, "")}: ${answer.trim()}`.slice(0, 1000);
  const last = await prisma.fact.findFirst({ where: { applicationId: null }, orderBy: { sort: "desc" }, select: { sort: true } });
  await prisma.$transaction([
    prisma.fact.create({ data: { text: fact, sort: (last?.sort ?? 0) + 1 } }),
    prisma.resumeVersion.update({
      where: { id: versionId },
      data: { coach: { ...coaching, questions: coaching.questions.filter((candidate) => candidate.id !== questionId) } as Prisma.InputJsonValue },
    }),
  ]);
  return startJob(
    improveVersionUnitJob,
    { id: versionId, unitId: question.unitId, instruction: `Use this new fact from the candidate where it makes the case stronger: "${fact}"` },
    { key: versionJobKey(versionId) },
  );
}

export const startTailorVersion = (id: string, jobDescription: string) => startJob(tailorVersionJob, { id, jobDescription }, { key: versionJobKey(id) });
export const startCoachVersion = (id: string) => startJob(coachVersionJob, { id }, { key: versionJobKey(id) });
export const startImproveUnit = (id: string, unitId: string, instruction: string) => startJob(improveVersionUnitJob, { id, unitId, instruction }, { key: versionJobKey(id) });

// ─── Reading ────────────────────────────────────────────────────────────────

export async function loadResumeVersion(id: string) {
  const record = await prisma.resumeVersion.findUnique({
    where: { id },
    include: {
      snapshots: { orderBy: { createdAt: "desc" }, select: { id: true, cause: true, createdAt: true } },
      application: { select: { id: true, company: true, role: true, title: true } },
    },
  });
  if (!record) return null;
  const coach = record.coach ? coachSchema.safeParse(record.coach) : null;
  return { ...record, units: unitsSchema.parse(record.units), coach: coach?.success ? coach.data : null };
}

export async function listResumeVersions() {
  return prisma.resumeVersion.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, target: true, updatedAt: true, themeId: true, jobDescription: true, application: { select: { company: true, role: true } } },
  });
}
