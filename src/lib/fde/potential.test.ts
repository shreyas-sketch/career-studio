import { describe, expect, it } from "vitest";

import { comparePay, comparesWith, marketPay, nextRoles, parseCurrentAmount, payFromRole } from "./potential";
import type { Assessment, Requirement, Role, RoleScore } from "./types";

const role = (description: string, over: Partial<Role> = {}): Role => ({
  id: over.id ?? "r1",
  source: "greenhouse",
  sourceLabel: "Greenhouse board",
  externalId: "1",
  title: "Forward Deployed Engineer",
  employer: "Acme",
  location: "San Francisco, CA",
  remotePolicy: "",
  seniority: "",
  seniorityGroup: "accessible",
  url: "https://example.com/1",
  applyUrl: null,
  description,
  fullText: true,
  postedAt: null,
  updatedAt: null,
  checkedAt: "2026-11-05T00:00:00.000Z",
  status: "open",
  otherLocations: [],
  reasons: [],
  requirements: [],
  extractionError: null,
  ...over,
});

const one = (description: string, over: Partial<Role> = {}) => payFromRole(role(description, over)).entries;

describe("reading pay from a posting", () => {
  it("reads a base range stated on the line before", () => {
    const [entry] = one("For pay transparency purposes, the base salary range for this full-time position is:\n$216,000—$270,000 USD");
    expect(entry).toMatchObject({ kind: "base", currency: "USD", min: 216000, max: 270000, midpoint: 243000, location: "United States" });
    expect(entry.excerpts).toEqual(["$216,000—$270,000 USD"]);
  });

  it("reads cents and an annual suffix", () => {
    expect(one("The San Francisco, CA base pay range for this role is $137,000.00 - $207,000.00.")[0]).toMatchObject({ kind: "base", min: 137000, max: 207000 });
    expect(one("The estimated salary range for this position is estimated to be $135,000 - $200,000/year.")[0]).toMatchObject({ kind: "base", min: 135000, max: 200000 });
  });

  it("treats on-target earnings as total compensation", () => {
    expect(one("COMPENSATION\n• OTE $254,600 - $350,000 USD (75/25 Split) • Offers Equity")[0]).toMatchObject({ kind: "total", min: 254600, max: 350000 });
  });

  it("doesn't choose when a posting says both, or says neither", () => {
    expect(one("The US base salary range for this full-time position is: $270,000 - $300,000 OTE + equity + benefits.")[0].kind).toBe("unclear");
    expect(one("The pay range(s) for this role represents the expected salary range for non-commissionable roles or on-target earnings for commissionable roles.\nThe total compensation package may also include bonus.\n$182,000—$250,208 USD")[0].kind).toBe("unclear");
    expect(one("Compensation\n$180,000 - $200,000 USD")[0].kind).toBe("unclear");
  });

  it("keeps the currency the posting states", () => {
    expect(one("MongoDB's base salary range for this role in Canada is:\n$158,000—$220,000 CAD", { location: "Toronto" })[0]).toMatchObject({ currency: "CAD", location: "Canada" });
    expect(one("Base salary range: £90,000 - £120,000", { location: "London" })[0]).toMatchObject({ currency: "GBP", location: "United Kingdom" });
    expect(one("Base salary range: CA$150,000 - CA$190,000", { location: "Toronto" })[0].currency).toBe("CAD");
  });

  it("won't guess which dollar a posting outside the US means", () => {
    const pay = payFromRole(role("Base salary range: $150,000 - $190,000", { location: "Singapore" }));
    expect(pay.entries).toEqual([]);
    expect(pay.unused).toMatch(/which currency/);
  });

  it("ignores money that isn't pay", () => {
    expect(one("With $125M raised at Series B. Compensation is competitive.")).toEqual([]);
    expect(one("Competitive salary. A weekly lunch stipend of $75 and a $500 home office stipend.")).toEqual([]);
    expect(one("Our customers saved $250,000 last year. Nothing about money for you here at all.")).toEqual([]);
    expect(one("Base salary is paid monthly: $90,000 per month.")).toEqual([]);
  });

  it("won't tie a range to an open-level posting that lists one per level", () => {
    const pay = payFromRole(role("Senior Engineer: $152000-$228,000\nStaff Engineer: $181,000-$272,000\nSenior Staff Engineer: $212,000-$318,000\nSalary compensation depends on level."));
    expect(pay.entries).toEqual([]);
    expect(pay.unused).toMatch(/by level/);
  });

  it("counts a posting once when it lists several zones in one country", () => {
    const entries = one("The base salary range depends on the zone.\nZone 1 $200,000 - $240,000 USD\nZone 2 $160,000 - $200,000 USD");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ min: 160000, max: 240000, midpoint: 200000 });
    expect(entries[0].excerpts).toHaveLength(2);
  });

  it("finds the place on the pay line when the role's location doesn't say", () => {
    expect(one("Compensation\nFor Bay Area based hires: Estimated annual salary of $194,000 - $266,000.", { location: "Hybrid" })[0]).toMatchObject({ location: "United States", currency: "USD", kind: "base" });
  });
});

