import { Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AiSetupNotice, EmptyState, relativeDay, Screen, Section, Verdict } from "@/components/career/parts";
import { PageHeader } from "@/components/page-header";
import { loadFreelancePrefs } from "@/lib/career/freelance-prefs";
import { isAiConfigured } from "@/lib/career/shared-data";
import { listUpworkAnalyses } from "@/lib/career/upwork";
import { UPWORK_REFERENCE } from "@/lib/career/upwork-data";

import { NewAnalysis } from "./new-analysis";

export const metadata: Metadata = { title: "Upwork analyst" };

/** Agent 6: paste an Upwork job, get fit, price, scope, take-home and a proposal. No Upwork account access needed. */
export default async function UpworkPage({ searchParams }: PageProps<"/upwork">) {
  const params = await searchParams;
  const [analyses, prefs, aiReady] = await Promise.all([listUpworkAnalyses(), loadFreelancePrefs(), isAiConfigured()]);
  const prefill = typeof params.text === "string" ? params.text.slice(0, 30_000) : "";

  return (
    <>
      <PageHeader
        title="Upwork analyst"
        description="Paste an Upwork job post. You'll get whether it fits you, what to bid, scope and milestones, what applying costs in Connects, what you'd take home after fees, and a proposal from your real experience."
      />
      <Screen wide>
        {!aiReady && <AiSetupNotice what="The Upwork analyst" />}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Section title="Analyse a job">
            <NewAnalysis
              disabled={!aiReady}
              prefill={prefill}
              defaults={{ serviceFeePercent: prefs.upworkFeePercent, minimumHourlyUsd: prefs.minimumHourlyUsd, connectsBalance: prefs.connectsBalance, connectPriceUsd: UPWORK_REFERENCE.connectPriceUsd.value }}
            />
          </Section>
          <Section title="Connects are not AI tokens">
            <div className="flex flex-col gap-3 text-sm text-pretty text-muted">
              <p>
                <span className="font-medium text-ink">Connects</span> are Upwork&apos;s currency for submitting proposals. You buy them from Upwork. {UPWORK_REFERENCE.connectPriceUsd.note}{" "}
                {UPWORK_REFERENCE.connectsPerProposal.note}
              </p>
              <p>
                <span className="font-medium text-ink">AI tokens</span> are what your own AI provider bills you for each analysis and proposal here. Career Studio shows an estimate of them on each analysis, separately.
              </p>
              <p>{UPWORK_REFERENCE.serviceFee.note}</p>
              <p className="text-meta">
                Sources: <a href={UPWORK_REFERENCE.connectPriceUsd.source} className="underline underline-offset-3" target="_blank" rel="noopener noreferrer">Upwork pricing</a>,{" "}
                <a href={UPWORK_REFERENCE.connectsPerProposal.source} className="underline underline-offset-3" target="_blank" rel="noopener noreferrer">Upwork on Connects</a>. Checked {UPWORK_REFERENCE.checkedOn}; prices change, so you can edit them per analysis.
              </p>
            </div>
          </Section>
        </div>

        <Section title="Your analyses">
          {analyses.length === 0 ? (
            <EmptyState icon={<Receipt size={20} aria-hidden="true" />} title="Nothing analysed yet">
              Copy a job post from Upwork, everything from the title to the client&apos;s details, and paste it above. Your Upwork account isn&apos;t needed, and nothing is sent to Upwork.
            </EmptyState>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {analyses.map((analysis) => (
                <li key={analysis.id}>
                  <Link href={`/upwork/${analysis.id}`} className="flex h-full flex-col gap-2 rounded-card border border-line-card bg-card p-4 text-ink hover:border-line-strong hover:text-ink">
                    <span className="line-clamp-2 font-medium text-pretty">{analysis.title}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      {analysis.verdict ? <Verdict verdict={analysis.verdict} /> : <span className="text-meta text-muted">Analysing…</span>}
                      {analysis.score !== null && <span className="text-meta text-muted tabular-nums">Fit {analysis.score}</span>}
                    </span>
                    <span className="mt-auto text-meta text-muted">
                      {analysis.status === "APPLIED" ? "Applied" : analysis.status === "SKIPPED" ? "Skipped" : analysis.hasProposal ? "Proposal drafted" : "Evaluating"} · {relativeDay(analysis.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </Screen>
    </>
  );
}
