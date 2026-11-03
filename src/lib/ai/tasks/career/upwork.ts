import { z } from "zod";

import { analysisSchema, screeningSchema, type UpworkAnalysis, type UpworkInputs } from "@/lib/career/upwork-data";
import type { ProfileData } from "@/lib/profile";

import { NO_EM_DASHES, postingForPrompt, profileForPrompt, system, truthfulness, UNTRUSTED_POSTING, type Task } from "../prompt-parts";

// The Upwork analyst (agent 6): judging a pasted job post, then writing the
// proposal and screening answers. Prices and fees are worked out in code
// (src/lib/career/upwork-data.ts); the model only judges and writes.

export const ANALYZE_UPWORK_VERSION = "analyze-upwork@1";
export const WRITE_PROPOSAL_VERSION = "write-proposal@1";

export type AnalyzeInput = {
  jobText: string;
  inputs: UpworkInputs;
  profile: ProfileData;
  /** Freelance preferences, as the user wrote them. */
  preferences: string;
};

const analysisAnswer = z.object({
  summary: z.string(),
  suitability: z.object({ score: z.number(), verdict: z.enum(["pursue", "consider", "skip"]), evidence: z.array(z.string()), gaps: z.array(z.string()) }),
  jobFacts: z.object({
    budgetType: z.enum(["hourly", "fixed", "unknown"]),
    statedBudget: z.string(),
    duration: z.string(),
    experienceLevel: z.string(),
    clientSignals: z.array(z.string()),
  }),
  pricing: z.object({ type: z.enum(["hourly", "fixed"]), low: z.number(), high: z.number(), rationale: z.string(), assumptions: z.array(z.string()) }),
  scope: z.object({
    deliverables: z.array(z.string()),
    effortHoursLow: z.number(),
    effortHoursHigh: z.number(),
    milestones: z.array(z.object({ title: z.string(), deliverable: z.string(), percent: z.number() })),
  }),
  risks: z.array(z.string()),
  missingInfo: z.array(z.string()),
  questionsForClient: z.array(z.string()),
  screeningQuestions: z.array(z.string()),
  boostAdvice: z.string(),
});

const ANALYST_RULES = `You advise a freelancer on whether and how to bid on an Upwork job they pasted, as JSON. Be practical and honest, and use only what the post and their profile show.
- summary: two sentences on what the client wants and whether it's a good use of this freelancer's time.
- suitability: score 0 to 100 for this freelancer; verdict pursue (strong fit, worth the Connects), consider (possible, with caveats) or skip; evidence: specific matches between the post and the profile (name the role, project or skill); gaps: what the post wants that the profile doesn't show.
- jobFacts: only what the pasted text states. budgetType and statedBudget as written ("" when not stated); duration and experienceLevel as written; clientSignals: things the post itself says about the client (e.g. "payment verified", "4.9 stars", "$20K+ spent", "15 hires", "posted 2 hours ago", number of proposals) copied as stated. Never guess anything the text doesn't say: no invented ratings, spend, competition or hire rates.
- pricing: what to bid, in USD. type hourly or fixed (follow the post's budget type; for unknown, choose what suits the scope). low and high: a sensible range for this freelancer given the scope, the post's stated budget, the level asked for, and the freelancer's own floor when given. rationale: why that range. assumptions: everything the range depends on (e.g. "the post's budget is the client's real ceiling", "two rounds of revisions"). Never claim to know winning bids or what others bid.
- scope: deliverables; effortHoursLow and effortHoursHigh for the whole job; milestones for a fixed-price contract (title, deliverable, percent of the total, adding up to 100), or [] for hourly.
- risks: red flags or risks in the post (vague scope, unpaid test work, off-platform contact or payment requests, unrealistic budget or deadline).
- missingInfo: what the freelancer would need to know to price it properly.
- questionsForClient: up to five good questions to ask in the proposal or before accepting.
- screeningQuestions: the screening questions the post asks applicants to answer, copied as written; [] when there are none.
- boostAdvice: one or two sentences on whether boosting this proposal with extra Connects seems worth it, given fit and how competitive the post looks from its own text. Say plainly when there isn't enough information.`;

