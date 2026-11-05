import type { NormalizedProfile, RoleStatus } from "../types";

// What the review needs from a retrieval provider. Only one implementation is
// used at a time, and nothing here falls back to another provider by itself:
// that would spend credits nobody agreed to.

export const PROVIDER_ERRORS = [
  "not_configured",
  "invalid_credentials",
  "permission",
  "rate_limited",
  "depleted",
  "inaccessible",
  "timeout",
  "provider_down",
  "invalid_response",
  "spend_limit",
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERRORS)[number];

/** Worth trying again shortly. Bad credentials and empty balances never are. */
const RETRYABLE: ReadonlySet<ProviderErrorCode> = new Set(["rate_limited", "timeout", "provider_down"]);

export class ProviderError extends Error {
  override name = "ProviderError";
  readonly code: ProviderErrorCode;
  readonly retryAfterSeconds: number | null;
  constructor(code: ProviderErrorCode, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }
}

/** What one call cost, as the provider reported it. */
export type Charge = { provider: string; tool: string; costMicro: number; callId: string | null; cached: boolean };

export type ListingSummary = { id: string; title: string; employer: string; location: string; url: string; postedAt: string | null };

export type JobRecord = {
  id: string;
  title: string;
  employer: string;
  location: string;
  remotePolicy: string;
  url: string;
  applyUrl: string | null;
  description: string;
  postedAt: string | null;
  expiresAt: string | null;
  /** From the provider's own field; "unknown" when it doesn't say. */
  status: RoleStatus;
  stateText: string;
};

export type JobSearch = { query: string; location: string; remoteOnly: boolean };

export type ConnectionCheck = { ok: boolean; code: ProviderErrorCode | null; message: string; balanceUsd: number | null; checkedAt: string };

export interface RetrievalProvider {
  readonly id: string;
  readonly label: string;
  readonly isFixture: boolean;
  isConfigured(): boolean;
  readProfile(url: string, options: { fresh: boolean; signal?: AbortSignal }): Promise<{ profile: NormalizedProfile; charge: Charge }>;
  searchJobs(search: JobSearch, options: { fresh: boolean; signal?: AbortSignal }): Promise<{ listings: ListingSummary[]; charge: Charge }>;
  getJob(id: string, options: { fresh: boolean; signal?: AbortSignal }): Promise<{ job: JobRecord; charge: Charge }>;
  /** Costs nothing: it's a free call that needs a valid token. */
  checkConnection(signal?: AbortSignal): Promise<ConnectionCheck>;
}

/** Published prices checked on 5 November 2026, in millionths of a dollar. Used to check a spending limit before a call. */
export const ESTIMATES_MICRO = { profile: 6_400, search: 1_000, job: 1_000 } as const;
