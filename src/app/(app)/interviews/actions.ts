"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { answerTurn, createInterviewSession, finishInterview, InterviewClosed, roundInterviewer } from "@/lib/career/interviews";
import { prisma } from "@/lib/prisma";

const id = z.string().min(1).max(64);

/** Starts a practice session: planned in the background, first question when ready. */
export const startInterview = action(
  z.object({
    company: z.string().max(200),
    role: z.string().max(200),
    jobDescription: z.string().max(30_000),
    focus: z.enum(["MIXED", "BEHAVIORAL", "TECHNICAL", "ROLE"]),
    difficulty: z.enum(["WARMUP", "STANDARD", "TOUGH"]),
    questionTarget: z.number().int().min(2).max(10),
    applicationId: id.nullable(),
    roundId: id.nullable(),
  }),
  async (input) => {
    if (!input.role.trim() && !input.jobDescription.trim()) throw new ActionError("Give the role, or paste its job description, so the questions fit it.");
    let interviewer = "";
    let company = input.company;
    let role = input.role;
    let jobDescription = input.jobDescription;
    if (input.roundId) {
      const round = await prisma.interviewRound.findUnique({ where: { id: input.roundId }, include: { loop: true } });
      if (!round) throw new ActionError("That round no longer exists.");
      interviewer = roundInterviewer(round);
      company ||= round.loop.company;
      role ||= round.loop.role;
      jobDescription ||= round.loop.jobDescription;
    }
    const session = await createInterviewSession({ ...input, company, role, jobDescription, interviewer });
    revalidatePath("/interviews");
    return session;
  },
);

export const submitAnswer = action(z.object({ sessionId: id, turnId: id, answer: z.string().max(10_000) }), async ({ sessionId, turnId, answer }) => {
  try {
    return { jobId: await answerTurn(sessionId, turnId, answer) };
  } catch (error) {
    if (error instanceof InterviewClosed) throw new ActionError(error.message);
    throw error;
  }
});

export const endInterview = action(z.object({ sessionId: id }), async ({ sessionId }) => {
  try {
    return { jobId: await finishInterview(sessionId) };
  } catch (error) {
    if (error instanceof InterviewClosed) throw new ActionError(error.message);
    throw error;
  }
});

export const deleteInterview = action(z.object({ sessionId: id }), async ({ sessionId }, { toast }) => {
  await prisma.interviewSession.deleteMany({ where: { id: sessionId } });
  revalidatePath("/interviews");
  toast("Practice session deleted.");
  return null;
});
