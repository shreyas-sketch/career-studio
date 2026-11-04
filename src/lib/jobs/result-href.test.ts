import { describe, expect, it } from "vitest";

import { resultHref, roundIds } from "./result-href";

const job = (type: string, input: unknown = {}, applicationId: string | null = null) => ({ id: "job1", type, applicationId, input });
const loops = new Map([["round1", "loop1"]]);

describe("where a result is", () => {
  it.each([
    [job("skill-plan", { id: "p1" }), "/skills", "/skills/p1"],
    [job("upwork-analyze", { id: "u1" }), "/upwork", "/upwork/u1"],
    [job("upwork-proposal", { id: "u1", instructions: "" }), "/upwork", "/upwork/u1"],
    [job("resume-version-coach", { id: "v1" }), "/resumes", "/resumes/v1"],
    [job("interview-finish", { sessionId: "s1" }), "/interviews", "/interviews/s1"],
    [job("round-prepare", { roundId: "round1" }), "/loops", "/loops/loop1"],
    [job("round-prepare", { roundId: "gone" }), "/loops", "/loops"],
    [job("import-profile", { resume: "text" }), "/resumes", "/profile/import?job=job1"],
    [job("startups-refresh"), "/agent", "/startups"],
    [job("freelance-refresh"), "/freelance", "/freelance"],
    [job("write-documents", {}, "a1"), "/resumes", "/applications/a1"],
    [job("skill-plan", {}), "/skills", "/skills"],
    [job("skill-plan", { id: "../settings" }), "/skills", "/skills/..%2Fsettings"],
  ])("sends %j under %s to %s", (finished, screen, href) => {
    expect(resultHref(finished, screen, loops)).toBe(href);
  });

  it("finds the rounds to look up", () => {
    expect(roundIds([job("round-prepare", { roundId: "r1" }), job("round-prepare", { roundId: "r1" }), job("skill-plan", { id: "p" })])).toEqual(["r1"]);
  });
});
