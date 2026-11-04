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

/** Long steps are split into parts (fitPlanToTime), so this is past what a model writes. */
const MAX_STEPS = 24;

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
  phases: list(z.object({ title: text(120), weeks: text(40), goal: text(300), steps: list(stepSchema, MAX_STEPS) }), 6),
  /** A portfolio piece that shows the skill to an employer or client. */
  project: z.object({ title: text(160), brief: text(1200), demonstrates: lines(6) }),
  /** How to use existing strengths now, before the gap is closed. */
  leverageNow: lines(6),
  /** What the plan can't promise. */
  caveats: lines(5),
});
export type SkillPlanContent = z.output<typeof skillPlanSchema>;
type Phase = SkillPlanContent["phases"][number];
type PlanStep = Phase["steps"][number];

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

/** The weeks a phase spans, as first and last: "3-5", "Weeks 3 to 5", "2". Null when it can't be read. */
export function phaseWeeks(weeks: string): { first: number; last: number } | null {
  const found = /(\d+)(?:\s*(?:-|–|—|to)\s*(\d+))?/.exec(weeks);
  if (!found) return null;
  const first = Number(found[1]);
  const last = found[2] ? Number(found[2]) : first;
  return first >= 1 && last >= first ? { first, last } : null;
}

const phaseHours = (phase: Phase) => phase.steps.reduce((sum, step) => sum + step.hours, 0);
const halfHours = (hours: number) => Math.floor(hours * 2) / 2;
const SMALLEST_STEP = 0.5;
const EPSILON = 1e-9;

/** A phase's hours against the time its weeks give, or null when its weeks can't be read. */
export function phaseLoad(phase: Phase, hoursPerWeek: number): { hours: number; capacity: number } | null {
  const span = phaseWeeks(phase.weeks);
  return span && { hours: phaseHours(phase), capacity: (span.last - span.first + 1) * hoursPerWeek };
}

/** True when the phases run in order inside the plan, and each fits the time its weeks give. */
function fitsAsWritten(phases: Phase[], hoursPerWeek: number, weeks: number): boolean {
  let lastWeek = 0;
  return phases.every((phase) => {
    const span = phaseWeeks(phase.weeks);
    const load = phaseLoad(phase, hoursPerWeek);
    if (!span || !load || span.first <= lastWeek || span.last > weeks || load.hours > load.capacity) return false;
    lastWeek = span.last;
    return true;
  });
}

/** Hours scaled to fit, by half hours; steps the smallest size can't fit are left out, last first. */
function scaledTo(phases: Phase[], budget: number): Phase[] {
  const total = phases.reduce((sum, phase) => sum + phaseHours(phase), 0);
  if (total <= budget) return phases;
  const factor = budget / total;
  const scaled = phases.map((phase) => ({ ...phase, steps: phase.steps.map((step) => ({ ...step, hours: Math.max(SMALLEST_STEP, halfHours(step.hours * factor)) })) }));
  const hoursLeft = () => scaled.reduce((sum, phase) => sum + phaseHours(phase), 0);
  while (hoursLeft() > budget) {
    const last = scaled[scaled.length - 1];
    last.steps.pop();
    if (last.steps.length === 0 && scaled.length > 1) scaled.pop();
  }
  return scaled;
}

/**
 * Weeks for each phase by its place in the hours, spread evenly over the plan.
 * A phase that ends part-way through a week shares it with the next, so
 * whole weeks never force hours out of a plan that fits.
 */
function withWeeksFromHours(phases: Phase[], hoursPerWeek: number, weeks: number): Phase[] {
  const total = phases.reduce((sum, phase) => sum + phaseHours(phase), 0);
  const pace = Math.min(hoursPerWeek, total / weeks) || hoursPerWeek;
  let hoursBefore = 0;
  return phases.map((phase) => {
    const first = Math.min(weeks, Math.floor(hoursBefore / pace + EPSILON) + 1);
    hoursBefore += phaseHours(phase);
    const last = Math.max(first, Math.min(weeks, Math.ceil(hoursBefore / pace - EPSILON)));
    return { ...phase, weeks: first === last ? String(first) : `${first}-${last}` };
  });
}

/** A step longer than a week's time, as parts that each fit in a week. */
function splitStep(step: PlanStep, hoursPerWeek: number): PlanStep[] {
  if (step.hours <= hoursPerWeek) return [step];
  const parts = Math.ceil(step.hours / hoursPerWeek);
  let left = step.hours;
  return Array.from({ length: parts }, (_, index) => {
    const hours = index === parts - 1 ? left : Math.min(hoursPerWeek, halfHours(left / (parts - index)) || SMALLEST_STEP);
    left -= hours;
    return { ...step, id: `${step.id}-${index + 1}`.slice(0, 40), title: `${step.title} (part ${index + 1} of ${parts})`.slice(0, 160), hours };
  });
}

/**
 * A plan held to the time they have, whatever the model wrote: every phase
 * within its weeks, the phases in order within the plan, and no step longer
 * than one week's hours, split into parts so each can be ticked off. Weeks
 * that fit stay as written. Otherwise they're worked out from the hours, and
 * hours are cut only when the time really isn't there, which the caveats say.
 */
export function fitPlanToTime(plan: SkillPlanContent, hoursPerWeek: number, weeks: number): SkillPlanContent {
  if (plan.phases.length === 0) return plan;
  const before = plan.phases.reduce((sum, phase) => sum + phaseHours(phase), 0);
  const phases = fitsAsWritten(plan.phases, hoursPerWeek, weeks) ? plan.phases : withWeeksFromHours(scaledTo(plan.phases, hoursPerWeek * weeks), hoursPerWeek, weeks);

  const fitted = withStepIds({ ...plan, phases: phases.map((phase) => ({ ...phase, steps: phase.steps.flatMap((step) => splitStep(step, hoursPerWeek)) })) });
  const after = fitted.phases.reduce((sum, phase) => sum + phaseHours(phase), 0);
  if (after >= before) return fitted;
  const note = `This plan was cut from ${before} to ${after} hours to fit ${hoursPerWeek} hours a week for ${weeks} ${weeks === 1 ? "week" : "weeks"}. More time would let you go deeper.`;
  return { ...fitted, caveats: [note, ...fitted.caveats].slice(0, 5) };
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
