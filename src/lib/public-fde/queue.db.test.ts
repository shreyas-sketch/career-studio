import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The test database, and a server set up as for the public review, but with
// nothing that can spend money: fixture profiles instead of LinkedIn reads,
// no data-service token, a model key that only reaches an address nothing
// listens on, and the analysis itself stubbed below. This checks queuing,
// limits, isolation and recovery; it says nothing about the live providers.
vi.hoisted(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
  if (!process.env.TEST_DATABASE_URL) url.pathname = `${url.pathname}_test`;
  if (!url.pathname.endsWith("_test")) throw new Error("Refusing to run against a database whose name doesn't end in _test.");
  process.env.DATABASE_URL = url.toString();
  process.env.CAREER_STUDIO_NO_TEST_USER = "1";
  process.env.DOSSIER_SECRET ??= "test-secret-test-secret-test-secret-1234";
  process.env.FDE_FIXTURE_MODE = "1";
  delete process.env.TREG_API_TOKEN;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-a-real-key-000000";
  process.env.PUBLIC_FDE_ANTHROPIC_TEST_BASE_URL = "http://127.0.0.1:9";
});

const stub = vi.hoisted(() => ({ analysing: 0, peakAnalysing: 0, benchmarkBuilds: 0, failNext: null as null | (() => Error) }));

vi.mock("@/lib/fde/review", async (original) => {
  const actual = await original<typeof import("@/lib/fde/review")>();
  const { prisma } = await import("@/lib/prisma");
  return {
    ...actual,
    // The analysis, stubbed: it takes a little while, counts how many run at once, and writes a finished report.
    runReview: vi.fn(async (id: string) => {
      stub.analysing++;
      stub.peakAnalysing = Math.max(stub.peakAnalysing, stub.analysing);
      try {
        await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 60));
        if (stub.failNext) {
          const make = stub.failNext;
          stub.failNext = null;
          throw make();
        }
        await prisma.fdeReport.update({ where: { id }, data: { state: "complete" } });
        return "complete";
      } finally {
        stub.analysing--;
      }
    }),
    runFreelance: vi.fn(async () => 0),
    ensureBenchmark: vi.fn(async () => {
      stub.benchmarkBuilds++;
      await new Promise((resolve) => setTimeout(resolve, 150));
      const saved = await prisma.fdeBenchmark.create({
        data: { scopeKey: actual.scopeKeyOf({ location: "", remoteOnly: false, seniority: "any" }), version: Date.now() % 1_000_000, filters: {}, roles: [], coverage: {}, rubricVersion: (await import("@/lib/fde/rubric")).RUBRIC_VERSION, expiresAt: new Date(Date.now() + 3_600_000) },
      });
      return { id: saved.id, reused: false, roles: 0 };
    }),
  };
});

import { accountsPool } from "@/lib/accounts/db";
import { prisma } from "@/lib/prisma";

import { ensureQueueSchema, Q, q, queuePool } from "./db";
import { newGuestId, ownerOf } from "./guest";
import { ServiceBusy, ServiceUnavailable } from "./model";
import { readControls, updateControls } from "./ops";
import { claim, heartbeat, jobFor, reapExpiredLeases, retryReport, submitReport } from "./queue";
import { deleteGuestReport, sweepPublicFde } from "./retention";
import { asPublicTenant, ensurePublicTenant } from "./tenant";
import { loadPublicReport } from "./view";
import { ensureSharedBenchmark, tick } from "./worker";

const profileUrl = (slug: string) => `https://www.linkedin.com/in/${slug}`;
const SHARED_NETWORK = "same-office-wifi";

async function resetPublic() {
  await q(`TRUNCATE ${Q}.jobs, ${Q}.controls, ${Q}.cooldowns, ${Q}.incidents, ${Q}.spend`);
  await asPublicTenant(async () => {
    await prisma.fdeReport.deleteMany({});
    await prisma.fdeProfileSnapshot.deleteMany({});
    await prisma.fdeUsage.deleteMany({});
    await prisma.fdeBenchmark.deleteMany({});
  });
  stub.analysing = 0;
  stub.peakAnalysing = 0;
  stub.benchmarkBuilds = 0;
  stub.failNext = null;
}

