import type { Assessment, ReportResult, Requirement, Role, RoleScore, SeniorityGroup } from "./types";

// What a report's own openings say about pay and next roles. Everything here is
// worked out from saved postings and assessments, with no model and no paid call,
// so an older report gets the same answer every time.
//
// Only what a posting states is used. Currencies are never converted, a range
// that doesn't say what it covers is never treated as base salary, and a number
// someone types in is compared on the page and goes nowhere else.

/** Under this many postings a group shows its ranges, not an average. */
export const MIN_POSTINGS_FOR_AVERAGE = 3;
/** Stipends, lunch budgets and funding rounds all fall under this. */
const LOWEST_ANNUAL_PAY = 30_000;
const CONTEXT_LINES = 6;
const AFTER_LINES = 3;

export type PayKind = "base" | "total" | "unclear";

export const PAY_KIND_LABELS: Record<PayKind, string> = {
  base: "Base salary",
  total: "Total compensation",
  unclear: "Pay type not clear",
};

export const SENIORITY_LABELS: Record<SeniorityGroup, string> = {
  accessible: "Accessible levels",
  unstated: "Level not stated",
  aspirational: "Senior, aspirational",
};

/** One posting's pay in one place, however many ranges it gave for that place. */
export type PayEntry = {
  roleId: string;
  employer: string;
  title: string;
  url: string;
  statedLocation: string;
  location: string;
  currency: string;
  seniority: SeniorityGroup;
  kind: PayKind;
  min: number;
  max: number;
  midpoint: number;
  excerpts: string[];
};

export type PayLine = {
  kind: PayKind;
  entries: PayEntry[];
  /** Null when too few postings state it. */
  average: number | null;
  low: number;
  high: number;
};

export type PayGroup = { key: string; location: string; currency: string; seniority: SeniorityGroup; lines: PayLine[] };

export type UnusedPosting = { roleId: string; employer: string; title: string; url: string; reason: string };

export type MarketPay = { roleCount: number; statedCount: number; groups: PayGroup[]; unused: UnusedPosting[] };

const PAY_WORDS = /\bsalary\b|\bcompensation\b|\bpay range|\bbase pay\b|\bOTE\b|\bon[-\s]target\b/i;
const BASE_WORDS = /\bbase (?:salary|pay|compensation)\b|\bannual salary\b|\bsalary range\b|\bestimated (?:annual )?salary\b/i;
const TOTAL_WORDS = /\bOTE\b|\bon[-\s]target\b|\btotal (?:target |cash )?(?:compensation|pay)\s+(?:range|is|of\b|:)|\btarget total\b/i;
const NOT_PAY = /\braised\b|\bseries [a-h]\b|\bfunding\b|\bvaluation\b|\brevenue\b|\bARR\b|\bstipend\b|\bsign[-\s]on\b/i;
const NOT_YEARLY = /\/\s*(?:hour|hr|h|day|week|month|mo)\b|\bper (?:hour|day|week|month)\b|\bhourly\b|\bmonthly\b/i;
const LEVEL_LABEL = /^[\s•*-]*(?:(?:senior|staff|principal|lead|junior|mid|associate|level|L\d)\b[^:$]{0,40}|[^:$]{0,30}\bengineer\b[^:$]{0,10}):/i;
const AMOUNT = /(\d{1,3}(?:,\d{3})+|\d{1,3}(?:\.\d{3})+(?!\d)|\d{2,3}\s?k\b|\d{5,7})(?:\.\d{2})?/gi;

const CURRENCY_CODES = /\b(USD|CAD|EUR|GBP|AUD|NZD|SGD|INR|CHF|JPY|KRW|SEK|NOK|DKK|PLN|ILS|AED|BRL|MXN)\b/;
const CURRENCY_MARKS: [RegExp, string][] = [
  [/US\$/, "USD"],
  [/\bCA?\$/, "CAD"],
  [/\bAU?\$/, "AUD"],
  [/\bS\$/, "SGD"],
  [/€/, "EUR"],
  [/£/, "GBP"],
  [/₹/, "INR"],
];

const PLACES: [RegExp, string][] = [
  [/\bU\.S\.|\bUSA?\b(?!\$)|United States|Bay Area|San Francisco|New York|\bNYC\b|Seattle|Austin|Boston|Chicago|Los Angeles|Denver|Washington,? D\.?C|Maryland|Virginia|Foster City|Palo Alto|Mountain View|, (?:CA|NY|WA|TX|MA|IL|CO|VA|MD|GA|FL|NC|PA|DC)\b/, "United States"],
  [/Canada|Toronto|Vancouver|Montreal/, "Canada"],
  [/United Kingdom|\bUK\b|London/, "United Kingdom"],
  [/Ireland|Dublin/, "Ireland"],
  [/Germany|Berlin|Munich/, "Germany"],
  [/France|Paris/, "France"],
  [/Netherlands|Amsterdam/, "Netherlands"],
  [/Spain|Madrid|Barcelona/, "Spain"],
  [/India|Hyderabad|Bengaluru|Bangalore|Mumbai|Delhi|Pune/, "India"],
  [/Singapore/, "Singapore"],
  [/Australia|Sydney|Melbourne/, "Australia"],
  [/Japan|Tokyo/, "Japan"],
  [/Korea|Seoul/, "South Korea"],
];

