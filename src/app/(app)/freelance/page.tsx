import type { Metadata } from "next";

import { AiSetupNotice, Screen } from "@/components/career/parts";
import { PageHeader } from "@/components/page-header";
import { FREELANCE_REFRESH_KEY, listOpportunities, searchKeywords } from "@/lib/career/freelance";
import { loadFreelancePrefs } from "@/lib/career/freelance-prefs";
import { FREELANCE_SOURCES } from "@/lib/career/freelance-sources";
import { isAiConfigured, openJob } from "@/lib/career/shared-data";
import { loadProfile } from "@/lib/profile-data";

import { FreelanceBoard } from "./freelance-board";

export const metadata: Metadata = { title: "Freelance opportunities" };

const FILTERS = ["open", "saved", "pursuing", "dismissed"] as const;

/** Agent 5: freelance and contract work from public sources, matched and scored for the user. */
export default async function FreelancePage({ searchParams }: PageProps<"/freelance">) {
  const params = await searchParams;
  const filter = FILTERS.find((value) => value === params.show) ?? "open";
  const [prefs, profile, aiReady, jobId] = await Promise.all([loadFreelancePrefs(), loadProfile(), isAiConfigured(), openJob(FREELANCE_REFRESH_KEY)]);
  const opportunities = await listOpportunities(filter, { keywords: searchKeywords(prefs, profile), prefs, profile });

  return (
    <>
      <PageHeader
        title="Freelance opportunities"
        description="Contract and freelance work from public job sources, matched to what you sell, your rate and your availability, with an honest fit check on each."
      />
      <Screen wide>
        {!aiReady && <AiSetupNotice what="Scoring opportunities" />}
        <FreelanceBoard
          prefs={prefs}
          suggestedKeywords={searchKeywords({ ...prefs, keywords: [] }, profile)}
          filter={filter}
          jobId={jobId}
          aiReady={aiReady}
          sources={Object.entries(FREELANCE_SOURCES).map(([key, source]) => ({ key, ...source }))}
          opportunities={opportunities.map((row) => ({
            id: row.id,
            source: row.source,
            sourceName: row.sourceName,
            title: row.title,
            client: row.client,
            url: row.url,
            description: row.description,
            budget: row.budget,
            kind: row.kind,
            location: row.location,
            tags: row.tags,
            postedAt: row.postedAt ? row.postedAt.toISOString() : null,
            score: row.score,
            fit: row.fit,
            status: row.status,
            relevance: row.relevance,
          }))}
        />
      </Screen>
    </>
  );
}