async function freshBenchmark() {
  const { scopeKeyOf } = await import("@/lib/fde/review");
  const { RUBRIC_VERSION } = await import("@/lib/fde/rubric");
  await asPublicTenant(() =>
    prisma.fdeBenchmark.create({ data: { scopeKey: scopeKeyOf({ location: "", remoteOnly: false, seniority: "any" }), version: 1, filters: {}, roles: [], coverage: {}, rubricVersion: RUBRIC_VERSION, expiresAt: new Date(Date.now() + 3_600_000) } }),
  );
}

/** Runs the worker until nothing is open, recording the most jobs running at once in each lane. */
async function drain(limitMs = 60_000) {
  const peak = { profile: 0, analysis: 0 };
  const until = Date.now() + limitMs;
  for (;;) {
    await tick();
    const { rows } = await q<{ stage: string; n: number }>(`SELECT stage, count(*)::int AS n FROM ${Q}.jobs GROUP BY stage`);
    const count = Object.fromEntries(rows.map((row) => [row.stage, row.n]));
    peak.profile = Math.max(peak.profile, count.profile_running ?? 0);
    peak.analysis = Math.max(peak.analysis, count.analysis_running ?? 0);
    const open = (count.profile_queued ?? 0) + (count.profile_running ?? 0) + (count.analysis_queued ?? 0) + (count.analysis_running ?? 0);
    if (open === 0) return { peak, count };
    if (Date.now() > until) throw new Error(`Still open after ${limitMs} ms: ${JSON.stringify(count)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

beforeAll(async () => {
  await ensureQueueSchema();
  await ensurePublicTenant();
}, 120_000);

beforeEach(async () => {
  await resetPublic();
  await updateControls({ intakePaused: false, profilePaused: false, analysisPaused: false, pauseReason: "", lanes: { profile: 8, analysis: 6 } }, "test");
});

afterAll(async () => {
  await resetPublic();
  await queuePool().end();
  await accountsPool().end();
});

describe("a burst of 50 visitors", () => {
  it("accepts every submission at once, once each, and gives each a durable id", async () => {
    const guests = Array.from({ length: 50 }, () => newGuestId());
    // Each visitor double-clicks: two submissions with the same click key, at the same moment as everyone else's.
    const results = await Promise.all(
      guests.flatMap((guestId, index) => {
        const input = { guestId, url: profileUrl(index % 2 ? "fixture-full" : "fixture-long"), clientKey: `click${index}abcdef`, ipHash: SHARED_NETWORK };
        return [submitReport(input), submitReport(input)];
      }),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    const ids = results.map((result) => (result.ok ? result.id : ""));
    for (let i = 0; i < ids.length; i += 2) expect(ids[i]).toBe(ids[i + 1]);
    expect(new Set(ids).size).toBe(50);
    const { rows } = await q<{ n: number }>(`SELECT count(*)::int AS n FROM ${Q}.jobs`);
    expect(rows[0]!.n).toBe(50);
    expect(await asPublicTenant(() => prisma.fdeReport.count())).toBe(50);
  }, 60_000);

  it("drains all 50 to finished reports without exceeding either lane's limit", async () => {
    await freshBenchmark();
    await updateControls({ lanes: { profile: 8, analysis: 6 } }, "test");
    const guests = Array.from({ length: 50 }, () => newGuestId());
    const ids = await Promise.all(guests.map(async (guestId) => {
      const result = await submitReport({ guestId, url: profileUrl("fixture-full"), clientKey: null, ipHash: SHARED_NETWORK });
      if (!result.ok) throw new Error(result.code);
      return result.id;
    }));
    const { peak, count } = await drain();
    expect(count.finished).toBe(50);
    expect(peak.profile).toBeLessThanOrEqual(8);
    expect(peak.analysis).toBeLessThanOrEqual(6);
    expect(stub.peakAnalysing).toBeLessThanOrEqual(6);
    // Each visitor got their own profile read, even for the same address.
    const snapshots = await asPublicTenant(() => prisma.fdeProfileSnapshot.findMany({ select: { ownerUserId: true } }));
    expect(new Set(snapshots.map((snapshot) => snapshot.ownerUserId)).size).toBe(50);
    // And every report is complete, in its owner's view only.
    const views = await Promise.all(ids.map((id, index) => loadPublicReport(id, guests[index]!)));
    expect(views.every((view) => view?.status.phase === "complete")).toBe(true);
    // Set-asides were released down to what was really spent (nothing, with fixtures).
    const reserved = await q<{ r: string }>(`SELECT coalesce(sum(reserved_micro), 0)::text AS r FROM ${Q}.jobs`);
    expect(Number(reserved.rows[0]!.r)).toBe(0);
  }, 120_000);
});

describe("isolation", () => {
  it("never shows, serves or deletes one visitor's report for another", async () => {
    const alice = newGuestId();
    const bob = newGuestId();
    const a = await submitReport({ guestId: alice, url: profileUrl("fixture-full"), clientKey: null, ipHash: "x" });
    const b = await submitReport({ guestId: bob, url: profileUrl("fixture-full"), clientKey: null, ipHash: "x" });
    if (!a.ok || !b.ok) throw new Error("not accepted");
    // Same address, but separate reports: Bob's submission doesn't reuse Alice's.
    expect(a.id).not.toBe(b.id);
    expect(await loadPublicReport(a.id, alice)).not.toBeNull();
    expect(await loadPublicReport(a.id, bob)).toBeNull();
    expect(await jobFor(a.id, bob)).toBeNull();
    expect(await deleteGuestReport(a.id, bob)).toBe(false);
    expect(await loadPublicReport(a.id, alice)).not.toBeNull();
    expect(await retryReport(a.id, bob)).toMatchObject({ ok: false, code: "not_found" });
    // Ids that aren't report ids at all are refused before any lookup.
    expect(await loadPublicReport("../../etc", alice)).toBeNull();
    expect(await deleteGuestReport(a.id, alice)).toBe(true);
    expect(await loadPublicReport(a.id, alice)).toBeNull();
  });

  it("keeps guest rows out of every account's owner id space", async () => {
    const guest = newGuestId();
    const result = await submitReport({ guestId: guest, url: profileUrl("fixture-full"), clientKey: null, ipHash: "x" });
    if (!result.ok) throw new Error(result.code);
    const row = await asPublicTenant(() => prisma.fdeReport.findUniqueOrThrow({ where: { id: result.id } }));
    expect(row.ownerUserId).toBe(ownerOf(guest));
    expect(row.ownerUserId.startsWith("guest:")).toBe(true);
  });
});

describe("limits", () => {
  it("lets one browser start 2 reports a day, and gives the same report back for the same address", async () => {
    const guest = newGuestId();
    const first = await submitReport({ guestId: guest, url: profileUrl("fixture-full"), clientKey: null, ipHash: "x" });
    const again = await submitReport({ guestId: guest, url: profileUrl("fixture-full"), clientKey: null, ipHash: "x" });
    const second = await submitReport({ guestId: guest, url: profileUrl("fixture-long"), clientKey: null, ipHash: "x" });
    const third = await submitReport({ guestId: guest, url: profileUrl("fixture-partial"), clientKey: null, ipHash: "x" });
    expect(first.ok && again.ok && first.id === again.id && again.reused).toBe(true);
    expect(second.ok).toBe(true);
    expect(third).toMatchObject({ ok: false, code: "guest_quota", status: 429 });
  });

  it("refuses a report the day's budget can't cover, counting what's set aside for queued ones", async () => {
    // $9.70 already spent today against the default $10 budget; each report sets $0.20 aside.
    await q(`INSERT INTO ${Q}.spend (day, kind, cost_micro) VALUES (current_date, 'model', 9700000)`);
    const one = await submitReport({ guestId: newGuestId(), url: profileUrl("fixture-full"), clientKey: null, ipHash: "x" });
    const two = await submitReport({ guestId: newGuestId(), url: profileUrl("fixture-full"), clientKey: null, ipHash: "x" });
    expect(one.ok).toBe(true);
    expect(two).toMatchObject({ ok: false, code: "budget", status: 503 });
  });

  it("refuses new reports while intake is paused, and rejects addresses that aren't profiles", async () => {
    await updateControls({ intakePaused: true }, "test");
    expect(await submitReport({ guestId: newGuestId(), url: profileUrl("fixture-full"), clientKey: null, ipHash: "x" })).toMatchObject({ ok: false, code: "paused" });
    await updateControls({ intakePaused: false }, "test");
    expect(await submitReport({ guestId: newGuestId(), url: "https://www.linkedin.com/company/acme", clientKey: null, ipHash: "x" })).toMatchObject({ ok: false, code: "invalid_url", status: 422 });
  });
});

describe("recovery and failures", () => {
  it("takes back a job whose worker stopped renewing its lease", async () => {
    const result = await submitReport({ guestId: newGuestId(), url: profileUrl("fixture-full"), clientKey: null, ipHash: "x" });
    if (!result.ok) throw new Error(result.code);
    const job = await claim("profile", 8, "worker-that-dies");
    expect(job?.id).toBe(result.id);
    expect(await claim("profile", 1, "another")).toBeNull(); // the lane's one place is taken
    await q(`UPDATE ${Q}.jobs SET lease_until = now() - interval '1 second' WHERE id = $1`, [result.id]);
    const { requeued } = await reapExpiredLeases();
    expect(requeued).toContain(result.id);
    expect(await heartbeat(result.id, "worker-that-dies")).toBe(false);
    await freshBenchmark();
    const { count } = await drain();
    expect(count.finished).toBe(1);
  });

  it("marks a private profile as unreadable, without retrying or failing the session", async () => {
    const guest = newGuestId();
    const result = await submitReport({ guestId: guest, url: profileUrl("fixture-private"), clientKey: null, ipHash: "x" });
    if (!result.ok) throw new Error(result.code);
    await drain();
    const view = await loadPublicReport(result.id, guest);
    expect(view?.status.phase).toBe("restricted");
    expect(view?.status.retryable).toBe(false);
  });

  it("pauses profile reading on a bad data-service token instead of failing every queued report", async () => {
    const guest = newGuestId();
    const bad = await submitReport({ guestId: guest, url: profileUrl("fixture-401"), clientKey: null, ipHash: "x" });
    if (!bad.ok) throw new Error(bad.code);
    for (let i = 0; i < 40 && !(await readControls(true)).profilePaused; i++) {
      await tick();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const controls = await readControls(true);
    expect(controls.profilePaused).toBe(true);
    const view = await loadPublicReport(bad.id, guest);
    expect(view?.status.phase).toBe("waiting");
    // Nothing a visitor sees names the provider, the token or the cause.
    expect(JSON.stringify(view)).not.toMatch(/treg|TREG_API_TOKEN|invalid_credentials/i);
    const incidents = await q<{ code: string }>(`SELECT code FROM ${Q}.incidents`);
    expect(incidents.rows.map((row) => row.code)).toContain("invalid_credentials");
  });

  it("keeps a report's place when the model is busy, and pauses analysis when the model is unavailable", async () => {
    await freshBenchmark();
    const guest = newGuestId();
    const result = await submitReport({ guestId: guest, url: profileUrl("fixture-full"), clientKey: null, ipHash: "x" });
    if (!result.ok) throw new Error(result.code);
    stub.failNext = () => new ServiceBusy("model", 500, "rate limited");
    for (let i = 0; i < 80; i++) {
      await tick();
      const job = await jobFor(result.id, guest);
      if (job?.error_code === "model_busy") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const deferred = await jobFor(result.id, guest);
    expect(deferred?.error_code).toBe("model_busy");
    expect(deferred?.deferrals).toBe(1);

    stub.failNext = () => new ServiceUnavailable("model", "auth", "401");
    for (let i = 0; i < 80 && !(await readControls(true)).analysisPaused; i++) {
      await tick();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect((await readControls(true)).analysisPaused).toBe(true);
    expect((await jobFor(result.id, guest))?.stage).toBe("analysis_queued");

    await updateControls({ analysisPaused: false }, "test");
    const { count } = await drain();
    expect(count.finished).toBe(1);
    expect((await loadPublicReport(result.id, guest))?.status.phase).toBe("complete");
  });

  it("builds the shared market sample once, however many workers need it at the same moment", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => ensureSharedBenchmark(null, AbortSignal.timeout(30_000))));
    expect(results).toHaveLength(10);
    expect(stub.benchmarkBuilds).toBe(1);
  });
});

describe("retention", () => {
  it("deletes guest reports and their profile reads after the retention window", async () => {
    const guest = newGuestId();
    const result = await submitReport({ guestId: guest, url: profileUrl("fixture-full"), clientKey: null, ipHash: "x" });
    if (!result.ok) throw new Error(result.code);
    await freshBenchmark();
    await drain();
    // 73 hours later, with the default 72-hour window.
    const later = new Date(Date.now() + 73 * 3_600_000);
    await q(`UPDATE ${Q}.jobs SET created_at = now() - interval '73 hours' WHERE id = $1`, [result.id]);
    await sweepPublicFde(later);
    expect(await jobFor(result.id, guest)).toBeNull();
    expect(await asPublicTenant(() => prisma.fdeReport.count({ where: { id: result.id } }))).toBe(0);
    expect(await asPublicTenant(() => prisma.fdeProfileSnapshot.count({ where: { ownerUserId: ownerOf(guest) } }))).toBe(0);
  });
});
