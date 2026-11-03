import { z } from "zod";

// The shapes stored in InterviewSession, InterviewTurn and InterviewRound's
// JSON columns, shared by the AI tasks, the server code and the screens.

// Everything here is also what the model's answers are checked against after
// they arrive, so lengths and counts are clipped rather than refused, and
// scores are clamped: a slightly long answer shouldn't fail a whole step.
// (The schemas sent to the model are the loose ones in the tasks.)
const text = (max: number) => z.string().transform((value) => value.trim().slice(0, max));
const lines = (max: number, length = 400) =>
  z.array(z.string()).transform((items) => items.map((item) => item.trim().slice(0, length)).filter(Boolean).slice(0, max));
const scale = (min: number, max: number, decimals = 0) =>
  z.number().transform((value) => {
    const factor = 10 ** decimals;
    const clamped = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
    return Math.round(clamped * factor) / factor;
  });
const list = <T extends z.ZodType>(item: T, max: number) => z.array(item).transform((items) => items.slice(0, max));

/** The competencies a session covers, planned before the first question. */
export const planSchema = z.object({
  competencies: list(z.object({ name: text(80), why: text(300) }), 8),
});
export type InterviewPlan = z.output<typeof planSchema>;

/** Feedback on one answer. */
export const feedbackSchema = z.object({
  /** 1 (weak) to 5 (excellent), against what the question was looking for. */
  score: scale(1, 5),
  summary: text(400),
  strengths: lines(4),
  gaps: lines(4),
  /** A stronger answer built only from the user's real experience, with [placeholders] for facts the profile lacks. */
  strongerAnswer: text(2500),
  /** Facts the stronger answer needed and the profile doesn't have; worth adding to the profile. */
  missingFacts: lines(4, 200),
});
export type AnswerFeedback = z.output<typeof feedbackSchema>;

export const competencyScoreSchema = z.object({ competency: text(80), score: scale(1, 5, 1), note: text(300) });

/** The end-of-session report. */
export const reportSchema = z.object({
  /** Average of the answers' scores, 1–5, one decimal. */
  overall: scale(0, 5, 1),
  readiness: text(500),
  competencies: list(competencyScoreSchema, 10),
  strengths: lines(5),
  recurringWeaknesses: lines(5),
  practiceNext: lines(5),
});
export type InterviewReport = z.output<typeof reportSchema>;

/** A round's prep plan in an interview loop. */
export const prepSchema = z.object({
  /** What this interviewer is most likely screening for. */
  focus: list(z.object({ area: text(120), why: text(300), howToPrepare: text(500) }), 6),
  likelyQuestions: list(z.object({ question: text(300), why: text(300) }), 10),
  /** Stories from the profile to have ready, each with where to use it. */
  stories: list(z.object({ story: text(300), useFor: text(200) }), 6),
  questionsToAsk: lines(6, 300),
  /** What earlier rounds' notes and feedback mean for this one. */
  carryForward: lines(5),
  tips: lines(5),
});
export type RoundPrep = z.output<typeof prepSchema>;

export const FOCUS_LABELS = {
  MIXED: "Mixed",
  BEHAVIORAL: "Behavioral",
  TECHNICAL: "Technical",
  ROLE: "Role-specific",
} as const;

export const DIFFICULTY_LABELS = {
  WARMUP: "Warm-up",
  STANDARD: "Standard",
  TOUGH: "Tough",
} as const;

export const ROUND_KIND_LABELS = {
  RECRUITER_SCREEN: "Recruiter screen",
  HIRING_MANAGER: "Hiring manager",
  TECHNICAL: "Technical",
  SYSTEM_DESIGN: "System design",
  CASE: "Case interview",
  TAKE_HOME: "Take-home",
  BEHAVIORAL: "Behavioral",
  PANEL: "Panel",
  FINAL: "Final round",
  OTHER: "Other",
} as const;

/** Who usually sits in each kind of round, and what they screen for: a starting point the user can edit. */
export const ROUND_PERSPECTIVES: Record<keyof typeof ROUND_KIND_LABELS, string> = {
  RECRUITER_SCREEN: "A recruiter checking motivation, basic fit, salary expectations, availability and how clearly you explain your background.",
  HIRING_MANAGER: "The future manager judging scope, ownership, how you prioritise and work with others, and whether you'd succeed on their team.",
  TECHNICAL: "A practitioner on the team probing depth in the core skills the role needs, how you reason through problems, and trade-offs.",
  SYSTEM_DESIGN: "A senior engineer looking at how you scope an ambiguous problem, structure a design, handle scale and failure, and explain trade-offs.",
  CASE: "An interviewer testing structured problem solving: framing, assumptions, quantitative reasoning and a clear recommendation.",
  TAKE_HOME: "Reviewers judging the quality of a take-home assignment and how well you walk through and defend your decisions.",
  BEHAVIORAL: "An interviewer using past-behaviour questions to judge collaboration, conflict, failure, influence and values.",
  PANEL: "Several interviewers from across the team, each with their own angle, looking for consistency and how you handle different audiences.",
  FINAL: "A senior leader checking judgement, ambition, culture add and whether to close you, often with open-ended questions.",
  OTHER: "",
};

/** Average score of the answered turns, one decimal; null when nothing was scored. */
export function averageScore(turns: { feedback: unknown }[]): number | null {
  const scores = turns.flatMap((turn) => {
    const parsed = feedbackSchema.safeParse(turn.feedback);
    return parsed.success ? [parsed.data.score] : [];
  });
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10;
}
