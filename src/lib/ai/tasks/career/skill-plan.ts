import { z } from "zod";

import { assessmentSchema, fitPlanToTime, skillPlanSchema, STEP_KINDS, withStepIds, type SkillAssessment, type SkillPlanContent } from "@/lib/career/skill-plan-data";
import { experienceMonths, type ProfileData } from "@/lib/profile";

import { NO_EM_DASHES, postingForPrompt, profileForPrompt, system, UNTRUSTED_POSTING, type Task } from "../prompt-parts";

// Skill arbitrage (agent 7): an honest read of where the user stands for a
// target role and one skill, then a plan sized to their hours.

export const SKILL_PLAN_VERSION = "skill-plan@2";

export type SkillPlanInput = {
  targetRole: string;
  jobDescription: string;
  skill: string;
  hoursPerWeek: number;
  weeks: number;
  context: string;
  profile: ProfileData;
  today?: Date;
};

const answerSchema = z.object({
  assessment: z.object({
    summary: z.string(),
    strengths: z.array(z.object({ strength: z.string(), evidence: z.string() })),
    transferable: z.array(z.object({ experience: z.string(), howItTransfers: z.string() })),
    gaps: z.array(z.object({ skill: z.string(), importance: z.enum(["must-have", "important", "nice-to-have"]), currentLevel: z.string() })),
    readiness: z.enum(["early", "developing", "close", "ready"]),
    assumptions: z.array(z.string()),
  }),
  plan: z.object({
    phases: z.array(
      z.object({
        title: z.string(),
        weeks: z.string(),
        goal: z.string(),
        steps: z.array(z.object({ id: z.string(), kind: z.enum(STEP_KINDS), title: z.string(), detail: z.string(), hours: z.number(), proof: z.string() })),
      }),
    ),
    project: z.object({ title: z.string(), brief: z.string(), demonstrates: z.array(z.string()) }),
    leverageNow: z.array(z.string()),
    caveats: z.array(z.string()),
  }),
});

export const writeSkillPlan: Task<SkillPlanInput, { assessment: SkillAssessment; plan: SkillPlanContent }> = async (provider, input, { signal }) => {
  const budget = input.hoursPerWeek * input.weeks;
  const years = Math.floor(experienceMonths(input.profile, input.today ?? new Date()) / 12);
  const answer = await provider.complete({
    system: system(
      `You are a candid career coach. A person wants to develop one skill to qualify for a target role or kind of work. Answer as JSON with an assessment and a plan.

assessment:
- summary: two or three honest sentences on where they stand for this target, and what the skill would change.
- strengths: what they already bring to this target, each with evidence from their profile (name the role, project or skill).
- transferable: experience from other contexts that carries over, and how it transfers.
- gaps: what the target needs that the profile doesn't show, the skill they named included when they lack it; importance must-have, important or nice-to-have; currentLevel: what the profile suggests they have now ("none shown" when nothing).
- readiness: early, developing, close or ready, for the target as a whole.
- assumptions: everything the assessment rests on that the profile doesn't confirm (e.g. "the profile lists Python but not how deeply it was used").

plan, fitted to ${input.hoursPerWeek} hours a week for ${input.weeks} weeks (${budget} hours in all; the steps' hours must add up to no more than that, and each phase's steps to no more than ${input.hoursPerWeek} hours for each week it spans):
- phases: two to five, in order, each with its weeks (e.g. "1-3"), a goal and steps. Each step: a short id (e.g. "p1-basics"), kind (learn, practice, build, demonstrate or apply), a title, the detail of what to do, hours, and proof: what shows it's done.
  Make steps concrete and specific to their starting point: skip what their profile shows they know, build on their strengths, and favour doing over watching. Name kinds of resources (e.g. "the official documentation's tutorial", "a free course on the fundamentals") rather than specific links, courses or prices you can't verify.
- project: one portfolio piece that would demonstrate the skill to an employer or client, tied to their background where possible.
- leverageNow: how they can use their existing strengths for this target now, before the gap is closed (positioning, applying to adjacent roles, framing their experience).
- caveats: what the plan can't promise. Never promise a job, an income or a timeline to being hired.

The plan is future work: never describe a step, the project or anything they'll learn as experience they already have.`,
      UNTRUSTED_POSTING,
      NO_EM_DASHES,
    ),
    messages: [
      {
        role: "user",
        content: [
          `The target: ${input.targetRole || "(see the job description)"}`,
          `The skill to develop: ${input.skill}`,
          `Time available: ${input.hoursPerWeek} hours a week for ${input.weeks} weeks.`,
          input.context.trim() ? `What they add about their starting point:\n${input.context.trim().slice(0, 2000)}` : null,
          `Their work experience: about ${years} ${years === 1 ? "year" : "years"} in all.`,
          `Their profile:\n${profileForPrompt(input.profile)}`,
          input.jobDescription.trim() ? `The job description they're aiming at:\n${postingForPrompt(input.jobDescription)}` : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "skill_plan",
    creativity: "BALANCED",
    effort: "medium",
    signal,
  });
  // Trust nothing: the time they have is checked in code, phase by phase.
  const plan = fitPlanToTime(withStepIds(skillPlanSchema.parse(answer.plan)), input.hoursPerWeek, input.weeks);
  return { data: { assessment: assessmentSchema.parse(answer.assessment), plan }, promptVersion: SKILL_PLAN_VERSION };
};
