import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { InterviewStatus } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { continueInterview, planInterview, prepareRound, reportInterview, type InterviewSetup, type Turn } from "@/lib/ai/tasks/career/interview";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { averageScore, feedbackSchema, planSchema, reportSchema, ROUND_KIND_LABELS } from "@/lib/career/interview-data";
import { defineJob, startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";

// Mock interviews (agent 3) and interview loops (agent 4) on the server:
// records in the account's schema, AI steps as background jobs the screens
// follow live.

export const interviewJobKey = (sessionId: string) => `interview:${sessionId}`;
export const roundJobKey = (roundId: string) => `round:${roundId}`;

export type NewSession = {
  title?: string;
  company: string;
  role: string;
  jobDescription: string;
  focus: InterviewSetup["focus"];
  difficulty: InterviewSetup["difficulty"];
  questionTarget: number;
  applicationId?: string | null;
  roundId?: string | null;
  interviewer?: string;
};

/** Creates a session and starts planning it and writing its first question. */
export async function createInterviewSession(input: NewSession): Promise<{ id: string; jobId: string }> {
  const session = await prisma.interviewSession.create({
    data: {
      title: (input.title || [input.role, input.company].filter(Boolean).join(" at ") || "Practice interview").slice(0, 200),
      company: input.company.slice(0, 200),
      role: input.role.slice(0, 200),
      jobDescription: input.jobDescription.slice(0, 30_000),
      focus: input.focus,
      difficulty: input.difficulty,
      questionTarget: Math.min(10, Math.max(2, Math.round(input.questionTarget))),
      interviewer: (input.interviewer ?? "").slice(0, 1000),
      applicationId: input.applicationId ?? null,
      roundId: input.roundId ?? null,
    },
    select: { id: true },
  });
  const jobId = await startJob(interviewStartJob, { sessionId: session.id }, { key: interviewJobKey(session.id) });
  return { id: session.id, jobId };
}

async function setupOf(sessionId: string): Promise<{ setup: InterviewSetup; plan: z.output<typeof planSchema> | null; status: InterviewStatus }> {
  const [session, profile] = await Promise.all([prisma.interviewSession.findUniqueOrThrow({ where: { id: sessionId } }), loadProfile()]);
  return {
    setup: {
      role: session.role,
      company: session.company,
      jobDescription: session.jobDescription,
      focus: session.focus,
      difficulty: session.difficulty,
      interviewer: session.interviewer,
      questionTarget: session.questionTarget,
      profile,
    },
    plan: session.plan ? planSchema.parse(session.plan) : null,
    status: session.status,
  };
}

export const interviewStartJob = defineJob({
  type: "interview-start",
  input: z.object({ sessionId: z.string() }),
  result: z.object({ turnId: z.string() }),
  async run({ sessionId }, { step, signal }) {
    await step("Reading the role and your profile");
    const [{ setup }, provider, options] = await Promise.all([setupOf(sessionId), getAiProvider(), loadTaskOptions()]);
    await step("Planning the interview");
    const { data, promptVersion } = await planInterview(provider, setup, { ...options, signal });
    const turn = await prisma.$transaction(async (tx) => {
      await tx.interviewSession.update({ where: { id: sessionId }, data: { plan: data.plan as Prisma.InputJsonValue, writtenWith: promptVersion } });
      return tx.interviewTurn.create({
        data: { sessionId, index: 0, kind: "question", competency: data.first.competency, question: data.first.question, lookingFor: data.first.lookingFor },
        select: { id: true },
      });
    });
    return { turnId: turn.id };
  },
});

/** Saves the answer to the open question and starts the feedback and the next question. */
export async function answerTurn(sessionId: string, turnId: string, answer: string): Promise<string> {
  const { count } = await prisma.interviewTurn.updateMany({
    where: { id: turnId, sessionId, answeredAt: null, session: { status: InterviewStatus.ACTIVE } },
    data: { answer: answer.slice(0, 10_000), answeredAt: new Date() },
  });
  if (count === 0) throw new InterviewClosed();
  return startJob(interviewAnswerJob, { sessionId, turnId }, { key: interviewJobKey(sessionId) });
}

export class InterviewClosed extends Error {
  override name = "InterviewClosed";
  constructor() {
    super("That question was already answered, or the interview has ended.");
  }
}

export const interviewAnswerJob = defineJob({
  type: "interview-answer",
  input: z.object({ sessionId: z.string(), turnId: z.string() }),
  result: z.object({ next: z.enum(["follow-up", "question", "end"]) }),
  async run({ sessionId, turnId }, { step, signal }) {
    const [{ setup, plan }, turns, provider, options] = await Promise.all([
      setupOf(sessionId),
      prisma.interviewTurn.findMany({ where: { sessionId }, orderBy: { index: "asc" } }),
      getAiProvider(),
      loadTaskOptions(),
    ]);
    const current = turns.find((turn) => turn.id === turnId);
    if (!current || !plan) throw new Error("The interview isn't ready for that answer.");
    const history: Turn[] = turns.filter((turn) => turn.index < current.index).map(toTurn);
    const mainAsked = turns.filter((turn) => turn.kind === "question").length;
    // The current main question is the last "question" at or before this turn.
    const followedUp = current.kind === "follow-up";

    await step("Listening to your answer");
    const { data, promptVersion } = await continueInterview(
      provider,
      { ...setup, plan, history, current: { ...toTurn(current), lookingFor: current.lookingFor }, mainAsked, followedUp },
      { ...options, signal },
    );

    await prisma.$transaction(async (tx) => {
      await tx.interviewTurn.update({ where: { id: turnId }, data: { feedback: data.feedback as Prisma.InputJsonValue } });
      if (data.next.action !== "end") {
        await tx.interviewTurn.create({
          data: {
            sessionId,
            index: current.index + 1,
            kind: data.next.action,
            competency: data.next.competency,
            question: data.next.question,
            lookingFor: data.next.lookingFor,
          },
        });
      }
      await tx.interviewSession.update({ where: { id: sessionId }, data: { writtenWith: promptVersion } });
    });

    if (data.next.action === "end") {
      await step("Writing your report");
      await writeReport(sessionId, signal);
    }
    return { next: data.next.action };
  },
});

const toTurn = (turn: { kind: string; competency: string; question: string; answer: string }): Turn => ({
  kind: turn.kind === "follow-up" ? "follow-up" : "question",
  competency: turn.competency,
  question: turn.question,
  answer: turn.answer,
});

async function writeReport(sessionId: string, signal: AbortSignal): Promise<void> {
  const [{ setup }, turns, provider, options] = await Promise.all([
    setupOf(sessionId),
    prisma.interviewTurn.findMany({ where: { sessionId, answeredAt: { not: null } }, orderBy: { index: "asc" } }),
    getAiProvider(),
    loadTaskOptions(),
  ]);
  // An unanswered question left open when ending early is dropped.
  await prisma.interviewTurn.deleteMany({ where: { sessionId, answeredAt: null } });
  if (turns.length === 0) {
    await prisma.interviewSession.update({ where: { id: sessionId }, data: { status: InterviewStatus.COMPLETED, completedAt: new Date() } });
    return;
  }
  const { data, promptVersion } = await reportInterview(
    provider,
    {
      ...setup,
      turns: turns.map((turn) => {
        const feedback = feedbackSchema.safeParse(turn.feedback);
        return { ...toTurn(turn), score: feedback.success ? feedback.data.score : null, gaps: feedback.success ? feedback.data.gaps : [] };
      }),
    },
    { ...options, signal },
  );
  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: { report: data as Prisma.InputJsonValue, writtenWith: promptVersion, status: InterviewStatus.COMPLETED, completedAt: new Date() },
  });
}

