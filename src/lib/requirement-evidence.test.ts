import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";
import { matchRequirements } from "@/lib/ai/tasks/match-requirements";
import type { AIProvider } from "@/lib/ai/provider";
import { experienceMonths, type ProfileData } from "@/lib/profile";

import { admitsWeakness, checkDegree, degreeFields, degreeLevel, isDegreeRequirement, withoutInventedWeakness, yearsAsked } from "./requirement-evidence";

const today = new Date(2026, 10, 4);
const degree = (text: string, overrides = {}) => ({ id: "d1", degree: text, school: "Thakur College", notes: "", startYear: 2023, startMonth: 6, endYear: 2026, endMonth: 4, current: false, ...overrides }) as ProfileData["education"][number];

describe("yearsAsked", () => {
  it.each([
    ["0-2 years of experience", 2, { min: 0, max: 2 }],
    ["0–2 yrs", 0, { min: 0, max: 2 }],
    ["2 to 4 years in backend", null, { min: 2, max: 4 }],
    ["Up to 3 years", 3, { min: 0, max: 3 }],
    ["5+ years of product design", 5, { min: 5, max: null }],
  ])("reads %s", (text, years, expected) => {
    expect(yearsAsked(text, years)).toEqual(expected);
  });
});

describe("degrees", () => {
  it.each([
    ["B.Sc. Data Science", "bachelor"],
    ["BSc Computer Science", "bachelor"],
    ["Bachelor of Science", "bachelor"],
    ["Bachelor's degree", "bachelor"],
    ["B.Tech in Mechanical", "bachelor"],
    ["M.Sc. Statistics", "master"],
    ["Master of Arts", "master"],
    ["MBA", "master"],
    ["PhD in Physics", "doctorate"],
    ["Scrum Master", null],
  ])("%s is %s", (text, level) => {
    expect(degreeLevel(text)).toBe(level);
  });

  it("tells a degree requirement from a job title", () => {
    expect(isDegreeRequirement("Bachelor degree in computer science")).toBe(true);
    expect(isDegreeRequirement("Scrum Master certification")).toBe(false);
    expect(isDegreeRequirement("Master data management")).toBe(false);
  });

  it("reads the fields asked for", () => {
    expect(degreeFields("Bachelor degree in computer science, data science or related field")).toEqual(["computer science", "data science"]);
  });

  const ask = "Bachelor degree in computer science, data science or related field";
  it("recognises a B.Sc. in a named field", () => {
    expect(checkDegree(ask, { education: [degree("B.Sc. Data Science")] }, today)).toMatchObject({ result: "covered", note: "B.Sc. Data Science, Thakur College" });
  });
  it("lets a higher degree meet a lower level", () => {
    expect(checkDegree("Bachelor's degree in data science", { education: [degree("Master of Science in Data Science")] }, today).result).toBe("covered");
  });
  it("is unsure about another field, not a no", () => {
    expect(checkDegree(ask, { education: [degree("B.A. History")] }, today).result).toBe("partial");
  });
  it("calls a degree in progress partial", () => {
    expect(checkDegree(ask, { education: [degree("B.Sc. Data Science", { endYear: 2028 })] }, today).result).toBe("partial");
  });
  it("knows a lower degree doesn't meet a higher one", () => {
    expect(checkDegree("Master's degree in statistics", { education: [degree("B.Sc. Statistics")] }, today).result).toBe("unmet");
  });
  it("stays open when equivalent experience counts", () => {
    expect(checkDegree("Master's degree or equivalent experience", { education: [degree("B.Sc. Statistics")] }, today).result).toBe("partial");
  });
  it("says nothing either way without any education", () => {
    expect(checkDegree(ask, { education: [] }, today).result).toBe("none");
  });
});

describe("weaknesses nobody stated", () => {
  it.each([
    "Clear client communication is an area I'm still building.",
    "I am still developing my SQL.",
    "I don't have experience with Kubernetes.",
    "I lack formal training.",
    "I have limited exposure to payments.",
    "While I haven't led a team, I am keen.",
    "I'm new to fintech.",
  ])("catches: %s", (sentence) => {
    expect(admitsWeakness(sentence)).toBe(true);
  });

  it.each(["I built a client portal and trained their staff.", "I don't believe in shortcuts, so I test everything.", "Clients kept coming back."])("leaves alone: %s", (sentence) => {
    expect(admitsWeakness(sentence)).toBe(false);
  });

  it("takes out just that sentence", () => {
    expect(withoutInventedWeakness("I ran discovery with clients. Clear client communication is an area I'm still building. I'd love to talk.")).toBe("I ran discovery with clients. I'd love to talk.");
  });
  it("keeps what the candidate said themselves", () => {
    const text = "I'm still learning Kubernetes.";
    expect(withoutInventedWeakness(text, ["I'm still learning Kubernetes and take a course on it"])).toBe(text);
  });
});

