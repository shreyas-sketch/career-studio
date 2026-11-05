import "server-only";

import type { AIProvider } from "@/lib/ai";
import { AiError } from "@/lib/ai/errors";
import { AnthropicProvider, type AnthropicUsage } from "@/lib/ai/providers/anthropic";
import type { ReviewAi } from "@/lib/fde/review";
import { SpendMeter } from "@/lib/fde/spend";
import type { Charge } from "@/lib/fde/providers/types";
import type { UsageKind } from "@/lib/fde/types";

import { MAX_PROMPT_TOKENS, MODEL_TIMEOUT_MS, publicFdeConfig, USD } from "./config";
import { Q, q } from "./db";
import { addSpend, cooldownUntil, setCooldown, type Upstream } from "./ops";

// The public review's model: Claude Haiku 5.5 (or PUBLIC_FDE_MODEL) with the
// server's own key. It never uses an account's AI settings, and it never
// switches to another model or provider when this one fails: the report waits
// or says it couldn't be done.

/** A service is down for everyone (bad key, unknown model, empty balance): the job waits and the lane is paused. */
export class ServiceUnavailable extends Error {
  override name = "ServiceUnavailable";
  constructor(
    readonly service: "model" | "profile" | "market",
    readonly code: string,
    /** For the operator only. */
    readonly detail: string,
  ) {
    super(`${service} unavailable: ${code}`);
  }
}

/** A service is busy (rate limits, overload): the job goes back in the queue to try again later, keeping its place. */
export class ServiceBusy extends Error {
  override name = "ServiceBusy";
  constructor(
    readonly service: "model" | "profile" | "market",
    readonly retryAfterMs: number,
    readonly detail: string,
  ) {
    super(`${service} busy`);
  }
}

/** This report has used what was set aside for it. */
export class BudgetReached extends Error {
  override name = "BudgetReached";
}

/** Errors that end a whole stage, rather than being noted against one role. */
export const isServiceFailure = (error: unknown): boolean => error instanceof ServiceUnavailable || error instanceof ServiceBusy || error instanceof BudgetReached;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });

const jitter = (ms: number) => Math.round(ms * (0.8 + Math.random() * 0.4));

/** Waits out a cool-down another worker set; one longer than `maxWaitMs` sends the job back to the queue instead. */
export async function respectCooldown(provider: Upstream, service: ServiceBusy["service"], signal: AbortSignal, maxWaitMs = 90_000): Promise<void> {
  const until = await cooldownUntil(provider);
  if (!until) return;
  const wait = until.getTime() - Date.now();
  if (wait <= 0) return;
  if (wait > maxWaitMs) throw new ServiceBusy(service, wait, `${provider} cooling down`);
  await sleep(jitter(wait), signal);
}

/**
 * What one report may spend, set aside when it was accepted (queue.ts). Every
 * paid call and every model answer is counted against it as it happens, in
 * the job's row and the day's totals.
 */
export class JobLedger {
  private spent: number;
  constructor(
    readonly jobId: string | null,
    private readonly capMicro: number,
    /** Already spent by earlier attempts at this job. */
    spentMicro = 0,
  ) {
    this.spent = spentMicro;
  }

  get spentMicro(): number {
    return this.spent;
  }

  /** Stops before a call once the set-aside is used up. */
  ensureRoom(): void {
    if (this.spent >= this.capMicro) throw new BudgetReached(`Used the ${(this.capMicro / USD).toFixed(2)} USD set aside for this report.`);
  }

  async add(kind: "profile" | "market" | "model", costMicro: number, tokens: { input?: number; output?: number } = {}): Promise<void> {
    this.spent += costMicro;
    await addSpend(kind, costMicro, tokens);
    if (this.jobId) await q(`UPDATE ${Q}.jobs SET spent_micro = spent_micro + $2 WHERE id = $1`, [this.jobId, Math.round(costMicro)]);
  }

  async addModel(usage: AnthropicUsage): Promise<void> {
    const { inputUsdPerMTok, outputUsdPerMTok } = publicFdeConfig();
    // Cache reads cost a tenth of input, writes a quarter more; this review doesn't use the cache, but count them if it ever does.
    const input = usage.inputTokens + usage.cacheReadTokens * 0.1 + usage.cacheWriteTokens * 1.25;
    const cost = (input * inputUsdPerMTok + usage.outputTokens * outputUsdPerMTok) * (USD / 1_000_000);
    await this.add("model", cost, { input: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens, output: usage.outputTokens });
  }
}

/** The review's retrieval meter, also counting each charge against the report's set-aside. */
export class PublicMeter extends SpendMeter {
  constructor(
    reportId: string | null,
    private readonly ledger: JobLedger,
    private readonly kindOverride?: "market",
  ) {
    super(reportId);
  }

