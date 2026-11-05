import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { runAsUser, TEST_USER_ID } from "@/lib/tenancy/context";
import { createTestClient, resetDatabase } from "@/test/db";

import { exportReport, listReports, loadReportView } from "./report";
import { sweepFdeData } from "./retention";
import { runReview } from "./review";
import { refreshReview, retryReview, startReview } from "./start";
import type { Coverage, ReportResult, Role } from "./types";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const ai = vi.hoisted(() => ({ current: undefined as unknown, usable: true }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => ai.current }));
vi.mock("@/lib/ai/config", async (original) => ({ ...(await original<object>()), isAiUsable: async () => ai.usable }));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: async () => ({ creativity: "BALANCED", strict: true, language: "English" }) }));
vi.mock("@/lib/accounts/db", () => ({ accountsQuery: async () => ({ rows: [] }) }));
const jobs = vi.hoisted(() => ({ started: [] as unknown[] }));
vi.mock("@/lib/jobs/runner", () => ({
  defineJob: <T,>(definition: T) => definition,
  startJob: async (_job: unknown, input: unknown) => {
    jobs.started.push(input);
    return { id: "job" };
  },
  findLatestJob: async () => null,
  isFinished: () => true,
}));
vi.mock("./config", async (original) => {
  const { createFixtureProvider } = await import("./providers/fixture");
  return {
    ...(await original<object>()),
    fdeConfig: () => ({
      runSpendLimitMicro: 100_000,
      dailySpendLimitMicro: 1_000_000,
      accountDailyReports: 3,
      shortlistSize: 10,
      benchmarkMaxAgeHours: 24,
      profileMaxAgeDays: 7,
      retentionDays: 90,
      linkedInDetailLimit: 10,
      modelUsdPerMillionTokens: null,
      fixtureMode: true,
    }),
    retrievalProvider: () => createFixtureProvider(),
  };
});
const market = vi.hoisted(() => ({ fail: null as string | null, calls: 0 }));
vi.mock("./market", async (original) => {
  const real = await original<typeof import("./market")>();
  return {
    ...real,
    discoverMarket: async () => {
      market.calls++;
      if (market.fail) throw new real.DiscoveryFailed(market.fail, []);
      return { roles: ROLES(), coverage: COVERAGE() };
    },
  };
});

const POSTING_A = "Acme Robotics needs engineers who ship Python services. You will work directly with customers on site. Experience with Rust is required.";
const POSTING_B = "Bluebird runs on TypeScript. You will work with customers every week and own production systems.";

function ROLES(): Role[] {
  const base = {
    source: "greenhouse",
    sourceLabel: "Greenhouse board",
    location: "London",
    remotePolicy: "",
    seniority: "Not stated",
    seniorityGroup: "unstated",
    applyUrl: null,
    fullText: true,
    postedAt: null,
    updatedAt: null,
    checkedAt: "2026-11-05T00:00:00.000Z",
    status: "open",
    otherLocations: [],
    reasons: ["The title names the role."],
    requirements: [],
    extractionError: null,
  };
  return [
    { ...base, id: "greenhouse:acme:1", externalId: "1", title: "Forward Deployed Engineer", employer: "Acme", url: "https://example.test/acme", description: POSTING_A },
    { ...base, id: "greenhouse:bluebird:2", externalId: "2", title: "Forward Deployed Engineer", employer: "Bluebird", url: "https://example.test/bluebird", description: POSTING_B },
  ] as unknown as Role[];
}

function COVERAGE(): Coverage {
  return { scope: "Global", queries: ["Forward Deployed Engineer"], searchedAt: "2026-11-05T00:00:00.000Z", sources: [], selectionRationale: "A curated market sample.", candidates: 2, duplicatesMerged: 0, excluded: [], target: { min: 8, max: 12, employers: 5 }, limits: ["Only 2 verified roles were available; the target is 8 to 12."] };
}

