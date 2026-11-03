import { z } from "zod";

// The Upwork analyst's numbers (agent 6). The model judges the job; the
// money is worked out here, in code, from what the user entered and from
// Upwork's published prices, so every figure can be traced to an input.

/**
 * Upwork's published figures that the analyst uses as defaults. Each one is
 * shown with its source and when it was checked, and the user can change it
 * for their own account (prices change, and the service fee varies by
 * contract: Upwork shows the exact rate on the proposal screen).
 */
export const UPWORK_REFERENCE = {
  checkedOn: "2026-11-03",
  connectPriceUsd: {
    value: 0.15,
    note: "Connects cost $0.15 each, bought in bundles (minimum 10).",
    source: "https://www.upwork.com/resources/is-upwork-free",
  },
  serviceFee: {
    range: [0, 15] as const,
    note: "Upwork's freelancer service fee on standard contracts ranges from 0% to 15% depending on the contract; the exact rate shows on the proposal or offer screen and is fixed for that contract.",
    source: "https://www.upwork.com/resources/is-upwork-free",
  },
  connectsPerProposal: {
    note: "The number of Connects needed varies by job post (some need none). Upwork shows it on the job post.",
    source: "https://www.upwork.com/resources/maximizing-your-upwork-connects",
  },
  boost: {
    note: "Boosting is optional: you bid extra Connects to show your proposal near the top. Upwork runs it as an auction.",
    source: "https://www.upwork.com/resources/maximizing-your-upwork-connects",
  },
  freelancerPlus: {
    note: "Freelancer Plus costs $19.99 per month and includes 100 Connects per month.",
    source: "https://www.upwork.com/resources/is-upwork-free",
  },
} as const;

/** What the user enters from Upwork. Null means they didn't (it's then left out of the sums, and said so). */
export const inputsSchema = z.object({
  /** Connects the job post asks for. */
  connectsRequired: z.number().int().min(0).max(500).nullable(),
  /** Extra Connects they'd bid to boost; 0 for none. */
  boostConnects: z.number().int().min(0).max(2000).default(0),
  /** Price per Connect in USD; Upwork's published price by default. */
  connectPriceUsd: z.number().min(0).max(10).default(UPWORK_REFERENCE.connectPriceUsd.value),
  /** The freelancer service fee shown for this contract, in percent; null until they enter it. */
  serviceFeePercent: z.number().min(0).max(50).nullable(),
  /** Their own floor, from freelance preferences or entered here. */
  minimumHourlyUsd: z.number().min(0).max(2000).nullable(),
  /** Connects they have now, to warn when the proposal needs more. */
  connectsBalance: z.number().int().min(0).max(100_000).nullable(),
});
export type UpworkInputs = z.output<typeof inputsSchema>;

const text = (max: number) => z.string().transform((value) => value.trim().slice(0, max));
const lines = (max: number, length = 400) =>
  z.array(z.string()).transform((items) => items.map((item) => item.trim().slice(0, length)).filter(Boolean).slice(0, max));
const money = z.number().transform((value) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0));
const list = <T extends z.ZodType>(item: T, max: number) => z.array(item).transform((items) => items.slice(0, max));

/** The model's analysis, as stored. */
export const analysisSchema = z.object({
  summary: text(600),
  suitability: z.object({
    score: z.number().transform((value) => Math.min(100, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)))),
    verdict: z.enum(["pursue", "consider", "skip"]),
    evidence: lines(5),
    gaps: lines(5),
  }),
  /** Facts the pasted post states; nothing inferred about the client's account. */
  jobFacts: z.object({
    budgetType: z.enum(["hourly", "fixed", "unknown"]),
    statedBudget: text(200),
    duration: text(200),
    experienceLevel: text(100),
    clientSignals: lines(6, 200),
  }),
  pricing: z.object({
    type: z.enum(["hourly", "fixed"]),
    low: money,
    high: money,
    rationale: text(800),
    assumptions: lines(6),
  }),
  scope: z.object({
    deliverables: lines(8),
    effortHoursLow: money,
    effortHoursHigh: money,
    milestones: list(z.object({ title: text(120), deliverable: text(300), percent: money }), 6),
  }),
  risks: lines(6),
  missingInfo: lines(6),
  questionsForClient: lines(6),
  screeningQuestions: lines(6, 500),
  boostAdvice: text(500),
});
export type UpworkAnalysis = z.output<typeof analysisSchema>;

export const screeningSchema = z.array(z.object({ question: text(500), answer: text(2000) })).transform((items) => items.slice(0, 8));

