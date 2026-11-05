import "server-only";

import { accountsQuery } from "@/lib/accounts/db";
import { SourceError, STARTUPS_USER_AGENT, testAddress } from "@/lib/startups/http";

import { BOARDS, boardUrl, ESTABLISHED, fromAshby, fromGreenhouseJob, fromLever, greenhouseJobUrl, greenhouseList, worthReading, type Board } from "./ats";
import { fdeConfig } from "./config";
import { DEFAULT_SHORTLIST, dedupe, establishedKey, shortlist, titleMatches, type Candidate } from "./market-filter";
import { ESTIMATES_MICRO, ProviderError, type RetrievalProvider } from "./providers/types";
import type { SpendMeter } from "./spend";
import type { Coverage, FdeFilters, Role } from "./types";

// Finding current openings: employers' own boards first, since they're free and
// a role on a live board is really open, then LinkedIn's job search to widen the
// sample. Only public listings are cached across accounts, never anything about
// who's being reviewed.

const BOARD_TTL_HOURS = 12;
const BOARD_TIMEOUT_MS = 40_000;
const MAX_BOARD_BYTES = 80 * 1024 * 1024;
const BOARD_CONCURRENCY = 6;

export const QUERIES = ["Forward Deployed Engineer", "Forward Deployed Software Engineer", "Forward Deployed AI Engineer"];

/** A public board's answer. Boards can be large, so this reads further than a page fetch would. */
async function fetchBoardJson(url: string, signal?: AbortSignal): Promise<unknown> {
  try {
    return await fetchBoardOnce(url, signal);
  } catch (error) {
    // One more try for a dropped or slow answer. An error status is the board's real answer.
    if (signal?.aborted || !(error instanceof SourceError) || error.message.startsWith("answered") || error.message === "sent too much") throw error;
    return fetchBoardOnce(url, signal);
  }
}

async function fetchBoardOnce(url: string, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(BOARD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(testAddress(url), {
      headers: { "user-agent": STARTUPS_USER_AGENT, accept: "application/json" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
    });
  } catch {
    throw new SourceError(timeout.aborted ? "took too long to answer" : "couldn't be reached");
  }
  if (!response.ok) throw new SourceError(`answered with an error (${response.status})`);
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BOARD_BYTES) throw new SourceError("sent too much");
  try {
    return await response.json();
  } catch {
    // The body arrives after the headers, so a slow board can fail here too.
    throw new SourceError(timeout.aborted ? "took too long to answer" : "sent something that wasn't JSON");
  }
}

/** Runs tasks a few at a time, in order of arrival. */
export async function inPool<T>(items: readonly T[], size: number, task: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        await task(items[index], index);
      }
    }),
  );
}

async function readBoard(board: Board, checkedAt: string, signal?: AbortSignal): Promise<Candidate[]> {
  const url = boardUrl(board);
  if (board.source === "lever") return fromLever(await fetchBoardJson(url, signal), board, checkedAt);
  if (board.source === "ashby") return fromAshby(await fetchBoardJson(url, signal), board, checkedAt);
  const matching = greenhouseList(await fetchBoardJson(url, signal)).filter((job) => worthReading(job.title));
  const found: Candidate[] = [];
  await inPool(matching.slice(0, 25), 4, async (job) => {
    const candidate = fromGreenhouseJob(await fetchBoardJson(greenhouseJobUrl(board, job.id), signal), board, checkedAt);
    if (candidate) found.push(candidate);
  });
  return found;
}

type CacheRow = { payload: Candidate[]; fetched_at: Date };

async function boardCandidates(board: Board, fresh: boolean, signal?: AbortSignal): Promise<{ items: Candidate[]; fromCache: boolean }> {
  const key = `fde-market:${board.source}:${board.slug}`;
  if (!fresh) {
    const { rows } = await accountsQuery<CacheRow>(`SELECT payload, fetched_at FROM cs_shared.feed_cache WHERE key = $1`, [key]);
    const row = rows[0];
    if (row && Date.now() - row.fetched_at.getTime() < BOARD_TTL_HOURS * 3_600_000) return { items: row.payload, fromCache: true };
  }
  const now = new Date();
  const items = await readBoard(board, now.toISOString(), signal);
  await accountsQuery(
    `INSERT INTO cs_shared.feed_cache (key, payload, fetched_at) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`,
    [key, JSON.stringify(items), now],
  );
  return { items, fromCache: false };
}

export class DiscoveryFailed extends Error {
  override name = "DiscoveryFailed";
  readonly sources: Coverage["sources"];
  constructor(message: string, sources: Coverage["sources"]) {
    super(message);
    this.sources = sources;
  }
}

export type DiscoveryOptions = {
  provider: RetrievalProvider;
  meter: SpendMeter;
  fresh: boolean;
  /** Set when paid calls are known to be pointless: a bad token, an empty balance. */
  skipPaid: string | null;
  signal?: AbortSignal;
  onFound?: (found: Candidate[], boardsChecked: number, boardsTotal: number) => Promise<void>;
};

const scopeText = (filters: FdeFilters) => {
  const parts = [`Global${filters.location ? `, filtered to "${filters.location}"` : ""}`];
  if (filters.remoteOnly) parts.push("remote roles only");
  if (filters.seniority === "accessible") parts.push("excluding senior roles");
  if (filters.seniority === "aspirational") parts.push("senior roles only");
  return parts.join(", ");
};

const RATIONALE =
  "A curated market sample, not an exhaustive or definitive ranking. Roles come from employers' own boards where possible and LinkedIn otherwise. Up to two per employer, at different levels where possible, ordered by employer spread and how recently they were posted. The profile under review plays no part in which roles are picked.";

