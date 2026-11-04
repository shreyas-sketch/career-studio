import { afterEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";

import { placeOf } from "../place";
import { fetchHnStartups, startupFromHnPost } from "./hn";
import { fetchYcStartups, readJobTitle, startupFromJob } from "./yc";

vi.mock("@/lib/env", () => ({ env: {} }));

afterEach(() => vi.unstubAllGlobals());

const berlin = placeOf({ city: "Berlin", country: "Germany" });

describe("YC startups' job posts (#222)", () => {
  it("reads the company, batch and the rest from a title", () => {
    expect(readJobTitle("Telli (YC F24) is hiring engineers and designers [Berlin, on-site]")).toEqual({ company: "Telli", batch: "F24", rest: "is hiring engineers and designers [Berlin, on-site]" });
    expect(readJobTitle("Flexport Is Hiring a Biz Ops Leader")).toEqual({ company: "Flexport", batch: "", rest: "is hiring a Biz Ops Leader" });
    expect(readJobTitle("Something else")).toEqual({ company: "Something else", batch: "", rest: "" });
  });

  it("makes a startup from a job post, with its own site when it links there", () => {
    const startup = startupFromJob({ id: 7, type: "job", title: "Lingo.dev (YC F24) is hiring a senior content engineer (Remote, worldwide)", url: "https://lingo.dev/en/careers/1", time: 1_790_000_000 });
    expect(startup).toMatchObject({
      source: "YC",
      externalId: "7",
      company: "Lingo.dev",
      website: "https://lingo.dev",
      location: "Remote, worldwide",
      remote: true,
      stage: "YC F24",
      roles: ["senior content engineer (Remote, worldwide)"],
      links: [
        { label: "Job post", url: "https://lingo.dev/en/careers/1" },
        { label: "On Hacker News", url: "https://news.ycombinator.com/item?id=7" },
      ],
      postedAt: new Date(1_790_000_000_000).toISOString(),
    });
    expect(startupFromJob({ id: 8, type: "job", title: "9 Mothers (YC P26) Is Hiring in Austin, TX", url: "https://www.ycombinator.com/companies/x/jobs/y" })).toMatchObject({
      website: "",
      location: "Austin, TX",
      roles: [],
    });
    expect(startupFromJob({ id: 9, type: "story", title: "Show HN" })).toBeNull();
    expect(startupFromJob({ id: 10, type: "job", title: "Acme (YC W20) Is Hiring", dead: true })).toBeNull();
  });

  it("fetches the job posts from Hacker News' API, skipping ones that don't answer", async () => {
    const requests = stubFetch(({ url }) => {
      if (url.pathname.endsWith("/jobstories.json")) return json([1, 2]);
      if (url.pathname.endsWith("/item/1.json")) return json({ id: 1, type: "job", title: "Acme (YC W24) Is Hiring", text: "<p>Join us</p>" });
      return json({}, { status: 500 });
    });
    expect(await fetchYcStartups()).toMatchObject([{ company: "Acme", details: "Join us" }]);
    expect(requests[0].headers.get("user-agent")).toMatch(/Dossier\/.*PRIVACY\.md#startups/);
  });

  it("fails when the API changes or answers nothing", async () => {
    stubFetch(() => json({ not: "a list" }));
    await expect(fetchYcStartups()).rejects.toThrow("changed its format");
    stubFetch(({ url }) => (url.pathname.endsWith("/jobstories.json") ? json([1]) : json({}, { status: 500 })));
    await expect(fetchYcStartups()).rejects.toThrow("didn't answer for any of its job posts");
  });
});

describe("Hacker News' Who is hiring? (#222)", () => {
  const post = (text: string, id = 1) => ({ id, text, created_at: "2026-10-01T16:00:00Z" });

  it("keeps a post in the profile's country, with the addresses it gives", () => {
    const startup = startupFromHnPost(
      post("PAGNOS | Cloud Engineer (TypeScript) | REMOTE (Germany) | Full-time<p>We build things. Apply: jobs@pagnos.de or ask jane at pagnos dot de. https://pagnos.de</p>"),
      berlin,
    );
    expect(startup).toMatchObject({
      source: "HN",
      company: "PAGNOS",
      website: "https://pagnos.de",
      location: "REMOTE (Germany)",
      remote: true,
      roles: ["Cloud Engineer (TypeScript)"],
      emails: [{ email: "jobs@pagnos.de", label: "Hiring", from: "https://news.ycombinator.com/item?id=1", onRequest: false }],
      links: [
        { label: "Hiring post", url: "https://news.ycombinator.com/item?id=1" },
        { label: "Website", url: "https://pagnos.de" },
      ],
    });
  });

  it("leaves out posts only for other places, and reads rounds and batches", () => {
    expect(startupFromHnPost(post("Acme | Engineer | REMOTE (US Timezones)"), berlin)).toBeNull();
    expect(startupFromHnPost(post("Acme | Engineer | New York, NY | Onsite"), berlin)).toBeNull();
    expect(startupFromHnPost(post("Acme (YC W24) | Engineer | Berlin | Series A"), berlin)).toMatchObject({ company: "Acme", stage: "Series A", remote: false });
    expect(startupFromHnPost(post("Tiller (YC W24) | Engineer | Berlin"), berlin)).toMatchObject({ company: "Tiller", stage: "YC W24" });
    expect(startupFromHnPost(post("Acme | Engineer | New York, NY | Onsite"), placeOf({ city: "", country: "" }))).toMatchObject({ location: "New York, NY · Onsite" });
    expect(startupFromHnPost({ id: 2, text: null }, berlin)).toBeNull();
    expect(startupFromHnPost(post("| x"), berlin)).toBeNull();
  });

  it("reads this month's thread through Algolia", async () => {
    stubFetch(({ url }) => {
      if (url.pathname.endsWith("/search_by_date"))
        return json({ hits: [{ objectID: "9", title: "Ask HN: Who wants to be hired? (October 2026)" }, { objectID: "10", title: "Ask HN: Who is hiring? (October 2026)" }] });
      if (url.pathname.endsWith("/items/10")) return json({ children: [post("Acme | Engineer | Berlin", 11), post("Other | Engineer | Paris, France", 12), { bad: true }] });
      return json({}, { status: 404 });
    });
    expect((await fetchHnStartups(berlin)).map((startup) => startup.externalId)).toEqual(["11"]);
  });

  it("fails clearly when there's no thread or the format changed", async () => {
    stubFetch(() => json({ hits: [] }));
    await expect(fetchHnStartups(berlin)).rejects.toThrow("has no hiring thread this month");
    stubFetch(() => json({ nope: 1 }));
    await expect(fetchHnStartups(berlin)).rejects.toThrow("changed its format");
    stubFetch(({ url }) => (url.pathname.endsWith("/search_by_date") ? json({ hits: [{ objectID: "10", title: "Ask HN: Who is hiring? (October 2026)" }] }) : json({ children: "x" })));
    await expect(fetchHnStartups(berlin)).rejects.toThrow("changed its format");
  });
});

describe("reading a hiring post's heading, in any order (QA, November 2026)", () => {
  const anywhere = placeOf({ city: "", country: "" });
  const mumbai = placeOf({ city: "Mumbai", country: "India" });
  const post = (heading: string, body = "We build things.") => ({ id: 1, text: `<p>${heading}</p><p>${body}</p>`, created_at: "2026-11-01T00:00:00Z" });

  it.each([
    ["Cologne, Germany | UMH | Product Engineer | Onsite, partly remote", "UMH"],
    ["UMH | Product Engineer | Cologne, Germany", "UMH"],
    ["Product Engineer | UMH | Cologne, Germany", "UMH"],
    ["India | Acme Payments | Software Engineer | Remote", "Acme Payments"],
    ["Senior Developer | Remote | Full-time | Tiller", "Tiller"],
    ["Tiller (YC W24) | Founding Engineer | Remote", "Tiller"],
    ["Developer Tools Inc | Backend Engineer | SF", "Developer Tools Inc"],
    ["$120k | Fieldnote | Designer | Berlin", "Fieldnote"],
  ])("finds the company in %s", (heading, company) => {
    expect(startupFromHnPost(post(heading), anywhere)?.company).toBe(company);
  });

  it.each(["India | Software Engineer", "Software Engineer", "SEEKING FREELANCER | Remote", "Berlin, Germany | Designer"])("won't call a place, role or label a company: %s", (heading) => {
    expect(startupFromHnPost(post(heading), anywhere)?.company).toBe("Company not named");
  });

  it("falls back on the site's address", () => {
    expect(startupFromHnPost(post("Software Engineer | Remote", 'See <a href="https://www.tiller.dev/jobs">our page</a>'), anywhere)?.company).toBe("tiller.dev");
  });

  it("keeps the example from QA as what it is", () => {
    const umh = startupFromHnPost(post("Cologne, Germany | UMH | Product Engineer | Onsite, partly remote"), anywhere);
    expect(umh).toMatchObject({ company: "UMH", remote: false, roles: ["Product Engineer"] });
    expect(umh?.location).toContain("Cologne, Germany");
    expect(umh?.location).toContain("partly remote");
  });

  it("doesn't offer an onsite or partly remote job elsewhere", () => {
    expect(startupFromHnPost(post("Cologne, Germany | UMH | Product Engineer | Onsite, partly remote"), mumbai)).toBeNull();
    expect(startupFromHnPost(post("Cologne, Germany | UMH | Engineer | Hybrid"), mumbai)).toBeNull();
    expect(startupFromHnPost(post("UMH | Engineer | Onsite in Cologne, no remote"), mumbai)).toBeNull();
  });

  it("does offer it where it is", () => {
    expect(startupFromHnPost(post("Cologne, Germany | UMH | Product Engineer | Hybrid"), berlin)?.company).toBe("UMH");
  });

  it("tells open, restricted and worldwide remote apart", () => {
    expect(startupFromHnPost(post("Tiller | Engineer | Remote (worldwide)"), mumbai)?.remote).toBe(true);
    expect(startupFromHnPost(post("Tiller | Engineer | Remote (US only)"), mumbai)).toBeNull();
    expect(startupFromHnPost(post("Tiller | Engineer | Remote (India)"), mumbai)?.remote).toBe(true);
  });
});
