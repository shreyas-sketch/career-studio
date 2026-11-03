import { describe, expect, it } from "vitest";

import { analysisSchema, economics, estimateTokens, inputsSchema, UPWORK_REFERENCE } from "./upwork-data";

const scope = { deliverables: [], effortHoursLow: 20, effortHoursHigh: 30, milestones: [] };
const inputs = (extra: object = {}) => inputsSchema.parse({ connectsRequired: 16, serviceFeePercent: 10, minimumHourlyUsd: null, connectsBalance: null, ...extra });

describe("Upwork economics", () => {
  it("uses Upwork's published price per Connect by default, with its source", () => {
    expect(inputs().connectPriceUsd).toBe(0.15);
    expect(UPWORK_REFERENCE.connectPriceUsd.source).toMatch(/^https:\/\/www\.upwork\.com\//);
  });

  it("works out take-home per hour and for the effort estimate on an hourly job", () => {
    const result = economics({ pricing: { type: "hourly", low: 60, high: 80, rationale: "", assumptions: [] }, scope }, inputs());
    expect(result.bids).toEqual([
      { label: "Low rate, per hour", gross: 60, fee: 6, net: 54 },
      { label: "High rate, per hour", gross: 80, fee: 8, net: 72 },
      { label: "Whole job, low (20 h)", gross: 1200, fee: 120, net: 1080 },
      { label: "Whole job, high (30 h)", gross: 2400, fee: 240, net: 2160 },
    ]);
  });

  it("prices the Connects, boost included, and warns when the balance is short", () => {
    const result = economics({ pricing: { type: "fixed", low: 1000, high: 1500, rationale: "", assumptions: [] }, scope }, inputs({ boostConnects: 10, connectsBalance: 20 }));
    expect(result.connects).toEqual({ required: 16, boost: 10, total: 26, costUsd: 3.9, shortBy: 6 });
  });

  it("gives an effective hourly rate for fixed bids, and flags a rate under the floor", () => {
    const result = economics({ pricing: { type: "fixed", low: 1000, high: 1500, rationale: "", assumptions: [] }, scope }, inputs({ minimumHourlyUsd: 40 }));
    // 1000 × 0.9 / 30 h = 30; 1500 × 0.9 / 20 h = 67.5
    expect(result.effectiveHourly).toEqual({ low: 30, high: 67.5 });
    expect(result.notes.join(" ")).toMatch(/below your \$40\/h floor/);
  });

  it("doesn't guess the fee or the Connects when they weren't entered", () => {
    const result = economics({ pricing: { type: "hourly", low: 50, high: 70, rationale: "", assumptions: [] }, scope }, inputs({ serviceFeePercent: null, connectsRequired: null }));
    expect(result.bids[0]).toEqual({ label: "Low rate, per hour", gross: 50, fee: null, net: null });
    expect(result.connects.costUsd).toBeNull();
    expect(result.notes).toHaveLength(2);
  });

  it("estimates AI tokens separately from Connects", () => {
    expect(estimateTokens("a".repeat(400), "b".repeat(400))).toBe(200);
  });

  it("clips and clamps what the model returns rather than failing on it", () => {
    const parsed = analysisSchema.parse({
      summary: "x".repeat(2000),
      suitability: { score: 140, verdict: "pursue", evidence: ["a", " ", "b"], gaps: [] },
      jobFacts: { budgetType: "fixed", statedBudget: "$1,500", duration: "", experienceLevel: "", clientSignals: [] },
      pricing: { type: "fixed", low: 999.6, high: -5, rationale: "", assumptions: [] },
      scope: { deliverables: [], effortHoursLow: 10, effortHoursHigh: 20, milestones: [] },
      risks: [],
      missingInfo: [],
      questionsForClient: [],
      screeningQuestions: [],
      boostAdvice: "",
    });
    expect(parsed.summary).toHaveLength(600);
    expect(parsed.suitability).toMatchObject({ score: 100, evidence: ["a", "b"] });
    expect(parsed.pricing).toMatchObject({ low: 1000, high: 0 });
  });
});
