import type { EducationItem, ProfileData } from "@/lib/profile";

// What can be decided about a requirement from the profile itself, without a
// model: how much experience it really asks for, what a degree counts as, and
// whether a quote a model gave really is in the profile. A model's word alone
// never makes something covered (found in QA, November 2026).

const YEARS = "(?:years?|yrs?)";

/** The experience a requirement asks for: "0-2 years" asks for nothing, "5+ years" for 5. */
export function yearsAsked(text: string, years: number | null): { min: number; max: number | null } {
  const range = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:-|–|—|to)\\s*(\\d+(?:\\.\\d+)?)\\s*\\+?\\s*${YEARS}`, "i").exec(text);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const upTo = new RegExp(`(?:up to|at most|maximum(?: of)?|max\\.?|less than|under|no more than|fewer than)\\s*(\\d+(?:\\.\\d+)?)\\s*${YEARS}`, "i").exec(text);
  if (upTo) return { min: 0, max: Number(upTo[1]) };
  return { min: years ?? 0, max: null };
}

const LEVELS = ["diploma", "associate", "bachelor", "master", "doctorate"] as const;
export type DegreeLevel = (typeof LEVELS)[number];

// Short forms are case-sensitive: "be" and "ma" are words too.
const LEVEL_PATTERNS: [DegreeLevel, RegExp][] = [
  ["doctorate", /\b(?:ph\.?\s?d|d\.?phil|doctorate|doctoral)\b/i],
  ["master", /\b(?:masters?|master['’]s)\s+(?:degree|of|in|or)\b|\bmaster['’]s\b|\b(?:m\.?sc|m\.?tech|m\.?eng|m\.?phil|mba|mca)\b|\b(?:M\.S\.|M\.A\.|MS|MA)\b/i],
  ["bachelor", /\bbachelor(?:['’]?s)?\b|\bundergraduate degree\b|\b(?:b\.?sc|b\.?tech|b\.?eng|b\.?com|bba|bca)\b|\b(?:B\.S\.|B\.A\.|B\.E\.|BS|BA|BE)\b/],
  ["associate", /\bassociate(?:['’]?s)? degree\b|\b(?:A\.A\.|A\.S\.)\s/i],
  ["diploma", /\b(?:diploma|hnd)\b/i],
];

export function degreeLevel(text: string): DegreeLevel | null {
  for (const [level, pattern] of LEVEL_PATTERNS) {
    // The bachelor's short forms are in capitals; its long ones aren't always.
    if (pattern.test(text) || (level === "bachelor" && /\bbachelor|\bb\.?sc\b|\bb\.?tech\b|\bb\.?eng\b/i.test(text))) return level;
  }
  return null;
}

/** Whether a requirement is about a degree: not "Scrum Master" or "master data". */
export function isDegreeRequirement(text: string): boolean {
  return /\b(?:degree|bachelor(?:['’]?s)?|masters?['’]? degree|master['’]s|ph\.?\s?d|doctorate|b\.?sc|m\.?sc|b\.?tech|m\.?tech|mba)\b/i.test(text) && !/\bscrum master\b/i.test(text);
}

const key = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[‘’]/g, "'")
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

const FIELD_NOISE =
  /\b(?:a|an|the|or|and|in|of|with|from|any|relevant|related|similar|equivalent|field|fields|discipline|disciplines|area|areas|required|preferred|degree|bachelor(?:['’]?s)?|masters?|master['’]s|ph\.?\s?d|doctorate|b\.?sc|m\.?sc|b\.?tech|m\.?tech|mba)\b/gi;

/** "Bachelor degree in computer science, data science or related field" → computer science, data science. */
export function degreeFields(text: string): string[] {
  const after = /\b(?:in|of)\b(.*)$/i.exec(text)?.[1] ?? "";
  return after
    .split(/,|\/|\bor\b|\band\b|\(|\)/i)
    .map((part) => part.replace(FIELD_NOISE, " ").replace(/[^\p{L}\p{N}+# -]/gu, " ").replace(/\s+/g, " ").trim().toLowerCase())
    .filter((part) => part.length > 1);
}

const FIELD_ALIASES: Record<string, string[]> = {
  "computer science": ["cs", "computing", "computer engineering"],
  "data science": ["data analytics"],
  "information technology": ["it"],
  engineering: ["b.e", "b.tech", "btech"],
};

export type DegreeCheck =
  | { result: "covered"; entry: EducationItem; note: string }
  | { result: "partial"; entry: EducationItem | null; note: string }
  | { result: "unmet"; entry: EducationItem; note: string }
  | { result: "none"; note: string };

const describe = (entry: EducationItem) => [entry.degree, entry.school].filter(Boolean).join(", ");

function inProgress(entry: EducationItem, today: Date): boolean {
  if (entry.current) return true;
  if (entry.endYear === null) return false;
  return entry.endYear * 12 + (entry.endMonth ?? 6) > today.getFullYear() * 12 + today.getMonth();
}

/** A degree requirement against the profile's education, by level and by field. */
export function checkDegree(text: string, profile: Pick<ProfileData, "education">, today: Date): DegreeCheck {
  const education = profile.education.filter((entry) => entry.degree.trim());
  if (education.length === 0) return { result: "none", note: "Add your education to check this" };

  const wanted = degreeLevel(text);
  const rank = (level: DegreeLevel | null) => (level === null ? -1 : LEVELS.indexOf(level));
  const levelOk = (entry: EducationItem) => wanted === null || rank(degreeLevel(entry.degree)) >= rank(wanted);
  const fields = degreeFields(text);
  const related = /\b(?:related|relevant|similar|equivalent)\b/i.test(text);
  const fieldOk = (entry: EducationItem) => {
    if (fields.length === 0) return true;
    const degree = key(`${entry.degree} ${entry.notes}`);
    return fields.some((field) => {
      const names = [field, ...(FIELD_ALIASES[field] ?? [])];
      return names.some((name) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^\\p{L}\\p{N}])`, "iu").test(degree));
    });
  };

  // A finished degree that fits beats one in progress, which beats a near miss.
  const fits = education.filter((entry) => levelOk(entry) && fieldOk(entry));
  const done = fits.find((entry) => !inProgress(entry, today));
  if (done) return { result: "covered", entry: done, note: describe(done) };
  if (fits[0]) return { result: "partial", entry: fits[0], note: `${describe(fits[0])}, still in progress` };

  const rightLevel = education.find(levelOk);
  if (rightLevel) {
    return {
      result: "partial",
      entry: rightLevel,
      note: related ? `${describe(rightLevel)}: check whether this counts as a related field` : `${describe(rightLevel)}: a different field from the one asked for`,
    };
  }
  const levels = education.map((entry) => degreeLevel(entry.degree));
  if (levels.some((level) => level === null)) {
    const unknown = education[levels.indexOf(null)];
    return { result: "partial", entry: unknown, note: `${describe(unknown)}: check whether this meets it` };
  }
  const highest = education.reduce((best, entry) => (rank(degreeLevel(entry.degree)) > rank(degreeLevel(best.degree)) ? entry : best));
  // "Or equivalent experience" keeps it open: the profile can't settle that alone.
  if (/\bequivalent\b/i.test(text)) return { result: "partial", entry: highest, note: `${describe(highest)}: the posting also accepts equivalent experience` };
  return { result: "unmet", entry: highest, note: `${describe(highest)}: the posting asks for a higher level` };
}

