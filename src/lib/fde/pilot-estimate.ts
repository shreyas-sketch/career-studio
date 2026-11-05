import { ESTIMATES_MICRO } from "./providers/types";

// What a batch is expected to cost before anything is spent. Prices are the
// published ones checked on 5 November 2026; tokens are rough. A reused
// benchmark is what keeps the job search from being paid for per person.

export type PilotEstimate = {
  profiles: number;
  profileMicro: number;
  discoveryMicro: number;
  jobDetailMicro: number;
  paidTotalMicro: number;
  modelTokens: number;
  modelMicro: number | null;
};

/** Evidence for about ten roles, then insights and a plan, per person. */
const TOKENS_PER_PROFILE = 60_000;
/** Reading about ten postings once, for the whole batch. */
const TOKENS_PER_BENCHMARK = 40_000;
const SEARCHES = 3;

export function estimatePilot(profiles: number, options: { detailLimit: number; usdPerMillionTokens: number | null; benchmarkReused?: boolean }): PilotEstimate {
  const reused = options.benchmarkReused ?? false;
  const profileMicro = profiles * ESTIMATES_MICRO.profile;
  const discoveryMicro = reused ? 0 : SEARCHES * ESTIMATES_MICRO.search;
  const jobDetailMicro = reused ? 0 : options.detailLimit * ESTIMATES_MICRO.job;
  const modelTokens = profiles * TOKENS_PER_PROFILE + (reused ? 0 : TOKENS_PER_BENCHMARK);
  return {
    profiles,
    profileMicro,
    discoveryMicro,
    jobDetailMicro,
    paidTotalMicro: profileMicro + discoveryMicro + jobDetailMicro,
    modelTokens,
    modelMicro: options.usdPerMillionTokens === null ? null : Math.round(modelTokens * options.usdPerMillionTokens),
  };
}