export type Economics = {
  /** What one bid at this price brings in, before and after the fee. */
  bids: { label: string; gross: number; fee: number | null; net: number | null }[];
  connects: { required: number | null; boost: number; total: number | null; costUsd: number | null; shortBy: number | null };
  /** Effective hourly rate after fees, for the fixed-price range against the effort estimate. */
  effectiveHourly: { low: number | null; high: number | null };
  /** Plain statements of what was assumed or left out. */
  notes: string[];
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * The money side of a bid. Hourly bids are shown per hour and for the
 * effort estimate; fixed bids for the whole contract. The service fee comes
 * only from the user's entry: with none, take-home isn't guessed.
 */
export function economics(analysis: Pick<UpworkAnalysis, "pricing" | "scope">, inputs: UpworkInputs): Economics {
  const { pricing, scope } = analysis;
  const feeRate = inputs.serviceFeePercent === null ? null : inputs.serviceFeePercent / 100;
  const net = (gross: number) => (feeRate === null ? null : round2(gross * (1 - feeRate)));
  const fee = (gross: number) => (feeRate === null ? null : round2(gross * feeRate));
  const notes: string[] = [];

  const bids: Economics["bids"] = [];
  if (pricing.type === "hourly") {
    for (const [label, rate] of [
      ["Low rate, per hour", pricing.low],
      ["High rate, per hour", pricing.high],
    ] as const) {
      bids.push({ label, gross: rate, fee: fee(rate), net: net(rate) });
    }
    if (scope.effortHoursHigh > 0) {
      const low = pricing.low * scope.effortHoursLow;
      const high = pricing.high * scope.effortHoursHigh;
      bids.push({ label: `Whole job, low (${scope.effortHoursLow} h)`, gross: low, fee: fee(low), net: net(low) });
      bids.push({ label: `Whole job, high (${scope.effortHoursHigh} h)`, gross: high, fee: fee(high), net: net(high) });
    }
  } else {
    bids.push({ label: "Low bid", gross: pricing.low, fee: fee(pricing.low), net: net(pricing.low) });
    bids.push({ label: "High bid", gross: pricing.high, fee: fee(pricing.high), net: net(pricing.high) });
  }
  if (feeRate === null) notes.push("Take-home isn't shown until you enter the service fee Upwork shows for this contract (0–15%).");

  const total = inputs.connectsRequired === null ? null : inputs.connectsRequired + inputs.boostConnects;
  const costUsd = total === null ? null : round2(total * inputs.connectPriceUsd);
  if (inputs.connectsRequired === null) notes.push("Enter the Connects this job asks for (shown on the job post) to see what applying costs.");
  const shortBy = total !== null && inputs.connectsBalance !== null && total > inputs.connectsBalance ? total - inputs.connectsBalance : null;

  let effectiveHourly: Economics["effectiveHourly"] = { low: null, high: null };
  if (pricing.type === "fixed" && scope.effortHoursHigh > 0 && feeRate !== null) {
    // Lowest pay for the most hours, highest for the fewest.
    const perHour = (amount: number, hours: number) => (hours > 0 ? round2((amount * (1 - feeRate)) / hours) : null);
    effectiveHourly = { low: perHour(pricing.low, scope.effortHoursHigh), high: perHour(pricing.high, Math.max(1, scope.effortHoursLow)) };
    if (inputs.minimumHourlyUsd !== null && effectiveHourly.low !== null && effectiveHourly.low < inputs.minimumHourlyUsd) {
      notes.push(`At the low bid and the high effort estimate this works out below your $${inputs.minimumHourlyUsd}/h floor.`);
    }
  }
  if (pricing.type === "hourly" && inputs.minimumHourlyUsd !== null && feeRate !== null && net(pricing.low)! < inputs.minimumHourlyUsd) {
    notes.push(`The low rate takes home less than your $${inputs.minimumHourlyUsd}/h floor after the fee.`);
  }
  return { bids, connects: { required: inputs.connectsRequired, boost: inputs.boostConnects, total, costUsd, shortBy }, effectiveHourly, notes };
}

/**
 * A rough count of the AI tokens a step used, from its prompt and answer
 * (about four characters a token). Shown so it isn't confused with
 * Connects: tokens are billed by the user's own AI provider, Connects by Upwork.
 */
export function estimateTokens(...texts: string[]): number {
  return Math.ceil(texts.reduce((sum, value) => sum + value.length, 0) / 4);
}
