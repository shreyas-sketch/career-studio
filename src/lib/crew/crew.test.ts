import { describe, expect, it } from "vitest";

import { CREW_IDS, crewOfPath, crewSummary, describeWork, jobRole, restingCrew } from "./crew";

describe("the crew", () => {
  it("has someone for every agent's screen, and no one for the user's own", () => {
    expect(crewOfPath("/agent")).toBe("scout");
    expect(crewOfPath("/applications/abc")).toBe("tailor");
    expect(crewOfPath("/interviews/abc")).toBe("interviewer");
    expect(crewOfPath("/loops")).toBe("usher");
    expect(crewOfPath("/freelance")).toBe("prospector");
    expect(crewOfPath("/upwork/abc")).toBe("appraiser");
    expect(crewOfPath("/skills")).toBe("coach");
    expect(crewOfPath("/")).toBeUndefined();
    expect(crewOfPath("/settings")).toBeUndefined();
  });

  it("knows who does each job, and has no job for someone who doesn't exist", () => {
    expect(jobRole("write-documents")?.crew).toBe("tailor");
    expect(jobRole("upwork-analyze")?.crew).toBe("appraiser");
    expect(jobRole("no-such-job")).toBeUndefined();
    expect(CREW_IDS).toHaveLength(7);
  });

  it("says what's happening in the words of the job's own step", () => {
    expect(describeWork({ id: "tailor", step: "Tailoring the resume", about: "Stripe" })).toBe("Tailor is tailoring the resume for Stripe.");
    expect(describeWork({ id: "scout", step: "Searching for new postings", about: null })).toBe("Scout is searching for new postings.");
  });

  it("doesn't claim anyone's busy when no one is", () => {
    expect(crewSummary(restingCrew())).toBe("Nobody's working right now. Give the crew something to do.");
  });

  it("names everyone who's working", () => {
    const members = restingCrew();
    members.scout = { ...members.scout, status: "working", step: "Searching for new postings" };
    expect(crewSummary(members)).toBe("Scout is searching for new postings.");
    members.coach = { ...members.coach, status: "working", step: "Assessing where you stand and planning" };
    expect(crewSummary(members)).toBe("Scout and Coach are working for you right now.");
  });
});