export const analyzeUpworkJob: Task<AnalyzeInput, { analysis: UpworkAnalysis; usage: { prompt: string; answer: string } }> = async (provider, input, { signal }) => {
  const prompt = [
    `The freelancer's profile:\n${profileForPrompt(input.profile)}`,
    input.preferences.trim() ? `Their freelance preferences:\n${input.preferences.trim()}` : null,
    input.inputs.minimumHourlyUsd !== null ? `Their minimum hourly rate: $${input.inputs.minimumHourlyUsd}.` : null,
    `The Upwork job post they pasted:\n${postingForPrompt(input.jobText)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const answer = await provider.complete({
    system: system(ANALYST_RULES, UNTRUSTED_POSTING, NO_EM_DASHES),
    messages: [{ role: "user", content: prompt }],
    schema: analysisAnswer,
    schemaName: "upwork_analysis",
    creativity: "FAITHFUL",
    effort: "medium",
    signal,
  });
  const analysis = analysisSchema.parse(answer);
  if (analysis.pricing.high < analysis.pricing.low) [analysis.pricing.low, analysis.pricing.high] = [analysis.pricing.high, analysis.pricing.low];
  if (analysis.scope.effortHoursHigh < analysis.scope.effortHoursLow) [analysis.scope.effortHoursLow, analysis.scope.effortHoursHigh] = [analysis.scope.effortHoursHigh, analysis.scope.effortHoursLow];
  return { data: { analysis, usage: { prompt, answer: JSON.stringify(answer) } }, promptVersion: ANALYZE_UPWORK_VERSION };
};

export type ProposalInput = {
  jobText: string;
  analysis: UpworkAnalysis;
  profile: ProfileData;
  /** What the user wants to stress or leave out. */
  instructions: string;
  strict: boolean;
};

const proposalAnswer = z.object({
  proposal: z.string(),
  screening: z.array(z.object({ question: z.string(), answer: z.string() })),
});

export const writeUpworkProposal: Task<ProposalInput, { proposal: string; screening: z.output<typeof screeningSchema>; usage: { prompt: string; answer: string } }> = async (provider, input, { signal, strict }) => {
  const prompt = [
    `The freelancer's profile:\n${profileForPrompt(input.profile)}`,
    `The analysis of the job (pricing, scope, questions for the client):\n${JSON.stringify(
      { pricing: input.analysis.pricing, scope: input.analysis.scope, questionsForClient: input.analysis.questionsForClient, gaps: input.analysis.suitability.gaps },
      null,
      2,
    )}`,
    input.analysis.screeningQuestions.length > 0 ? `Screening questions to answer, in this order:\n${input.analysis.screeningQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}` : "The post has no screening questions.",
    input.instructions.trim() ? `What the freelancer asks for this proposal:\n${input.instructions.trim()}` : null,
    `The Upwork job post:\n${postingForPrompt(input.jobText)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const answer = await provider.complete({
    system: system(
      `You write an Upwork proposal for this freelancer, as JSON.
- proposal: a cover letter for Upwork, about 120 to 220 words. Open with the client's problem in one line (clients see the first two lines in the list), then the most relevant thing this freelancer has done (from the profile, specific), how they'd approach this job (from the scope), and one or two of the questions for the client. Plain, confident, no flattery, no "Dear Hiring Manager", no "I am writing to apply". Don't state a price unless the instructions ask for it.
- screening: an answer to each screening question, in order, in the first person; [] when there are none.`,
      truthfulness(strict ?? input.strict),
      "Where the post asks about experience the profile doesn't show, say honestly what the freelancer has that's closest, never claim it.",
      UNTRUSTED_POSTING,
      NO_EM_DASHES,
    ),
    messages: [{ role: "user", content: prompt }],
    schema: proposalAnswer,
    schemaName: "upwork_proposal",
    creativity: "BALANCED",
    effort: "medium",
    signal,
  });
  return {
    data: { proposal: answer.proposal.trim().slice(0, 5000), screening: screeningSchema.parse(answer.screening), usage: { prompt, answer: JSON.stringify(answer) } },
    promptVersion: WRITE_PROPOSAL_VERSION,
  };
};
