import { beforeEach, describe, expect, it, vi } from "vitest";

import { JobStatus } from "@/generated/prisma/enums";
import { createTestClient, resetDatabase } from "@/test/db";

import { loadCrew } from "./live";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const prisma = () => db.client!;

const now = new Date("2026-11-03T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

async function job(type: string, status: JobStatus, fields: { step?: string; error?: string; finishedAt?: Date } = {}) {
  return prisma().job.create({ data: { type, status, input: {}, ...fields } });
}

describe("loadCrew", () => {
  beforeEach(() => resetDatabase(prisma()));

  it("has everyone resting when there are no jobs, and makes nothing up", async () => {
    const { members, finished } = await loadCrew(now);
    expect(Object.values(members).every(({ status, last, step }) => status === "resting" && last === null && step === null)).toBe(true);
    expect(finished).toEqual([]);
  });

  it("shows a running job as its member's work, in the job's own words", async () => {
    await job("write-documents", JobStatus.RUNNING, { step: "Tailoring the resume" });
    await job("write-email", JobStatus.QUEUED);
    const { members } = await loadCrew(now);
    expect(members.tailor).toMatchObject({ status: "working", step: "Tailoring the resume", jobs: 2 });
    expect(members.scout.status).toBe("resting");
  });

  it("remembers what a member finished last", async () => {
    await job("skill-plan", JobStatus.DONE, { finishedAt: minutesAgo(30) });
    const { members, finished } = await loadCrew(now);
    expect(members.coach).toMatchObject({ status: "resting", last: { what: "Wrote a skill plan", at: minutesAgo(30).toISOString() } });
    expect(finished[0]).toMatchObject({ crew: "coach", handsOver: true, error: null });
  });

  it("is stuck after a recent failure, until newer work or time passes", async () => {
    await job("upwork-analyze", JobStatus.FAILED, { error: "The key was refused.", finishedAt: minutesAgo(5) });
    expect((await loadCrew(now)).members.appraiser).toMatchObject({ status: "stuck", error: "The key was refused." });
    await job("upwork-analyze", JobStatus.DONE, { finishedAt: minutesAgo(1) });
    expect((await loadCrew(now)).members.appraiser.status).toBe("resting");
  });

  it("forgets an old failure", async () => {
    await job("upwork-analyze", JobStatus.FAILED, { error: "The key was refused.", finishedAt: minutesAgo(90) });
    expect((await loadCrew(now)).members.appraiser.status).toBe("resting");
  });

  it("doesn't hand over small steps, but does hand over their failures", async () => {
    await job("interview-answer", JobStatus.DONE, { finishedAt: minutesAgo(2) });
    await job("refine", JobStatus.FAILED, { error: "No.", finishedAt: minutesAgo(1) });
    const { finished } = await loadCrew(now);
    expect(finished.map(({ handsOver }) => handsOver)).toEqual([true, false]);
    expect(finished[0]!.error).toBe("No.");
  });

  it("ignores job types no one does", async () => {
    await job("no-such-job", JobStatus.RUNNING);
    const { members } = await loadCrew(now);
    expect(Object.values(members).every(({ status }) => status === "resting")).toBe(true);
  });
});
