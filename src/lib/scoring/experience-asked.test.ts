import { describe, expect, it } from "vitest";

import { describeAsked, experienceAsked, withExperienceChecked } from "./experience-asked";

const today = new Date("2026-11-04T00:00:00Z");
const months17 = { experience: [{ startYear: 2025, startMonth: 6, endYear: null, endMonth: null, current: true }] } as never;
const fit = { score: 72, reasons: ["Python matches your projects.", "The posting gives no years requirement, so that isn't held against you."], redFlags: [] };

describe("the years a posting asks for", () => {
  it.each([
    ["Experience asked: at least 4 years (listed by FreeHire)\n\nWe are seeking an engineer.", { min: 4, max: null }],
    ["EXPERIENCE 4 Yrs", { min: 4, max: null }],
    ["3-5 years of experience in Python.", { min: 3, max: 5 }],
    ["0–2 years experience", { min: 0, max: 2 }],
    ["Minimum 6 years as an engineer.", { min: 6, max: null }],
    ["5+ years of experience. 2+ years of experience with AWS.", { min: 2, max: null }],
  ])("reads %j", (text, asked) => {
    expect(experienceAsked(text)).toEqual(asked);
  });

  it("puts the source's listing ahead of the text", () => {
    expect(experienceAsked("Experience asked: at least 4 years (listed by FreeHire)\n\n1 year of experience with Docker.")).toEqual({ min: 4, max: null });
  });

  it.each(["We have 20 years of experience in insurance.", "Founded 10 years ago.", "5 years of Go preferred; experience helps.", "A strong Python background."])("isn't asked by %j", (text) => {
    expect(experienceAsked(text)).toBeNull();
  });

  it("holds the Minivel case below a good fit, says why, and drops the false claim", () => {
    const checked = withExperienceChecked(fit, experienceAsked("Experience asked: at least 4 years (listed by FreeHire)"), months17, today);
    expect(checked.score).toBe(69);
    expect(checked.redFlags[0]).toBe("It asks for at least 4 years; your profile shows about 1 year.");
    expect(checked.reasons).toEqual(["Python matches your projects."]);
  });

  it("treats a far larger ask as poor", () => {
    expect(withExperienceChecked(fit, { min: 8, max: null }, months17, today).score).toBe(49);
  });

  it("leaves a score alone when the experience is there", () => {
    const checked = withExperienceChecked(fit, { min: 1, max: 3 }, months17, today);
    expect(checked.score).toBe(72);
    expect(checked.redFlags).toEqual([]);
  });

  it("explains what's known instead of claiming there's no requirement", () => {
    const checked = withExperienceChecked(fit, null, months17, today);
    expect(checked.score).toBe(72);
    expect(checked.reasons[1]).toBe("The text this source sent doesn't state the years asked for; the job's own page may.");
    expect(describeAsked(null)).toMatch(/not stated in the text this source sent/);
  });
});
