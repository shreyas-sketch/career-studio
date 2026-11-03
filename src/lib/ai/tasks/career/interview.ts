import { z } from "zod";

import {
  feedbackSchema,
  planSchema,
  prepSchema,
  reportSchema,
  type AnswerFeedback,
  type InterviewPlan,
  type InterviewReport,
  type RoundPrep,
} from "@/lib/career/interview-data";
import type { ProfileData } from "@/lib/profile";

import { NO_EM_DASHES, postingForPrompt, profileForPrompt, system, UNTRUSTED_POSTING, type Task } from "../prompt-parts";

// The mock interviewer (Career Studio agents 3 and 4). The model plans the
// session, then for each answer gives feedback and decides what comes next in
// one call; code holds the line on how many questions and follow-ups there
// are. Everything it suggests the candidate could say comes from their
// profile, with [placeholders] where a fact is missing.

export const PLAN_INTERVIEW_VERSION = "plan-interview@1";
export const CONTINUE_INTERVIEW_VERSION = "continue-interview@1";
export const REPORT_INTERVIEW_VERSION = "report-interview@1";
export const PREPARE_ROUND_VERSION = "prepare-round@1";

export type InterviewSetup = {
  role: string;
  company: string;
  jobDescription: string;
  focus: "MIXED" | "BEHAVIORAL" | "TECHNICAL" | "ROLE";
  difficulty: "WARMUP" | "STANDARD" | "TOUGH";
  /** Who is asking, for a round of an interview loop; empty for a general session. */
  interviewer: string;
  questionTarget: number;
  profile: ProfileData;
};

export type NextQuestion = { competency: string; question: string; lookingFor: string };

const FOCUS: Record<InterviewSetup["focus"], string> = {
  MIXED: "a realistic mix: motivation and fit, past behaviour, and the role's core skills",
  BEHAVIORAL: "past-behaviour questions (tell me about a time…) on collaboration, ownership, conflict, failure, influence",
  TECHNICAL: "the role's technical skills: depth, reasoning through problems, trade-offs; no trivia",
  ROLE: "the specific responsibilities in this job description and how the candidate would handle them",
};

const DIFFICULTY: Record<InterviewSetup["difficulty"], string> = {
  WARMUP: "Friendly and encouraging; straightforward questions; follow up gently.",
  STANDARD: "A typical, professional interview at this level; probe vague answers once.",
  TOUGH: "Demanding, like a strong interviewer at a selective company: precise questions, push on vague claims and missing numbers, and challenge assumptions, while staying fair.",
};

const INTERVIEWER_RULES = `You are an experienced interviewer running a mock interview so the candidate can practise for a real role.
- Ask exactly one question at a time, the way a person would say it out loud: no lists of sub-questions, no preamble about being an AI.
- Ground every question in the job description and in the candidate's real background (their roles, projects, skills), and make it the kind of question this interviewer would ask for this role at this level.
- Never ask about age, family, health, religion, nationality or any other protected characteristic.`;

const COACH_RULES = `When you suggest what the candidate could have said:
- Use only facts from the candidate's profile and from their own answer. Never invent an employer, project, number, result, tool or credential.
- Where a strong answer needs a fact the profile doesn't have (a metric, the outcome, their exact role), write a placeholder in square brackets, e.g. "[how much the conversion rate changed]", and list that fact in missingFacts.
- Structure behavioural answers as situation, task, action, result, without labelling the parts.`;

const setupForPrompt = (setup: InterviewSetup) =>
  [
    `The role: ${setup.role || "(not stated)"}${setup.company ? ` at ${setup.company}` : ""}.`,
    `Focus: ${FOCUS[setup.focus]}.`,
    `Style: ${DIFFICULTY[setup.difficulty]}`,
    setup.interviewer ? `You are this interviewer, and ask what they would ask: ${setup.interviewer}` : null,
    `The job description:\n${postingForPrompt(setup.jobDescription || "(none given: use the role title and the candidate's background)")}`,
    `The candidate's profile:\n${profileForPrompt(setup.profile)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

// ─── Planning ───────────────────────────────────────────────────────────────

const planAnswer = z.object({
  competencies: z.array(z.object({ name: z.string(), why: z.string() })),
  firstQuestion: z.object({ competency: z.string(), question: z.string(), lookingFor: z.string() }),
});

export const planInterview: Task<InterviewSetup, { plan: InterviewPlan; first: NextQuestion }> = async (provider, setup, { signal }) => {
  const answer = await provider.complete({
    system: system(
      INTERVIEWER_RULES,
      `Plan a mock interview of ${setup.questionTarget} main questions, as JSON:
- competencies: the ${Math.min(setup.questionTarget, 6)} to ${Math.min(setup.questionTarget + 1, 8)} things this interview should test for this role, most important first, each with why it matters for this job.
- firstQuestion: the opening question, the competency it tests, and lookingFor: what a strong answer would show (kept from the candidate until they've answered).`,
      UNTRUSTED_POSTING,
      NO_EM_DASHES,
    ),
    messages: [{ role: "user", content: setupForPrompt(setup) }],
    schema: planAnswer,
    schemaName: "interview_plan",
    creativity: "BALANCED",
    effort: "low",
    signal,
  });
  const plan = planSchema.parse({ competencies: answer.competencies });
  if (plan.competencies.length === 0) plan.competencies.push({ name: "Fit for the role", why: "The model gave no plan." });
  return {
    data: { plan, first: clean(answer.firstQuestion, plan) },
    promptVersion: PLAN_INTERVIEW_VERSION,
  };
};

