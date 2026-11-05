import {
  CATEGORY_LABELS,
  REQUIREMENT_KEYS,
  type Assessment,
  type AssessmentStatus,
  type EvidenceGap,
  type MarketScore,
  type RecurringRow,
  type Requirement,
  type RequirementCategory,
  type RequirementKey,
  type Role,
  type RoleScore,
  type SeniorityGroup,
  type Strength,
} from "./types";

// The scoring rubric, in code so the same evidence always gets the same number.
// The model never produces a score: it only reads text, and every claim it
// makes is checked against the snapshots before it reaches this file. A score
// describes evidence against this sourced market sample. It isn't a hiring
// probability or a judgement of anyone's ability.

export const RUBRIC_VERSION = "fde-fit@1";

export const LEVEL_WEIGHT = { must: 2, preferred: 1 } as const;
export const CREDIT: Record<Exclude<AssessmentStatus, "cannot_assess">, number> = { demonstrated: 1, partial: 0.5, not_shown: 0 };
export const GROUP_WEIGHT: Record<SeniorityGroup, number> = { accessible: 1, unstated: 1, aspirational: 0.5 };

const LOW_COVERAGE = 0.75;
const MIN_REQUIREMENTS = 3;
const MIN_ROLES = 5;
const MIN_EMPLOYERS = 5;
const WITHIN_REACH = 55;

/** The rubric in words, shown beside every score. */
export const RUBRIC_EXPLAINED = [
  "Each role's fit: must-have requirements weigh 2, preferred requirements 1. Demonstrated earns all of its weight, Partial half, Not shown in this profile nothing.",
  "Cannot assess is left out of the denominator and counted as unknown. The range beside a score shows the result if every unknown were Not shown (low) or Demonstrated (high).",
  "Stated eligibility (years, location, travel, work authorization, degree, clearance, spoken language) is never part of technical fit. It's listed separately.",
  "Market readiness is the weighted mean of the per-role fits for verified-open roles: accessible and unstated seniority weigh 1, aspirational senior roles 0.5, so a senior opening can't dominate.",
  "Geography copies and reposts of one requisition count once. Requirements are never combined across employers into one mandatory list.",
  "Learning tasks you tick off don't change any score: only evidence in a profile snapshot can.",
];

const round = (value: number) => Math.round(value);

function assessedBy(assessments: readonly Assessment[]): Map<string, Assessment> {
  return new Map(assessments.map((assessment) => [assessment.requirementId, assessment]));
}

/** Technical fit for one role, from its own requirements only. */
export function scoreRole(role: Pick<Role, "id" | "seniorityGroup" | "requirements">, assessments: readonly Assessment[], options: { partialProfile: boolean; monthsOfExperience: number | null }): RoleScore {
  const byId = assessedBy(assessments.filter((assessment) => assessment.roleId === role.id));
  const categories: RoleScore["categories"] = {};
  const counts: Record<string, number> = { demonstrated: 0, partial: 0, not_shown: 0, cannot_assess: 0 };
  let earned = 0;
  let possible = 0;
  let unknownWeight = 0;
  let technical = 0;

  for (const requirement of role.requirements) {
    if (requirement.eligibility) continue;
    technical++;
    const status = byId.get(requirement.id)?.status ?? "cannot_assess";
    counts[status]++;
    const weight = LEVEL_WEIGHT[requirement.level];
    if (status === "cannot_assess") {
      unknownWeight += weight;
      continue;
    }
    const gained = weight * CREDIT[status];
    earned += gained;
    possible += weight;
    const category = (categories[requirement.category] ??= { earned: 0, possible: 0 });
    category.earned += gained;
    category.possible += weight;
  }

  const total = possible + unknownWeight;
  const score = possible > 0 ? round((100 * earned) / possible) : null;
  const coverage = total > 0 ? possible / total : 0;
  const provisional = options.partialProfile || coverage < LOW_COVERAGE || technical < MIN_REQUIREMENTS;
  const reach = reachOf(role, score, options.monthsOfExperience);
  return {
    roleId: role.id,
    score,
    low: total > 0 ? round((100 * earned) / total) : null,
    high: total > 0 ? round((100 * (earned + unknownWeight)) / total) : null,
    earned,
    possible,
    unknownWeight,
    coverage: Math.round(coverage * 100) / 100,
    provisional,
    categories,
    counts,
    ...reach,
  };
}

