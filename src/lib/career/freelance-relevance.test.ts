import { describe, expect, it } from "vitest";

import { isSoftSkill, relevanceOf, withoutUnbackedClaims } from "./freelance-relevance";

const listing = (title: string, description = "", tags: string[] = []) => ({ title, description, tags });
const keywords = ["AI Automation Engineer", "Python", "Backend"];

describe("freelance relevance", () => {
  it("ranks automation and backend work as strong, and says why", () => {
    const relevance = relevanceOf(listing("Backend automation contractor"), keywords);
    expect(relevance.tier).toBe("strong");
    expect(relevance.why).toBe("Matches AI Automation Engineer, Backend in its title.");
  });

  it("won't find a keyword inside another word", () => {
    expect(relevanceOf(listing("Counselor", "Provide training by email and maintain client trust."), ["AI", "ML", "R"]).tier).toBe("none");
  });

  it("keeps a passing mention apart from a real match", () => {
    expect(relevanceOf(listing("Language talent", "Some Python is welcome."), keywords).tier).toBe("low");
    expect(relevanceOf(listing("Platform role", "Python and backend services."), keywords).tier).toBe("possible");
    expect(relevanceOf(listing("Platform role", "", ["python"]), keywords).tier).toBe("strong");
  });

  it("reads keywords written with symbols", () => {
    expect(relevanceOf(listing("Senior C++ contractor"), ["C++"]).tier).toBe("strong");
    expect(relevanceOf(listing("Node.js freelance"), ["Node.js"]).tier).toBe("strong");
    expect(relevanceOf(listing("C developer"), ["C++"]).tier).toBe("none");
  });

  it("doesn't match on a job title's generic words", () => {
    expect(relevanceOf(listing("Oracle Fusion Cloud Lead"), ["Team Lead"]).tier).toBe("none");
    expect(relevanceOf(listing("Oracle Fusion Cloud Lead"), ["Software Engineer"]).tier).toBe("none");
  });

  it("doesn't search for soft skills from a profile", () => {
    expect(["Communication", "client communication", "English", "Problem solving"].every(isSoftSkill)).toBe(true);
    expect(isSoftSkill("Python")).toBe(false);
  });

  it("says when there's nothing to compare with", () => {
    expect(relevanceOf(listing("Anything"), [])).toMatchObject({ tier: "possible", matched: [] });
  });
});

describe("a fit's claims", () => {
  const profile = { languages: [], experience: [{ role: "Data engineer" }], basics: { headline: "Data engineer" } } as never;
  const prefs = { minimumHourlyUsd: null, hoursPerWeek: null };
  const fit = (...reasons: string[]) => ({ reasons, gaps: ["It asks for fluent German."], concerns: [] });

  it.each(["English proficiency matches the listing.", "Your fluency suits the role.", "Your senior background suits it.", "Your availability matches.", "Your rate fits their budget."])("drops %j", (reason) => {
    expect(withoutUnbackedClaims(fit(reason), profile, prefs).reasons).toEqual([]);
  });

  it("keeps what the profile backs, and the gaps", () => {
    const kept = withoutUnbackedClaims(fit("Python on the pipeline project matches."), profile, prefs);
    expect(kept.reasons).toHaveLength(1);
    expect(kept.gaps).toEqual(["It asks for fluent German."]);
  });

  it("keeps a language, level, hours and rate they did give", () => {
    const own = { languages: [{ name: "English" }], experience: [{ role: "Senior data engineer" }], basics: { headline: "" } } as never;
    const reasons = ["English proficiency matches.", "Your senior background suits it.", "Your availability matches.", "Your rate fits their budget."];
    expect(withoutUnbackedClaims(fit(...reasons), own, { minimumHourlyUsd: 40, hoursPerWeek: 20 }).reasons).toEqual(reasons);
  });
});
