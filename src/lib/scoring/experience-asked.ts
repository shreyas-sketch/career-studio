import type { PostingFit } from "@/lib/fit";
import { experienceMonths, type ProfileData } from "@/lib/profile";

// How many years a posting asks for, read in code, so a score can't overlook
// it and no reason can say there's no requirement when there is one. A
// source's listing states it on a line of its own ("Experience asked: ...").

export type ExperienceAsked = { min: number; max: number | null };

const LISTED = /^experience asked:/i;
const YEARS = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|—|to)\s*(\d{1,2})\s*\+?\s*)?(?:years?|yrs?)\b/i;
const ABOUT_THE_JOB = /\b(?:experience|exp|background|track record|at least|minimum|min\.)\b/i;
/** "We have 20 years of experience", and what's only welcome. */
const NOT_ASKED = /\b(?:we have|we've|our|founded|since|ago|preferred|nice to have|bonus|ideally|a plus)\b/i;

function askedOn(line: string): ExperienceAsked | null {
  const found = YEARS.exec(line);
  if (!found) return null;
  return { min: Number(found[1]), max: found[2] ? Number(found[2]) : null };
}

/**
 * What the text asks for. A source's listing wins; otherwise the least any
 * line asks, since several usually mean one skill's years on top of the
 * job's, and a cap taken from the wrong one would be unfair. The model still
 * reads the whole text.
 */
export function experienceAsked(text: string): ExperienceAsked | null {
  const lines = text.split(/\n|(?<=[.;])\s+/).map((line) => line.trim());
  const listed = lines.find((line) => LISTED.test(line));
  if (listed) {
    const asked = askedOn(listed);
    if (asked) return asked;
  }
  const asked = lines.filter((line) => ABOUT_THE_JOB.test(line) && !NOT_ASKED.test(line)).flatMap((line) => askedOn(line) ?? []);
  return asked.length > 0 ? asked.reduce((least, next) => (next.min < least.min ? next : least)) : null;
}

const yearsWord = (years: number) => (years === 1 ? "1 year" : `${years} years`);

/** As the model and the screen read it. */
export function describeAsked(asked: ExperienceAsked | null): string {
  if (!asked) return "not stated in the text this source sent; the job's own page may say more";
  return asked.max !== null ? `${asked.min}–${asked.max} years` : `at least ${yearsWord(asked.min)}`;
}

/** A reason saying the job asks for no particular experience, in any of the usual words. */
const CLAIMS_NONE =
  /\b(?:no|without(?: a| any)?|doesn'?t (?:state|give|list|specify|mention)(?: a| any)?|does not (?:state|give|list|specify|mention)(?: a| any)?|gives no|states no|lists no)\s+(?:specific\s+|stated\s+|explicit\s+|minimum\s+)*(?:years?|experience)\b/i;

/** Past these shortfalls the fit bands in score-posting's prompt say "possible at best", then "poor". */
const SHORT_BY_YEARS = 1;
const FAR_SHORT_BY_YEARS = 3;
const POSSIBLE_AT_BEST = 69;
const POOR = 49;

/**
 * A score held to what's known about the years asked. Someone a year or more
 * short can't be a good fit whatever the model or Jev made of the rest, and
 * the flag says so with the numbers. Reasons claiming there's no requirement
 * go when there is one, and say what's really known when there isn't.
 */
export function withExperienceChecked(fit: PostingFit, asked: ExperienceAsked | null, profile: Pick<ProfileData, "experience">, today = new Date()): PostingFit {
  if (!asked) {
    const reasons = fit.reasons.map((reason) => (CLAIMS_NONE.test(reason) ? "The text this source sent doesn't state the years asked for; the job's own page may." : reason));
    return { ...fit, reasons };
  }
  const reasons = fit.reasons.filter((reason) => !CLAIMS_NONE.test(reason));
  const months = experienceMonths(profile, today);
  const shortBy = asked.min - months / 12;
  if (shortBy < SHORT_BY_YEARS) return { ...fit, reasons: reasons.length > 0 ? reasons : fit.reasons };

  const have = months < 12 ? `${months} ${months === 1 ? "month" : "months"}` : `about ${yearsWord(Math.floor(months / 12))}`;
  const flag = `It asks for ${describeAsked(asked)}; your profile shows ${have}.`;
  return {
    score: Math.min(fit.score, shortBy >= FAR_SHORT_BY_YEARS ? POOR : POSSIBLE_AT_BEST),
    reasons: reasons.length > 0 ? reasons : [flag],
    redFlags: [flag, ...fit.redFlags].slice(0, 3),
  };
}
