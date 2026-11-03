import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { createTestClient, resetDatabase } from "@/test/db";

import { answerTurn, createInterviewSession, interviewAnswerJob, interviewProgress, interviewStartJob, loadInterviewSession, prepareRoundJob, roundInterviewer } from "./interviews";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const provider = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => provider.current }));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: async () => ({ creativity: "BALANCED", strict: true, language: null }) }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});
const started = vi.hoisted(() => [] as { type: string; input: unknown }[]);
vi.mock("@/lib/jobs/runner", () => ({
  defineJob: <T,>(definition: T) => definition,
  startJob: async (definition: { type: string }, input: unknown) => {
    started.push({ type: definition.type, input });
    return `job-${started.length}`;
  },
}));

const prisma = () => db.client!;
const context = { id: "test-job", step: async () => {}, signal: new AbortController().signal };

/** The model's next moves, in order, for "interview_turn" calls. */
let moves: ("follow-up" | "question" | "end")[] = [];
const feedback = (score: number) => ({
  score,
  summary: "Clear but light on outcomes.",
  strengths: ["Named the users you designed for"],
  gaps: ["No result given"],
  strongerAnswer: "At Ledgerly I redesigned onboarding, which cut drop-off by [how much].",
  missingFacts: ["The drop-off before and after"],
});

function scriptedModel() {
  return new MockProvider({
    reply: (call) => {
      switch (call.json?.name) {
        case "interview_plan":
          return {
            competencies: [
              { name: "Product thinking", why: "The role owns onboarding." },
              { name: "Collaboration", why: "Works with engineering daily." },
            ],
            firstQuestion: { competency: "Product thinking", question: "Walk me through a product decision you owned.", lookingFor: "Problem, options, outcome." },
          };
        case "interview_turn": {
          const action = moves.shift() ?? "end";
          return {
            feedback: feedback(action === "end" ? 4 : 3),
            next: { action, competency: "Collaboration", question: action === "end" ? "" : `Next ${action}?`, lookingFor: "Specifics." },
          };
        }
        case "interview_report":
          return {
            readiness: "Close: add numbers to your stories.",
            competencies: [{ competency: "Product thinking", score: 3.5, note: "Good framing." }],
            strengths: ["Structured answers"],
            recurringWeaknesses: ["No metrics"],
            practiceNext: ["Prepare two stories with numbers"],
          };
        case "round_prep":
          return { focus: [{ area: "Ownership", why: "Manager round", howToPrepare: "Pick two stories" }], likelyQuestions: [], stories: [], questionsToAsk: ["How is success measured?"], carryForward: ["Add numbers"], tips: [] };
        default:
          throw new Error(`Unexpected call ${call.json?.name}`);
      }
    },
  });
}

beforeEach(async () => {
  await resetDatabase(prisma());
  started.length = 0;
  moves = [];
  provider.current = scriptedModel();
});
afterAll(() => prisma().$disconnect());

async function startSession(questionTarget = 2) {
  const { id } = await createInterviewSession({
    company: "Ledgerly",
    role: "Senior Product Designer",
    jobDescription: "Own onboarding for our payments product.",
    focus: "MIXED",
    difficulty: "STANDARD",
    questionTarget,
  });
  await interviewStartJob.run({ sessionId: id }, context);
  return id;
}

async function answerOpen(sessionId: string, text: string) {
  const session = (await loadInterviewSession(sessionId))!;
  const open = session.turns.find((turn) => !turn.answeredAt)!;
  await answerTurn(sessionId, open.id, text);
  await interviewAnswerJob.run({ sessionId, turnId: open.id }, context);
}

