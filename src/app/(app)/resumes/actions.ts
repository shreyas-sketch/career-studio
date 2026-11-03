"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import {
  answerCoachQuestion,
  createResumeVersion,
  editVersionUnit,
  refreshFromProfile,
  restoreSnapshot,
  startCoachVersion,
  startImproveUnit,
  startTailorVersion,
  toggleVersionUnit,
} from "@/lib/career/resume-versions";
import { discardProfileImports, importProfileJob } from "@/lib/jobs/import-profile";
import { startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";

const id = z.string().min(1).max(64);

export const newVersion = action(
  z.object({ name: z.string().max(120), target: z.string().max(300), copyOf: id.nullable(), applicationId: id.nullable() }),
  async (input) => {
    const versionId = await createResumeVersion(input);
    revalidatePath("/resumes");
    return { id: versionId };
  },
);

export const renameVersion = action(z.object({ id, name: z.string().max(120), target: z.string().max(300) }), async ({ id: versionId, name, target }) => {
  await prisma.resumeVersion.update({ where: { id: versionId }, data: { name: name.trim() || "Untitled resume", target } });
  return null;
});

export const editUnit = action(z.object({ id, unitId: z.string().max(200), text: z.string().max(6000) }), async ({ id: versionId, unitId, text }) => {
  await editVersionUnit(versionId, unitId, text);
  return null;
});

export const includeUnit = action(z.object({ id, unitId: z.string().max(200), include: z.boolean() }), async ({ id: versionId, unitId, include }) => {
  await toggleVersionUnit(versionId, unitId, include);
  revalidatePath(`/resumes/${versionId}`);
  return null;
});

export const setVersionTheme = action(z.object({ id, themeId: z.string().max(64) }), async ({ id: versionId, themeId }) => {
  await prisma.resumeVersion.update({ where: { id: versionId }, data: { themeId } });
  revalidatePath(`/resumes/${versionId}`);
  return null;
});

export const restoreVersion = action(z.object({ id, snapshotId: id }), async ({ id: versionId, snapshotId }, { toast }) => {
  await restoreSnapshot(versionId, snapshotId);
  revalidatePath(`/resumes/${versionId}`);
  toast("Earlier version restored. What was there before is in the history too.");
  return null;
});

export const refreshVersion = action(z.object({ id }), async ({ id: versionId }, { toast }) => {
  await refreshFromProfile(versionId);
  revalidatePath(`/resumes/${versionId}`);
  toast("Rebuilt from your profile. The previous text is in the history.");
  return null;
});

export const tailorVersion = action(z.object({ id, jobDescription: z.string().min(1).max(30_000) }), async ({ id: versionId, jobDescription }) => {
  if (jobDescription.trim().length < 80) throw new ActionError("Paste the whole job description to tailor to.");
  return { jobId: await startTailorVersion(versionId, jobDescription) };
});

export const coachVersion = action(z.object({ id }), async ({ id: versionId }) => ({ jobId: await startCoachVersion(versionId) }));

export const answerQuestion = action(z.object({ id, questionId: z.string().max(40), answer: z.string().min(1).max(1500) }), async ({ id: versionId, questionId, answer }) => {
  try {
    return { jobId: await answerCoachQuestion(versionId, questionId, answer) };
  } catch (error) {
    if (error instanceof Error && /isn't open/.test(error.message)) throw new ActionError(error.message);
    throw error;
  }
});

export const improve = action(z.object({ id, unitId: z.string().max(200), instruction: z.string().min(1).max(1500) }), async ({ id: versionId, unitId, instruction }) => ({
  jobId: await startImproveUnit(versionId, unitId, instruction),
}));

export const deleteVersion = action(z.object({ id }), async ({ id: versionId }, { toast }) => {
  await prisma.resumeVersion.deleteMany({ where: { id: versionId } });
  revalidatePath("/resumes");
  toast("Resume deleted.");
  return null;
});

/**
 * Starting from scratch: the answers become a resume-like text that Dossier's
 * importer sorts into the profile, reviewed before anything is saved.
 */
export const startGuided = action(
  z.object({
    name: z.string().max(120),
    headline: z.string().max(200),
    location: z.string().max(200),
    roles: z.array(z.object({ role: z.string().max(200), company: z.string().max(200), dates: z.string().max(100), did: z.string().max(3000) })).max(6),
    education: z.string().max(1500),
    skills: z.string().max(1500),
    extra: z.string().max(3000),
  }),
  async (answers) => {
    const roles = answers.roles.filter((role) => role.role.trim() || role.company.trim());
    if (!answers.name.trim() || roles.length === 0) throw new ActionError("Add your name and at least one role (a job, internship, volunteering or freelance work all count).");
    const text = [
      answers.name,
      answers.headline,
      answers.location,
      "",
      "EXPERIENCE",
      ...roles.flatMap((role) => [`${role.role} | ${role.company} | ${role.dates}`, ...role.did.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => `- ${line}`), ""]),
      answers.education.trim() && `EDUCATION\n${answers.education}`,
      answers.skills.trim() && `SKILLS\n${answers.skills}`,
      answers.extra.trim() && `MORE ABOUT ME\n${answers.extra}`,
    ]
      .filter((part): part is string => typeof part === "string" && part !== "")
      .join("\n");
    await discardProfileImports();
    return { jobId: await startJob(importProfileJob, { resume: text }, { key: "profile-import" }) };
  },
);
