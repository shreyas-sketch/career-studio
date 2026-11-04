import "server-only";

import { z } from "zod";

import { accountsQuery } from "@/lib/accounts/db";
import { getJson, SourceError } from "@/lib/startups/http";
import { htmlToText } from "@/lib/startups/text";

// Freelance and contract work from public sources (agent 5). Every source
// here offers a public API that allows reuse with attribution; each keeps
// its link back, and is cached server-side for all accounts (the listings
// are public) so the sources are polled no more than they ask:
// - Remotive: a few times a day at most (github.com/remotive-com/remote-jobs-api)
// - Jobicy: no more than hourly (github.com/Jobicy/remote-jobs-api)
// - Remote OK: link back and name Remote OK; no logos (remoteok.com/api's legal notice)
// - Himalayas: attribution with a link (himalayas.app)
// - Hacker News "Ask HN: Freelancer? Seeking freelancer?" via HN's public Algolia API
// Upwork's and Freelancer.com's own APIs need approved credentials and
// aren't used; Upwork jobs are analysed from pasted posts instead.

export const FREELANCE_SOURCES = {
  REMOTIVE: { name: "Remotive", site: "https://remotive.com", ttlHours: 6, note: "Remote jobs; contract and freelance types kept." },
  JOBICY: { name: "Jobicy", site: "https://jobicy.com", ttlHours: 2, note: "Remote jobs; contract, freelance and part-time types kept." },
  REMOTEOK: { name: "Remote OK", site: "https://remoteok.com", ttlHours: 2, note: "Remote jobs; contract and freelance tags kept." },
  HIMALAYAS: { name: "Himalayas", site: "https://himalayas.app", ttlHours: 12, note: "Remote jobs, searched by your keywords; contract and freelance kept." },
  HN: { name: "Hacker News", site: "https://news.ycombinator.com", ttlHours: 6, note: "The monthly “Freelancer? Seeking freelancer?” thread; only posts seeking a freelancer." },
} as const;
export type FreelanceSource = keyof typeof FREELANCE_SOURCES;

/** One listing, the same shape from every source. */
export type FoundOpportunity = {
  source: FreelanceSource;
  externalId: string;
  title: string;
  client: string;
  url: string;
  description: string;
  budget: string;
  kind: string;
  location: string;
  tags: string[];
  postedAt: string | null;
};

const clip = (value: string | null | undefined, max: number) => (value ?? "").replace(/\s+\n/g, "\n").trim().slice(0, max);

/**
 * Text a source encoded twice, as UTF-8 read as Latin-1 ("Lead â\u0080\u0094 Logistics",
 * "fÃ¼r"), which Remote OK's API sends. Decoding is only kept when the whole
 * text is valid that way, so correct text ("café") stays as it was.
 */
export function repairedText(text: string): string {
  if (!/[\u00c2-\u00f4][\u0080-\u00bf]/.test(text) || /[^\u0000-\u00ff]/.test(text)) return text;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(text, "latin1"));
  } catch {
    return text;
  }
}

const isHttp = (url: string) => /^https?:\/\//i.test(url);

// ─── The shared cache ───────────────────────────────────────────────────────

type CacheRow = { payload: FoundOpportunity[]; fetched_at: Date };

async function cached(key: string, ttlHours: number, load: () => Promise<FoundOpportunity[]>, now = new Date()): Promise<{ items: FoundOpportunity[]; fetchedAt: Date; stale: boolean }> {
  const { rows } = await accountsQuery<CacheRow>(`SELECT payload, fetched_at FROM cs_shared.feed_cache WHERE key = $1`, [key]);
  const row = rows[0];
  if (row && now.getTime() - row.fetched_at.getTime() < ttlHours * 3_600_000) return { items: row.payload, fetchedAt: row.fetched_at, stale: false };
  try {
    const items = await load();
    await accountsQuery(
      `INSERT INTO cs_shared.feed_cache (key, payload, fetched_at) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`,
      [key, JSON.stringify(items), now],
    );
    return { items, fetchedAt: now, stale: false };
  } catch (error) {
    // A source that's down shouldn't empty the list: serve what was last fetched.
    if (row) return { items: row.payload, fetchedAt: row.fetched_at, stale: true };
    throw error;
  }
}

