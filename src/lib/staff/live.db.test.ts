import { beforeEach, describe, expect, it, vi } from "vitest";

import { JobStatus } from "@/generated/prisma/enums";
import { createTestClient, resetDatabase } from "@/test/db";

import { loadStaff } from "./live";

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

describe("loadStaff", () => {
  beforeEach(() => resetDatabase(prisma()));

  it("has everyone idle when there are no jobs, and makes nothing up", async () => {
    const { members, finished } = await loadStaff(now);
    expect(Object.values(members).every(({ status, last, step }) => status === "idle" && last === null && step === null)).toBe(true);
    expect(finished).toEqual([]);
  });

  it("shows a running job as its member's work, in the job's own words", async () => {
    await job("write-documents", JobStatus.RUNNING, { step: "Tailoring the resume" });
    await job("write-email", JobStatus.QUEUED);
    const { members } = await loadStaff(now);
    expect(members.editor).toMatchObject({ status: "working", step: "Tailoring the resume", jobs: 2 });
    expect(members.search.status).toBe("idle");
  });

  it("remembers what a member finished last", async () => {
    await job("skill-plan", JobStatus.DONE, { finishedAt: minutesAgo(30) });
    const { members, finished } = await loadStaff(now);
    expect(members.advisor).toMatchObject({ status: "idle", last: { what: "Wrote a skill plan", at: minutesAgo(30).toISOString() } });
    expect(finished[0]).toMatchObject({ staff: "advisor", reports: true, error: null });
  });

  it("is stuck after a recent failure, until newer work or time passes", async () => {
    await job("upwork-analyze", JobStatus.FAILED, { error: "The key was refused.", finishedAt: minutesAgo(5) });
    expect((await loadStaff(now)).members.analyst).toMatchObject({ status: "stuck", error: "The key was refused." });
    await job("upwork-analyze", JobStatus.DONE, { finishedAt: minutesAgo(1) });
    expect((await loadStaff(now)).members.analyst.status).toBe("idle");
  });

  it("forgets an old failure", async () => {
    await job("upwork-analyze", JobStatus.FAILED, { error: "The key was refused.", finishedAt: minutesAgo(90) });
    expect((await loadStaff(now)).members.analyst.status).toBe("idle");
  });

  it("doesn't report small steps, but does report their failures", async () => {
    await job("interview-answer", JobStatus.DONE, { finishedAt: minutesAgo(2) });
    await job("refine", JobStatus.FAILED, { error: "No.", finishedAt: minutesAgo(1) });
    const { finished } = await loadStaff(now);
    expect(finished.map(({ reports }) => reports)).toEqual([true, false]);
    expect(finished[0]!.error).toBe("No.");
  });

  it("ignores job types no one does", async () => {
    await job("no-such-job", JobStatus.RUNNING);
    const { members } = await loadStaff(now);
    expect(Object.values(members).every(({ status }) => status === "idle")).toBe(true);
  });
});