const placeIn = (text: string) => PLACES.find(([pattern]) => pattern.test(text))?.[1] ?? null;

function amountsIn(line: string): number[] {
  const values: number[] = [];
  for (const match of line.matchAll(AMOUNT)) {
    const raw = match[1].toLowerCase().replace(/\s/g, "");
    const value = raw.endsWith("k") ? Number(raw.slice(0, -1)) * 1000 : Number(raw.replace(/[,.]/g, ""));
    if (value >= LOWEST_ANNUAL_PAY) values.push(value);
  }
  return values.slice(0, 2);
}

/** "USD", or "$" when the posting doesn't say which dollar, or null when it shows no currency. */
function currencyIn(line: string): string | null {
  const code = line.match(CURRENCY_CODES)?.[1];
  if (code) return code;
  const marked = CURRENCY_MARKS.find(([pattern]) => pattern.test(line))?.[1];
  if (marked) return marked;
  return line.includes("$") ? "$" : null;
}

/** The nearest words that say what the range covers. Saying both means it isn't clear. */
function kindNear(lines: string[], index: number): PayKind {
  for (let at = index; at >= Math.max(0, index - CONTEXT_LINES); at -= 1) {
    const base = BASE_WORDS.test(lines[at]);
    const total = TOTAL_WORDS.test(lines[at]);
    if (base && total) return "unclear";
    if (base) return "base";
    if (total) return "total";
  }
  return "unclear";
}

/** The ranges a posting states, or why it can't be used. */
export function payFromRole(role: Role): { entries: PayEntry[]; unused: string | null } {
  const lines = role.description
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const found: { line: string; kind: PayKind; currency: string; location: string; min: number; max: number }[] = [];
  let unclearDollar = false;
  let levelled = 0;

  lines.forEach((line, index) => {
    if (line.length > 320 || NOT_PAY.test(line) || NOT_YEARLY.test(line)) return;
    const values = amountsIn(line);
    if (values.length === 0) return;
    const marked = currencyIn(line);
    if (!marked) return;
    const context = lines.slice(Math.max(0, index - CONTEXT_LINES), index + 1);
    // Some postings explain the ranges just after listing them.
    const nearby = [...context, ...lines.slice(index + 1, index + 1 + AFTER_LINES)];
    if (!nearby.some((text) => PAY_WORDS.test(text))) return;
    if (LEVEL_LABEL.test(line)) levelled += 1;
    const location = placeIn(line) ?? placeIn(role.location) ?? placeIn(context.join(" ")) ?? (role.location.trim() || "Location not stated");
    const currency = marked === "$" ? (location === "United States" ? "USD" : null) : marked;
    if (!currency) {
      unclearDollar = true;
      return;
    }
    found.push({ line, kind: kindNear(lines, index), currency, location, min: Math.min(...values), max: Math.max(...values) });
  });

  if (levelled >= 2) return { entries: [], unused: "It gives separate ranges by level, so none can be tied to this opening." };
  if (found.length === 0) return { entries: [], unused: unclearDollar ? "It shows $ without saying which currency." : "The posting doesn't state pay." };

  // One posting counts once in a place, however many zones it lists there.
  const merged = new Map<string, typeof found>();
  for (const range of found) {
    const key = [range.location, range.currency, range.kind].join("|");
    merged.set(key, [...(merged.get(key) ?? []), range]);
  }
  const entries = [...merged.values()].map((ranges): PayEntry => {
    const [first] = ranges;
    return {
      roleId: role.id,
      employer: role.employer,
      title: role.title,
      url: role.url,
      statedLocation: role.location,
      location: first.location,
      currency: first.currency,
      seniority: role.seniorityGroup,
      kind: first.kind,
      min: Math.min(...ranges.map((range) => range.min)),
      max: Math.max(...ranges.map((range) => range.max)),
      midpoint: ranges.reduce((sum, range) => sum + (range.min + range.max) / 2, 0) / ranges.length,
      excerpts: ranges.map((range) => range.line),
    };
  });
  return { entries, unused: null };
}

const KIND_ORDER: PayKind[] = ["base", "total", "unclear"];
const SENIORITY_ORDER: SeniorityGroup[] = ["accessible", "unstated", "aspirational"];

