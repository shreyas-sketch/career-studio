"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { RoundKind, RoundStatus } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { ROUND_PERSPECTIVES } from "@/lib/career/interview-data";
import { createInterviewSession, roundInterviewer, startRoundPrep } from "@/lib/career/interviews";
import { prisma } from "@/lib/prisma";

const id = z.string().min(1).max(64);
const kind = z.enum(RoundKind);

/** A typical set of rounds to start from; the user edits them to match what the company said. */
const TYPICAL: RoundKind[] = [RoundKind.RECRUITER_SCREEN, RoundKind.HIRING_MANAGER, RoundKind.TECHNICAL, RoundKind.FINAL];

export const createLoop = action(
  z.object({
    company: z.string().max(200),
    role: z.string().max(200),
    jobDescription: z.string().max(30_000),
    applicationId: id.nullable(),
    rounds: z.array(kind).max(10),
  }),
  async ({ company, role, jobDescription, applicationId, rounds }) => {
    if (!company.trim() && !applicationId) throw new ActionError("Name the company, or pick the application this loop is for.");
    if (applicationId && (await prisma.interviewLoop.findUnique({ where: { applicationId }, select: { id: true } }))) {
      throw new ActionError("That application already has an interview loop.");
    }
    const kinds = rounds.length > 0 ? rounds : TYPICAL;
    const loop = await prisma.interviewLoop.create({
      data: {
        company: company.trim(),
        role: role.trim(),
        jobDescription,
        applicationId,
        rounds: { create: kinds.map((roundKind, index) => ({ kind: roundKind, sort: index, perspective: ROUND_PERSPECTIVES[roundKind] })) },
      },
      select: { id: true },
    });
    revalidatePath("/loops");
    return loop;
  },
);

export const addRound = action(z.object({ loopId: id, kind }), async ({ loopId, kind: roundKind }) => {
  const last = await prisma.interviewRound.findFirst({ where: { loopId }, orderBy: { sort: "desc" }, select: { sort: true } });
  await prisma.interviewRound.create({ data: { loopId, kind: roundKind, sort: (last?.sort ?? -1) + 1, perspective: ROUND_PERSPECTIVES[roundKind] } });
  revalidatePath(`/loops/${loopId}`);
  return null;
});

export const updateRound = action(
  z.object({
    id,
    kind: kind.optional(),
    title: z.string().max(200).optional(),
    interviewer: z.string().max(300).optional(),
    perspective: z.string().max(1000).optional(),
    scheduledAt: z.string().max(40).nullable().optional(),
    durationMinutes: z.number().int().min(5).max(600).nullable().optional(),
    status: z.enum(RoundStatus).optional(),
    notes: z.string().max(10_000).optional(),
  }),
  async ({ id: roundId, scheduledAt, ...changes }) => {
    let when: Date | null | undefined;
    if (scheduledAt !== undefined) {
      when = scheduledAt ? new Date(scheduledAt) : null;
      if (when && Number.isNaN(when.getTime())) throw new ActionError("That date isn't valid.");
    }
    const round = await prisma.interviewRound.update({ where: { id: roundId }, data: { ...changes, ...(when !== undefined ? { scheduledAt: when } : {}) }, select: { loopId: true } });
    await prisma.interviewLoop.update({ where: { id: round.loopId }, data: { updatedAt: new Date() } });
    return null;
  },
);

export const moveRound = action(z.object({ id, direction: z.enum(["up", "down"]) }), async ({ id: roundId, direction }) => {
  const round = await prisma.interviewRound.findUniqueOrThrow({ where: { id: roundId } });
  const rounds = await prisma.interviewRound.findMany({ where: { loopId: round.loopId }, orderBy: { sort: "asc" }, select: { id: true } });
  const index = rounds.findIndex((other) => other.id === roundId);
  const swap = direction === "up" ? index - 1 : index + 1;
  if (swap < 0 || swap >= rounds.length) return null;
  [rounds[index], rounds[swap]] = [rounds[swap]!, rounds[index]!];
  await prisma.$transaction(rounds.map((other, sort) => prisma.interviewRound.update({ where: { id: other.id }, data: { sort } })));
  revalidatePath(`/loops/${round.loopId}`);
  return null;
});

export const removeRound = action(z.object({ id }), async ({ id: roundId }) => {
  const round = await prisma.interviewRound.delete({ where: { id: roundId }, select: { loopId: true } });
  revalidatePath(`/loops/${round.loopId}`);
  return null;
});

export const prepareRound = action(z.object({ id }), async ({ id: roundId }) => ({ jobId: await startRoundPrep(roundId) }));

/** Starts a practice session as this round's interviewer. */
export const practiseRound = action(
  z.object({ id, focus: z.enum(["MIXED", "BEHAVIORAL", "TECHNICAL", "ROLE"]), difficulty: z.enum(["WARMUP", "STANDARD", "TOUGH"]) }),
  async ({ id: roundId, focus, difficulty }) => {
    const round = await prisma.interviewRound.findUniqueOrThrow({ where: { id: roundId }, include: { loop: true } });
    return createInterviewSession({
      title: `${round.loop.role || "Interview"} at ${round.loop.company || "the company"}: ${round.title || roundInterviewer(round).split(";")[0]}`,
      company: round.loop.company,
      role: round.loop.role,
      jobDescription: round.loop.jobDescription,
      focus,
      difficulty,
      questionTarget: 5,
      applicationId: round.loop.applicationId,
      roundId,
      interviewer: roundInterviewer(round),
    });
  },
);

export const updateLoop = action(
  z.object({ id, status: z.enum(["ACTIVE", "OFFER", "CLOSED"]).optional(), notes: z.string().max(10_000).optional(), jobDescription: z.string().max(30_000).optional() }),
  async ({ id: loopId, ...changes }) => {
    await prisma.interviewLoop.update({ where: { id: loopId }, data: changes });
    revalidatePath(`/loops/${loopId}`);
    return null;
  },
);

export const deleteLoop = action(z.object({ id }), async ({ id: loopId }, { toast }) => {
  await prisma.interviewLoop.deleteMany({ where: { id: loopId } });
  revalidatePath("/loops");
  toast("Interview loop deleted.");
  return null;
});