// ─── Sources ────────────────────────────────────────────────────────────────

const CONTRACT = /\b(contract|contractor|freelance|freelancer|part[-\s]?time|temporary|temp|consult(ant|ing)?|gig|project[-\s]based|hourly)\b/i;

const remotiveSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.union([z.number(), z.string()]),
      url: z.string(),
      title: z.string(),
      company_name: z.string().nullish(),
      category: z.string().nullish(),
      job_type: z.string().nullish(),
      publication_date: z.string().nullish(),
      candidate_required_location: z.string().nullish(),
      salary: z.string().nullish(),
      description: z.string().nullish(),
      tags: z.array(z.string()).nullish(),
    }),
  ),
});

export function fromRemotive(payload: unknown): FoundOpportunity[] {
  const parsed = remotiveSchema.safeParse(payload);
  if (!parsed.success) throw new SourceError("changed its format");
  return parsed.data.jobs
    .filter((job) => /contract|freelance|part_time/i.test(job.job_type ?? ""))
    .filter((job) => isHttp(job.url))
    .map((job) => ({
      source: "REMOTIVE",
      externalId: String(job.id),
      title: clip(job.title, 200),
      client: clip(job.company_name, 120),
      url: job.url,
      description: clip(htmlToText(job.description ?? ""), 12_000),
      budget: clip(job.salary, 120),
      kind: (job.job_type ?? "").replace(/_/g, "-"),
      location: clip(job.candidate_required_location, 160),
      tags: [...(job.tags ?? []), job.category ?? ""].filter(Boolean).slice(0, 12),
      postedAt: job.publication_date ?? null,
    }));
}

const jobicySchema = z.object({
  jobs: z.array(
    z.object({
      id: z.union([z.number(), z.string()]),
      url: z.string(),
      jobTitle: z.string(),
      companyName: z.string().nullish(),
      jobIndustry: z.union([z.array(z.string()), z.string()]).nullish(),
      jobType: z.union([z.array(z.string()), z.string()]).nullish(),
      jobGeo: z.string().nullish(),
      jobExcerpt: z.string().nullish(),
      jobDescription: z.string().nullish(),
      pubDate: z.string().nullish(),
      salaryMin: z.union([z.number(), z.string()]).nullish(),
      salaryMax: z.union([z.number(), z.string()]).nullish(),
      salaryCurrency: z.string().nullish(),
      salaryPeriod: z.string().nullish(),
    }),
  ),
});

const asList = (value: string[] | string | null | undefined) => (Array.isArray(value) ? value : value ? [value] : []);

export function fromJobicy(payload: unknown): FoundOpportunity[] {
  const parsed = jobicySchema.safeParse(payload);
  if (!parsed.success) throw new SourceError("changed its format");
  return parsed.data.jobs
    .filter((job) => asList(job.jobType).some((type) => /contract|freelance|part/i.test(type)))
    .filter((job) => isHttp(job.url))
    .map((job) => {
      const range = [job.salaryMin, job.salaryMax].filter((value) => value !== null && value !== undefined && value !== "").join("–");
      return {
        source: "JOBICY",
        externalId: String(job.id),
        title: clip(htmlToText(job.jobTitle), 200),
        client: clip(htmlToText(job.companyName ?? ""), 120),
        url: job.url,
        description: clip(htmlToText(job.jobDescription ?? job.jobExcerpt ?? ""), 12_000),
        budget: range ? `${job.salaryCurrency ?? ""} ${range}${job.salaryPeriod ? ` per ${job.salaryPeriod}` : ""}`.trim() : "",
        kind: asList(job.jobType).join(", ").toLowerCase(),
        location: clip(job.jobGeo, 160),
        tags: asList(job.jobIndustry).map((tag) => htmlToText(tag)).slice(0, 12),
        postedAt: job.pubDate ?? null,
      };
    });
}

