import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { getAiProvider } from "@/lib/ai";
import { writeSkillPlan } from "@/lib/ai/tasks/career/skill-plan";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { assessmentSchema, planProgress, progressSchema, skillPlanSchema } from "@/lib/career/skill-plan-data";
import { defineJob, startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";

export const skillPlanJobKey = (id: string) => `skill-plan:${id}`;

export type NewSkillPlan = {
  targetRole: string;
  jobDescription: string;
  skill: string;
  hoursPerWeek: number;
  weeks: number;
  context: string;
  applicationId?: string | null;
};

export async function createSkillPlan(input: NewSkillPlan): Promise<{ id: string; jobId: string }> {
  const plan = await prisma.skillPlan.create({
    data: {
      title: `${input.skill.trim()} for ${input.targetRole.trim() || "your target role"}`.slice(0, 200),
      targetRole: input.targetRole.slice(0, 200),
      jobDescription: input.jobDescription.slice(0, 30_000),
      skill: input.skill.slice(0, 200),
      hoursPerWeek: Math.min(60, Math.max(1, Math.round(input.hoursPerWeek))),
      weeks: Math.min(52, Math.max(1, Math.round(input.weeks))),
      context: input.context.slice(0, 2000),
      applicationId: input.applicationId ?? null,
      progress: [],
    },
    select: { id: true },
  });
  const jobId = await startJob(skillPlanJob, { id: plan.id }, { key: skillPlanJobKey(plan.id) });
  return { id: plan.id, jobId };
}

export const skillPlanJob = defineJob({
  type: "skill-plan",
  input: z.object({ id: z.string() }),
  result: z.object({ done: z.boolean() }),
  async run({ id }, { step, signal }) {
    await step("Reading your profile and the target");
    const record = await prisma.skillPlan.findUniqueOrThrow({ where: { id } });
    const [profile, provider, options] = await Promise.all([loadProfile(), getAiProvider(), loadTaskOptions()]);
    await step("Assessing where you stand and planning");
    const { data, promptVersion } = await writeSkillPlan(
      provider,
      { targetRole: record.targetRole, jobDescription: record.jobDescription, skill: record.skill, hoursPerWeek: record.hoursPerWeek, weeks: record.weeks, context: record.context, profile },
      { ...options, signal },
    );
    await prisma.skillPlan.update({
      where: { id },
      data: { assessment: data.assessment as Prisma.InputJsonValue, plan: data.plan as Prisma.InputJsonValue, writtenWith: promptVersion },
    });
    return { done: true };
  },
});

/** Marks a step done or not done. */
export async function setStepDone(id: string, stepId: string, done: boolean): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    const record = await tx.skillPlan.findUniqueOrThrow({ where: { id }, select: { progress: true } });
    const current = progressSchema.parse(record.progress);
    const next = done ? [...current, stepId] : current.filter((value) => value !== stepId);
    const progress = progressSchema.parse(next);
    await tx.skillPlan.update({ where: { id }, data: { progress } });
    return progress;
  });
}

export async function loadSkillPlan(id: string) {
  const record = await prisma.skillPlan.findUnique({ where: { id }, include: { application: { select: { id: true, company: true, role: true, title: true } } } });
  if (!record) return null;
  const plan = record.plan ? skillPlanSchema.parse(record.plan) : null;
  const progress = progressSchema.parse(record.progress);
  return { ...record, assessment: record.assessment ? assessmentSchema.parse(record.assessment) : null, plan, progress, totals: planProgress(plan, progress) };
}

export async function listSkillPlans() {
  const records = await prisma.skillPlan.findMany({ orderBy: { updatedAt: "desc" }, take: 200 });
  return records.map((record) => {
    const plan = record.plan ? skillPlanSchema.safeParse(record.plan) : null;
    const assessment = record.assessment ? assessmentSchema.safeParse(record.assessment) : null;
    return {
      id: record.id,
      title: record.title,
      skill: record.skill,
      targetRole: record.targetRole,
      status: record.status,
      updatedAt: record.updatedAt,
      readiness: assessment?.success ? assessment.data.readiness : null,
      totals: planProgress(plan?.success ? plan.data : null, progressSchema.parse(record.progress)),
    };
  });
}
