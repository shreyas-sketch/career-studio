import { describe, expect, it } from "vitest";

import { describeStep, describeWork, jobRole, moodOf, staffOfPath, STAFF_IDS } from "./staff";

describe("the staff", () => {
  it("knows who does each job, and no one does a job that doesn't exist", () => {
    expect(jobRole("write-documents")?.staff).toBe("editor");
    expect(jobRole("upwork-analyze")?.staff).toBe("analyst");
    expect(jobRole("no-such-job")).toBeUndefined();
    expect(STAFF_IDS).toHaveLength(7);
  });

  it("has someone for every agent's screen, and no one for the user's own", () => {
    expect(staffOfPath("/agent")).toBe("search");
    expect(staffOfPath("/applications/abc")).toBe("editor");
    expect(staffOfPath("/interviews/abc")).toBe("coach");
    expect(staffOfPath("/loops")).toBe("coordinator");
    expect(staffOfPath("/freelance")).toBe("researcher");
    expect(staffOfPath("/upwork/abc")).toBe("analyst");
    expect(staffOfPath("/skills")).toBe("advisor");
    expect(staffOfPath("/")).toBeUndefined();
    expect(staffOfPath("/settings")).toBeUndefined();
  });

  it("gives a robot the mood of its real work", () => {
    expect(moodOf("working")).toBe("working");
    expect(moodOf("queued")).toBe("waiting");
    expect(moodOf("stuck")).toBe("stuck");
    expect(moodOf("idle")).toBe("idle");
  });

  it("says what's happening in the words of the job's own step", () => {
    expect(describeWork({ id: "editor", step: "Tailoring the resume", about: "Stripe" })).toBe("Your resume editor is tailoring the resume for Stripe.");
    expect(describeStep({ step: "Searching for new postings", about: null })).toBe("Searching for new postings");
  });
});
