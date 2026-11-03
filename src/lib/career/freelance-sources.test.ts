import { describe, expect, it } from "vitest";

import { freelancePrefsSchema } from "./freelance-prefs";
import { fromHimalayas, fromHnThread, fromJobicy, fromRemoteOk, fromRemotive, keywordScore } from "./freelance-sources";
import { relevant, searchKeywords } from "./freelance";

// Test fixtures in each source's documented shape. They exist for these
// tests only; the app only ever shows what the sources really return.

describe("freelance sources", () => {
  it("keeps Remotive's contract and freelance jobs, with the link back", () => {
    const items = fromRemotive({
      "0-legal-notice": "…",
      "job-count": 2,
      jobs: [
        { id: 1, url: "https://remotive.com/remote-jobs/design/a-1", title: "Webflow designer", company_name: "Acme", category: "Design", job_type: "contract", publication_date: "2026-11-01T10:00:00", candidate_required_location: "Worldwide", salary: "$50-70/hr", description: "<p>Build <b>landing pages</b></p>" },
        { id: 2, url: "https://remotive.com/remote-jobs/dev/b-2", title: "Staff engineer", company_name: "Big", job_type: "full_time", description: "" },
      ],
    });
    expect(items).toEqual([
      expect.objectContaining({ source: "REMOTIVE", externalId: "1", url: "https://remotive.com/remote-jobs/design/a-1", description: expect.stringContaining("landing pages"), budget: "$50-70/hr", kind: "contract" }),
    ]);
  });

  it("reads Jobicy's arrays and salary range", () => {
    const items = fromJobicy({
      jobs: [
        { id: 7, url: "https://jobicy.com/jobs/7-copy", jobTitle: "Copywriter", companyName: "Inkly", jobIndustry: ["Copywriting"], jobType: ["Contract"], jobGeo: "Anywhere", jobDescription: "<p>Write</p>", pubDate: "2026-10-30 08:00:00", salaryMin: 30, salaryMax: 45, salaryCurrency: "USD", salaryPeriod: "hour" },
        { id: 8, url: "https://jobicy.com/jobs/8", jobTitle: "Full-time PM", jobType: ["Full-Time"] },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "JOBICY", budget: "USD 30–45 per hour", kind: "contract", location: "Anywhere" });
  });

  it("skips Remote OK's legal notice and keeps contract roles", () => {
    const items = fromRemoteOk([
      { legal: "Please link back to the URL on Remote OK and mention Remote OK as a source." },
      { id: "123", url: "https://remoteok.com/remote-jobs/123", position: "Freelance React developer", company: "Shopsy", tags: ["react", "contract"], date: "2026-11-02T00:00:00Z", description: "<p>Help us ship</p>", salary_min: 0 },
      { id: "124", url: "https://remoteok.com/remote-jobs/124", position: "Senior Backend Engineer", tags: ["go"] },
    ]);
    expect(items.map((item) => item.externalId)).toEqual(["123"]);
    expect(items[0]!.kind).toBe("contract");
  });

  it("keeps Himalayas' contract roles, linked to their Himalayas page", () => {
    const items = fromHimalayas({
      jobs: [
        { title: "Data analyst (contract)", companyName: "Metric", employmentType: "Contractor", guid: "https://himalayas.app/companies/metric/jobs/data-analyst", pubDate: 1793500000, categories: ["Data"], minSalary: 60000, maxSalary: 80000, currency: "USD" },
        { title: "Engineer", employmentType: "Full Time", guid: "https://himalayas.app/x" },
      ],
    });
    expect(items).toEqual([expect.objectContaining({ source: "HIMALAYAS", url: "https://himalayas.app/companies/metric/jobs/data-analyst", budget: "USD 60,000–80,000" })]);
    expect(items[0]!.postedAt).toMatch(/^2026-/);
  });

  it("keeps only 'SEEKING FREELANCER' posts from Hacker News' thread", () => {
    const items = fromHnThread({
      children: [
        { id: 1, author: "acme", text: "SEEKING FREELANCER - Remote<p>Need a Shopify developer for 3 weeks", created_at: "2026-11-01T00:00:00Z" },
        { id: 2, author: "dev", text: "SEEKING WORK - Remote<p>I build apps" },
      ],
    });
    expect(items).toEqual([expect.objectContaining({ source: "HN", externalId: "1", url: "https://news.ycombinator.com/item?id=1", location: "Remote" })]);
  });

  it("refuses a source whose format changed, rather than showing nothing silently", () => {
    expect(() => fromRemotive({ nope: true })).toThrow(/changed its format/);
  });
});

describe("matching listings to preferences", () => {
  const listing = (title: string, kind = "contract", description = "") => ({
    source: "REMOTIVE" as const,
    externalId: title,
    title,
    client: "",
    url: "https://remotive.com/x",
    description,
    budget: "",
    kind,
    location: "",
    tags: [],
    postedAt: null,
  });

  it("ranks by where keywords appear, and drops what they avoid", () => {
    const prefs = freelancePrefsSchema.parse({ keywords: ["webflow", "landing page"], avoid: "crypto" });
    const results = relevant(
      [listing("Landing page designer", "contract", "webflow"), listing("Webflow developer"), listing("Webflow for a crypto exchange"), listing("Accountant")],
      prefs,
      prefs.keywords,
    );
    expect(results.map(({ item }) => item.title)).toEqual(["Landing page designer", "Webflow developer"]);
  });

  it("keeps only the contract types they want", () => {
    const prefs = freelancePrefsSchema.parse({ kinds: ["freelance"] });
    expect(relevant([listing("A", "part-time"), listing("B", "freelance")], prefs, []).map(({ item }) => item.title)).toEqual(["B"]);
  });

  it("searches the profile's headline and skills when no keywords are set", () => {
    const keywords = searchKeywords(freelancePrefsSchema.parse({}), {
      basics: { headline: "Product designer, Webflow developer" },
      skills: [{ name: "Figma" }, { name: "Prototyping" }],
    } as never);
    expect(keywords).toEqual(["Product designer", "Webflow developer", "Figma", "Prototyping"]);
  });

  it("scores title matches above body matches", () => {
    expect(keywordScore(listing("React developer"), ["react"])).toBeGreaterThan(keywordScore(listing("Developer", "contract", "react"), ["react"]));
  });
});
