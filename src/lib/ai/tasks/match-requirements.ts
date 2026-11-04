import { z } from "zod";

import { matchSchema, NOT_SHOWN_NOTE, type Extracted, type Match } from "@/lib/application-data";
import { experienceMonths, formatMonthYear, languageLevelLabel, sameName, type ProfileData } from "@/lib/profile";
import { checkDegree, evidenceSources, isDegreeRequirement, sourcesNaming, verifiedQuote, yearsAsked, type EvidenceSource } from "@/lib/requirement-evidence";

import { system, UNTRUSTED_POSTING, type Task } from "./prompt-parts";

export const MATCH_REQUIREMENTS_VERSION = "match-requirements@2";

// The model says which profile skill or language each requirement is about and
// quotes what in the profile backs it; code decides covered, partial or gap from
// the profile itself and checks every quote is really there, so the match is
// explainable and a model can't talk a requirement into being met (NEW-4, E7-4).
const answerSchema = z.object({
  matches: z.array(
    z.object({
      /** The requirement's number in the list. */
      requirement: z.number().int(),
      /** A skill from the profile's list, spelled as there, or null. */
      skill: z.string().nullable(),
      /** A language from the profile's list, or null. */
      language: z.string().nullable(),
      /** How well the quotes show it: "direct", "partial", or "none". */
      strength: z.enum(["direct", "partial", "none"]).nullable().default(null),
      /** Word-for-word lines from the candidate's text. */
      evidence: z.array(z.object({ source: z.string(), quote: z.string() })).nullable().default(null),
    }),
  ),
});

const INSTRUCTIONS = `You compare a job's requirements with a candidate's skills and languages.

For each numbered requirement, answer which ONE of the candidate's skills it is about, if any, and which of the candidate's languages, if any. Copy names exactly as they appear in the candidate's lists. Match on meaning ("Strong prototyping skills in Figma" is about "Figma"; "Has built or maintained a design system" is about "Design systems"), but don't stretch: when no skill really fits, answer null. Answer every requirement once.

Also say what in the candidate's text shows the requirement, for abilities a skill name doesn't cover, such as "client communication" or "domain experience". In evidence, give up to two quotes copied word for word from candidateText, each with the id of the entry it comes from as source; never reword a quote, and never quote the requirement. Set strength to "direct" when the quotes clearly show the candidate doing what's asked ("Ran discovery calls with clients and trained their staff" shows client communication), "partial" when they're related but don't fully show it, and "none" with no evidence when nothing does. Nothing being there means the text doesn't say; don't assume the candidate can't.`;

export type MatchInput = { requirements: Extracted["requirements"]; profile: ProfileData; today?: Date };

/** NEW-4: each requirement covered, partial or a gap, with its evidence. */
export const matchRequirements: Task<MatchInput, Match> = async (provider, { requirements, profile, today = new Date() }, { signal }) => {
  const sources = evidenceSources(profile);
  const needsModel = requirements.some((requirement) => requirement.kind !== "years" && requirement.kind !== "education" && !isDegreeRequirement(requirement.text));
  const answer = needsModel
    ? await provider.complete({
        system: system(INSTRUCTIONS, UNTRUSTED_POSTING),
        messages: [
          {
            role: "user",
            content: JSON.stringify(
              {
                requirements: requirements.map((requirement, index) => ({ number: index, text: requirement.text, kind: requirement.kind, skill: requirement.skill })),
                candidateSkills: profile.skills.map((skill) => skill.name),
                candidateLanguages: profile.languages.map((language) => language.name),
                candidateText: sources.map(({ id, kind, text }) => ({ id, kind, text })),
              },
              null,
              2,
            ),
          },
        ],
        schema: answerSchema,
        schemaName: "requirement_matches",
        creativity: "FAITHFUL",
        effort: "low",
        signal,
      })
    : { matches: [] };

  const mapped = new Map(answer.matches.map((match) => [match.requirement, match]));
  return {
    data: matchSchema.parse({
      items: requirements.map((requirement, index) => classify(requirement, mapped.get(index), profile, sources, today)),
    }),
    promptVersion: MATCH_REQUIREMENTS_VERSION,
  };
};

type Item = Match["items"][number];

type Mapped = z.infer<typeof answerSchema>["matches"][number];

const ago = (months: number) => {
  if (months < 12) return `about ${months} ${months === 1 ? "month" : "months"}`;
  const years = Math.floor(months / 12);
  return `about ${years} ${years === 1 ? "year" : "years"}`;
};

