import "server-only";

import { RoundStatus } from "@/generated/prisma/enums";
import { averageScore, prepSchema, reportSchema } from "@/lib/career/interview-data";
import { prisma } from "@/lib/prisma";

// Reading interview loops (agent 4) for their screens and the dashboard.

export async function listLoops() {
  const loops = await prisma.interviewLoop.findMany({
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: { rounds: { orderBy: { sort: "asc" }, select: { id: true, kind: true, title: true, status: true, scheduledAt: true } } },
  });
  return loops.map((loop) => {
    const next = loop.rounds.find((round) => round.status === RoundStatus.UPCOMING);
    return {
      ...loop,
      done: loop.rounds.filter((round) => round.status === RoundStatus.DONE).length,
      next: next ?? null,
    };
  });
}

/** Rounds coming up across every active loop, soonest first; undated ones last. */
export async function upcomingRounds(limit = 20) {
  const rounds = await prisma.interviewRound.findMany({
    where: { status: RoundStatus.UPCOMING, loop: { status: "ACTIVE" } },
    orderBy: [{ scheduledAt: { sort: "asc", nulls: "last" } }, { sort: "asc" }],
    take: limit,
    include: { loop: { select: { id: true, company: true, role: true } } },
  });
  return rounds.map((round) => ({ ...round, prepared: round.prep !== null }));
}

export async function loadLoop(id: string) {
  const loop = await prisma.interviewLoop.findUnique({
    where: { id },
    include: {
      application: { select: { id: true, title: true, company: true, role: true, status: true } },
      rounds: {
        orderBy: { sort: "asc" },
        include: { sessions: { orderBy: { createdAt: "desc" }, select: { id: true, status: true, createdAt: true, report: true, turns: { select: { feedback: true } } } } },
      },
    },
  });
  if (!loop) return null;
  return {
    ...loop,
    rounds: loop.rounds.map((round) => {
      const prep = round.prep ? prepSchema.safeParse(round.prep) : null;
      return {
        ...round,
        prep: prep?.success ? prep.data : null,
        sessions: round.sessions.map((session) => {
          const report = session.report ? reportSchema.safeParse(session.report) : null;
          return { id: session.id, status: session.status, createdAt: session.createdAt, average: averageScore(session.turns), weaknesses: report?.success ? report.data.recurringWeaknesses : [] };
        }),
      };
    }),
  };
}