/** Ends the interview now and writes the report on what was answered. */
export const interviewFinishJob = defineJob({
  type: "interview-finish",
  input: z.object({ sessionId: z.string() }),
  result: z.object({ done: z.boolean() }),
  async run({ sessionId }, { step, signal }) {
    await step("Writing your report");
    await writeReport(sessionId, signal);
    return { done: true };
  },
});

export async function finishInterview(sessionId: string): Promise<string> {
  const session = await prisma.interviewSession.findUnique({ where: { id: sessionId }, select: { status: true } });
  if (!session || session.status !== InterviewStatus.ACTIVE) throw new InterviewClosed();
  return startJob(interviewFinishJob, { sessionId }, { key: interviewJobKey(sessionId) });
}

/** A session with its turns, for its screen. */
export async function loadInterviewSession(id: string) {
  const session = await prisma.interviewSession.findUnique({
    where: { id },
    include: {
      turns: { orderBy: { index: "asc" } },
      application: { select: { id: true, company: true, role: true, title: true } },
      round: { select: { id: true, title: true, kind: true, loopId: true, loop: { select: { company: true, role: true } } } },
    },
  });
  if (!session) return null;
  return {
    ...session,
    plan: session.plan ? planSchema.parse(session.plan) : null,
    report: session.report ? reportSchema.parse(session.report) : null,
    turns: session.turns.map((turn) => ({ ...turn, feedback: turn.feedback ? feedbackSchema.parse(turn.feedback) : null })),
  };
}

