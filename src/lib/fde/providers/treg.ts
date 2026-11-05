import type { RetrievalProvider, Charge, ConnectionCheck, JobSearch, ProviderErrorCode } from "./types";
import { ESTIMATES_MICRO, ProviderError } from "./types";
import { mapJob, mapListings, mapProfile } from "./harvest-map";

// Treg's gateway to HarvestAPI's LinkedIn tools, server to server. The token is
// only ever sent as X-Treg-Token to Treg itself, from the server, and it's never
// put in a message, a log line or a response. Treg reports each charge in a
// header, so costs here are what it says, not what we'd expect.

export type TregConfig = {
  token: string | undefined;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Waits between tries; tests pass one that doesn't. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  retries?: number;
  newKey?: () => string;
};

const BASE = "https://treg.to";
const TOOLS = {
  profile: "harvestapi.linkedin.user.profile",
  search: "harvestapi.linkedin.search.jobs",
  job: "harvestapi.linkedin.job.get",
  geo: "harvestapi.linkedin.geo.search",
} as const;
const LIMIT_USD: Record<keyof typeof TOOLS, string> = { profile: "0.0200", search: "0.0050", job: "0.0050", geo: "0.0010" };

const SECONDS = 1000;

type Answer = { body: unknown; charge: Charge };

const errorName = (body: unknown): string => {
  const value = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const named = value.error ?? value.code ?? value.detail;
  if (typeof named === "string") return named;
  if (named && typeof named === "object") {
    const inner = named as Record<string, unknown>;
    if (typeof inner.code === "string") return inner.code;
    if (typeof inner.error === "string") return inner.error;
  }
  return "";
};

/** Treg's own refusals and the provider's errors, as what they mean for this review. */
export function classifyError(status: number, isTregError: boolean, body: unknown, retryAfterHeader: string | null): ProviderError {
  const name = errorName(body);
  const fromBody = body && typeof body === "object" ? Number((body as Record<string, unknown>).retry_after_s) : NaN;
  const retryAfter = Number.isFinite(fromBody) ? fromBody : Number(retryAfterHeader) || null;
  const fail = (code: ProviderErrorCode, message: string) => new ProviderError(code, message, retryAfter);

  if (isTregError) {
    if (status === 401) return fail("invalid_credentials", "Treg didn't accept the token. Check TREG_API_TOKEN in the server's variables.");
    if (status === 403) return fail("permission", "Treg says this token isn't allowed to use this tool.");
    if (status === 402) {
      return /route_max_cost/.test(name)
        ? fail("spend_limit", "Treg's price for this call is above the ceiling set here, so it wasn't made.")
        : fail("depleted", "The Treg balance has run out. Nothing was charged for this call.");
    }
    if (status === 429 && /trial_allowance/.test(name)) return fail("depleted", "Treg's trial allowance for today is used up. It resets at 00:00 UTC.");
    if (status === 429) return fail("rate_limited", "Treg is limiting requests right now.");
    if (status === 409) return fail("rate_limited", "The same request is still running at Treg.");
    if (status === 503) return fail("provider_down", "Treg has no capacity for this tool right now.");
    return fail("provider_down", `Treg refused the call (${status}).`);
  }
  if (status === 429) return fail("rate_limited", "The provider is limiting requests right now.");
  if (status >= 500) return fail("provider_down", `The provider had an error (${status}).`);
  if (status === 401 || status === 403) return fail("inaccessible", "The provider can't read this record: it's private or restricted.");
  return fail("inaccessible", `The provider couldn't read this record (${status}).`);
}