/** One part of the profile a model can quote from. */
export type EvidenceSource = { id: string; kind: "experience" | "project" | "education" | "summary" | "fact"; label: string; text: string };

/** Everything in the profile a requirement could be backed by, with the ids a model's answer points at. */
export function evidenceSources(profile: ProfileData): EvidenceSource[] {
  const sources: EvidenceSource[] = [];
  if (profile.basics.summary.trim()) sources.push({ id: "summary", kind: "summary", label: "your summary", text: profile.basics.summary });
  for (const entry of profile.experience) {
    sources.push({ id: entry.id, kind: "experience", label: entry.company || entry.role, text: [entry.role, entry.descriptor, entry.bullets].filter(Boolean).join("\n") });
  }
  for (const entry of profile.projects) sources.push({ id: entry.id, kind: "project", label: entry.name, text: entry.bullets });
  for (const entry of profile.education) sources.push({ id: entry.id, kind: "education", label: entry.school || entry.degree, text: [entry.degree, entry.notes].filter(Boolean).join("\n") });
  for (const fact of profile.facts) if (fact.text.trim()) sources.push({ id: fact.id, kind: "fact", label: "your facts", text: fact.text });
  return sources.filter((source) => source.text.trim());
}

/** A quote that really is in that source; a model can't back a match with words it made up. */
export function verifiedQuote(sources: EvidenceSource[], id: string, quote: string): EvidenceSource | null {
  const wanted = key(quote);
  if (wanted.length < 8) return null;
  const source = sources.find((entry) => entry.id === id);
  return source && key(source.text).includes(wanted) ? source : null;
}