/** Advertised pay across a report's open roles, kept apart by place, currency and level. */
export function marketPay(roles: readonly Role[]): MarketPay {
  const open = roles.filter((role) => role.status === "open");
  const unused: UnusedPosting[] = [];
  const entries: PayEntry[] = [];
  let statedCount = 0;
  for (const role of open) {
    const pay = payFromRole(role);
    if (pay.entries.length > 0) {
      statedCount += 1;
      entries.push(...pay.entries);
    } else {
      unused.push({ roleId: role.id, employer: role.employer, title: role.title, url: role.url, reason: pay.unused ?? "The posting doesn't state pay." });
    }
  }

  const byGroup = new Map<string, PayEntry[]>();
  for (const entry of entries) {
    const key = [entry.location, entry.currency, entry.seniority].join("|");
    byGroup.set(key, [...(byGroup.get(key) ?? []), entry]);
  }
  const groups = [...byGroup.entries()].map(([key, members]): PayGroup => {
    const [first] = members;
    const lines = KIND_ORDER.flatMap((kind): PayLine[] => {
      const ofKind = members.filter((entry) => entry.kind === kind);
      if (ofKind.length === 0) return [];
      const average = ofKind.length >= MIN_POSTINGS_FOR_AVERAGE ? ofKind.reduce((sum, entry) => sum + entry.midpoint, 0) / ofKind.length : null;
      return [{ kind, entries: ofKind, average, low: Math.min(...ofKind.map((entry) => entry.min)), high: Math.max(...ofKind.map((entry) => entry.max)) }];
    });
    return { key, location: first.location, currency: first.currency, seniority: first.seniority, lines };
  });
  groups.sort((a, b) => a.location.localeCompare(b.location) || a.currency.localeCompare(b.currency) || SENIORITY_ORDER.indexOf(a.seniority) - SENIORITY_ORDER.indexOf(b.seniority));
  return { roleCount: open.length, statedCount, groups, unused };
}

export type CurrentPay = { amount: number; currency: string; kind: "base" | "total" };

export type PayComparison =
  | { kind: "estimate"; difference: number; percent: number }
  | { kind: "too_few"; toLow: number; toHigh: number };

/** Only like with like: same currency, and base with base or total with total. */
export function comparesWith(group: Pick<PayGroup, "currency">, line: Pick<PayLine, "kind">, current: CurrentPay | null): boolean {
  return current !== null && group.currency === current.currency && line.kind === current.kind;
}

export function comparePay(line: Pick<PayLine, "average" | "low" | "high">, current: CurrentPay): PayComparison {
  if (line.average === null) return { kind: "too_few", toLow: line.low - current.amount, toHigh: line.high - current.amount };
  const difference = line.average - current.amount;
  return { kind: "estimate", difference, percent: Math.round((difference / current.amount) * 100) };
}

/** A typed amount, or null when it isn't a usable yearly figure. */
export function parseCurrentAmount(text: string): number | null {
  const value = Number(text.replace(/[\s,]/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

// ─── Next roles ──────────────────────────────────────────────

export type RoleGap = { requirementId: string; text: string; must: boolean; status: Assessment["status"]; action: string };

export type NextRole = { role: Role; score: number | null; reason: string; gaps: RoleGap[]; conditions: string[] };

export type NextRoleTier = { reach: RoleScore["reach"]; title: string; description: string; roles: NextRole[] };

const TIERS: { reach: RoleScore["reach"]; title: string; description: string }[] = [
  { reach: "within_reach", title: "Closest next roles", description: "The profile already shows much of what these ask for." },
  { reach: "stretch", title: "Realistic with these skills developed", description: "These ask for skills this profile doesn't show yet." },
  { reach: "aspirational", title: "Longer-term roles", description: "These are senior, or ask for more years than the profile's dates show." },
];

const ROLES_PER_TIER = 2;
const GAPS_PER_ROLE = 2;

function gapsFor(role: Role, assessments: Map<string, Assessment>): RoleGap[] {
  const open = role.requirements.flatMap((requirement: Requirement): RoleGap[] => {
    const assessment = assessments.get(requirement.id);
    if (requirement.eligibility || !assessment) return [];
    if (assessment.status !== "not_shown" && assessment.status !== "partial") return [];
    return [{ requirementId: requirement.id, text: requirement.text, must: requirement.level === "must", status: assessment.status, action: assessment.action }];
  });
  return open.sort((a, b) => Number(b.must) - Number(a.must) || Number(b.status === "not_shown") - Number(a.status === "not_shown")).slice(0, GAPS_PER_ROLE);
}

/** The sampled roles by how close this profile is to them, each with what stands in the way. */
export function nextRoles(result: Pick<ReportResult, "roleScores" | "assessments">, roles: readonly Role[]): NextRoleTier[] {
  const assessments = new Map(result.assessments.map((assessment) => [assessment.requirementId, assessment]));
  const rolesById = new Map(roles.map((role) => [role.id, role]));
  return TIERS.map((tier) => ({
    ...tier,
    roles: result.roleScores
      .filter((score) => score.reach === tier.reach && rolesById.has(score.roleId))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
      .slice(0, ROLES_PER_TIER)
      .map((score): NextRole => {
        const role = rolesById.get(score.roleId) as Role;
        return {
          role,
          score: score.score,
          reason: score.reachReason,
          gaps: gapsFor(role, assessments),
          conditions: role.requirements.filter((requirement) => requirement.eligibility).map((requirement) => requirement.text).slice(0, 3),
        };
      }),
  })).filter((tier) => tier.roles.length > 0);
}
