import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { OpportunityStatus } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { fitSchema, scoreOpportunity } from "@/lib/ai/tasks/career/freelance";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { loadFreelancePrefs, prefsForPrompt, type FreelancePrefs } from "@/lib/career/freelance-prefs";
import { FREELANCE_SOURCES, keywordScore, searchFreelanceSources, type FoundOpportunity, type FreelanceSource } from "@/lib/career/freelance-sources";
import { defineJob, startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import type { ProfileData } from "@/lib/profile";

export const FREELANCE_REFRESH_KEY = "freelance:refresh";
export const opportunityJobKey = (id: string) => `opportunity:${id}`;

/** How many new listings a refresh keeps, and how many of the best it scores with the AI model. */
const KEEP = 40;
const AUTO_SCORE = 8;

/** What to search for: the user's keywords, else their headline and top skills. */
export function searchKeywords(prefs: FreelancePrefs, profile: ProfileData): string[] {
  if (prefs.keywords.length > 0) return prefs.keywords;
  const fromHeadline = profile.basics.headline
    .split(/[,|/·•]+| and /i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 40);
  return [...new Set([...fromHeadline, ...profile.skills.slice(0, 6).map((skill) => skill.name)])].slice(0, 8);
}

/** Listings that match the preferences: wanted contract types, not what they avoid, and at least one keyword. */
export function relevant(items: FoundOpportunity[], prefs: FreelancePrefs, keywords: string[]): { item: FoundOpportunity; relevance: number }[] {
  const avoid = prefs.avoid
    .split(/[,;\n]+/)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length >= 3);
  return items
    .filter((item) => {
      const kind = item.kind.toLowerCase();
      const wanted = prefs.kinds.some((wantedKind) => kind.includes(wantedKind === "part-time" ? "part" : wantedKind));
      // Sources label loosely; keep anything they marked as contract-like when the type is unclear.
      return wanted || !/(contract|freelance|part)/.test(kind);
    })
    .filter((item) => !avoid.some((word) => `${item.title} ${item.description}`.toLowerCase().includes(word)))
    .map((item) => ({ item, relevance: keywords.length > 0 ? keywordScore(item, keywords) : 1 }))
    .filter(({ relevance }) => relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || Date.parse(b.item.postedAt ?? "0") - Date.parse(a.item.postedAt ?? "0"));
}

export const freelanceRefreshJob = defineJob({
  type: "freelance-refresh",
  input: z.object({}),
  result: z.object({
    added: z.number(),
    scored: z.number(),
    sources: z.array(z.object({ source: z.string(), found: z.number(), error: z.string().nullable(), stale: z.boolean() })),
  }),
  async run(_input, { step, signal }) {
    await step("Checking the freelance sources");
    const [prefs, profile] = await Promise.all([loadFreelancePrefs(), loadProfile()]);
    const keywords = searchKeywords(prefs, profile);
    const results = await searchFreelanceSources(keywords, signal);

    await step("Matching listings to your preferences");
    const dismissed = new Set(
      (await prisma.freelanceOpportunity.findMany({ where: { status: OpportunityStatus.DISMISSED }, select: { source: true, externalId: true } })).map(
        (row) => `${row.source}:${row.externalId}`,
      ),
    );
    const matches = relevant(
      results.flatMap((result) => result.items),
      prefs,
      keywords,
    )
      .filter(({ item }) => !dismissed.has(`${item.source}:${item.externalId}`))
      .slice(0, KEEP);

    let added = 0;
    for (const { item } of matches) {
      const data = {
        title: item.title,
        client: item.client,
        url: item.url,
        description: item.description,
        budget: item.budget,
        kind: item.kind,
        location: item.location,
        tags: item.tags as Prisma.InputJsonValue,
        postedAt: item.postedAt && !Number.isNaN(Date.parse(item.postedAt)) ? new Date(item.postedAt) : null,
      };
      const existing = await prisma.freelanceOpportunity.findUnique({ where: { source_externalId: { source: item.source, externalId: item.externalId } }, select: { id: true } });
      if (existing) await prisma.freelanceOpportunity.update({ where: { id: existing.id }, data });
      else {
        await prisma.freelanceOpportunity.create({ data: { source: item.source, externalId: item.externalId, ...data } });
        added++;
      }
    }

    // The best unscored ones get a fit score right away; the rest on request.
    const unscored = await prisma.freelanceOpportunity.findMany({
      where: { score: null, status: { not: OpportunityStatus.DISMISSED }, OR: matches.slice(0, AUTO_SCORE).map(({ item }) => ({ source: item.source, externalId: item.externalId })) },
      select: { id: true },
    });
    let scored = 0;
    if (unscored.length > 0) {
      await step(`Scoring the ${unscored.length} best matches`);
      const [provider, options] = await Promise.all([getAiProvider(), loadTaskOptions()]);
      for (const { id } of unscored) {
        await scoreOne(id, provider, options, prefs, profile, signal);
        scored++;
      }
    }
    return {
      added,
      scored,
      sources: results.map((result) => ({ source: result.source, found: result.items.length, error: result.error, stale: result.stale })),
    };
  },
});