/** Within reach or aspirational, from what the posting says and what the dates show. */
function reachOf(role: Pick<Role, "seniorityGroup" | "requirements">, score: number | null, months: number | null): Pick<RoleScore, "reach" | "reachReason"> {
  const asked = role.requirements.filter((requirement) => requirement.eligibility === "years" && requirement.level === "must").map((requirement) => requirement.years?.min ?? 0);
  const yearsAsked = asked.length > 0 ? Math.max(...asked) : null;
  if (role.seniorityGroup === "aspirational") return { reach: "aspirational", reachReason: "The posting describes a senior role." };
  if (yearsAsked !== null && months !== null && months < (yearsAsked - 1) * 12) {
    return { reach: "aspirational", reachReason: `It asks for ${yearsAsked} years; the profile's dates show about ${Math.floor(months / 12)}.` };
  }
  if (score !== null && score >= WITHIN_REACH) return { reach: "within_reach", reachReason: `Fit is ${score} and nothing in the posting marks it as senior.` };
  return { reach: "stretch", reachReason: score === null ? "Too little could be assessed." : `Fit is ${score}, under the ${WITHIN_REACH} this rubric treats as within reach.` };
}

/** The market-readiness score, or the reason it's withheld. */
export function scoreMarket(roles: readonly Pick<Role, "id" | "employer" | "status" | "seniorityGroup">[], scores: readonly RoleScore[], options: { profileQuality: "full" | "partial" | "identity" }): MarketScore {
  const scoreOf = new Map(scores.map((score) => [score.roleId, score]));
  const counted = roles.filter((role) => role.status === "open" && scoreOf.get(role.id)?.score !== null && scoreOf.has(role.id));
  const employers = new Set(counted.map((role) => role.employer.toLowerCase()));

  const groups: MarketScore["groups"] = {};
  for (const group of ["accessible", "unstated", "aspirational"] as const) {
    const inGroup = counted.filter((role) => role.seniorityGroup === group);
    const sum = inGroup.reduce((total, role) => total + (scoreOf.get(role.id)?.score ?? 0), 0);
    groups[group] = { count: inGroup.length, score: inGroup.length > 0 ? round(sum / inGroup.length) : null };
  }

  const empty: MarketScore = {
    rubric: RUBRIC_VERSION,
    score: null,
    withheld: null,
    provisional: true,
    provisionalWhy: [],
    low: null,
    high: null,
    roleCount: counted.length,
    employerCount: employers.size,
    weightTotal: 0,
    coverage: 0,
    categories: {},
    groups,
  };
  if (options.profileQuality === "identity") return { ...empty, withheld: "Only name-level data came back for this profile, so there's nothing to assess." };
  if (counted.length === 0) return { ...empty, withheld: "No verified-open role could be compared with this profile." };

  let weightTotal = 0;
  let weighted = 0;
  let low = 0;
  let high = 0;
  let coverage = 0;
  const categories: MarketScore["categories"] = {};
  for (const role of counted) {
    const result = scoreOf.get(role.id)!;
    const weight = GROUP_WEIGHT[role.seniorityGroup];
    weightTotal += weight;
    weighted += weight * (result.score ?? 0);
    low += weight * (result.low ?? 0);
    high += weight * (result.high ?? 0);
    coverage += weight * result.coverage;
    for (const [name, value] of Object.entries(result.categories)) {
      const category = (categories[name] ??= { earned: 0, possible: 0 });
      category.earned += weight * value.earned;
      category.possible += weight * value.possible;
    }
  }

  const provisionalWhy: string[] = [];
  if (options.profileQuality === "partial") provisionalWhy.push("Parts of the profile weren't retrieved.");
  if (counted.length < MIN_ROLES) provisionalWhy.push(`Only ${counted.length} ${counted.length === 1 ? "role" : "roles"} could be compared.`);
  if (employers.size < MIN_EMPLOYERS) provisionalWhy.push(`The sample covers ${employers.size} ${employers.size === 1 ? "employer" : "employers"}.`);
  if (counted.some((role) => scoreOf.get(role.id)?.provisional)) provisionalWhy.push("Some roles could only be partly assessed.");

  return {
    ...empty,
    score: round(weighted / weightTotal),
    provisional: provisionalWhy.length > 0,
    provisionalWhy,
    low: round(low / weightTotal),
    high: round(high / weightTotal),
    weightTotal,
    coverage: Math.round((coverage / weightTotal) * 100) / 100,
    categories,
  };
}

const keyLabel = (key: string) => REQUIREMENT_KEYS[key as RequirementKey] ?? REQUIREMENT_KEYS.other;

