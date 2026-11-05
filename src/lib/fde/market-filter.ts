import type { DiscoveredRole, FdeFilters, Role, RoleSource, RoleStatus, SeniorityGroup } from "./types";

// Deciding what counts as a forward deployed role and which of them make the
// benchmark. Nothing here knows who's being reviewed: the shortlist is the same
// for any profile, so no role can be picked because it flatters this one.

export type Candidate = {
  source: RoleSource;
  sourceLabel: string;
  externalId: string;
  requisitionId: string | null;
  title: string;
  employer: string;
  location: string;
  remotePolicy: string;
  url: string;
  applyUrl: string | null;
  description: string;
  postedAt: string | null;
  updatedAt: string | null;
  checkedAt: string;
  status: RoleStatus;
  otherLocations: string[];
};

export type Exclusion = { title: string; employer: string; reason: string; url: string };

const FORWARD = /forward[\s-]+deployed|\bFDE\b/i;
const EQUIVALENT = /\bdeploy(?:ed|ment)\s+(?:\w+\s+){0,2}engineer|\bapplied\s+ai\s+engineer|\bai\s+deployment\b/i;
const ENGINEERING_TITLE = /engineer|developer|\bFDE\b|\bSWE\b/i;
const NOT_THIS_ROLE: [RegExp, string][] = [
  [/\bproduct manager\b/i, "It's a product manager role."],
  [/\b(?:engineering )?manager\b|\bdirector\b|\bhead of\b|\bvp\b|\bvice president\b/i, "It's a people-management role."],
  [/\bbanker\b|\bstrategist\b|\bstrategy\b|\baccelerator\b|\bsales\b|\baccount executive\b/i, "It isn't an engineering role."],
  [/\barchitect\b|\brecruit|\banalyst\b|\bdesigner\b|\bconsultant\b|\bdeployment lead\b|\bengagement lead\b|\bdelivery lead\b/i, "It isn't an engineering role."],
  [/\bintern(?:ship)?\b/i, "It's an internship."],
];

const CUSTOMER = /\bcustomers?\b|\bclients?\b|customer[-\s]facing|\bon[-\s]?site\b|embedded? (?:with|in|alongside)|\bstakeholders?\b/gi;
const DEPLOYMENT = /\bdeploy\w*|\bproduction\b|\bimplementation\w*|\bintegrat\w+|\brollouts?\b|\bgo[-\s]live\b/gi;
const ENGINEERING = /\bcode\b|\bcoding\b|\bsoftware\b|\bpython\b|\btypescript\b|\bjavascript\b|\bAPIs?\b|\bbackend\b|\bfull[-\s]?stack\b|\bdistributed systems?\b|\bengineering\b/gi;

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

/** The full posting's minimum length: anything shorter is a snippet, not something to compare with. */
export const MIN_DESCRIPTION = 500;

export function titleMatches(title: string): { match: boolean; equivalent: boolean; reason: string | null } {
  const forward = FORWARD.test(title);
  const equivalent = !forward && EQUIVALENT.test(title);
  if (!forward && !equivalent) return { match: false, equivalent: false, reason: "The title doesn't name a forward deployed role." };
  if (!ENGINEERING_TITLE.test(title)) return { match: false, equivalent, reason: "It isn't an engineering role." };
  for (const [pattern, reason] of NOT_THIS_ROLE) if (pattern.test(title)) return { match: false, equivalent, reason };
  return { match: true, equivalent, reason: null };
}