function clean(question: { competency: string; question: string; lookingFor: string }, plan: InterviewPlan): NextQuestion {
  const text = question.question.trim().slice(0, 600);
  return {
    competency: (question.competency.trim() || plan.competencies[0]?.name || "").slice(0, 80),
    question: text || "Tell me about yourself and why this role interests you.",
    lookingFor: question.lookingFor.trim().slice(0, 600),
  };
}

// ─── Each answer ────────────────────────────────────────────────────────────

export type Turn = { kind: "question" | "follow-up"; competency: string; question: string; answer: string };

export type ContinueInput = InterviewSetup & {
  plan: InterviewPlan;
  /** Earlier turns, answered. */
  history: Turn[];
  /** The turn just answered. */
  current: Turn & { lookingFor: string };
  /** Main questions asked so far, the current one included. */
  mainAsked: number;
  /** Whether the current main question already had its follow-up. */
  followedUp: boolean;
};

export type Continuation = { feedback: AnswerFeedback; next: ({ action: "follow-up" | "question" } & NextQuestion) | { action: "end" } };

const continueAnswer = z.object({
  feedback: z.object({
    score: z.number(),
    summary: z.string(),
    strengths: z.array(z.string()),
    gaps: z.array(z.string()),
    strongerAnswer: z.string(),
    missingFacts: z.array(z.string()),
  }),
  next: z.object({
    action: z.enum(["follow-up", "question", "end"]),
    competency: z.string(),
    question: z.string(),
    lookingFor: z.string(),
  }),
});