export function createTregProvider(config: TregConfig): RetrievalProvider {
  const baseUrl = (config.baseUrl ?? BASE).replace(/\/+$/, "");
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 45 * SECONDS;
  const retries = config.retries ?? 2;
  const newKey = config.newKey ?? (() => crypto.randomUUID());

  async function once(tool: keyof typeof TOOLS, query: Record<string, string>, options: { fresh: boolean; key: string; signal?: AbortSignal }): Promise<Answer> {
    if (!config.token) throw new ProviderError("not_configured", "TREG_API_TOKEN isn't set on the server.");
    const url = `${baseUrl}/call/${TOOLS[tool]}?${new URLSearchParams(query)}`;
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await doFetch(url, {
        headers: {
          accept: "application/json",
          "X-Treg-Token": config.token,
          "X-Treg-Route-Max-Cost": LIMIT_USD[tool],
          "Idempotency-Key": options.key,
          ...(options.fresh ? { "Cache-Control": "no-cache" } : {}),
        },
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      if (options.signal?.aborted) throw new ProviderError("timeout", "The request was stopped.");
      throw new ProviderError("timeout", timeout.aborted ? "The provider took too long to answer." : "The provider couldn't be reached.");
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      if (response.ok) throw new ProviderError("invalid_response", "The provider's answer wasn't JSON.");
    }
    const isTregError = response.headers.get("x-treg-error") === "1";
    if (!response.ok) throw classifyError(response.status, isTregError, body, response.headers.get("retry-after"));
    return {
      body,
      charge: {
        provider: "treg",
        tool: TOOLS[tool],
        costMicro: Number(response.headers.get("x-treg-cost-micro") ?? 0) || 0,
        callId: response.headers.get("x-treg-call-id"),
        cached: response.headers.get("x-treg-cache") === "hit",
      },
    };
  }

  /** A retry repeats the same Idempotency-Key, so a call that timed out can't be charged twice. */
  async function call(tool: keyof typeof TOOLS, query: Record<string, string>, options: { fresh: boolean; signal?: AbortSignal }): Promise<Answer> {
    const key = newKey();
    for (let attempt = 0; ; attempt++) {
      try {
        return await once(tool, query, { ...options, key });
      } catch (error) {
        if (!(error instanceof ProviderError) || !error.retryable || attempt >= retries || options.signal?.aborted) throw error;
        await sleep(Math.min((error.retryAfterSeconds ?? 2 ** attempt) * SECONDS, 15 * SECONDS));
      }
    }
  }

  return {
    id: "treg",
    label: "Treg (HarvestAPI)",
    isFixture: false,
    isConfigured: () => Boolean(config.token),
    async readProfile(url, options) {
      const { body, charge } = await call("profile", { url }, options);
      return { profile: mapProfile(body, url, "Treg (HarvestAPI)"), charge };
    },
    async searchJobs(search: JobSearch, options) {
      const query: Record<string, string> = { search: search.query, sortBy: "relevance", postedLimit: "month" };
      if (search.location) query.location = search.location;
      if (search.remoteOnly) query.workplaceType = "remote";
      const { body, charge } = await call("search", query, options);
      return { listings: mapListings(body), charge };
    },
    async getJob(jobId, options) {
      const { body, charge } = await call("job", { jobId }, options);
      return { job: mapJob(body), charge };
    },
    /** The free geo tool needs a valid token and answers in the provider's shape, so nothing is spent. */
    async checkConnection(signal): Promise<ConnectionCheck> {
      const checkedAt = new Date().toISOString();
      try {
        const { body, charge } = await once("geo", { search: "London" }, { fresh: false, key: newKey(), signal });
        const shaped = body && typeof body === "object" && ("elements" in body || "element" in body);
        if (!shaped) return { ok: false, code: "invalid_response", message: "Treg answered, but not in the expected shape.", balanceUsd: null, checkedAt };
        if (charge.costMicro > 0) return { ok: true, code: null, message: `Connected, though this check cost $${(charge.costMicro / 1_000_000).toFixed(4)}.`, balanceUsd: null, checkedAt };
        return { ok: true, code: null, message: "Connected. Treg accepted the token and returned a valid answer at no charge.", balanceUsd: null, checkedAt };
      } catch (error) {
        const known = error instanceof ProviderError ? error : new ProviderError("provider_down", "The check failed.");
        return { ok: false, code: known.code, message: known.message, balanceUsd: null, checkedAt };
      }
    },
  };
}

export const tregEstimates = ESTIMATES_MICRO;