const ABOUT_THE_ROLE = /\byou(?:'ll|\u2019ll)?\b|\byour\b|\b(?:this|the) role\b|\bFDEs?\b|\bforward[-\s]deployed\b/i;
const HANDS_ON = /\bwork(?:ing)?\s+(?:\S+\s+){0,2}(?:with|alongside|inside)\b|\bpartner\w*|\bembed\w*|\bon[-\s]?site\b|\bhands[-\s]on\b|\bbuild\w*|\bship\w*|\bdeliver\w*|\bdeploy\w*|\bintegrat\w*|\bimplement\w*|\bwrit(?:e|ing)\b/i;

/**
 * The sentence that says what this role does, not the first that uses the word.
 * "Millions of customers trust us" is about the company, so it proves nothing
 * about the job, and returning nothing is better than quoting it as if it did.
 */
export function dutySentence(text: string, pattern: RegExp): string {
  const single = new RegExp(pattern.source, pattern.flags.replace("g", ""));
  const duties = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 25 && single.test(sentence) && ABOUT_THE_ROLE.test(sentence));
  const found = duties.find((sentence) => HANDS_ON.test(sentence)) ?? duties[0] ?? "";
  return found.length > 240 ? `${found.slice(0, 240).trimEnd()}\u2026` : found;
}

/** Does the posting's own text describe customer-facing engineering and deployment? Keywords in a title aren't enough. */
export function verifyResponsibilities(candidate: Pick<Candidate, "description">, equivalent: boolean): { ok: boolean; reason: string | null } {
  const text = candidate.description;
  const customer = count(text, CUSTOMER);
  const deployment = count(text, DEPLOYMENT);
  const engineering = count(text, ENGINEERING);
  const enough = equivalent ? customer >= 3 && deployment >= 2 && engineering >= 2 : customer >= 1 && deployment >= 1 && engineering >= 1;
  if (enough) return { ok: true, reason: null };
  if (customer < (equivalent ? 3 : 1)) return { ok: false, reason: "The posting doesn't describe customer-facing work." };
  if (engineering < (equivalent ? 2 : 1)) return { ok: false, reason: "The posting doesn't describe hands-on engineering." };
  return { ok: false, reason: "The posting doesn't describe deployment work." };
}

const SENIOR = /\b(senior|sr\.?|staff|principal|lead|distinguished)\b/i;
const JUNIOR = /\b(junior|jr\.?|associate|entry[-\s]level|new grad(?:uate)?|early career|graduate)\b/i;
const MID = /\b(mid[-\s]?level|intermediate)\b/i;
const YEARS = /(\d{1,2})\s*\+?\s*(?:or more\s+)?(?:years?|yrs?)\b/gi;

/** What the posting states about level, without working out what it "really" means. */
export function seniorityOf(title: string, description: string): { seniority: string; group: SeniorityGroup } {
  const senior = SENIOR.exec(title)?.[1];
  if (senior) return { seniority: senior[0].toUpperCase() + senior.slice(1).toLowerCase(), group: "aspirational" };
  const junior = JUNIOR.exec(title)?.[1];
  if (junior) return { seniority: junior[0].toUpperCase() + junior.slice(1).toLowerCase(), group: "accessible" };
  if (MID.test(title)) return { seniority: "Mid-level", group: "accessible" };
  const years = [...description.matchAll(YEARS)].map((match) => Number(match[1])).filter((value) => value > 0 && value <= 25);
  if (years.length > 0) {
    const highest = Math.max(...years);
    return { seniority: `Asks for ${highest}+ years`, group: highest >= 7 ? "aspirational" : "accessible" };
  }
  return { seniority: "Not stated", group: "unstated" };
}

const employerKey = (employer: string) => employer.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").replace(/(?:inc|llc|ltd|gmbh|corp|corporation|technologies|labs|ai)$/, "");

const wordsOf = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared);
}

const SOURCE_RANK: Record<RoleSource, number> = { greenhouse: 0, lever: 0, ashby: 0, fixture: 1, linkedin: 2 };
const SAME_REQUISITION = 0.72;

const SAME_TITLE = 0.75;

/**
 * A title's words without the places it names, so that "Engineer (Korea)" and
 * "Engineer - London" count as one job, but "Security Engineer" and "Software
 * Engineer" at the same employer don't, however much boilerplate they share.
 */
function titleWordsOf(role: Pick<Candidate, "title" | "location" | "otherLocations">): Set<string> {
  const places = new Set(`${role.location} ${role.otherLocations.join(" ")}`.toLowerCase().match(/[a-z]+/g) ?? []);
  const words = role.title.replace(/\([^)]*\)/g, " ").toLowerCase().match(/[a-z]+/g) ?? [];
  return new Set(words.filter((word) => !places.has(word)));
}