/**
 * What recurs across roles: each row counts distinct roles, never mentions, and
 * keeps every role's own excerpt. Asks made by one employer stay out of it and
 * are listed as employer-specific instead.
 */
export function recurringRequirements(roles: readonly Pick<Role, "id" | "requirements">[], assessments: readonly Assessment[]): { recurring: RecurringRow[]; employerSpecific: Requirement[] } {
  const byId = assessedBy(assessments);
  const rows = new Map<string, RecurringRow>();
  const employerSpecific: Requirement[] = [];
  const analyzed = roles.filter((role) => role.requirements.length > 0).length;
  for (const role of roles) {
    const seen = new Set<string>();
    for (const requirement of role.requirements) {
      if (requirement.key === "other") {
        employerSpecific.push(requirement);
        continue;
      }
      const row = rows.get(requirement.key) ?? { key: requirement.key, label: keyLabel(requirement.key), category: requirement.category, count: 0, analyzed, mustCount: 0, roles: [] };
      if (!seen.has(requirement.key)) {
        seen.add(requirement.key);
        row.count++;
        if (requirement.level === "must") row.mustCount++;
      }
      row.roles.push({ roleId: role.id, requirementId: requirement.id, level: requirement.level, status: byId.get(requirement.id)?.status ?? null, excerpt: requirement.excerpt });
      rows.set(requirement.key, row);
    }
  }
  const all = [...rows.values()].sort((a, b) => b.count - a.count || b.mustCount - a.mustCount || a.label.localeCompare(b.label));
  const once = all.filter((row) => row.count < 2);
  for (const row of once) {
    const role = roles.find((entry) => entry.id === row.roles[0].roleId);
    employerSpecific.push(...(role?.requirements.filter((requirement) => requirement.key === row.key) ?? []));
  }
  return { recurring: all.filter((row) => row.count >= 2), employerSpecific };
}

/** Technical requirements most often without evidence. Missing evidence isn't missing ability. */
export function priorityGaps(roles: readonly Pick<Role, "id" | "requirements">[], assessments: readonly Assessment[], limit = 6): EvidenceGap[] {
  const byId = assessedBy(assessments);
  const gaps = new Map<string, EvidenceGap & { roles: Set<string>; musts: Set<string> }>();
  for (const role of roles) {
    for (const requirement of role.requirements) {
      if (requirement.eligibility || requirement.key === "other") continue;
      const status = byId.get(requirement.id)?.status;
      if (status !== "not_shown" && status !== "partial") continue;
      const gap = gaps.get(requirement.key) ?? { key: requirement.key, label: keyLabel(requirement.key), roleCount: 0, mustCount: 0, weight: 0, roles: new Set<string>(), musts: new Set<string>() };
      gap.roles.add(role.id);
      if (requirement.level === "must") gap.musts.add(role.id);
      gap.weight += LEVEL_WEIGHT[requirement.level] * (status === "partial" ? 0.5 : 1);
      gaps.set(requirement.key, gap);
    }
  }
  return [...gaps.values()]
    .map(({ roles: inRoles, musts, ...gap }) => ({ ...gap, roleCount: inRoles.size, mustCount: musts.size }))
    .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** Requirements the profile shows, each with a quote checked against it. */
export function demonstratedStrengths(roles: readonly Pick<Role, "id" | "requirements">[], assessments: readonly Assessment[], limit = 6): Strength[] {
  const byId = assessedBy(assessments);
  const strengths = new Map<string, Strength & { roles: Set<string> }>();
  for (const role of roles) {
    for (const requirement of role.requirements) {
      if (requirement.eligibility || requirement.key === "other") continue;
      const assessment = byId.get(requirement.id);
      const quote = assessment?.evidence[0];
      if (assessment?.status !== "demonstrated" || !quote) continue;
      const strength = strengths.get(requirement.key) ?? { key: requirement.key, label: keyLabel(requirement.key), roleCount: 0, quote: quote.quote, sourceLabel: quote.label, sourceId: quote.sourceId, roles: new Set<string>() };
      strength.roles.add(role.id);
      strengths.set(requirement.key, strength);
    }
  }
  return [...strengths.values()]
    .map(({ roles: inRoles, ...strength }) => ({ ...strength, roleCount: inRoles.size }))
    .sort((a, b) => b.roleCount - a.roleCount || a.label.localeCompare(b.label))
    .slice(0, limit);
}

export const categoryLabel = (category: string) => CATEGORY_LABELS[category as RequirementCategory] ?? category;