/** Quotes what it's given, plus one requirement from the other employer and one invented claim. */
function reply(call: { json?: { name: string }; messages: { content: string }[] }) {
  const content = call.messages.at(-1)?.content ?? "";
  if (call.json?.name === "fde_requirements") {
    const requirements = content.includes("Acme Robotics")
      ? [
          { text: "Python", excerpt: "engineers who ship Python services", level: "must", category: "engineering", key: "python", eligibility: null },
          { text: "Customers", excerpt: "work directly with customers on site", level: "must", category: "customer", key: "customer_facing", eligibility: null },
          { text: "Rust", excerpt: "Experience with Rust is required", level: "must", category: "engineering", key: "other_languages", eligibility: null },
          // Bluebird's words, offered for Acme's role: this has to be dropped.
          { text: "TypeScript", excerpt: "Bluebird runs on TypeScript", level: "must", category: "engineering", key: "typescript_javascript", eligibility: null },
        ]
      : [{ text: "TypeScript", excerpt: "Bluebird runs on TypeScript", level: "must", category: "engineering", key: "typescript_javascript", eligibility: null }];
    return { isCustomerFacingEngineering: true, requirements };
  }
  if (call.json?.name === "fde_evidence") {
    const requirements = JSON.parse(/Requirements \(from this role only\):\n([\s\S]*?)\n\nThe profile's sources:/.exec(content)?.[1] ?? "[]") as { id: string; text: string }[];
    const sources = JSON.parse(/The profile's sources:\n([\s\S]*)$/.exec(content)?.[1] ?? "[]") as { id: string; text: string }[];
    const python = sources.flatMap((source) => source.text.split(/\n+/).filter((line) => /Python/.test(line)).map((quote) => ({ sourceId: source.id, quote })))[0];
    return {
      assessments: requirements.map(({ id, text }) =>
        text === "Python"
          ? { requirementId: id, status: "demonstrated", evidence: [python], note: "Quoted.", action: "" }
          : text === "Rust"
            ? // No such line anywhere in the profile, so this can't stand.
              { requirementId: id, status: "demonstrated", evidence: [{ sourceId: sources[0].id, quote: "Wrote a Rust kernel for NASA" }], note: "Invented.", action: "" }
            : { requirementId: id, status: "not_shown", evidence: [], note: "Nothing shows this.", action: "Describe it." },
      ),
    };
  }
  if (call.json?.name === "fde_insights") return { summary: "Stand-in.", rewrites: [], questions: [], portfolio: [] };
  throw new Error(`No answer for ${call.json?.name}`);
}

const prisma = () => db.client!;
const context = { step: async () => {}, signal: new AbortController().signal };
const OTHER_USER = "7e570000000000000000000b";

beforeEach(async () => {
  await resetDatabase(prisma());
  jobs.started = [];
  market.fail = null;
  market.calls = 0;
  ai.usable = true;
  ai.current = new MockProvider({ reply: reply as never });
});

afterAll(() => db.client?.$disconnect());

async function reviewed(slug = "fixture-full") {
  const { id } = await startReview({ url: `https://www.linkedin.com/in/${slug}`, filters: { location: "", remoteOnly: false, seniority: "any" } });
  await runReview(id, context, { freshProfile: false, freshMarket: false, withFreelance: false });
  return id;
}

describe("a review, from the start of the job to the saved report", () => {
  it("keeps one employer's words to that employer and drops what the profile doesn't say", async () => {
    const id = await reviewed();
    const row = await prisma().fdeReport.findUniqueOrThrow({ where: { id } });
    const result = row.result as unknown as ReportResult;

    // Partial only because this stand-in model has no answer for the learning plan.
    expect(row.state).toBe("partial");
    expect(result.checks.planFailed).toBe(true);
    const benchmark = await prisma().fdeBenchmark.findUniqueOrThrow({ where: { id: row.benchmarkId! } });
    const [acme, bluebird] = benchmark.roles as unknown as Role[];
    expect(acme.requirements.map((requirement) => requirement.text)).toEqual(["Python", "Customers", "Rust"]);
    expect(bluebird.requirements.map((requirement) => requirement.text)).toEqual(["TypeScript"]);
    expect(result.checks.requirementsDropped).toBe(1);

    const rust = result.assessments.find((assessment) => assessment.requirementId === acme.requirements[2].id);
    expect(rust?.status).not.toBe("demonstrated");
    expect(result.checks.claimsDowngraded).toBeGreaterThan(0);
  });

  it("works out the scores from the assessments, not from the model", async () => {
    const id = await reviewed();
    const row = await prisma().fdeReport.findUniqueOrThrow({ where: { id } });
    const result = row.result as unknown as ReportResult;
    const acme = result.roleScores.find((score) => score.roleId === "greenhouse:acme:1");
    // Python is shown; customers and Rust are not. Three musts at two points each.
    expect(acme?.earned).toBe(2);
    expect(acme?.possible).toBe(6);
    expect(acme?.score).toBe(33);
    expect(result.market?.roleCount).toBe(2);
    expect(result.market?.rubric).toBe("fde-fit@1");
  });

  it("keeps the subject's data apart from the account's own profile", async () => {
    await prisma().profileField.create({ data: { key: "name", value: "Aaryan Shukla" } });
    await prisma().skill.create({ data: { name: "Account owner's own skill" } });
    const before = [await prisma().profileField.findMany(), await prisma().skill.findMany()];
    await reviewed();
    expect([await prisma().profileField.findMany(), await prisma().skill.findMany()]).toEqual(before);
    const snapshot = await prisma().fdeProfileSnapshot.findFirstOrThrow();
    expect(snapshot.ownerUserId).toBe(TEST_USER_ID);
    expect(snapshot.subjectProfileUrl).toContain("fixture-full");
  });

  it("reports a failed market search and doesn't fall back to an old one", async () => {
    await reviewed();
    const benchmarks = await prisma().fdeBenchmark.count();
    market.fail = "None of the sources could be read.";
    const first = await prisma().fdeReport.findFirstOrThrow();
    const { id } = await refreshReview({ id: first.id, refreshMarket: true });
    await runReview(id, context, { freshProfile: true, freshMarket: true, withFreelance: false });

    const row = await prisma().fdeReport.findUniqueOrThrow({ where: { id } });
    expect(row.state).toBe("failed");
    expect(row.errorCode).toBe("discovery_failed");
    expect(row.benchmarkId).toBeNull();
    expect(await prisma().fdeBenchmark.count()).toBe(benchmarks);
    // The report it was refreshing stays exactly as it was.
    expect((await prisma().fdeReport.findUniqueOrThrow({ where: { id: first.id } })).state).toBe(first.state);
  });

  it("doesn't pay for a market search when a fresh benchmark is there", async () => {
    await reviewed("fixture-full");
    await reviewed("fixture-no-photo");
    expect(market.calls).toBe(1);
    const second = await prisma().fdeReport.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(second.benchmarkOrigin).toBe("cached");
  });

  it("names the missing AI connection and still shows the roles", async () => {
    ai.usable = false;
    const id = await reviewed();
    const row = await prisma().fdeReport.findUniqueOrThrow({ where: { id } });
    expect(row.state).toBe("partial");
    expect(row.errorCode).toBe("ai_not_configured");
    expect((row.result as unknown as ReportResult).searchCoverage?.scope).toBe("Global");
  });

  it("withholds the score when only a name came back", async () => {
    const id = await reviewed("fixture-identity");
    const row = await prisma().fdeReport.findUniqueOrThrow({ where: { id } });
    expect(row.state).toBe("restricted");
    expect(row.errorCode).toBe("identity_only");
    expect((row.result as unknown as ReportResult).market).toBeNull();
  });

  it("stops at a credentials failure without marking it as a private profile", async () => {
    const id = await reviewed("fixture-401");
    const row = await prisma().fdeReport.findUniqueOrThrow({ where: { id } });
    expect(row.state).toBe("failed");
    expect(row.errorCode).toBe("invalid_credentials");
    expect(await prisma().fdeProfileSnapshot.count()).toBe(0);
  });
});

describe("starting a review", () => {
  const filters = { location: "", remoteOnly: false, seniority: "any" } as const;

  it("makes one report for two clicks at once", async () => {
    const url = "https://www.linkedin.com/in/fixture-full";
    const [first, second] = await Promise.all([startReview({ url, filters }), startReview({ url, filters })]);
    expect(first.id).toBe(second.id);
    expect(await prisma().fdeReport.count()).toBe(1);
    expect(jobs.started).toHaveLength(1);
  });

  it("makes a separate report for different filters", async () => {
    const url = "https://www.linkedin.com/in/fixture-full";
    const first = await startReview({ url, filters });
    const second = await startReview({ url, filters: { ...filters, remoteOnly: true } });
    expect(first.id).not.toBe(second.id);
  });

  it("stops at the account's daily limit", async () => {
    for (const slug of ["a-one", "a-two", "a-three"]) await startReview({ url: `https://www.linkedin.com/in/${slug}`, filters });
    await expect(startReview({ url: "https://www.linkedin.com/in/a-four", filters })).rejects.toThrow(/reviews for today/);
  });

  it("rejects an address that isn't a LinkedIn profile", async () => {
    await expect(startReview({ url: "http://169.254.169.254/in/x", filters })).rejects.toThrow();
    expect(await prisma().fdeReport.count()).toBe(0);
  });
});

describe("whose report it is", () => {
  it("shows nothing to another account", async () => {
    const id = await reviewed();
    expect(await loadReportView(id)).not.toBeNull();

    await runAsUser(OTHER_USER, async () => {
      expect(await loadReportView(id)).toBeNull();
      expect(await exportReport(id)).toBeNull();
      expect(await listReports()).toEqual([]);
      await expect(refreshReview({ id, refreshMarket: false })).rejects.toThrow(/doesn't exist/);
      await expect(retryReview(id)).rejects.toThrow(/doesn't exist/);
    });
  });

  it("never sends remote image addresses to the browser", async () => {
    const id = await reviewed();
    expect(JSON.stringify(await loadReportView(id))).not.toMatch(/licdn\.com/);
  });
});

describe("what's kept", () => {
  it("removes old reports and what only they used, and leaves recent ones", async () => {
    const id = await reviewed();
    const later = new Date(Date.now() + 91 * 86_400_000);
    expect(await sweepFdeData(new Date(), 90)).toBe(0);
    expect(await prisma().fdeReport.count()).toBe(1);

    expect(await sweepFdeData(later, 90)).toBe(1);
    expect(await prisma().fdeReport.findUnique({ where: { id } })).toBeNull();
    expect(await prisma().fdeProfileSnapshot.count()).toBe(0);
    expect(await prisma().fdeUsage.count()).toBe(0);
  });
});