/** One entry per requisition: geography copies and reposts merge, and the employer's own posting wins. */
export function dedupe(candidates: readonly Candidate[]): { roles: Candidate[]; merged: number } {
  const ordered = [...candidates].sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || b.description.length - a.description.length);
  const kept: { role: Candidate; words: Set<string>; titleWords: Set<string>; key: string }[] = [];
  let merged = 0;
  for (const candidate of ordered) {
    const key = employerKey(candidate.employer);
    const words = wordsOf(candidate.description);
    const titleWords = titleWordsOf(candidate);
    const same = kept.find(
      (entry) =>
        entry.key === key &&
        ((candidate.requisitionId && entry.role.requisitionId === candidate.requisitionId) ||
          (similarity(entry.titleWords, titleWords) >= SAME_TITLE && similarity(entry.words, words) >= SAME_REQUISITION)),
    );
    if (!same) {
      kept.push({ role: { ...candidate, otherLocations: [...candidate.otherLocations] }, words, titleWords, key });
      continue;
    }
    merged++;
    for (const place of [candidate.location, ...candidate.otherLocations]) {
      if (place && place !== same.role.location && !same.role.otherLocations.includes(place)) same.role.otherLocations.push(place);
    }
  }
  return { roles: kept.map((entry) => entry.role), merged };
}

export function matchesFilters(role: Pick<Candidate, "location" | "otherLocations" | "remotePolicy">, group: SeniorityGroup, filters: FdeFilters): boolean {
  const places = [role.location, ...role.otherLocations].join(" · ").toLowerCase();
  if (filters.location && !places.includes(filters.location.toLowerCase())) return false;
  if (filters.remoteOnly && !/remote/i.test(`${role.remotePolicy} ${places}`)) return false;
  if (filters.seniority === "accessible" && group === "aspirational") return false;
  if (filters.seniority === "aspirational" && group !== "aspirational") return false;
  return true;
}

export type ShortlistOptions = { target: number; min: number; max: number; minEmployers: number; perEmployer: number; established: ReadonlySet<string> };

export const DEFAULT_SHORTLIST: Omit<ShortlistOptions, "target" | "established"> = { min: 8, max: 12, minEmployers: 5, perEmployer: 2 };

/** The core titles first, then specialisms of it, then equivalents. It reads only the title, never the person. */
const titleRank = (role: { title: string; equivalent: boolean }) =>
  role.equivalent ? 2 : /forward[\s-]deployed\s+(software\s+|ai\s+)?engineer/i.test(role.title) ? 0 : 1;

const freshness = (role: Candidate) => Date.parse(role.updatedAt ?? role.postedAt ?? "") || 0;

/** Why this posting is in the sample, in words the reader can check against it. */
export function reasonsFor(role: Candidate, equivalent: boolean, established: ReadonlySet<string>): string[] {
  const reasons = [
    equivalent ? `Treated as an equivalent: "${role.title}" and its text describes the same work.` : `The title names the role: "${role.title}".`,
    role.source === "linkedin" ? "Listed on LinkedIn and confirmed open from its job record." : `Listed on ${role.employer}'s own careers board (${role.sourceLabel}).`,
  ];
  const customer = dutySentence(role.description, CUSTOMER);
  reasons.push(customer ? `Customer-facing: "${customer}"` : "The posting mentions customers, but no sentence plainly says this role works with them.");
  const engineering = dutySentence(role.description, ENGINEERING);
  if (engineering && engineering !== customer) reasons.push(`Engineering: "${engineering}"`);
  if (established.has(employerKey(role.employer))) reasons.push("The employer has an established forward deployed practice, which is why its board is searched. The posting itself was still read.");
  return reasons;
}

export const establishedKey = employerKey;

/**
 * The curated sample. One role per employer first, then a second where the
 * employer has one at a different level, so that one company can't fill the
 * list. Ordered by employer spread and freshness only.
 */
