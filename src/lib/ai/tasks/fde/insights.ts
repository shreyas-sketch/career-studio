import { z } from "zod";

import { factSources, unverifiedFacts } from "@/lib/ai/fact-guard";
import { isGrounded } from "@/lib/fde/grounding";
import type { ProfileSource } from "@/lib/fde/subject";
import type { EvidenceGap, FdeInsights, Rewrite, Strength } from "@/lib/fde/types";

import { NO_EM_DASHES, NO_INVENTED_WEAKNESS, system, type Task } from "../prompt-parts";

import { UNTRUSTED_PROFILE } from "./evidence";

// Suggested wording for the profile. A suggestion may reword and reorder what's
// there. If it adds a number or a name the profile doesn't have, it's withheld;
// a placeholder like [metric] is how it asks the person for one.

export const FDE_INSIGHTS_VERSION = "fde-insights@1";

const answerSchema = z.object({
  summary: z.string(),
  rewrites: z.array(z.object({ target: z.string(), original: z.string(), suggested: z.string(), why: z.string() })),
  questions: z.array(z.string()),
  portfolio: z.array(z.object({ title: z.string(), brief: z.string(), proves: z.array(z.string()) })),
});
type Answer = z.output<typeof answerSchema>;

export type InsightsInput = {
  name: string;
  sources: ProfileSource[];
  gaps: EvidenceGap[];
  strengths: Strength[];
  recurring: { label: string; count: number; analyzed: number }[];
  score: number | null;
  provisional: boolean;
  /** Identifies the prompt and model in what's saved. */
  writtenWith: string;
};

const withoutPlaceholders = (text: string) => text.replace(/\[[^\]]{1,40}\]/g, " ");

/** Exported so the checks can be tested without a model. */
export function checkedInsights(answer: Answer, input: InsightsInput): FdeInsights {
  const allowed = factSources([input.name, ...input.sources.map((source) => source.text), ...input.gaps.map((gap) => gap.label), ...input.recurring.map((row) => row.label), "Forward Deployed Engineer FDE"]);
  let withheld = 0;
  const rewrites: Rewrite[] = [];
  for (const raw of answer.rewrites) {
    const original = raw.original.trim();
    const suggested = raw.suggested.trim();
    const anchored = !original || input.sources.some((source) => isGrounded(source.text, original));
    if (!suggested || !anchored || unverifiedFacts(withoutPlaceholders(suggested), allowed).length > 0) {
      withheld++;
      continue;
    }
    rewrites.push({ target: raw.target.trim().slice(0, 80), original, suggested: suggested.slice(0, 3000), why: raw.why.trim().slice(0, 300) });
  }
  const summary = answer.summary.trim();
  return {
    summary: unverifiedFacts(summary, factSources([...input.sources.map((source) => source.text), ...input.recurring.map((row) => row.label), String(input.score ?? ""), "Forward Deployed FDE"])).length === 0 ? summary.slice(0, 900) : "",
    rewrites: rewrites.slice(0, 8),
    rewritesWithheld: withheld,
    questions: answer.questions.map((question) => question.trim().slice(0, 240)).filter(Boolean).slice(0, 8),
    portfolio: answer.portfolio.slice(0, 3).map((idea) => ({ title: idea.title.trim().slice(0, 120), brief: idea.brief.trim().slice(0, 500), proves: idea.proves.map((item) => item.trim().slice(0, 80)).slice(0, 5) })),
    writtenWith: input.writtenWith,
  };
}

export const writeInsights: Task<InsightsInput, FdeInsights> = async (provider, input, { signal }) => {
  const answer = await provider.complete({
    system: system(
      `You help someone present real experience for forward deployed engineering roles, as JSON. You're writing for the person reviewing this profile.
- summary: three sentences at most on where this profile stands against the sampled roles. It describes evidence against this sample, never a hiring chance or anyone's worth.
- rewrites: edits to the headline, the About section and specific experience entries.
  - target: "Headline", "About" or the entry's label.
  - original: the exact words being replaced, copied from the source; empty only for a brand-new line.
  - suggested: the new wording. Keep every fact, date, metric and scope as written. Never add a number, employer, tool or result that isn't there. Where a number would help but isn't known, write a placeholder like [metric] or [team size].
  - why: which sampled requirement it speaks to.
- questions: what to ask the person to fill those placeholders or to surface work the profile doesn't show.
- portfolio: up to three small, future projects that would make a gap visible. These are things to do, never something they've done.`,
      NO_INVENTED_WEAKNESS,
      UNTRUSTED_PROFILE,
      NO_EM_DASHES,
    ),
    messages: [
      {
        role: "user",
        content: [
          `Whose profile: ${input.name || "not stated"}.`,
          `Market-readiness score on this sample: ${input.score ?? "withheld"}${input.provisional ? " (provisional)" : ""}.`,
          `Recurring requirements:\n${JSON.stringify(input.recurring.slice(0, 14))}`,
          `Shown in the profile:\n${JSON.stringify(input.strengths.map(({ label, roleCount, quote }) => ({ label, roleCount, quote })))}`,
          `Not shown, or shown in part:\n${JSON.stringify(input.gaps.map(({ label, roleCount, mustCount }) => ({ label, roleCount, mustCount })))}`,
          `The profile's sources:\n${JSON.stringify(input.sources.map(({ label, text }) => ({ label, text: text.slice(0, 5000) })), null, 1)}`,
        ].join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "fde_insights",
    creativity: "BALANCED",
    effort: "medium",
    signal,
  });
  return { data: checkedInsights(answer, input), promptVersion: FDE_INSIGHTS_VERSION };
};
