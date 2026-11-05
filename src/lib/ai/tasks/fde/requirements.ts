import { z } from "zod";

import { yearsAsked } from "@/lib/requirement-evidence";
import { cleanQuote, isGrounded } from "@/lib/fde/grounding";
import { ELIGIBILITY_KINDS, REQUIREMENT_CATEGORIES, REQUIREMENT_KEYS, type EligibilityKind, type Requirement, type RequirementKey } from "@/lib/fde/types";

import { NO_EM_DASHES, postingForPrompt, system, UNTRUSTED_POSTING, type Task } from "../prompt-parts";

// Reads what one posting asks for. Each posting is read alone, so one
// employer's requirement can't end up on another's, and each requirement must
// quote the posting's own words. Quotes that aren't there are dropped in code.

export const FDE_REQUIREMENTS_VERSION = "fde-requirements@1";

const answerSchema = z.object({
  isCustomerFacingEngineering: z.boolean(),
  requirements: z.array(
    z.object({
      text: z.string(),
      excerpt: z.string(),
      level: z.enum(["must", "preferred"]),
      category: z.enum(REQUIREMENT_CATEGORIES),
      key: z.string(),
      eligibility: z.string().nullable(),
    }),
  ),
});

const ELIGIBILITY_OF_KEY: Partial<Record<RequirementKey, EligibilityKind>> = {
  years_experience: "years",
  degree: "degree",
  travel: "travel",
  location: "location",
  work_authorization: "work_authorization",
  clearance: "clearance",
  language: "language",
};

const PREFERRED_WORDS = /\b(nice to have|preferred|a plus|bonus|ideally|desirable|advantageous)\b/i;
const PREFERRED_HEADING = /^(?:.*\b(?:preferred|nice[-\s]to[-\s]haves?|bonus points?|bonus|it'?s a plus)\b.*:?)$/i;
const MUST_HEADING = /^(?:.*\b(?:required|requirements?|minimum|must[-\s]haves?|you have|what you('| wi)ll need|qualifications|about you|what we'?re looking for)\b.*:?)$/i;

/** Whether a posting's own structure marks this excerpt as optional, whatever a model thinks. */
export function isPreferredInPosting(posting: string, excerpt: string): boolean {
  if (PREFERRED_WORDS.test(excerpt)) return true;
  const at = posting.toLowerCase().indexOf(cleanQuote(excerpt).toLowerCase());
  if (at < 0) return false;
  const lines = posting.slice(0, at).split("\n").map((line) => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    if (line.length > 90) continue;
    if (PREFERRED_HEADING.test(line)) return true;
    if (MUST_HEADING.test(line)) return false;
  }
  return false;
}

export type ExtractInput = { roleId: string; title: string; employer: string; description: string };
export type ExtractOutput = { isCustomerFacingEngineering: boolean; requirements: Requirement[]; dropped: number };

/** Keeps what really is in this posting. Exported so the checks can be tested without a model. */
export function checkedRequirements(answer: z.output<typeof answerSchema>, input: ExtractInput): ExtractOutput {
  const seen = new Set<string>();
  const requirements: Requirement[] = [];
  let dropped = 0;
  for (const raw of answer.requirements) {
    const excerpt = cleanQuote(raw.excerpt);
    if (!isGrounded(input.description, excerpt)) {
      dropped++;
      continue;
    }
    const key = raw.key in REQUIREMENT_KEYS ? (raw.key as RequirementKey) : "other";
    const signature = `${key}:${excerpt.toLowerCase()}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    const named = (ELIGIBILITY_KINDS as readonly string[]).includes(raw.eligibility ?? "") ? (raw.eligibility as EligibilityKind) : null;
    const eligibility = ELIGIBILITY_OF_KEY[key] ?? named;
    const stated = /(\d+(?:\.\d+)?)\s*\+?\s*(?:or more\s+)?(?:years?|yrs?)/i.exec(excerpt)?.[1];
    const years = eligibility === "years" ? yearsAsked(excerpt, stated ? Number(stated) : null) : null;
    requirements.push({
      id: `${input.roleId}#${requirements.length + 1}`,
      roleId: input.roleId,
      text: raw.text.trim().slice(0, 240),
      excerpt,
      level: raw.level === "preferred" || isPreferredInPosting(input.description, excerpt) ? "preferred" : "must",
      category: eligibility ? "eligibility" : raw.category === "eligibility" ? "engineering" : raw.category,
      key,
      eligibility,
      years: years && years.min > 0 ? years : null,
    });
  }
  return { isCustomerFacingEngineering: answer.isCustomerFacingEngineering, requirements, dropped };
}

export const extractRequirements: Task<ExtractInput, ExtractOutput> = async (provider, input, { signal }) => {
  const answer = await provider.complete({
    system: system(
      `You read one job posting and list what it asks of a candidate, as JSON.
- isCustomerFacingEngineering: true only if the posting itself describes hands-on engineering together with working directly with customers on deployments. A keyword in the title isn't enough.
- requirements: every distinct thing asked for, up to 25, from this posting only. Never add what such roles usually ask for.
  - text: the requirement in a few plain words.
  - excerpt: the posting's own words for it, copied exactly: no paraphrase, no joining of separate sentences.
  - level: "must" if stated as required, "preferred" if it's optional, a plus or nice to have. If the posting doesn't distinguish, "must".
  - category: one of ${REQUIREMENT_CATEGORIES.join(", ")}.
  - key: the closest of ${Object.keys(REQUIREMENT_KEYS).join(", ")}. Use "other" for anything particular to this employer.
  - eligibility: for a condition rather than a skill, one of ${ELIGIBILITY_KINDS.join(", ")}; otherwise null.
- Responsibilities describing the job count only where they imply a skill the candidate must already have.`,
      UNTRUSTED_POSTING,
      NO_EM_DASHES,
    ),
    messages: [{ role: "user", content: `The role: ${input.title} at ${input.employer}.\n\n${postingForPrompt(input.description)}` }],
    schema: answerSchema,
    schemaName: "fde_requirements",
    creativity: "FAITHFUL",
    effort: "low",
    signal,
  });
  return { data: checkedRequirements(answer, input), promptVersion: FDE_REQUIREMENTS_VERSION };
};