export function shortlist(candidates: readonly Candidate[], filters: FdeFilters, options: ShortlistOptions): { selected: Role[]; excluded: Exclusion[]; limits: string[] } {
  const excluded: Exclusion[] = [];
  const eligible: (Candidate & { group: SeniorityGroup; seniority: string; equivalent: boolean })[] = [];
  const exclude = (role: Candidate, reason: string) => excluded.push({ title: role.title, employer: role.employer, reason, url: role.url });

  for (const role of candidates) {
    const title = titleMatches(role.title);
    if (!title.match) {
      exclude(role, title.reason ?? "Not a forward deployed role.");
      continue;
    }
    if (role.status !== "open") {
      exclude(role, role.status === "closed" ? "It's closed." : "It couldn't be confirmed open.");
      continue;
    }
    if (role.description.length < MIN_DESCRIPTION) {
      exclude(role, "The full description wasn't available, and a snippet isn't enough.");
      continue;
    }
    const duties = verifyResponsibilities(role, title.equivalent);
    if (!duties.ok) {
      exclude(role, duties.reason ?? "The posting doesn't describe the work.");
      continue;
    }
    const { seniority, group } = seniorityOf(role.title, role.description);
    if (!matchesFilters(role, group, filters)) {
      exclude(role, "Outside the filters you set.");
      continue;
    }
    eligible.push({ ...role, seniority, group, equivalent: title.equivalent });
  }

  const byEmployer = new Map<string, typeof eligible>();
  for (const role of eligible) {
    const key = employerKey(role.employer);
    byEmployer.set(key, [...(byEmployer.get(key) ?? []), role]);
  }
  const employers = [...byEmployer.entries()].sort(([a, rolesA], [b, rolesB]) => Number(options.established.has(b)) - Number(options.established.has(a)) || freshness(rolesB[0]) - freshness(rolesA[0]) || a.localeCompare(b));
  for (const [, roles] of employers) roles.sort((a, b) => titleRank(a) - titleRank(b) || freshness(b) - freshness(a));

  const target = Math.max(options.min, Math.min(options.max, options.target));
  const picked: typeof eligible = [];
  for (let round = 0; round < options.perEmployer && picked.length < target; round++) {
    for (const [, roles] of employers) {
      if (picked.length >= target) break;
      const already = picked.filter((role) => roles.includes(role));
      if (already.length !== round) continue;
      const next = roles.find((role) => !already.includes(role) && !already.some((other) => other.group === role.group)) ?? roles.find((role) => !already.includes(role));
      if (next) picked.push(next);
    }
  }
  for (const role of eligible) if (!picked.includes(role)) exclude(role, "A well-formed role, but the sample takes a limited number per employer.");

  const limits: string[] = [];
  const employerCount = new Set(picked.map((role) => employerKey(role.employer))).size;
  if (picked.length < options.min) limits.push(`Only ${picked.length} verified roles were available; the target is ${options.min} to ${options.max}.`);
  if (employerCount < options.minEmployers) limits.push(`The sample covers ${employerCount} ${employerCount === 1 ? "employer" : "employers"}; the target is at least ${options.minEmployers}.`);

  return {
    selected: picked.map((role) => ({
      id: `${role.source}:${role.externalId}`,
      source: role.source,
      sourceLabel: role.sourceLabel,
      externalId: role.externalId,
      title: role.title,
      employer: role.employer,
      location: role.location,
      remotePolicy: role.remotePolicy,
      seniority: role.seniority,
      seniorityGroup: role.group,
      url: role.url,
      applyUrl: role.applyUrl,
      description: role.description,
      fullText: true,
      postedAt: role.postedAt,
      updatedAt: role.updatedAt,
      checkedAt: role.checkedAt,
      status: role.status,
      otherLocations: role.otherLocations,
      reasons: reasonsFor(role, role.equivalent, options.established),
      requirements: [],
      extractionError: null,
    })),
    excluded,
    limits,
  };
}

export const previewOf = (role: Role): DiscoveredRole => ({ id: role.id, title: role.title, employer: role.employer, location: role.location, sourceLabel: role.sourceLabel, status: role.status, url: role.url, seniority: role.seniority });
