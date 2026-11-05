import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The public review's model layer against a stand-in for Anthropic's API on
// localhost: no request leaves the machine and nothing is billed.
const PORT = 39_871;
vi.hoisted(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
  if (!process.env.TEST_DATABASE_URL) url.pathname = `${url.pathname}_test`;
  if (!url.pathname.endsWith("_test")) throw new Error("Refusing to run against a database whose name doesn't end in _test.");
  process.env.DATABASE_URL = url.toString();
  process.env.CAREER_STUDIO_NO_TEST_USER = "1";
  process.env.DOSSIER_SECRET ??= "test-secret-test-secret-test-secret-1234";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-a-real-key-000000";
  process.env.PUBLIC_FDE_ANTHROPIC_TEST_BASE_URL = "http://127.0.0.1:39871";
  process.env.CAREER_STUDIO_ALLOW_PRIVATE_AI_URLS = "1";
});

import { AiError } from "@/lib/ai/errors";

import { Q, q, queuePool } from "./db";
import { BudgetReached, checkModel, JobLedger, publicModel, ServiceUnavailable } from "./model";
import { cooldownUntil, spendToday } from "./ops";

/** What the stand-in answers next to /v1/messages, in order; then "ok". */
let script: ("ok" | "429" | "401" | "404")[] = [];
let modelsStatus = 200;
let server: Server;

beforeAll(async () => {
  server = createServer((request, response) => {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(JSON.stringify(body));
    };
    if (request.method === "GET" && request.url?.startsWith("/v1/models/")) {
      return modelsStatus === 200 ? send(200, { id: "claude-haiku-5-5", type: "model", capabilities: { effort: { supported: false } } }) : send(modelsStatus, { type: "error", error: { type: "error", message: "no" } });
    }
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const next = script.shift() ?? "ok";
      if (next === "429") return send(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, { "retry-after": "0" });
      if (next === "401") return send(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
      if (next === "404") return send(404, { type: "error", error: { type: "not_found_error", message: "model: claude-haiku-5-5" } });
      send(200, { id: "msg", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1_000_000, output_tokens: 200_000 } });
    });
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
});

beforeEach(async () => {
  script = [];
  modelsStatus = 200;
  await q(`TRUNCATE ${Q}.jobs, ${Q}.cooldowns, ${Q}.spend`);
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await queuePool().end();
});

const ask = (ledger: JobLedger, content = "Are you there?") => publicModel(ledger).provider.complete({ system: "Answer OK.", messages: [{ role: "user", content }], maxTokens: 16 });

describe("the public review's model", () => {
  it("counts the tokens each answer really used, at Haiku 5.5's price", async () => {
    const ledger = new JobLedger(null, 10_000_000);
    expect(await ask(ledger)).toBe("OK");
    // 1M input at $0.10 and 200K output at $0.50: $0.20.
    expect(ledger.spentMicro).toBe(200_000);
    const spend = await spendToday();
    expect(spend.find((row) => row.kind === "model")).toMatchObject({ costMicro: 200_000, tokensIn: 1_000_000, tokensOut: 200_000 });
  });

  it("waits out a rate limit with a shared cool-down, then carries on", async () => {
    // The SDK retries once by itself; the second refusal reaches the review's own handling.
    script = ["429", "429"];
    const ledger = new JobLedger(null, 10_000_000);
    expect(await ask(ledger)).toBe("OK");
    expect(await cooldownUntil("anthropic")).toBeNull(); // over by the time it answered
    const { rows } = await q<{ provider: string }>(`SELECT provider FROM ${Q}.cooldowns`);
    expect(rows.map((row) => row.provider)).toContain("anthropic");
  }, 60_000);

  it("calls a refused key unavailable, rather than noting it against one comparison", async () => {
    script = ["401"];
    await expect(ask(new JobLedger(null, 10_000_000))).rejects.toBeInstanceOf(ServiceUnavailable);
  });

  it("stops before a call once the report's set-aside is used up", async () => {
    await expect(ask(new JobLedger(null, 100, 100))).rejects.toBeInstanceOf(BudgetReached);
  });

  it("refuses a prompt over the price threshold for that comparison only", async () => {
    const huge = "x".repeat(400_000);
    await expect(ask(new JobLedger(null, 10_000_000), huge)).rejects.toMatchObject({ kind: "too-long" } satisfies Partial<AiError>);
  });

  it("checks the key and the model for free, and says what's wrong in plain words", async () => {
    expect(await checkModel()).toMatchObject({ ok: true });
    modelsStatus = 401;
    expect(await checkModel()).toMatchObject({ ok: false, message: expect.stringContaining("didn't accept") });
    modelsStatus = 404;
    expect(await checkModel()).toMatchObject({ ok: false, message: expect.stringContaining("no model called") });
  });
});