/** A skill named outright in a role's or project's text, e.g. "Built the pipeline in FastAPI". */
export function sourcesNaming(sources: EvidenceSource[], skill: string): EvidenceSource[] {
  const name = key(skill).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (name.length < 2) return [];
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}+#])${name}(?:$|[^\\p{L}\\p{N}+#])`, "iu");
  return sources.filter((source) => (source.kind === "experience" || source.kind === "project") && pattern.test(key(source.text)));
}

// First-person admissions of a weakness, in English. A person can say this
// about themselves; a model filling a gap can't say it for them.
const ADMISSIONS: RegExp[] = [
  /\b(?:area|skill|something|thing)s?\b[^.!?\n]{0,40}\bI(?:['’]m| am| have been|['’]ve been)?\s+(?:still\s+|currently\s+)?(?:building|developing|learning|working on|improving|growing|strengthening)\b/i,
  /\bI(?:['’]m| am)\s+still\s+(?:building|developing|learning|working on|improving|growing|strengthening|new to)\b/i,
  /\bI(?:['’]m| am)\s+(?:new to|not yet|less experienced|inexperienced|not an expert|not as)\b/i,
  /\bI\s+(?:do not|don['’]t|did not|didn['’]t|may not|might not)\s+(?:yet\s+|currently\s+)?(?:have|bring|meet|hold|possess)\b/i,
  /\bI\s+(?:lack|haven['’]t|have not|have yet to)\b/i,
  /\bI\s+have\s+(?:limited|little|no|less|minimal)\b/i,
  /\bmy\s+(?:lack|limited|weakness|weakest|gap|gaps|inexperience)\b/i,
  /\bwhile\s+I\s+(?:do not|don['’]t|may not|haven['’]t|have not|lack)\b/i,
];

/** The sentence in `text` that admits a weakness, if any. */
const SENTENCE = /[^.!?\n]+[.!?]*["”’)]*(?:\s+|$)|\n+/g;
export const admitsWeakness = (text: string) => ADMISSIONS.some((pattern) => pattern.test(text));

/**
 * Takes out any first-person weakness the candidate didn't state themselves.
 * Their own facts can say it; the profile leaving something out can't.
 */
export function withoutInventedWeakness(text: string, ownWords: string[] = []): string {
  if (!admitsWeakness(text) || ownWords.some(admitsWeakness)) return text;
  return (text.match(SENTENCE) ?? [text])
    .filter((sentence) => !admitsWeakness(sentence))
    .join("")
    .replace(/[ \t]+$/gm, "")
    .trim();
}
