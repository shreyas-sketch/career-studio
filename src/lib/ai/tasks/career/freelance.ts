import { z } from "zod";

import type { ProfileData } from "@/lib/profile";

import { NO_EM_DASHES, postingForPrompt, profileForPrompt, system, UNTRUSTED_POSTING, type Task } from "../prompt-parts";

// The freelance finder's fit check (agent 5): is this opportunity worth the
// user's time, given their skills, rate floor, availability and constraints.

export const SCORE_OPPORTUNITY_VERSION = "score-opportunity@1";

export const fitSchema = z.object({
  score: z.number().transform((value) => Math.min(100, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)))),
  verdict: z.enum(["pursue", "consider", "skip"]),
  reasons: z.array(z.string()).transform((items) => items.map((item) => item.trim().slice(0, 300)).filter(Boolean).slice(0, 4)),
  gaps: z.array(z.string()).transform((items) => items.map((item) => item.trim().slice(0, 300)).filter(Boolean).slice(0, 4)),
  concerns: z.array(z.string()).transform((items) => items.map((item) => item.trim().slice(0, 300)).filter(Boolean).slice(0, 4)),
});
export type OpportunityFit = z.output<typeof fitSchema>;

export type ScoreOpportunityInput = {
  opportunity: { title: string; client: string; description: string; budget: string; kind: string; location: string; source: string };
  profile: ProfileData;
  preferences: string;
};

const answerSchema = z.object({
  score: z.number(),
  verdict: z.enum(["pursue", "consider", "skip"]),
  reasons: z.array(z.string()),
  gaps: z.array(z.string()),
  concerns: z.array(z.string()),
});

export const scoreOpportunity: Task<ScoreOpportunityInput, OpportunityFit> = async (provider, input, { signal }) => {
  const answer = await provider.complete({
    system: system(
      `You judge whether a freelance or contract opportunity is a good use of this freelancer's time, as JSON.
- score 0 to 100: how well it fits their skills and experience, their rate floor and availability, and their constraints (85+ strong fit; 70-84 good; 50-69 possible; below 50 poor).
- verdict: pursue, consider or skip.
- reasons: up to four specific matches between the listing and their profile or preferences.
- gaps: what the listing asks for that their profile doesn't show.
- concerns: practical concerns: pay below their floor or not stated, hours beyond their availability, location or time-zone limits they can't meet, a full-time employee role dressed up as a contract, vague scope, or anything they said they avoid.
Use only what the listing and profile say; never invent the client's budget, reputation or competition.`,
      UNTRUSTED_POSTING,
      NO_EM_DASHES,
    ),
    messages: [
      {
        role: "user",
        content: [
          `Their profile:\n${profileForPrompt(input.profile)}`,
          input.preferences ? `Their freelance preferences:\n${input.preferences}` : "They haven't set freelance preferences.",
          `The listing (from ${input.opportunity.source}):\n${JSON.stringify(
            { title: input.opportunity.title, client: input.opportunity.client, pay: input.opportunity.budget || "not stated", type: input.opportunity.kind, location: input.opportunity.location },
            null,
            2,
          )}`,
          postingForPrompt(input.opportunity.description.slice(0, 8000)),
        ].join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "opportunity_fit",
    creativity: "FAITHFUL",
    effort: "low",
    signal,
  });
  return { data: fitSchema.parse(answer), promptVersion: SCORE_OPPORTUNITY_VERSION };
};
