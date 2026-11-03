import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Screen } from "@/components/career/parts";
import { PageHeader } from "@/components/page-header";
import { isAiConfigured, openJob } from "@/lib/career/shared-data";
import { loadUpworkAnalysis, upworkJobKey } from "@/lib/career/upwork";
import { UPWORK_REFERENCE } from "@/lib/career/upwork-data";

import { AnalysisView } from "./analysis-view";

export const metadata: Metadata = { title: "Upwork analysis" };

export default async function UpworkAnalysisPage({ params }: PageProps<"/upwork/[id]">) {
  const { id } = await params;
  const [record, aiReady] = await Promise.all([loadUpworkAnalysis(id), isAiConfigured()]);
  if (!record) notFound();
  const jobId = await openJob(upworkJobKey(id));

  return (
    <>
      <PageHeader
        title={record.title}
        before={
          <Link href="/upwork" className="text-sm text-muted hover:text-ink">
            ← Upwork analyst
          </Link>
        }
      />
      <Screen wide>
        <AnalysisView
          record={{
            id: record.id,
            jobText: record.jobText,
            jobUrl: record.jobUrl,
            status: record.status,
            inputs: record.inputs,
            analysis: record.analysis,
            economics: record.economics,
            proposal: record.proposal,
            screening: record.screening,
            usage: record.usage,
          }}
          reference={{ checkedOn: UPWORK_REFERENCE.checkedOn, feeNote: UPWORK_REFERENCE.serviceFee.note, source: UPWORK_REFERENCE.connectPriceUsd.source, boostNote: UPWORK_REFERENCE.boost.note }}
          jobId={jobId}
          aiReady={aiReady}
        />
      </Screen>
    </>
  );
}