export async function discoverMarket(filters: FdeFilters, options: DiscoveryOptions): Promise<{ roles: Role[]; coverage: Coverage }> {
  const config = fdeConfig();
  const sources: Coverage["sources"] = [];
  const found: Candidate[] = [];
  let checked = 0;
  let fromCache = 0;

  await inPool(BOARDS, BOARD_CONCURRENCY, async (board) => {
    try {
      const { items, fromCache: cached } = await boardCandidates(board, options.fresh, options.signal);
      if (cached) fromCache++;
      found.push(...items);
      sources.push({ source: `${board.employer} (${board.source})`, status: "ok", found: items.length, note: cached ? "From the last 12 hours' copy of the board." : "Read live." });
    } catch (error) {
      sources.push({ source: `${board.employer} (${board.source})`, status: "failed", found: 0, note: error instanceof SourceError ? `The board ${error.message}.` : "The board couldn't be read." });
    }
    checked++;
    await options.onFound?.(found, checked, BOARDS.length);
  });

  const linkedin = await searchLinkedIn(filters, found, options, config.linkedinDetailLimit);
  sources.push(linkedin.source);
  found.push(...linkedin.candidates);

  if (found.length === 0 && sources.every((source) => source.status !== "ok")) {
    throw new DiscoveryFailed("None of the job sources could be read, so there's no current market to compare with.", sources);
  }

  const { roles, merged } = dedupe(found);
  const { selected, excluded, limits } = shortlist(roles, filters, { ...DEFAULT_SHORTLIST, target: config.shortlistSize, established: new Set([...ESTABLISHED].map(establishedKey)) });
  const unread = sources.filter((source) => source.status === "failed").map((source) => source.source.replace(/ \(.*\)$/, ""));
  if (unread.length > 0) limits.push(`${unread.length} ${unread.length === 1 ? "source" : "sources"} couldn't be read, so their roles aren't in this sample: ${unread.join(", ")}.`);
  if (fromCache > 0) limits.push(`${fromCache} of ${BOARDS.length} employer boards came from a copy under 12 hours old.`);

  return {
    roles: selected,
    coverage: {
      scope: scopeText(filters),
      queries: QUERIES,
      searchedAt: new Date().toISOString(),
      sources: sources.sort((a, b) => a.source.localeCompare(b.source)),
      selectionRationale: RATIONALE,
      candidates: found.length,
      duplicatesMerged: merged,
      excluded,
      target: { min: DEFAULT_SHORTLIST.min, max: DEFAULT_SHORTLIST.max, employers: DEFAULT_SHORTLIST.minEmployers },
      limits,
    },
  };
}

const sameRole = (candidate: Pick<Candidate, "employer" | "title">) => `${establishedKey(candidate.employer)}:${candidate.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()}`;

/** LinkedIn's search, then each promising role's full record. Paid per call, so it stops at the first sign of a credential or balance problem. */
async function searchLinkedIn(filters: FdeFilters, known: Candidate[], options: DiscoveryOptions, detailLimit: number): Promise<{ candidates: Candidate[]; source: Coverage["sources"][number] }> {
  const label = "LinkedIn (through the job search provider)";
  const { provider, meter, fresh, signal } = options;
  if (provider.isFixture) return { candidates: [], source: { source: label, status: "skipped", found: 0, note: "Fixture mode: LinkedIn wasn't searched." } };
  if (options.skipPaid) return { candidates: [], source: { source: label, status: "skipped", found: 0, note: options.skipPaid } };
  if (!provider.isConfigured()) return { candidates: [], source: { source: label, status: "skipped", found: 0, note: "TREG_API_TOKEN isn't set, so LinkedIn wasn't searched." } };

  const candidates: Candidate[] = [];
  try {
    const listings = new Map<string, { id: string; title: string; employer: string }>();
    for (const query of QUERIES) {
      await meter.authorize(ESTIMATES_MICRO.search);
      const { listings: page, charge } = await provider.searchJobs({ query, location: filters.location, remoteOnly: filters.remoteOnly }, { fresh, signal });
      await meter.record("discovery", charge);
      for (const listing of page) if (titleMatches(listing.title).match && !listings.has(listing.id)) listings.set(listing.id, listing);
    }
    const covered = new Set(known.map(sameRole));
    const toRead = [...listings.values()].filter((listing) => !covered.has(sameRole(listing))).slice(0, detailLimit);
    for (const listing of toRead) {
      await meter.authorize(ESTIMATES_MICRO.job);
      const { job, charge } = await provider.getJob(listing.id, { fresh, signal });
      await meter.record("job_detail", charge);
      candidates.push({
        source: "linkedin",
        sourceLabel: "LinkedIn",
        externalId: job.id,
        requisitionId: null,
        title: job.title,
        employer: job.employer || listing.employer,
        location: job.location,
        remotePolicy: job.remotePolicy,
        url: job.url,
        applyUrl: job.applyUrl,
        description: job.description,
        postedAt: job.postedAt,
        updatedAt: null,
        checkedAt: new Date().toISOString(),
        status: job.status,
        otherLocations: [],
      });
    }
    return { candidates, source: { source: label, status: "ok", found: candidates.length, note: `${listings.size} listings matched; ${toRead.length} read in full.` } };
  } catch (error) {
    const known = error instanceof ProviderError ? error : null;
    return { candidates, source: { source: label, status: "failed", found: candidates.length, note: known ? known.message : "The search couldn't be completed." } };
  }
}