function classify(requirement: Extracted["requirements"][number], mapped: Mapped | undefined, profile: ProfileData, sources: EvidenceSource[], today: Date): Item {
  const base = { requirement: requirement.text, skill: null, experienceIds: [] as string[], note: null };

  if (requirement.kind === "years") {
    const { min, max } = yearsAsked(requirement.text, requirement.years);
    const dated = profile.experience.filter((entry) => entry.startYear !== null);
    if (dated.length === 0) {
      // "0-2 years" asks for nothing: having no roles yet fits it.
      return min === 0 ? { ...base, result: "covered", note: "This asks for no minimum experience" } : { ...base, result: "gap", basis: "not-shown", note: "Add your experience to check this" };
    }
    const first = dated.reduce(
      (earliest, entry) => (entry.startYear! * 12 + (entry.startMonth ?? 1) < earliest.startYear! * 12 + (earliest.startMonth ?? 1) ? entry : earliest),
      dated[0],
    );
    const count = profile.experience.length;
    const roles = `${count} ${count === 1 ? "role" : "roles"} in your profile, since ${formatMonthYear(first.startYear, first.startMonth)}`;
    // Overlapping roles count once: experienceMonths adds up calendar months.
    const months = experienceMonths(profile, today);
    if (months >= min * 12) {
      return { ...base, result: "covered", note: max !== null && months > max * 12 ? `${roles} (${ago(months)}, more than the ${max} asked for)` : `${roles} (${ago(months)})` };
    }
    // A role without dates could make up the difference, so it isn't settled.
    return dated.length < count
      ? { ...base, result: "partial", note: `${roles} (${ago(months)}, and some roles have no dates)` }
      : { ...base, result: "gap", basis: "unmet", note: `${roles} (${ago(months)}; this asks for ${min})` };
  }

  if (requirement.kind === "education" || isDegreeRequirement(requirement.text)) {
    const degree = checkDegree(requirement.text, profile, today);
    if (degree.result === "none") return { ...base, result: "gap", basis: "not-shown", note: degree.note };
    if (degree.result === "unmet") return { ...base, result: "gap", basis: "unmet", note: degree.note };
    return { ...base, result: degree.result, note: degree.note };
  }

  // Names must be the profile's own: a model can't add a skill by misspelling one.
  const language = profile.languages.find(
    (entry) => (mapped?.language && sameName(entry.name, mapped.language)) || (requirement.language && sameName(entry.name, requirement.language)),
  );
  if (requirement.kind === "language" || (language && !mapped?.skill)) {
    return language
      ? { ...base, result: "covered", skill: language.name, note: `${language.name}: ${languageLevelLabel(language.level)}` }
      : { ...base, result: "gap", basis: "not-shown", note: "Not in your profile" };
  }

  const quotes = (mapped?.evidence ?? []).flatMap(({ source, quote }) => {
    const found = verifiedQuote(sources, source, quote);
    return found ? [{ found, quote: quote.trim() }] : [];
  });
  const evidence = quotes.map(({ found, quote }) => ({ source: found.label, quote }));
  const shownAt = (entries: EvidenceSource[]) => [...new Set(entries.map((entry) => entry.label))].join(", ");

  // The model's pick first, then the skill the posting names; spelling may differ a little.
  const skill =
    profile.skills.find((entry) => mapped?.skill && sameSkill(entry.name, mapped.skill)) ??
    profile.skills.find((entry) => requirement.skill && sameSkill(entry.name, requirement.skill));
  if (skill) {
    const tagged = profile.experience.filter((entry) => entry.skillIds.includes(skill.id));
    if (tagged.length > 0) {
      return {
        ...base,
        result: "covered",
        skill: skill.name,
        experienceIds: tagged.map((entry) => entry.id),
        note: `Used at ${[...new Set(tagged.map((entry) => entry.company || entry.role))].join(", ")}`,
        ...(evidence.length > 0 ? { evidence } : {}),
      };
    }
    // Not tagged, but written down: the role's own words show it was used.
    const named = sourcesNaming(sources, skill.name);
    const shown = [...new Set([...named, ...(mapped?.strength === "direct" ? quotes.map(({ found }) => found) : [])])].filter((source) => source.kind === "experience" || source.kind === "project");
    if (shown.length > 0) {
      return {
        ...base,
        result: "covered",
        skill: skill.name,
        experienceIds: shown.filter((source) => source.kind === "experience").map((source) => source.id),
        note: `Used at ${shownAt(shown)}`,
        ...(evidence.length > 0 ? { evidence } : {}),
      };
    }
    return { ...base, result: "partial", skill: skill.name, note: "In your skills, but not linked to a role yet" };
  }

  if (quotes.length > 0 && mapped?.strength !== "none") {
    const entries = quotes.map(({ found }) => found);
    const experienceIds = entries.filter((entry) => entry.kind === "experience").map((entry) => entry.id);
    return mapped?.strength === "direct"
      ? { ...base, result: "covered", experienceIds, note: `Shown at ${shownAt(entries)}`, evidence }
      : { ...base, result: "partial", experienceIds, note: `Closest in your profile: ${shownAt(entries)}`, evidence };
  }
  return { ...base, result: "gap", basis: "not-shown", note: requirement.kind === "skill" ? "Not in your profile yet" : NOT_SHOWN_NOTE };
}

/**
 * Whether two skill names mean the same skill, forgiving case, punctuation
 * and a plural: "Design system" is "Design systems", "UX-research" is "UX research".
 */
export function sameSkill(a: string, b: string): boolean {
  const key = (name: string) =>
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(" ")
      .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word))
      .join(" ");
  return key(a) === key(b);
}