export const continueInterview: Task<ContinueInput, Continuation> = async (provider, input, { signal }) => {
  const { plan, history, current, mainAsked, followedUp, questionTarget } = input;
  const mustEnd = mainAsked >= questionTarget && followedUp;
  const canFollowUp = !followedUp;
  const canAsk = mainAsked < questionTarget;
  const options = [canFollowUp && '"follow-up" (one probing question on this same answer, when it was vague, missed what the question was after, or made a claim worth testing)', canAsk && '"question" (the next main question, on a competency from the plan not yet covered well)', '"end" (the interview is complete)'].filter(Boolean);

  const answer = await provider.complete({
    system: system(
      INTERVIEWER_RULES,
      `The candidate just answered. As JSON:
- feedback on that answer only: score 1 to 5 against what the question was looking for (1 off-target, 2 thin, 3 adequate, 4 strong, 5 excellent for this level); a one-sentence summary; up to four specific strengths and up to four specific gaps; strongerAnswer: how they could answer it better, in the first person, in their voice; missingFacts.
- next: ${mustEnd ? '"end": the interview is over.' : `choose ${options.join(", or ")}. Give the competency, the question and what a strong answer would show. For "end", leave question and lookingFor empty.`}
Judge the answer as written. An empty or "I don't know" answer scores 1, with a stronger answer showing how they could approach it.`,
      COACH_RULES,
      UNTRUSTED_POSTING,
      NO_EM_DASHES,
    ),
    messages: [
      {
        role: "user",
        content: [
          setupForPrompt(input),
          `The interview plan:\n${JSON.stringify(plan.competencies, null, 2)}`,
          history.length > 0 ? `The interview so far:\n${history.map(turnForPrompt).join("\n\n")}` : null,
          `The question just asked (${current.kind}, on ${current.competency || "general fit"}):\n${current.question}`,
          current.lookingFor ? `What it was looking for:\n${current.lookingFor}` : null,
          `The candidate's answer:\n<answer>\n${current.answer.trim().slice(0, 8000) || "(no answer)"}\n</answer>`,
          `Main questions asked: ${mainAsked} of ${questionTarget}.`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: continueAnswer,
    schemaName: "interview_turn",
    creativity: "BALANCED",
    effort: "medium",
    signal,
  });

  const feedback = feedbackSchema.parse(answer.feedback);
  // Code, not the model, keeps to the session's shape.
  let action = answer.next.action;
  if (mustEnd) action = "end";
  else if (action === "follow-up" && !canFollowUp) action = canAsk ? "question" : "end";
  else if (action === "question" && !canAsk) action = "end";
  const question = answer.next.question.trim();
  if (action !== "end" && !question) action = canAsk ? "question" : "end";
  return {
    data: { feedback, next: action === "end" || !question ? { action: "end" } : { action, ...clean(answer.next, plan) } },
    promptVersion: CONTINUE_INTERVIEW_VERSION,
  };
};

const turnForPrompt = (turn: Turn) => `${turn.kind === "follow-up" ? "Follow-up" : "Question"} (${turn.competency}): ${turn.question}\nAnswer: ${turn.answer.trim().slice(0, 3000) || "(no answer)"}`;

// ─── The report ─────────────────────────────────────────────────────────────

export type ReportInput = InterviewSetup & {
  turns: (Turn & { score: number | null; gaps: string[] })[];
};

const reportAnswer = z.object({
  readiness: z.string(),
  competencies: z.array(z.object({ competency: z.string(), score: z.number(), note: z.string() })),
  strengths: z.array(z.string()),
  recurringWeaknesses: z.array(z.string()),
  practiceNext: z.array(z.string()),
});

export const reportInterview: Task<ReportInput, InterviewReport> = async (provider, input, { signal }) => {
  const scored = input.turns.flatMap((turn) => (turn.score === null ? [] : [turn.score]));
  const overall = scored.length ? scored.reduce((sum, score) => sum + score, 0) / scored.length : 0;
  const answer = await provider.complete({
    system: system(
      `You review a finished mock interview and write the candidate's report, as JSON:
- readiness: two or three honest sentences on how ready they are for this interview and what would most improve their chances. Don't promise outcomes.
- competencies: each competency the interview tested, with a score from 1 to 5 based on the answers to it, and a short note.
- strengths: what they did well across answers.
- recurringWeaknesses: patterns that showed up in more than one answer (e.g. no numbers, unclear personal role, rambling), most important first.
- practiceNext: specific, doable things to practise before the real interview.
Base everything on the answers and their feedback; never invent what they said.`,
      NO_EM_DASHES,
    ),
    messages: [
      {
        role: "user",
        content: [
          `The role: ${input.role || "(not stated)"}${input.company ? ` at ${input.company}` : ""}.`,
          `The interview:\n${input.turns
            .map((turn) => `${turnForPrompt(turn)}\nScore: ${turn.score ?? "not scored"}. Gaps noted: ${turn.gaps.join("; ") || "none"}`)
            .join("\n\n")}`,
        ].join("\n\n"),
      },
    ],
    schema: reportAnswer,
    schemaName: "interview_report",
    creativity: "FAITHFUL",
    effort: "low",
    signal,
  });
  return { data: reportSchema.parse({ overall, ...answer }), promptVersion: REPORT_INTERVIEW_VERSION };
};

// ─── Interview loops: preparing a round ─────────────────────────────────────

export type PrepareRoundInput = {
  company: string;
  role: string;
  jobDescription: string;
  round: { kind: string; title: string; interviewer: string; perspective: string; durationMinutes: number | null };
  /** Earlier rounds of this loop, with the user's notes and any practice results. */
  earlier: { title: string; kind: string; notes: string; practice: string | null }[];
  profile: ProfileData;
};

const prepAnswer = z.object({
  focus: z.array(z.object({ area: z.string(), why: z.string(), howToPrepare: z.string() })),
  likelyQuestions: z.array(z.object({ question: z.string(), why: z.string() })),
  stories: z.array(z.object({ story: z.string(), useFor: z.string() })),
  questionsToAsk: z.array(z.string()),
  carryForward: z.array(z.string()),
  tips: z.array(z.string()),
});

export const prepareRound: Task<PrepareRoundInput, RoundPrep> = async (provider, input, { signal }) => {
  const answer = await provider.complete({
    system: system(
      `You help a candidate prepare for one specific round of a hiring process, as JSON:
- focus: what this interviewer is most likely to screen for in this round, why, and how to prepare in the time before it.
- likelyQuestions: up to eight questions this interviewer is likely to ask, each with why they'd ask it.
- stories: up to five specific experiences from the candidate's profile to have ready (name the role or project), and which questions each answers. Only experiences the profile shows.
- questionsToAsk: good questions the candidate could ask this particular interviewer.
- carryForward: what the earlier rounds' notes and practice say about this one (things to fix, threads the interviewers will pick up). Empty when there are no earlier rounds.
- tips: practical advice for this round's format.
Never invent facts about the company, the interviewers or the candidate. Where the job description doesn't say, speak in terms of what such a round usually covers.`,
      UNTRUSTED_POSTING,
      NO_EM_DASHES,
    ),
    messages: [
      {
        role: "user",
        content: [
          `The role: ${input.role || "(not stated)"}${input.company ? ` at ${input.company}` : ""}.`,
          `This round: ${JSON.stringify(input.round, null, 2)}`,
          input.earlier.length > 0 ? `Earlier rounds:\n${JSON.stringify(input.earlier, null, 2)}` : "This is the first round.",
          `The job description:\n${postingForPrompt(input.jobDescription || "(none given)")}`,
          `The candidate's profile:\n${profileForPrompt(input.profile)}`,
        ].join("\n\n"),
      },
    ],
    schema: prepAnswer,
    schemaName: "round_prep",
    creativity: "BALANCED",
    effort: "medium",
    signal,
  });
  return { data: prepSchema.parse(answer), promptVersion: PREPARE_ROUND_VERSION };
};