const remoteOkSchema = z.array(z.record(z.string(), z.unknown()));
const remoteOkJob = z.object({
  id: z.union([z.number(), z.string()]),
  url: z.string(),
  position: z.string(),
  company: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
  location: z.string().nullish(),
  description: z.string().nullish(),
  date: z.string().nullish(),
  salary_min: z.number().nullish(),
  salary_max: z.number().nullish(),
});

export function fromRemoteOk(payload: unknown): FoundOpportunity[] {
  const parsed = remoteOkSchema.safeParse(payload);
  if (!parsed.success) throw new SourceError("changed its format");
  // The first element is Remote OK's legal notice, not a job.
  return parsed.data.flatMap((entry) => {
    const job = remoteOkJob.safeParse(entry);
    if (!job.success || !isHttp(job.data.url)) return [];
    const tags = (job.data.tags ?? []).map(repairedText);
    const text = `${job.data.position} ${tags.join(" ")}`;
    if (!CONTRACT.test(text) && !tags.some((tag) => CONTRACT.test(tag))) return [];
    const salary = job.data.salary_min && job.data.salary_max ? `$${job.data.salary_min.toLocaleString("en-US")}–$${job.data.salary_max.toLocaleString("en-US")} a year` : "";
    return [
      {
        source: "REMOTEOK" as const,
        externalId: String(job.data.id),
        title: clip(repairedText(job.data.position), 200),
        client: clip(repairedText(job.data.company ?? ""), 120),
        url: job.data.url,
        description: clip(repairedText(htmlToText(job.data.description ?? "")), 12_000),
        budget: salary,
        kind: tags.filter((tag) => CONTRACT.test(tag)).join(", ") || "contract",
        location: clip(repairedText(job.data.location ?? ""), 160) || "Remote",
        tags: tags.slice(0, 12),
        postedAt: job.data.date ?? null,
      },
    ];
  });
}

const himalayasSchema = z.object({
  jobs: z.array(
    z.object({
      title: z.string(),
      companyName: z.string().nullish(),
      employmentType: z.string().nullish(),
      minSalary: z.number().nullish(),
      maxSalary: z.number().nullish(),
      currency: z.string().nullish(),
      locationRestrictions: z.array(z.string()).nullish(),
      categories: z.array(z.string()).nullish(),
      description: z.string().nullish(),
      excerpt: z.string().nullish(),
      pubDate: z.union([z.number(), z.string()]).nullish(),
      applicationLink: z.string().nullish(),
      guid: z.string().nullish(),
    }),
  ),
});

export function fromHimalayas(payload: unknown): FoundOpportunity[] {
  const parsed = himalayasSchema.safeParse(payload);
  if (!parsed.success) throw new SourceError("changed its format");
  return parsed.data.jobs
    .filter((job) => CONTRACT.test(job.employmentType ?? ""))
    .flatMap((job) => {
      const url = job.guid && isHttp(job.guid) ? job.guid : job.applicationLink && isHttp(job.applicationLink) ? job.applicationLink : null;
      if (!url) return [];
      const posted = typeof job.pubDate === "number" ? new Date(job.pubDate * (job.pubDate < 1e12 ? 1000 : 1)).toISOString() : (job.pubDate ?? null);
      return [
        {
          source: "HIMALAYAS" as const,
          externalId: url,
          title: clip(job.title, 200),
          client: clip(job.companyName, 120),
          url,
          description: clip(htmlToText(job.description ?? job.excerpt ?? ""), 12_000),
          budget: job.minSalary && job.maxSalary ? `${job.currency ?? "USD"} ${job.minSalary.toLocaleString("en-US")}–${job.maxSalary.toLocaleString("en-US")}` : "",
          kind: (job.employmentType ?? "").toLowerCase(),
          location: (job.locationRestrictions ?? []).join(", ").slice(0, 160) || "Remote",
          tags: (job.categories ?? []).slice(0, 12),
          postedAt: posted,
        },
      ];
    });
}

