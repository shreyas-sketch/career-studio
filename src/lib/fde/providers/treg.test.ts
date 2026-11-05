import { describe, expect, it, vi } from "vitest";

import { mapJob, mapListings, mapProfile } from "./harvest-map";
import { classifyError, createTregProvider } from "./treg";
import { ProviderError } from "./types";

const fullProfile = {
  id: "ACoAA1",
  publicIdentifier: "sam-lee",
  linkedinUrl: "https://www.linkedin.com/in/sam-lee",
  firstName: "Sam",
  lastName: "Lee",
  headline: "Engineer",
  emails: ["sam@private.example"],
  pronoun: "they/them",
  location: { linkedinText: "Berlin, Germany" },
  about: "Long about text.",
  profilePicture: { url: "https://media.licdn.com/p.jpg" },
  coverPicture: { url: "https://media.licdn.com/c.jpg" },
  followerCount: 12,
  experience: [{ position: "Engineer", companyName: "Acme", companyLogo: { url: "https://media.licdn.com/l.jpg" }, description: "Did things.", startDate: { month: "Mar", year: 2021, text: "Mar 2021" }, endDate: { text: "Present" }, skills: ["Go"] }],
  education: [{ schoolName: "TU", degree: "BSc", startDate: { year: 2015, text: "2015" }, endDate: { year: 2019, text: "2019" } }],
  skills: [{ name: "Go", endorsements: "3" }],
  certifications: [],
  languages: [{ name: "German", proficiency: "Native" }],
};

describe("mapping a provider's profile", () => {
  const map = (element: unknown) => mapProfile({ element, status: 200 }, "https://www.linkedin.com/in/sam-lee", "Treg (HarvestAPI)");

  it("maps every field, and the real image fields", () => {
    const profile = map(fullProfile);
    expect(profile).toMatchObject({ name: "Sam Lee", location: "Berlin, Germany", photo: "photo", banner: "banner", about: "Long about text.", followers: 12, connections: null, currentPosition: "Engineer at Acme", quality: "full" });
    expect(profile.images).toMatchObject({ photo: "https://media.licdn.com/p.jpg", banner: "https://media.licdn.com/c.jpg", "co-0": "https://media.licdn.com/l.jpg" });
    expect(profile.experience[0]).toMatchObject({ current: true, end: null, start: { year: 2021, month: 3 }, skills: ["Go"] });
  });

  it("never carries an email address or pronouns", () => {
    const text = JSON.stringify(map(fullProfile));
    expect(text).not.toContain("private.example");
    expect(text).not.toContain("they/them");
  });

  it("keeps empty apart from not retrieved", () => {
    const { sections } = map(fullProfile);
    expect(sections.certifications).toBe("empty");
    expect(sections.projects).toBe("not_retrieved");
    expect(sections.experience).toBe("present");
  });

  it("falls back to no photo, never to something invented", () => {
    const profile = map({ ...fullProfile, profilePicture: { url: "http://insecure.test/p.jpg" }, photo: undefined });
    expect(profile.photo).toBeNull();
    expect(profile.images.photo).toBeUndefined();
  });

  it("calls a record with only a name identity-only, and full only when the core sections came", () => {
    expect(map({ firstName: "Sam", lastName: "Lee", linkedinUrl: "https://www.linkedin.com/in/sam-lee" }).quality).toBe("identity");
    expect(map(fullProfile).quality).toBe("full");
    expect(map({ ...fullProfile, about: undefined }).quality).toBe("partial");
  });

  it("treats a 200 with no record as inaccessible", () => {
    expect(() => mapProfile({ element: null, status: 404, error: "Profile not found" }, "u", "p")).toThrow(/Profile not found/);
    expect(() => mapProfile({ element: {} }, "u", "p")).toThrow(ProviderError);
  });
});

describe("mapping job records", () => {
  it("reads search listings, skipping incomplete ones", () => {
    expect(mapListings({ elements: [{ id: "1", title: "FDE", url: "https://www.linkedin.com/jobs/view/1", company: { name: "Acme" }, location: { linkedinText: "Remote" } }, { id: "2" }] })).toEqual([{ id: "1", title: "FDE", employer: "Acme", location: "Remote", url: "https://www.linkedin.com/jobs/view/1", postedAt: null }]);
  });

  it("takes a job's status from its state, and unknown when it doesn't say", () => {
    const job = (jobState: string | undefined, extra = {}) => mapJob({ element: { id: "1", title: "FDE", linkedinUrl: "https://www.linkedin.com/jobs/view/1", descriptionText: "Text", jobState, ...extra } });
    expect(job("LISTED").status).toBe("open");
    expect(job("CLOSED").status).toBe("closed");
    expect(job(undefined).status).toBe("unknown");
    expect(job("LISTED", { expireAt: "2020-01-01T00:00:00Z" }).status).toBe("closed");
  });
});

