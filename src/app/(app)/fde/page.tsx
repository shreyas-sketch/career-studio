import { Radar } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AiSetupNotice, EmptyState, relativeDay, Screen, Section } from "@/components/career/parts";
import { PageHeader } from "@/components/page-header";
import { buttonClassName } from "@/components/ui/button";
import { isAiConfigured } from "@/lib/career/shared-data";
import { fdeConfig, retrievalProvider } from "@/lib/fde/config";
import { STATE_LABELS } from "@/lib/fde/format";
import { listReports } from "@/lib/fde/report";

import { StartForm } from "./start-form";

export const metadata: Metadata = { title: "FDE review" };

export default async function FdePage() {
  const [reports, aiReady] = await Promise.all([listReports(), isAiConfigured()]);
  const provider = retrievalProvider();

  return (
    <>
      <PageHeader
        title="FDE review"
        description="Paste someone's public LinkedIn profile. Power Deploy finds current forward deployed engineering openings by itself, compares the profile with each one, and Stop looks for paid freelance work that fits."
        actions={
          <Link href="/fde/pilot" className={buttonClassName("secondary", "sm")}>
            Batch pilot
          </Link>
        }
      />
      <Screen wide>
        {!aiReady && <AiSetupNotice what="The comparison" />}
        {fdeConfig().fixtureMode && (
          <p className="rounded-card border border-warning-line bg-warning-surface px-5 py-4 text-sm text-pretty">
            Fixture mode is on. Profiles here are invented samples, not LinkedIn reads. Job openings are still real.
          </p>
        )}
        {!provider.isConfigured() && (
          <p className="rounded-card border border-warning-line bg-warning-surface px-5 py-4 text-sm text-pretty">
            Reading LinkedIn profiles needs one server setting, TREG_API_TOKEN. Until then a review can still find real openings, but can&apos;t read the profile.{" "}
            <Link href="/settings?section=fde" className="underline">
              See what&apos;s needed
            </Link>
          </p>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_400px]">
          <Section title="Review a profile">
            <div className="rounded-panel border border-line-card bg-card p-7 max-sm:p-5">
              <StartForm />
            </div>
          </Section>
          <Section title="Your reports">
            {reports.length === 0 ? (
              <EmptyState icon={<Radar size={20} aria-hidden="true" />} title="No reviews yet">
                A report shows where a profile stands against a sourced sample of open roles, with every claim tied to words in the profile and the posting.
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-2">
                {reports.map((report) => (
                  <li key={report.id}>
                    <Link href={`/fde/${report.id}`} className="flex items-center justify-between gap-4 rounded-card border border-line-card bg-card px-4 py-3 hover:bg-hover">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{report.name}</span>
                        <span className="text-meta text-muted">
                          {STATE_LABELS[report.state]}, {relativeDay(new Date(report.createdAt))}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        {report.score !== null ? (
                          <span className="font-serif text-2xl tabular-nums">{report.score}</span>
                        ) : (
                          <span className="text-meta text-muted">No score</span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </Screen>
    </>
  );
}