describe("averaging across a sample", () => {
  const base = (id: string, low: number, high: number, over: Partial<Role> = {}) => role(`Base salary range: $${low.toLocaleString("en-US")} - $${high.toLocaleString("en-US")} USD`, { id, ...over });

  it("averages midpoints from three postings and labels what it counted", () => {
    const pay = marketPay([base("a", 100000, 200000), base("b", 200000, 300000), base("c", 300000, 400000), role("Nothing about money.", { id: "d" })]);
    expect(pay).toMatchObject({ roleCount: 4, statedCount: 3 });
    expect(pay.groups).toHaveLength(1);
    expect(pay.groups[0].lines[0]).toMatchObject({ kind: "base", average: 250000, low: 100000, high: 400000 });
    expect(pay.unused.map((entry) => entry.roleId)).toEqual(["d"]);
  });

  it("gives no average for one or two postings", () => {
    const line = marketPay([base("a", 100000, 200000), base("b", 200000, 300000)]).groups[0].lines[0];
    expect(line.average).toBeNull();
    expect(line.entries).toHaveLength(2);
  });

  it("keeps levels, places and pay types apart", () => {
    const pay = marketPay([
      base("a", 100000, 200000),
      base("b", 100000, 200000, { seniorityGroup: "aspirational" }),
      role("Base salary range: €90,000 - €100,000", { id: "c", location: "Berlin" }),
      role("OTE $200,000 - $300,000 USD", { id: "d" }),
    ]);
    expect(pay.groups.map((group) => group.key).sort()).toEqual(["Germany|EUR|accessible", "United States|USD|accessible", "United States|USD|aspirational"]);
    const us = pay.groups.find((group) => group.key === "United States|USD|accessible");
    expect(us?.lines.map((line) => line.kind)).toEqual(["base", "total"]);
  });

  it("leaves out closed roles", () => {
    expect(marketPay([base("a", 100000, 200000, { status: "closed" })])).toMatchObject({ roleCount: 0, statedCount: 0, groups: [] });
  });
});

describe("comparing with current pay", () => {
  const current = { amount: 200000, currency: "USD", kind: "base" as const };

  it("compares like with like only", () => {
    expect(comparesWith({ currency: "USD" }, { kind: "base" }, current)).toBe(true);
    expect(comparesWith({ currency: "EUR" }, { kind: "base" }, current)).toBe(false);
    expect(comparesWith({ currency: "USD" }, { kind: "total" }, current)).toBe(false);
    expect(comparesWith({ currency: "USD" }, { kind: "unclear" }, current)).toBe(false);
    expect(comparesWith({ currency: "USD" }, { kind: "base" }, null)).toBe(false);
  });

  it("gives an increase from an average, and a fall when the market is lower", () => {
    expect(comparePay({ average: 250000, low: 1, high: 2 }, current)).toEqual({ kind: "estimate", difference: 50000, percent: 25 });
    expect(comparePay({ average: 150000, low: 1, high: 2 }, current)).toEqual({ kind: "estimate", difference: -50000, percent: -25 });
  });

  it("gives only the stated range when there are too few postings", () => {
    expect(comparePay({ average: null, low: 180000, high: 260000 }, current)).toEqual({ kind: "too_few", toLow: -20000, toHigh: 60000 });
  });

  it("takes only a positive number", () => {
    expect(parseCurrentAmount("185,000")).toBe(185000);
    expect(parseCurrentAmount("")).toBeNull();
    expect(parseCurrentAmount("-5")).toBeNull();
    expect(parseCurrentAmount("lots")).toBeNull();
  });
});

describe("next roles", () => {
  const requirement = (id: string, over: Partial<Requirement> = {}): Requirement => ({ id, roleId: "r1", text: `Needs ${id}`, excerpt: id, level: "must", category: "engineering", key: "python", eligibility: null, years: null, ...over });
  const assessment = (requirementId: string, status: Assessment["status"]): Assessment => ({ requirementId, roleId: "r1", status, evidence: [], note: "", action: `Work on ${requirementId}` });
  const score = (over: Partial<RoleScore>): RoleScore => ({ roleId: "r1", score: 60, low: 60, high: 60, earned: 0, possible: 0, unknownWeight: 0, coverage: 1, provisional: false, categories: {}, counts: {}, reach: "stretch", reachReason: "Fit is 60.", ...over });

  it("groups roles by reach and names what stands in the way, required skills first", () => {
    const target = role("", { requirements: [requirement("nice", { level: "preferred" }), requirement("shown"), requirement("missing"), requirement("years", { eligibility: "years" })] });
    const [tier, ...rest] = nextRoles({ roleScores: [score({})], assessments: [assessment("nice", "not_shown"), assessment("shown", "demonstrated"), assessment("missing", "not_shown"), assessment("years", "not_shown")] }, [target]);
    expect(rest).toEqual([]);
    expect(tier.reach).toBe("stretch");
    const [next] = tier.roles;
    expect(next.gaps.map((gap) => gap.requirementId)).toEqual(["missing", "nice"]);
    expect(next.gaps[0].action).toBe("Work on missing");
    expect(next.conditions).toEqual(["Needs years"]);
  });

  it("shows nothing when the report has no comparison", () => {
    expect(nextRoles({ roleScores: [], assessments: [] }, [role("")])).toEqual([]);
  });
});