async function scoreOne(
  id: string,
  provider: Awaited<ReturnType<typeof getAiProvider>>,
  options: Awaited<ReturnType<typeof loadTaskOptions>>,
  prefs: FreelancePrefs,
  profile: ProfileData,
  signal: AbortSignal,
): Promise<void> {
  const row = await prisma.freelanceOpportunity.findUniqueOrThrow({ where: { id } });
  const { data, promptVersion } = await scoreOpportunity(
    provider,
    { opportunity: { ...row, source: FREELANCE_SOURCES[row.source as FreelanceSource]?.name ?? row.source }, profile, preferences: prefsForPrompt(prefs) },
    { ...options, signal },
  );
  await prisma.freelanceOpportunity.update({ where: { id }, data: { score: data.score, fit: data as Prisma.InputJsonValue, scoredWith: promptVersion } });
}

export const scoreOpportunityJob = defineJob({
  type: "opportunity-score",
  input: z.object({ id: z.string() }),
  result: z.object({ done: z.boolean() }),
  async run({ id }, { step, signal }) {
    await step("Checking the fit");
    const [prefs, profile, provider, options] = await Promise.all([loadFreelancePrefs(), loadProfile(), getAiProvider(), loadTaskOptions()]);
    await scoreOne(id, provider, options, prefs, profile, signal);
    return { done: true };
  },
});

export const startFreelanceRefresh = () => startJob(freelanceRefreshJob, {}, { key: FREELANCE_REFRESH_KEY });
export const startOpportunityScore = (id: string) => startJob(scoreOpportunityJob, { id }, { key: opportunityJobKey(id) });

export async function setOpportunityStatus(id: string, status: OpportunityStatus): Promise<void> {
  await prisma.freelanceOpportunity.update({ where: { id }, data: { status } });
}

export async function listOpportunities(filter: "open" | "saved" | "pursuing" | "dismissed" = "open") {
  const where: Prisma.FreelanceOpportunityWhereInput =
    filter === "open"
      ? { status: { in: [OpportunityStatus.NEW, OpportunityStatus.SAVED, OpportunityStatus.PURSUING] } }
      : { status: filter === "saved" ? OpportunityStatus.SAVED : filter === "pursuing" ? OpportunityStatus.PURSUING : OpportunityStatus.DISMISSED };
  const rows = await prisma.freelanceOpportunity.findMany({
    where,
    orderBy: [{ score: { sort: "desc", nulls: "last" } }, { postedAt: { sort: "desc", nulls: "last" } }],
    take: 120,
  });
  return rows.map((row) => {
    const fit = row.fit ? fitSchema.safeParse(row.fit) : null;
    return { ...row, tags: z.array(z.string()).catch([]).parse(row.tags), fit: fit?.success ? fit.data : null, sourceName: FREELANCE_SOURCES[row.source as FreelanceSource]?.name ?? row.source };
  });
}

export async function loadOpportunity(id: string) {
  const row = await prisma.freelanceOpportunity.findUnique({ where: { id } });
  if (!row) return null;
  const fit = row.fit ? fitSchema.safeParse(row.fit) : null;
  return { ...row, tags: z.array(z.string()).catch([]).parse(row.tags), fit: fit?.success ? fit.data : null, sourceName: FREELANCE_SOURCES[row.source as FreelanceSource]?.name ?? row.source };
}