describe("mock interviews", () => {
  it("plans the session and asks the first question, without showing what it's looking for as the question", async () => {
    const id = await startSession();
    const session = await loadInterviewSession(id);
    expect(session?.plan?.competencies.map((c) => c.name)).toEqual(["Product thinking", "Collaboration"]);
    expect(session?.turns).toMatchObject([{ index: 0, kind: "question", question: "Walk me through a product decision you owned.", lookingFor: "Problem, options, outcome." }]);
    expect(started.map((job) => job.type)).toEqual(["interview-start"]);
  });

  it("gives feedback on each answer, follows up at most once per question, and ends with a report", async () => {
    const id = await startSession(2);
    moves = ["follow-up", "follow-up", "end"]; // the second follow-up in a row isn't allowed
    await answerOpen(id, "I redesigned onboarding at Ledgerly.");
    await answerOpen(id, "We tested three flows.");
    let session = (await loadInterviewSession(id))!;
    // A follow-up, then (since a second follow-up isn't allowed) the next main question.
    expect(session.turns.map((turn) => turn.kind)).toEqual(["question", "follow-up", "question"]);
    expect(session.turns[0]!.feedback).toMatchObject({ score: 3, missingFacts: ["The drop-off before and after"] });

    await answerOpen(id, "I paired with engineers weekly.");
    session = (await loadInterviewSession(id))!;
    expect(session.status).toBe("COMPLETED");
    expect(session.report).toMatchObject({ overall: 3.3, recurringWeaknesses: ["No metrics"] });
    expect(session.turns.every((turn) => turn.feedback)).toBe(true);
  });

  it("never asks more main questions than planned", async () => {
    const id = await startSession(2);
    moves = ["question", "question", "question"];
    await answerOpen(id, "One.");
    await answerOpen(id, "Two.");
    const session = (await loadInterviewSession(id))!;
    expect(session.turns.filter((turn) => turn.kind === "question")).toHaveLength(2);
    expect(session.status).toBe("COMPLETED");
  });

  it("refuses a second answer to the same question", async () => {
    const id = await startSession();
    const [turn] = (await loadInterviewSession(id))!.turns;
    await answerTurn(id, turn!.id, "First.");
    await expect(answerTurn(id, turn!.id, "Again.")).rejects.toThrow(/already answered/);
  });

  it("tracks progress by competency across finished sessions", async () => {
    for (let i = 0; i < 2; i++) {
      const id = await startSession(1);
      moves = ["end"];
      await answerOpen(id, "An answer.");
    }
    const progress = await interviewProgress();
    expect(progress.timeline).toHaveLength(2);
    expect(progress.competencies).toEqual([{ competency: "Product thinking", first: 3.5, latest: 3.5, sessions: 2 }]);
  });
});

describe("interview loops", () => {
  it("prepares a round with what earlier rounds and practice showed", async () => {
    const loop = await prisma().interviewLoop.create({
      data: {
        company: "Ledgerly",
        role: "Senior Product Designer",
        rounds: {
          create: [
            { sort: 0, kind: "RECRUITER_SCREEN", notes: "They asked about salary early." },
            { sort: 1, kind: "HIRING_MANAGER", interviewer: "Priya, design manager", perspective: "Ownership and impact" },
          ],
        },
      },
      include: { rounds: { orderBy: { sort: "asc" } } },
    });
    const mock = scriptedModel();
    provider.current = mock;
    await prepareRoundJob.run({ roundId: loop.rounds[1]!.id }, context);
    const round = await prisma().interviewRound.findUniqueOrThrow({ where: { id: loop.rounds[1]!.id } });
    expect(round.prep).toMatchObject({ carryForward: ["Add numbers"], questionsToAsk: ["How is success measured?"] });
    expect(round.preparedWith).toBe("prepare-round@1");
    // The earlier round's notes reach the model.
    expect(JSON.stringify(mock.calls[0]!.messages)).toContain("They asked about salary early.");
  });

  it("describes the round's interviewer for a practice session", () => {
    expect(roundInterviewer({ kind: "HIRING_MANAGER", title: "", interviewer: "Priya, design manager", perspective: "Ownership and impact" })).toBe(
      "Hiring manager round; interviewer: Priya, design manager; they screen for: Ownership and impact",
    );
  });
});