describe("classifying errors", () => {
  it("tells credentials, permission, balance, limits and access apart", () => {
    expect(classifyError(401, true, {}, null).code).toBe("invalid_credentials");
    expect(classifyError(403, true, {}, null).code).toBe("permission");
    expect(classifyError(402, true, { error: "insufficient_balance" }, null).code).toBe("depleted");
    expect(classifyError(402, true, { error: "route_max_cost" }, null).code).toBe("spend_limit");
    expect(classifyError(429, true, { error: "trial_allowance_reached" }, null).code).toBe("depleted");
    expect(classifyError(429, true, { error: "provider_rate_limited", retry_after_s: 7 }, null)).toMatchObject({ code: "rate_limited", retryAfterSeconds: 7 });
    expect(classifyError(404, false, {}, null).code).toBe("inaccessible");
    expect(classifyError(403, false, {}, null).code).toBe("inaccessible");
    expect(classifyError(502, false, {}, null).code).toBe("provider_down");
  });

  it("only ever retries what could succeed later", () => {
    expect(classifyError(401, true, {}, null).retryable).toBe(false);
    expect(classifyError(402, true, {}, null).retryable).toBe(false);
    expect(classifyError(429, true, {}, null).retryable).toBe(true);
  });
});

const TOKEN = "test-token-not-real";

function answers(...responses: (() => Response)[]) {
  const fetchImpl = vi.fn<typeof fetch>();
  for (const respond of responses) fetchImpl.mockImplementationOnce(async () => respond());
  return fetchImpl;
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("calling Treg", () => {
  const build = (fetchImpl: typeof fetch, retries = 2) => createTregProvider({ token: TOKEN, fetchImpl, retries, sleep: async () => {}, newKey: () => "same-key" });

  it("sends the token as X-Treg-Token, sets a price ceiling and reads the charge", async () => {
    const fetchImpl = answers(json({ element: fullProfile }, 200, { "x-treg-cost-micro": "6400", "x-treg-call-id": "c1", "x-treg-cache": "hit" }));
    const { profile, charge } = await build(fetchImpl).readProfile("https://www.linkedin.com/in/sam-lee", { fresh: false });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://treg.to/call/harvestapi.linkedin.user.profile?url=https%3A%2F%2Fwww.linkedin.com%2Fin%2Fsam-lee");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Treg-Token"]).toBe(TOKEN);
    expect(headers.Authorization).toBeUndefined();
    expect(headers["X-Treg-Route-Max-Cost"]).toBeDefined();
    expect(charge).toEqual({ provider: "treg", tool: "harvestapi.linkedin.user.profile", costMicro: 6400, callId: "c1", cached: true });
    expect(profile.name).toBe("Sam Lee");
  });

  it("asks for a live read only on a deliberate refresh", async () => {
    const fetchImpl = answers(json({ element: fullProfile }), json({ element: fullProfile }));
    await build(fetchImpl).readProfile("u", { fresh: false });
    await build(fetchImpl).readProfile("u", { fresh: true });
    expect((fetchImpl.mock.calls[0][1]?.headers as Record<string, string>)["Cache-Control"]).toBeUndefined();
    expect((fetchImpl.mock.calls[1][1]?.headers as Record<string, string>)["Cache-Control"]).toBe("no-cache");
  });

  it("never retries bad credentials or an empty balance", async () => {
    const unauthorized = answers(json({}, 401, { "x-treg-error": "1" }));
    await expect(build(unauthorized).readProfile("u", { fresh: false })).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(unauthorized).toHaveBeenCalledTimes(1);
    const broke = answers(json({ error: "insufficient_balance" }, 402, { "x-treg-error": "1" }));
    await expect(build(broke).readProfile("u", { fresh: false })).rejects.toMatchObject({ code: "depleted" });
    expect(broke).toHaveBeenCalledTimes(1);
  });

  it("retries a limit a bounded number of times, with the same key, so nothing is charged twice", async () => {
    const fetchImpl = answers(json({ error: "share_busy" }, 429, { "x-treg-error": "1" }), json({}, 502), json({ element: fullProfile }));
    await build(fetchImpl).readProfile("u", { fresh: false });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const keys = fetchImpl.mock.calls.map(([, init]) => (init?.headers as Record<string, string>)["Idempotency-Key"]);
    expect(new Set(keys).size).toBe(1);

    const always = answers(json({}, 429), json({}, 429), json({}, 429), json({}, 429));
    await expect(build(always).readProfile("u", { fresh: false })).rejects.toMatchObject({ code: "rate_limited" });
    expect(always).toHaveBeenCalledTimes(3);
  });

  it("reports a timeout as a timeout", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("network"));
    await expect(build(fetchImpl, 0).readProfile("u", { fresh: false })).rejects.toMatchObject({ code: "timeout" });
  });

  it("doesn't call anything without a token, and says exactly what's missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = createTregProvider({ token: undefined, fetchImpl });
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.readProfile("u", { fresh: false })).rejects.toMatchObject({ code: "not_configured", message: expect.stringContaining("TREG_API_TOKEN") });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("checks the connection with the free tool, and the result never contains the token", async () => {
    const fetchImpl = answers(json({ elements: [{ id: "1" }], status: 200 }, 200, { "x-treg-cost-micro": "0" }));
    const check = await build(fetchImpl).checkConnection();
    expect(String(fetchImpl.mock.calls[0][0])).toContain("harvestapi.linkedin.geo.search");
    expect(check.ok).toBe(true);
    expect(JSON.stringify(check)).not.toContain(TOKEN);

    const bad = await build(answers(json({}, 401, { "x-treg-error": "1" }))).checkConnection();
    expect(bad).toMatchObject({ ok: false, code: "invalid_credentials" });
    expect(JSON.stringify(bad)).not.toContain(TOKEN);
  });
});