  override async authorize(estimateMicro: number): Promise<void> {
    this.ledger.ensureRoom();
    await super.authorize(estimateMicro);
  }

  override async record(kind: UsageKind, charge: Charge): Promise<void> {
    await super.record(kind, charge);
    await this.ledger.add(this.kindOverride ?? (kind === "profile" ? "profile" : "market"), charge.costMicro);
  }
}

const estimateTokens = (request: { system: string; messages: { content: string }[] }) =>
  Math.ceil((request.system.length + request.messages.reduce((sum, message) => sum + message.content.length, 0)) / 3.5);

const ATTEMPTS = 4;

/** Whether the server can run the public review's model at all. */
export function modelConfigured(): boolean {
  return Boolean(publicFdeConfig().apiKey);
}

/**
 * The public review's model, with each answer's real token use counted
 * against `ledger`, a shared cool-down when the API says "too many requests",
 * and a few spaced-out retries before the job is handed back to the queue.
 */
export function publicModel(ledger: JobLedger): ReviewAi {
  const config = publicFdeConfig();
  if (!config.apiKey) throw new ServiceUnavailable("model", "not_configured", "ANTHROPIC_API_KEY isn't set on the server.");
  const raw = new AnthropicProvider(config.anthropicBaseUrl, config.apiKey, config.model, MODEL_TIMEOUT_MS, (usage) => ledger.addModel(usage));
  return { provider: gated(raw, ledger), taskOptions: { creativity: "FAITHFUL", strict: true, language: null, maxPages: null } };
}

function gated(raw: AIProvider, ledger: JobLedger): AIProvider {
  const complete = async (request: Parameters<AIProvider["complete"]>[0]) => {
    const signal = request.signal ?? new AbortController().signal;
    // A prompt over the price threshold is refused for that one comparison; the rest of the report goes on.
    if (estimateTokens(request) > MAX_PROMPT_TOKENS) throw AiError.of("too-long", "public review prompt over the price threshold");
    for (let attempt = 0; ; attempt++) {
      ledger.ensureRoom();
      await respectCooldown("anthropic", "model", signal);
      try {
        return await raw.complete(request as never);
      } catch (error) {
        if (!(error instanceof AiError)) throw error;
        if (error.kind === "auth" || error.kind === "model" || error.kind === "config") {
          throw new ServiceUnavailable("model", error.kind, error.detail ?? error.kind);
        }
        const busy = error.kind === "rate-limited" || error.kind === "busy";
        const transient = busy || error.kind === "unreachable" || error.kind === "timeout" || error.kind === "provider";
        if (!transient) throw error; // a bad answer, a cut-off: noted against this one comparison
        const wait = jitter(Math.min(10_000 * 2 ** attempt, 60_000));
        if (busy) await setCooldown("anthropic", wait, `${error.kind} (${error.detail ?? ""})`);
        if (attempt >= ATTEMPTS - 1) throw new ServiceBusy("model", Math.max(wait, 30_000), `${error.kind} after ${ATTEMPTS} tries (${error.detail ?? ""})`);
        if (!busy) await sleep(wait, signal);
      }
    }
  };
  return { kind: raw.kind, model: raw.model, listModels: (signal) => raw.listModels(signal), test: (signal) => raw.test(signal), complete } as AIProvider;
}

/**
 * A free check that the key works and the model exists: the Models API, which
 * isn't billed. Says only what an operator needs, never the provider's payload.
 */
export async function checkModel(signal?: AbortSignal): Promise<{ ok: boolean; message: string }> {
  const config = publicFdeConfig();
  if (!config.apiKey) return { ok: false, message: "ANTHROPIC_API_KEY isn't set on the server." };
  try {
    const response = await fetch(`${config.anthropicBaseUrl.replace(/\/+$/, "")}/v1/models/${encodeURIComponent(config.model)}`, {
      headers: { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" },
      signal: signal ?? AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (response.ok) return { ok: true, message: `The key works and ${config.model} is available to it.` };
    if (response.status === 401) return { ok: false, message: "Anthropic didn't accept ANTHROPIC_API_KEY." };
    if (response.status === 403) return { ok: false, message: "This key isn't allowed to use that model or API." };
    if (response.status === 404) return { ok: false, message: `This key's organization has no model called ${config.model}.` };
    if (response.status === 429) return { ok: false, message: "Anthropic is rate-limiting this key right now." };
    return { ok: false, message: `Anthropic answered ${response.status}.` };
  } catch {
    return { ok: false, message: "Anthropic couldn't be reached from the server." };
  }
}
