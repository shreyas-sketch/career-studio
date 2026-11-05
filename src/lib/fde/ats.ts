import { decodeEntities, htmlToText } from "@/lib/startups/text";

import { titleMatches, type Candidate } from "./market-filter";
import type { RoleSource } from "./types";

// Employers' own public job boards. These three APIs are published for exactly
// this (showing a company's open jobs), need no key and cost nothing. A role
// present on the live board is open, which is what "verified" means here. The
// mappers are pure; anything that doesn't look like a job is skipped.

export type Board = { source: Extract<RoleSource, "greenhouse" | "lever" | "ashby">; slug: string; employer: string };

/**
 * Boards that had real forward deployed openings when checked on 5 November
 * 2026. Being on this list decides only where to look, never what's picked.
 */
export const BOARDS: readonly Board[] = [
  { source: "lever", slug: "palantir", employer: "Palantir" },
  { source: "ashby", slug: "openai", employer: "OpenAI" },
  { source: "greenhouse", slug: "anthropic", employer: "Anthropic" },
  { source: "greenhouse", slug: "scaleai", employer: "Scale AI" },
  { source: "greenhouse", slug: "databricks", employer: "Databricks" },
  { source: "ashby", slug: "cohere", employer: "Cohere" },
  { source: "ashby", slug: "elevenlabs", employer: "ElevenLabs" },
  { source: "ashby", slug: "harvey", employer: "Harvey" },
  { source: "ashby", slug: "ramp", employer: "Ramp" },
  { source: "ashby", slug: "baseten", employer: "Baseten" },
  { source: "ashby", slug: "langchain", employer: "LangChain" },
  { source: "ashby", slug: "notion", employer: "Notion" },
  { source: "ashby", slug: "cursor", employer: "Cursor" },
  { source: "ashby", slug: "replit", employer: "Replit" },
  { source: "greenhouse", slug: "stripe", employer: "Stripe" },
  { source: "greenhouse", slug: "mongodb", employer: "MongoDB" },
  { source: "greenhouse", slug: "cloudflare", employer: "Cloudflare" },
  { source: "greenhouse", slug: "togetherai", employer: "Together AI" },
  { source: "greenhouse", slug: "datadog", employer: "Datadog" },
  { source: "greenhouse", slug: "vercel", employer: "Vercel" },
  { source: "greenhouse", slug: "figma", employer: "Figma" },
  { source: "greenhouse", slug: "gitlab", employer: "GitLab" },
  { source: "lever", slug: "shieldai", employer: "Shield AI" },
];

/** Employers whose forward deployed practice is long established and well known. */
export const ESTABLISHED = new Set(["palantir", "openai", "anthropic", "scale", "databricks"]);

export const boardUrl = (board: Board): string =>
  board.source === "greenhouse"
    ? `https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs`
    : board.source === "lever"
      ? `https://api.lever.co/v0/postings/${board.slug}?mode=json`
      : `https://api.ashbyhq.com/posting-api/job-board/${board.slug}?includeCompensation=true`;

export const greenhouseJobUrl = (board: Board, id: string) => `https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs/${encodeURIComponent(id)}`;

const SOURCE_LABELS: Record<Board["source"], string> = { greenhouse: "Greenhouse board", lever: "Lever board", ashby: "Ashby board" };

const text = (value: unknown) => (typeof value === "string" ? value : "");
const isoOf = (value: unknown): string | null => {
  const date = typeof value === "number" ? new Date(value) : typeof value === "string" && value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const isHttps = (url: string) => /^https:\/\//i.test(url);

/** Whether a listing's title is worth fetching in full. */
export const worthReading = (title: string) => titleMatches(title).match;

/** A Greenhouse board's jobs without descriptions, for choosing which to read. */
export function greenhouseList(payload: unknown): { id: string; title: string }[] {
  return asArray(asRecord(payload).jobs)
    .map(asRecord)
    .map((job) => ({ id: String(job.id ?? ""), title: text(job.title).trim() }))
    .filter((job) => job.id && job.title);
}

export function fromGreenhouseJob(payload: unknown, board: Board, checkedAt: string): Candidate | null {
  const job = asRecord(payload);
  const url = text(job.absolute_url);
  const id = String(job.id ?? "");
  if (!id || !isHttps(url) || !text(job.title)) return null;
  // Greenhouse sends its HTML with the tags themselves escaped.
  const description = htmlToText(decodeEntities(text(job.content)));
  return {
    source: "greenhouse",
    sourceLabel: SOURCE_LABELS.greenhouse,
    externalId: `${board.slug}:${id}`,
    requisitionId: text(job.requisition_id) || (job.internal_job_id ? String(job.internal_job_id) : null),
    title: text(job.title).trim(),
    employer: board.employer,
    location: text(asRecord(job.location).name).trim(),
    remotePolicy: /remote/i.test(text(asRecord(job.location).name)) ? "Remote stated" : "",
    url,
    applyUrl: url,
    description,
    postedAt: isoOf(job.first_published),
    updatedAt: isoOf(job.updated_at),
    checkedAt,
    status: "open",
    otherLocations: [],
  };
}

export function fromLever(payload: unknown, board: Board, checkedAt: string): Candidate[] {
  return asArray(payload).flatMap((value) => {
    const job = asRecord(value);
    const id = text(job.id);
    const url = text(job.hostedUrl);
    const title = text(job.text).trim();
    if (!id || !title || !isHttps(url) || !worthReading(title)) return [];
    const categories = asRecord(job.categories);
    const lists = asArray(job.lists)
      .map(asRecord)
      .map((list) => `${text(list.text)}\n${htmlToText(text(list.content))}`);
    const description = [text(job.openingPlain) || text(job.descriptionPlain), text(job.descriptionBodyPlain), ...lists, text(job.additionalPlain)].filter(Boolean).join("\n\n");
    return [
      {
        source: "lever" as const,
        sourceLabel: SOURCE_LABELS.lever,
        externalId: `${board.slug}:${id}`,
        requisitionId: null,
        title,
        employer: board.employer,
        location: text(categories.location).trim(),
        remotePolicy: text(job.workplaceType),
        url,
        applyUrl: text(job.applyUrl) || url,
        description,
        postedAt: isoOf(job.createdAt),
        updatedAt: null,
        checkedAt,
        status: "open" as const,
        otherLocations: [],
      },
    ];
  });
}

export function fromAshby(payload: unknown, board: Board, checkedAt: string): Candidate[] {
  return asArray(asRecord(payload).jobs).flatMap((value) => {
    const job = asRecord(value);
    const id = text(job.id);
    const url = text(job.jobUrl);
    const title = text(job.title).trim();
    if (!id || !title || !isHttps(url) || !worthReading(title) || job.isListed === false) return [];
    const secondary = asArray(job.secondaryLocations).map((entry) => text(asRecord(entry).location)).filter(Boolean);
    return [
      {
        source: "ashby" as const,
        sourceLabel: SOURCE_LABELS.ashby,
        externalId: `${board.slug}:${id}`,
        requisitionId: null,
        title,
        employer: board.employer,
        location: text(job.location).trim(),
        remotePolicy: job.isRemote === true ? "Remote" : text(job.workplaceType),
        url,
        applyUrl: text(job.applyUrl) || url,
        description: text(job.descriptionPlain) || htmlToText(text(job.descriptionHtml)),
        postedAt: isoOf(job.publishedAt),
        updatedAt: null,
        checkedAt,
        status: "open" as const,
        otherLocations: secondary,
      },
    ];
  });
}
