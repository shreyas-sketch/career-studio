import { z } from "zod";

// Skill arbitrage (agent 7): what the user has, what the target needs, and a
// plan sized to their time. Stored shapes clip rather than refuse, as the
// model's answers are checked against them.

const text = (max: number) => z.string().transform((value) => value.trim().slice(0, max));
const lines = (max: number, length = 400) =>
  z.array(z.string()).transform((items) => items.map((item) => item.trim().slice(0, length)).filter(Boolean).slice(0, max));
const list = <T extends z.ZodType>(item: T, max: number) => z.array(item).transform((items) => items.slice(0, max));
const hours = z.number().transform((value) => (Number.isFinite(value) ? Math.max(0, Math.round(value * 2) / 2) : 0));

export const READINESS = ["early", "developing", "close", "ready"] as const;
export const READINESS_LABELS: Record<(typeof READINESS)[number], string> = {
  early: "Early: the main skills are still ahead",
  developing: "Developing: a solid base with clear gaps",
  close: "Close: a few specific gaps to close",
  ready: "Ready: apply now while you keep building",
};

export const assessmentSchema = z.object({
  summary: text(700),
  strengths: list(z.object({ strength: text(160), evidence: text(300) }), 6),
  transferable: list(z.object({ experience: text(200), howItTransfers: text(300) }), 6),
  gaps: list(z.object({ skill: text(120), importance: z.enum(["must-have", "important", "nice-to-have"]), currentLevel: text(200) }), 8),
  readiness: z.enum(READINESS),
  assumptions: lines(6),
});
export type SkillAssessment = z.output<typeof assessmentSchema>;

export const STEP_KINDS = ["learn", "practice", "build", "demonstrate", "apply"] as const;

export const stepSchema = z.object({
  id: text(40),
  kind: z.enum(STEP_KINDS),
  title: text(160),
  detail: text(800),
  hours,
  /** How they'll know it's done, or what it produces. */
  proof: text(300),
});

export const skillPlanSchema = z.object({
  phases: list(z.object({ title: text(120), weeks: text(40), goal: text(300), steps: list(stepSchema, 10) }), 6),
  /** A portfolio piece that shows the skill to an employer or client. */
  project: z.object({ title: text(160), brief: text(1200), demonstrates: lines(6) }),
  /** How to use existing strengths now, before the gap is closed. */
  leverageNow: lines(6),
  /** What the plan can't promise. */
  caveats: lines(5),
});
export type SkillPlanContent = z.output<typeof skillPlanSchema>;

export const progressSchema = z.array(z.string()).transform((ids) => [...new Set(ids)].slice(0, 200));

/** Gives every step a unique, stable id, whatever the model sent. */
export function withStepIds(plan: SkillPlanContent): SkillPlanContent {
  const seen = new Set<string>();
  return {
    ...plan,
    phases: plan.phases.map((phase, p) => ({
      ...phase,
      steps: phase.steps.map((step, s) => {
        let id = step.id.replace(/[^a-z0-9-]/gi, "").toLowerCase() || `p${p + 1}s${s + 1}`;
        if (seen.has(id)) id = `p${p + 1}s${s + 1}`;
        seen.add(id);
        return { ...step, id };
      }),
    })),
  };
}

/** Hours in the plan, and how many are done. */
export function planProgress(plan: SkillPlanContent | null, done: string[]): { steps: number; done: number; hours: number; hoursDone: number } {
  const steps = plan?.phases.flatMap((phase) => phase.steps) ?? [];
  const finished = new Set(done);
  return {
    steps: steps.length,
    done: steps.filter((step) => finished.has(step.id)).length,
    hours: steps.reduce((sum, step) => sum + step.hours, 0),
    hoursDone: steps.filter((step) => finished.has(step.id)).reduce((sum, step) => sum + step.hours, 0),
  };
}
