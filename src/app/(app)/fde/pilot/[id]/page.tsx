import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Screen, Section } from "@/components/career/parts";
import { PageHeader } from "@/components/page-header";
import { fdeConfig, retrievalProvider } from "@/lib/fde/config";
import { money } from "@/lib/fde/format";
import { estimatePilot } from "@/lib/fde/pilot-estimate";
import { RUBRIC_VERSION } from "@/lib/fde/rubric";
import { pilotJobKey, type PilotItem } from "@/lib/fde/review";
import { filtersSchema } from "@/lib/fde/types";
import { findLatestJob, isFinished } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/tenancy/context";

import { PilotControls } from "./controls";

export const metadata: Metadata = { title: "FDE batch pilot" };

const FIRST_BATCH = 5;

export default async function PilotPage({ params }: PageProps<"/fde/pilot/[id]">) {
  const { id } = await params;
  const pilot = await prisma.fdePilot.findFirst({ where: { id, ownerUserId: requireUserId() } });
  if (!pilot) notFound();
  const items = pilot.items as unknown as PilotItem[];
  const rejected = pilot.rejected as unknown as { line: string; error: string }[];
  const config = fdeConfig();
  const benchmark = await prisma.fdeBenchmark.findFirst({ where: { rubricVersion: RUBRIC_VERSION, expiresAt: { gt: new Date() } }, orderBy: { discoveredAt: "desc" }, select: { version: true, discoveredAt: true } });
  const pending = items.filter((item) => item.state === "pending").length;
  const everything = estimatePilot(items.length, { detailLimit: config.linkedinDetailLimit, usdPerMillionTokens: config.modelUsdPerMillionTokens, benchmarkReused: Boolean(benchmark) });
  const nextBatch = estimatePilot(Math.min(pending, FIRST_BATCH), { detailLimit: config.linkedinDetailLimit, usdPerMillionTokens: config.modelUsdPerMillionTokens, benchmarkReused: Boolean(benchmark) });
  const usage = await prisma.fdeUsage.groupBy({ by: ["kind"], where: { report: { pilotId: id } }, _sum: { costMicro: true, tokens: true }, _count: true });
  const spent = usage.filter((entry) => entry.kind !== "model").reduce((sum, entry) => sum + (entry._sum.costMicro ?? 0), 0);
  const job = await findLatestJob(pilotJobKey(id));
  const running = Boolean(job && !isFinished(job));
  const count = (state: PilotItem["state"]) => items.filter((item) => item.state === state).length;
  filtersSchema.parse(pilot.filters);

  return (
    <>
      <PageHeader title={pilot.name} before={<Link href="/fde/pilot" className="text-sm text-muted underline underline-offset-2 hover:text-ink">Batch pilot</Link>} />
      <Screen wide>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-2">
          <Section title="Before spending anything" description="An estimate from published prices checked on 5 November 2026. Check them again before a large run.">
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-sm">
              <dt>{everything.profiles} profile reads</dt>
              <dd className="text-right tabular-nums">{money(everything.profileMicro)}</dd>
              <dt>Job searches</dt>
              <dd className="text-right tabular-nums">{everything.discoveryMicro ? money(everything.discoveryMicro) : "Reusing a saved benchmark"}</dd>
              <dt>Job details</dt>
              <dd className="text-right tabular-nums">{everything.jobDetailMicro ? money(everything.jobDetailMicro) : "Reusing a saved benchmark"}</dd>
              <dt className="font-medium">Paid retrieval in all</dt>
              <dd className="text-right font-medium tabular-nums">{money(everything.paidTotalMicro)}</dd>
              <dt className="text-muted">AI model, on your own account</dt>
              <dd className="text-right text-muted tabular-nums">about {everything.modelTokens.toLocaleString("en-US")} tokens{everything.modelMicro !== null ? `, ${money(everything.modelMicro)}` : ""}</dd>
              <dt className="text-muted">Hard spending limit</dt>
              <dd className="text-right text-muted tabular-nums">{money(pilot.spendLimitMicro)}</dd>
            </dl>
            {everything.paidTotalMicro > pilot.spendLimitMicro && <p className="text-sm text-warning">The estimate is above the limit, so the run would stop early.</p>}
            {rejected.length > 0 && <p className="text-meta text-muted">{rejected.length === 1 ? "1 line wasn't a valid address and isn't included." : `${rejected.length} lines weren't valid addresses and aren't included.`}</p>}
            <PilotControls id={id} pending={pending} done={items.length - pending} running={running} nextEstimate={money(nextBatch.paidTotalMicro)} configured={retrievalProvider().isConfigured()} />
          </Section>

          <Section title="So far">
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-sm">
              <dt>Complete</dt><dd className="text-right tabular-nums">{count("complete")}</dd>
              <dt>Partial</dt><dd className="text-right tabular-nums">{count("partial")}</dd>
              <dt>Inaccessible</dt><dd className="text-right tabular-nums">{count("inaccessible")}</dd>
              <dt>Failed</dt><dd className="text-right tabular-nums">{count("failed")}</dd>
              <dt>Not yet run</dt><dd className="text-right tabular-nums">{pending}</dd>
              <dt className="font-medium">Spent on retrieval</dt><dd className="text-right font-medium tabular-nums">{money(spent)}</dd>
              {usage.map((entry) => (
                <div key={entry.kind} className="contents text-meta text-muted">
                  <dt>{entry.kind.replace("_", " ")}: {entry._count} calls</dt>
                  <dd className="text-right tabular-nums">{entry.kind === "model" ? `about ${(entry._sum.tokens ?? 0).toLocaleString("en-US")} tokens` : money(entry._sum.costMicro ?? 0)}</dd>
                </div>
              ))}
            </dl>
            {pilot.stopReason && <p role="status" className="rounded-card border border-danger-line bg-danger-surface px-4 py-3 text-sm text-pretty">Stopped. {pilot.stopReason}</p>}
          </Section>
        </div>

        <Section title="Profiles">
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line-card bg-card">
            {items.map((item) => (
              <li key={item.slug} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
                {item.reportId ? <Link href={`/fde/${item.reportId}`} className="underline underline-offset-2">{item.slug}</Link> : <span>{item.slug}</span>}
                <span className="text-meta text-muted">{item.state}{item.note ? `: ${item.note}` : ""}</span>
              </li>
            ))}
          </ul>
        </Section>
      </Screen>
    </>
  );
}