const hnSearchSchema = z.object({ hits: z.array(z.object({ objectID: z.string(), title: z.string().nullish(), created_at: z.string().nullish() })) });
const hnThreadSchema = z.object({
  children: z.array(z.object({ id: z.union([z.number(), z.string()]), text: z.string().nullish(), author: z.string().nullish(), created_at: z.string().nullish() })),
});

export function fromHnThread(payload: unknown): FoundOpportunity[] {
  const parsed = hnThreadSchema.safeParse(payload);
  if (!parsed.success) throw new SourceError("changed its format");
  return parsed.data.children.flatMap((post) => {
    if (!post.text) return [];
    const text = htmlToText(post.text);
    // Only those looking for a freelancer; "SEEKING WORK" posts are other freelancers.
    if (!/^\s*seeking\s+freelancer/i.test(text)) return [];
    const body = text.replace(/^\s*seeking\s+freelancer\s*[:\-–]?\s*/i, "");
    // The first line that says what the work is: not only where it's done.
    const firstLine = body.split("\n").map((line) => line.trim()).find((line) => line && !/^(?:remote|on-?site|hybrid)[.!]?$/i.test(line)) ?? "";
    return [
      {
        source: "HN" as const,
        externalId: String(post.id),
        title: clip(firstLine, 200) || "Seeking freelancer",
        client: clip(post.author ?? "", 120),
        url: `https://news.ycombinator.com/item?id=${post.id}`,
        description: clip(body, 12_000),
        budget: "",
        kind: "freelance",
        location: /\bremote\b/i.test(body) ? "Remote" : "",
        tags: [],
        postedAt: post.created_at ?? null,
      },
    ];
  });
}

async function fetchHnFreelancer(signal?: AbortSignal): Promise<FoundOpportunity[]> {
  const search = hnSearchSchema.safeParse(
    await getJson("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=20", { signal }),
  );
  if (!search.success) throw new SourceError("changed its format");
  const thread = search.data.hits.find((hit) => /freelancer\?\s*seeking freelancer/i.test(hit.title ?? ""));
  if (!thread) return [];
  return fromHnThread(await getJson(`https://hn.algolia.com/api/v1/items/${thread.objectID}`, { signal }));
}

// ─── Searching ──────────────────────────────────────────────────────────────

export type SourceResult = { source: FreelanceSource; items: FoundOpportunity[]; fetchedAt: Date | null; stale: boolean; error: string | null };

/** Every source's listings for these keywords, from the cache when it's fresh. */
export async function searchFreelanceSources(keywords: string[], signal?: AbortSignal): Promise<SourceResult[]> {
  const query = keywords.slice(0, 3).join(" ").trim();
  const sources: [FreelanceSource, string, () => Promise<FoundOpportunity[]>][] = [
    ["REMOTIVE", "remotive:all", async () => fromRemotive(await getJson("https://remotive.com/api/remote-jobs", { signal }))],
    ["JOBICY", "jobicy:all", async () => fromJobicy(await getJson("https://jobicy.com/api/v2/remote-jobs?count=100", { signal }))],
    ["REMOTEOK", "remoteok:all", async () => fromRemoteOk(await getJson("https://remoteok.com/api", { signal }))],
    [
      "HIMALAYAS",
      `himalayas:${query.toLowerCase()}`,
      async () => (query ? fromHimalayas(await getJson(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(query)}&sort=recent`, { signal })) : []),
    ],
    ["HN", "hn:freelancer", () => fetchHnFreelancer(signal)],
  ];
  return Promise.all(
    sources.map(async ([source, key, load]) => {
      try {
        const { items, fetchedAt, stale } = await cached(key, FREELANCE_SOURCES[source].ttlHours, load);
        return { source, items, fetchedAt, stale, error: null };
      } catch (error) {
        return { source, items: [], fetchedAt: null, stale: false, error: error instanceof SourceError ? error.message : "couldn't be reached" };
      }
    }),
  );
}
