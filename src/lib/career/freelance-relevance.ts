import type { ProfileData } from "@/lib/profile";

// How relevant a listing is to what someone searches for, in code and shown
// to them (QA 4 Nov 2026): whole words only, since "ai" inside "training" or
// "email" once let a counselling listing through, and a passing mention in
// the text doesn't make a match.

export type Relevance = {
  /** strong: named in its title or tags. possible: several keywords in its text. low: one, in passing. none: not at all. */
  tier: "strong" | "possible" | "low" | "none";
  matched: string[];
  why: string;
};

export const TIER_ORDER: Record<Relevance["tier"], number> = { strong: 0, possible: 1, low: 2, none: 3 };

/** Words in a job title that say nothing about the work. */
const GENERIC_WORDS = new Set(
  "engineer engineering developer development lead senior junior staff principal manager specialist consultant analyst intern associate expert remote freelance freelancer contract contractor part time full stack software professional and with for the".split(" "),
);

/** What nearly every listing asks for, so it can't say a listing is relevant. */
const SOFT_SKILLS = /^(?:(?:verbal |written |client |clear |strong )?communication(?: skills)?|leadership|team ?work|collaboration|problem[- ]solving|time management|adaptability|critical thinking|attention to detail|english|hindi|presentation(?: skills)?|interpersonal(?: skills)?|mentoring)$/i;

export const isSoftSkill = (name: string) => SOFT_SKILLS.test(name.trim());

const escaped = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A whole word or phrase: "ai" not in "training", "c++" and "node.js" as written. */
function pattern(term: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}+#])${escaped(term).replace(/\s+/g, "[\\s-]+")}(?![\\p{L}\\p{N}+#])`, "iu");
}

/** A keyword, and the words in it that mean something alone: "Automation Engineer" also finds "automation". */
function termsOf(keyword: string): string[] {
  const phrase = keyword.trim();
  const words = phrase.split(/\s+/);
  if (words.length === 1) return [phrase];
  return [phrase, ...words.filter((word) => word.length >= 2 && !GENERIC_WORDS.has(word.toLowerCase()))];
}

const list = (words: string[]) => words.slice(0, 4).join(", ");

/** How relevant a listing is to these keywords, and why, in words for the screen. */
export function relevanceOf(item: { title: string; tags: string[]; description: string }, keywords: string[]): Relevance {
  const wanted = keywords.map((keyword) => keyword.trim()).filter((keyword) => keyword.length >= 2);
  if (wanted.length === 0) return { tier: "possible", matched: [], why: "No keywords to compare it with yet: add some to what you're looking for." };

  const found = (text: string) => wanted.filter((keyword) => termsOf(keyword).some((term) => pattern(term).test(text)));
  const inTitle = found(item.title);
  const inTags = found(item.tags.join(" · "));
  const inText = found(item.description);
  const matched = [...new Set([...inTitle, ...inTags, ...inText])];

  if (inTitle.length > 0) return { tier: "strong", matched, why: `Matches ${list(inTitle)} in its title.` };
  if (inTags.length > 0) return { tier: "strong", matched, why: `Matches ${list(inTags)} in its tags.` };
  if (inText.length >= 2) return { tier: "possible", matched, why: `Mentions ${list(inText)} in its description.` };
  if (inText.length === 1) return { tier: "low", matched, why: `Only mentions ${list(inText)}, in its description.` };
  return { tier: "none", matched, why: "Doesn't mention your keywords." };
}

const LANGUAGE = /\b(?:english|spanish|french|german|hindi|marathi|mandarin|chinese|japanese|korean|arabic|portuguese|russian|italian|dutch)\b/gi;
const LANGUAGE_SKILL = /\b(?:proficien\w*|fluen\w*|native|bilingual|speaks?|speaking|language skills?|language ability)\b/i;
const LEVEL = /\b(?:senior|seniority|principal|expert|expertise|lead-level|staff-level)\b/i;
const AVAILABILITY = /\b(?:availability|available|hours a week|hours per week)\b/i;
const RATE = /\b(?:rate|rates|hourly|pay|budget)\b.*\b(?:matches|meets|fits|above|within|aligns?)\b|\b(?:matches|meets|fits|above|within|aligns?)\b.*\b(?:rate|rates|hourly|pay|budget)\b/i;

/**
 * A fit without claims nobody can back: "why it fits" lines naming a language
 * the profile doesn't list, a level it doesn't state, or availability or a
 * rate they never gave. A model can write those however it's told; this is
 * the check. Gaps and concerns stay, since "it asks for German" is true.
 */
export function withoutUnbackedClaims<Fit extends { reasons: string[] }>(
  fit: Fit,
  profile: Pick<ProfileData, "languages" | "experience" | "basics">,
  prefs: { minimumHourlyUsd: number | null; hoursPerWeek: number | null },
): Fit {
  const spoken = profile.languages.map((language) => language.name.toLowerCase());
  const titles = [profile.basics.headline, ...profile.experience.map((entry) => entry.role)].join(" ");
  const backed = (reason: string) => {
    const languages = reason.match(LANGUAGE)?.map((name) => name.toLowerCase());
    if (languages ? !languages.every((name) => spoken.some((own) => own.includes(name))) : LANGUAGE_SKILL.test(reason)) return false;
    if (LEVEL.test(reason) && !LEVEL.test(titles)) return false;
    if (AVAILABILITY.test(reason) && prefs.hoursPerWeek === null) return false;
    if (RATE.test(reason) && prefs.minimumHourlyUsd === null) return false;
    return true;
  };
  return { ...fit, reasons: fit.reasons.filter(backed) };
}
