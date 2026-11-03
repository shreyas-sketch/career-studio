"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { SkillPlanStatus } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { createSkillPlan, setStepDone, skillPlanJob, skillPlanJobKey } from "@/lib/career/skill-plans";
import { startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";

const id = z.string().min(1).max(64);

export const startSkillPlan = action(
  z.object({
    targetRole: z.string().max(200),
    jobDescription: z.string().max(30_000),
    skill: z.string().max(200),
    hoursPerWeek: z.number().int().min(1).max(60),
    weeks: z.number().int().min(1).max(52),
    context: z.string().max(2000),
    applicationId: id.nullable(),
  }),
  async (input) => {
    if (!input.skill.trim()) throw new ActionError("Name the skill you want to develop.");
    if (!input.targetRole.trim() && !input.jobDescription.trim()) throw new ActionError("Name the target role, or paste a job description, so the plan aims at it.");
    const plan = await createSkillPlan(input);
    revalidatePath("/skills");
    return plan;
  },
);

export const toggleStep = action(z.object({ id, stepId: z.string().max(40), done: z.boolean() }), async ({ id: planId, stepId, done }) => ({ progress: await setStepDone(planId, stepId, done) }));

export const rewritePlan = action(z.object({ id }), async ({ id: planId }) => ({ jobId: await startJob(skillPlanJob, { id: planId }, { key: skillPlanJobKey(planId) }) }));

export const setPlanStatus = action(z.object({ id, status: z.enum(SkillPlanStatus) }), async ({ id: planId, status }) => {
  await prisma.skillPlan.update({ where: { id: planId }, data: { status } });
  revalidatePath("/skills");
  return null;
});

export const deletePlan = action(z.object({ id }), async ({ id: planId }, { toast }) => {
  await prisma.skillPlan.deleteMany({ where: { id: planId } });
  revalidatePath("/skills");
  toast("Plan deleted.");
  return null;
});