/** Every session, newest first, with its average score so far. */
export async function listInterviewSessions() {
  const sessions = await prisma.interviewSession.findMany({
    orderBy: { createdAt: "desc" },
    include: { turns: { select: { feedback: true } }, round: { select: { title: true } } },
    take: 200,
  });
  return sessions.map(({ turns, ...session }) => ({ ...session, answered: turns.filter((turn) => turn.feedback).length, average: averageScore(turns) }));
}

/** Scores across completed sessions per competency, for "progress". */
export async function interviewProgress() {
  const sessions = await prisma.interviewSession.findMany({
    where: { status: InterviewStatus.COMPLETED },
    orderBy: { completedAt: "asc" },
    select: { id: true, title: true, completedAt: true, report: true, turns: { select: { feedback: true } } },
  });
  const timeline = sessions.map((session) => ({ id: session.id, title: session.title, at: session.completedAt, average: averageScore(session.turns) }));
  const byCompetency = new Map<string, number[]>();
  for (const session of sessions) {
    const report = reportSchema.safeParse(session.report);
    if (!report.success) continue;
    for (const { competency, score } of report.data.competencies) {
      const key = competency.trim();
      if (!key) continue;
      byCompetency.set(key, [...(byCompetency.get(key) ?? []), score]);
    }
  }
  const competencies = [...byCompetency.entries()]
    .map(([competency, scores]) => ({ competency, latest: scores.at(-1)!, first: scores[0]!, sessions: scores.length }))
    .sort((a, b) => b.sessions - a.sessions || a.competency.localeCompare(b.competency))
    .slice(0, 12);
  return { timeline, competencies };
}

// ─── Interview loops ────────────────────────────────────────────────────────

/** The interviewer as the mock interview plays them, from a round's details. */
export function roundInterviewer(round: { kind: keyof typeof ROUND_KIND_LABELS; title: string; interviewer: string; perspective: string }): string {
  return [`${round.title || ROUND_KIND_LABELS[round.kind]} round`, round.interviewer && `interviewer: ${round.interviewer}`, round.perspective && `they screen for: ${round.perspective}`]
    .filter(Boolean)
    .join("; ");
}

export const prepareRoundJob = defineJob({
  type: "round-prepare",
  input: z.object({ roundId: z.string() }),
  result: z.object({ done: z.boolean() }),
  async run({ roundId }, { step, signal }) {
    await step("Reading the round and your profile");
    const round = await prisma.interviewRound.findUniqueOrThrow({
      where: { id: roundId },
      include: { loop: { include: { rounds: { orderBy: { sort: "asc" }, include: { sessions: { select: { report: true, turns: { select: { feedback: true } } } } } } } } },
    });
    const [profile, provider, options] = await Promise.all([loadProfile(), getAiProvider(), loadTaskOptions()]);
    const earlier = round.loop.rounds
      .filter((other) => other.sort < round.sort && other.id !== round.id)
      .map((other) => {
        const reports = other.sessions.flatMap((session) => {
          const report = reportSchema.safeParse(session.report);
          return report.success ? [report.data] : [];
        });
        const latest = reports.at(-1);
        return {
          title: other.title || ROUND_KIND_LABELS[other.kind],
          kind: ROUND_KIND_LABELS[other.kind],
          notes: other.notes,
          practice: latest ? `Practice score ${latest.overall}/5. Weaknesses: ${latest.recurringWeaknesses.join("; ") || "none noted"}` : null,
        };
      });
    await step("Preparing this round");
    const { data, promptVersion } = await prepareRound(
      provider,
      {
        company: round.loop.company,
        role: round.loop.role,
        jobDescription: round.loop.jobDescription,
        round: { kind: ROUND_KIND_LABELS[round.kind], title: round.title, interviewer: round.interviewer, perspective: round.perspective, durationMinutes: round.durationMinutes },
        earlier,
        profile,
      },
      { ...options, signal },
    );
    await prisma.interviewRound.update({ where: { id: roundId }, data: { prep: data as Prisma.InputJsonValue, preparedWith: promptVersion } });
    return { done: true };
  },
});

export function startRoundPrep(roundId: string): Promise<string> {
  return startJob(prepareRoundJob, { roundId }, { key: roundJobKey(roundId) });
}