describe("matching the posting from QA (November 2026)", () => {
  const base = demoProfile();
  const profile: ProfileData = {
    ...base,
    skills: [{ ...base.skills[0], id: "s1", name: "FastAPI" }],
    languages: [],
    facts: [],
    basics: { ...base.basics, summary: "" },
    education: [degree("B.Sc. Data Science")],
    projects: [],
    experience: [
      { ...base.experience[0], id: "a", role: "AI Generalist", company: "Muditra", startYear: 2026, startMonth: 8, endYear: null, endMonth: null, current: true, skillIds: [], bullets: "Ran discovery calls with clients and trained their staff at handover", descriptor: "" },
      // Overlaps the first, and must not count twice.
      { ...base.experience[0], id: "b", role: "AI Consultant", company: "M0", startYear: 2026, startMonth: 6, endYear: null, endMonth: null, current: true, skillIds: [], bullets: "Built the pipeline in FastAPI", descriptor: "" },
      { ...base.experience[0], id: "c", role: "Founder", company: "Arise", startYear: 2025, startMonth: 6, endYear: 2026, endMonth: 4, current: false, skillIds: [], bullets: "Delivered automations", descriptor: "" },
    ],
  };
  const answering = (matches: unknown[]) => ({ complete: async () => ({ matches }) }) as unknown as AIProvider;
  const requirements = [
    { text: "Bachelor degree in computer science, data science or related field", kind: "other" as const, skill: null, years: null, language: null },
    { text: "0-2 years of experience", kind: "years" as const, skill: null, years: 2, language: null },
    { text: "Clear client communication", kind: "other" as const, skill: null, years: null, language: null },
    { text: "FastAPI", kind: "skill" as const, skill: "FastAPI", years: null, language: null },
    { text: "Kubernetes", kind: "skill" as const, skill: "Kubernetes", years: null, language: null },
    { text: "5+ years of backend", kind: "years" as const, skill: null, years: 5, language: null },
  ];
  const run = (matches: unknown[]) => matchRequirements(answering(matches), { requirements, profile, today }, { creativity: "FAITHFUL", strict: true, language: null });

  it("counts overlapping roles once", () => {
    // Jun 2025 to Nov 2026 less May 2026: 16 calendar months, not the 21 adding the roles up gives.
    expect(experienceMonths(profile, today)).toBe(17);
  });

  it("recognises the degree, the range and written evidence", async () => {
    const { data } = await run([
      { requirement: 2, skill: null, language: null, strength: "direct", evidence: [{ source: "a", quote: "Ran discovery calls with clients" }] },
      { requirement: 3, skill: "FastAPI", language: null, strength: null, evidence: null },
      { requirement: 4, skill: null, language: null, strength: "none", evidence: [] },
    ]);
    expect(data.items.map((item) => item.result)).toEqual(["covered", "covered", "covered", "covered", "gap", "gap"]);
    expect(data.items[2]).toMatchObject({ note: "Shown at Muditra", evidence: [{ source: "Muditra", quote: "Ran discovery calls with clients" }], experienceIds: ["a"] });
    expect(data.items[3].note).toBe("Used at M0");
    expect(data.items[4].basis).toBe("not-shown");
    expect(data.items[5].basis).toBe("unmet");
  });

  it("doesn't believe a quote that isn't in the profile", async () => {
    const { data } = await run([{ requirement: 2, skill: null, language: null, strength: "direct", evidence: [{ source: "a", quote: "Presented to the board every quarter" }] }]);
    expect(data.items[2]).toMatchObject({ result: "gap", basis: "not-shown" });
    expect(data.items[2].evidence).toBeUndefined();
  });

  it("doesn't take one role's quote from another", async () => {
    const { data } = await run([{ requirement: 2, skill: null, language: null, strength: "direct", evidence: [{ source: "c", quote: "Ran discovery calls with clients" }] }]);
    expect(data.items[2].result).toBe("gap");
  });

  it("calls related evidence partial", async () => {
    const { data } = await run([{ requirement: 2, skill: null, language: null, strength: "partial", evidence: [{ source: "c", quote: "Delivered automations" }] }]);
    expect(data.items[2]).toMatchObject({ result: "partial", note: "Closest in your profile: Arise" });
  });
});
