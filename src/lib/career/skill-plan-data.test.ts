import { describe, expect, it } from "vitest";

import { fitPlanToTime, phaseLoad, phaseWeeks, planProgress, skillPlanSchema, withStepIds, type SkillPlanContent } from "./skill-plan-data";

const phase = (weeks: string, ...hours: number[]) => ({
  title: `Weeks ${weeks}`,
  weeks,
  goal: "",
  steps: hours.map((value, index) => ({ id: `w${weeks.replace(/\D/g, "")}s${index}`, kind: "practice" as const, title: `Step ${index}`, detail: "", hours: value, proof: "" })),
});
const plan = (...phases: ReturnType<typeof phase>[]): SkillPlanContent => withStepIds(skillPlanSchema.parse({ phases, project: { title: "", brief: "", demonstrates: [] }, leverageNow: [], caveats: [] }));
const total = (content: SkillPlanContent) => content.phases.flatMap((entry) => entry.steps).reduce((sum, step) => sum + step.hours, 0);

/** Everything the time allows, checked together: no phase over, in order (a week can be shared), inside the plan, no step over a week. */
function expectFits(content: SkillPlanContent, hoursPerWeek: number, weeks: number) {
  let last = 0;
  for (const entry of content.phases) {
    const span = phaseWeeks(entry.weeks)!;
    const load = phaseLoad(entry, hoursPerWeek)!;
    expect(span.first).toBeGreaterThanOrEqual(last);
    expect(span.last).toBeLessThanOrEqual(weeks);
    expect(load.hours).toBeLessThanOrEqual(load.capacity);
    for (const step of entry.steps) expect(step.hours).toBeLessThanOrEqual(hoursPerWeek);
    last = span.last;
  }
  expect(total(content)).toBeLessThanOrEqual(hoursPerWeek * weeks);
}

describe("fitting a plan to the time", () => {
  it("rebalances the QA case: 18 hours in a 15-hour phase, 40 in all", () => {
    const fitted = fitPlanToTime(plan(phase("1-2", 5, 5), phase("3-5", 5, 6, 4, 3), phase("6-8", 6, 6)), 5, 8);
    expectFits(fitted, 5, 8);
    expect(total(fitted)).toBe(40);
    expect(fitted.caveats).toEqual([]);
    expect(phaseLoad(fitted.phases[1], 5)!.hours).toBeGreaterThanOrEqual(18);
  });

  it("leaves a plan that fits exactly as written", () => {
    const fitting = plan(phase("1-2", 5, 5), phase("3", 4));
    expect(fitPlanToTime(fitting, 5, 3)).toEqual(fitting);
  });

  it("cuts hours only when the time isn't there, and says so", () => {
    const fitted = fitPlanToTime(plan(phase("1-2", 20, 20), phase("3-4", 20, 20)), 5, 4);
    expectFits(fitted, 5, 4);
    expect(fitted.caveats[0]).toBe("This plan was cut from 80 to 20 hours to fit 5 hours a week for 4 weeks. More time would let you go deeper.");
  });

  it("splits a step longer than a week's hours into parts with their own ids", () => {
    const fitted = fitPlanToTime(plan(phase("1-3", 12)), 5, 3);
    expectFits(fitted, 5, 3);
    const steps = fitted.phases[0].steps;
    expect(steps.map((step) => step.title)).toEqual(["Step 0 (part 1 of 3)", "Step 0 (part 2 of 3)", "Step 0 (part 3 of 3)"]);
    expect(steps.reduce((sum, step) => sum + step.hours, 0)).toBe(12);
    expect(new Set(steps.map((step) => step.id)).size).toBe(3);
  });

  it.each([
    ["weeks past the plan", [phase("1-4", 5), phase("5-9", 5)], 5, 6],
    ["weeks overlapping", [phase("1-3", 5), phase("2-4", 5)], 5, 6],
    ["weeks it can't read", [phase("first", 5), phase("then", 5)], 5, 4],
    ["more phases than weeks", [phase("1", 3), phase("2", 3), phase("3", 3), phase("4", 3)], 5, 2],
    ["many small steps in little time", [phase("1", 1, 1, 1, 1, 1, 1, 1, 1)], 1, 1],
    ["half hours", [phase("1-2", 2.5, 2.5, 2.5, 2.5, 2.5)], 5, 2],
  ])("repairs %s", (_label, phases, hoursPerWeek, weeks) => {
    expectFits(fitPlanToTime(plan(...phases), hoursPerWeek, weeks), hoursPerWeek, weeks);
  });

  it("keeps the hours and ids progress counts on", () => {
    const fitted = fitPlanToTime(plan(phase("1-3", 12)), 5, 3);
    const first = fitted.phases[0].steps[0];
    expect(planProgress(fitted, [first.id, "gone"])).toMatchObject({ steps: 3, done: 1, hours: 12, hoursDone: first.hours });
  });

  it("reads weeks however they're written", () => {
    expect(phaseWeeks("Weeks 3 to 5")).toEqual({ first: 3, last: 5 });
    expect(phaseWeeks("3–5")).toEqual({ first: 3, last: 5 });
    expect(phaseWeeks("2")).toEqual({ first: 2, last: 2 });
    expect(phaseWeeks("5-3")).toBeNull();
    expect(phaseWeeks("soon")).toBeNull();
  });
});
