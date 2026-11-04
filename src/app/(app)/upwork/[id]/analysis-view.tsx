"use client";

import { Check, Copy, FileText, RefreshCw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { JobProgress } from "@/components/career/job-progress";
import { FitMeter, Points, Section, Verdict } from "@/components/career/parts";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import type { Economics, UpworkAnalysis, UpworkInputs } from "@/lib/career/upwork-data";

import { deleteUpwork, reanalyzeUpwork, saveProposal, saveUpworkInputs, setUpworkStatus, writeProposal } from "../actions";
import { NumbersFields } from "../numbers";

type Record_ = {
  id: string;
  jobText: string;
  jobUrl: string;
  status: "EVALUATING" | "APPLIED" | "SKIPPED";
  inputs: UpworkInputs;
  analysis: UpworkAnalysis | null;
  economics: Economics | null;
  proposal: string;
  screening: { question: string; answer: string }[];
  usage: { analysisTokens?: number; proposalTokens?: number };
};

const usd = (value: number | null) => (value === null ? "–" : value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value % 1 === 0 ? 0 : 2 }));

export function AnalysisView({ record, reference, jobId: initialJob, aiReady }: { record: Record_; reference: { checkedOn: string; feeNote: string; source: string; boostNote: string }; jobId: string | null; aiReady: boolean }) {
  const router = useRouter();
  const [jobId, setJobId] = useState(initialJob);
  const [numbers, setNumbers] = useState(record.inputs);
  const [instructions, setInstructions] = useState("");
  const [proposal, setProposal] = useState(record.proposal);
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { analysis, economics } = record;
  const [lastProposal, setLastProposal] = useState(record.proposal);
  if (record.proposal !== lastProposal) {
    setLastProposal(record.proposal);
    setProposal(record.proposal);
  }

  const saveNumbers = () =>
    start(async () => {
      if (toastResult(await saveUpworkInputs({ id: record.id, inputs: numbers })).ok) router.refresh();
    });
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast("Copied.");
  };

  return (
    <div className="flex flex-col gap-8">
      <JobProgress jobId={jobId} idleLabel="Working…" onDone={() => setJobId(null)} />

      {analysis && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="flex flex-col gap-5 motion-safe:animate-rise-in">
            <div className="flex flex-wrap items-center gap-3">
              <Verdict verdict={analysis.suitability.verdict} />
              <FitMeter score={analysis.suitability.score} />
            </div>
            <p className="text-lead text-pretty">{analysis.summary}</p>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
              <Points title="Why you fit" items={analysis.suitability.evidence} tone="good" />
              <Points title="Gaps" items={analysis.suitability.gaps} tone="gap" empty="None found." />
            </div>
            <div className="flex flex-col gap-2 rounded-control bg-surface p-4">
              <h3 className="text-label font-semibold tracking-wide text-muted uppercase">What the post says</h3>
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {[
                  ["Budget", `${analysis.jobFacts.budgetType === "unknown" ? "Not stated" : analysis.jobFacts.budgetType === "hourly" ? "Hourly" : "Fixed price"}${analysis.jobFacts.statedBudget ? `: ${analysis.jobFacts.statedBudget}` : ""}`],
                  ["Duration", analysis.jobFacts.duration || "Not stated"],
                  ["Level", analysis.jobFacts.experienceLevel || "Not stated"],
                ].map(([term, value]) => (
                  <div key={term} className="flex gap-2">
                    <dt className="text-muted">{term}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {analysis.jobFacts.clientSignals.length > 0 && <p className="text-meta text-muted">About the client, as the post states: {analysis.jobFacts.clientSignals.join(" · ")}</p>}
            </div>
          </Card>

          <Card className="flex flex-col gap-4 motion-safe:animate-rise-in">
            <span className="text-label font-semibold tracking-wide text-accent-text uppercase">Suggested bid</span>
            <span className="font-serif text-[34px] leading-none font-semibold tabular-nums">
              {usd(analysis.pricing.low)}–{usd(analysis.pricing.high)}
              <span className="ml-1 font-sans text-sm font-normal text-muted">{analysis.pricing.type === "hourly" ? "per hour" : "fixed"}</span>
            </span>
            <p className="text-sm text-pretty text-muted">{analysis.pricing.rationale}</p>
            {economics && (
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-meta text-muted">
                    <th className="pb-1 font-medium"> </th>
                    <th className="pb-1 text-right font-medium">You bill</th>
                    <th className="pb-1 text-right font-medium">Fee</th>
                    <th className="pb-1 text-right font-medium">You keep</th>
                  </tr>
                </thead>
                <tbody>
                  {economics.bids.map((bid) => (
                    <tr key={bid.label} className="border-t border-line">
                      <td className="py-1.5 pr-2 text-meta">{bid.label}</td>
                      <td className="py-1.5 text-right">{usd(bid.gross)}</td>
                      <td className="py-1.5 text-right text-muted">{usd(bid.fee)}</td>
                      <td className="py-1.5 text-right font-semibold">{usd(bid.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {economics && (
              <div className="flex flex-col gap-1 rounded-control bg-accent-soft px-3 py-2 text-sm">
                <span className="font-medium">
                  Applying costs {economics.connects.total === null ? "? Connects" : `${economics.connects.total} Connects`} ({usd(economics.connects.costUsd)})
                </span>
                <span className="text-meta text-muted">
                  {economics.connects.required ?? "?"} for the proposal{economics.connects.boost > 0 ? ` + ${economics.connects.boost} to boost` : ""}. Paid to Upwork, not your AI provider.
                </span>
                {economics.connects.shortBy !== null && <span className="text-meta font-medium text-error">You&apos;re {economics.connects.shortBy} Connects short.</span>}
              </div>
            )}
            {economics?.effectiveHourly.low !== null && economics?.effectiveHourly.low !== undefined && (
              <p className="text-meta text-muted">
                Effective rate after fees: {usd(economics.effectiveHourly.low)}–{usd(economics.effectiveHourly.high)} per hour, given the effort estimate.
              </p>
            )}
            {economics?.notes.map((note) => (
              <p key={note} className="text-meta text-warning">
                {note}
              </p>
            ))}
            <Points title="Assumptions behind the range" items={analysis.pricing.assumptions} />
            <p className="text-meta text-pretty text-muted">
              {analysis.boostAdvice} {reference.boostNote}
            </p>
          </Card>
        </div>
      )}

      <Section title="Your numbers from Upwork" description={`${reference.feeNote} Upwork prices checked ${reference.checkedOn}.`}>
        <Card className="flex flex-col gap-4">
          <NumbersFields value={numbers} onChange={setNumbers} />
          <div>
            <Button variant="secondary" size="sm" disabled={pending} onClick={saveNumbers}>
              Update the sums
            </Button>
          </div>
        </Card>
      </Section>

      {analysis && (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
            <Section title="Scope and milestones">
              <Card className="flex flex-col gap-4">
                <Points title="Deliverables" items={analysis.scope.deliverables} />
                <p className="text-sm">
                  Effort: about <span className="font-semibold">{analysis.scope.effortHoursLow}–{analysis.scope.effortHoursHigh} hours</span>
                </p>
                {analysis.scope.milestones.length > 0 && (
                  <ol className="flex flex-col gap-2">
                    {analysis.scope.milestones.map((milestone, index) => (
                      <li key={index} className="flex items-start gap-3 text-sm">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text">{index + 1}</span>
                        <span className="flex-1">
                          <span className="font-medium">{milestone.title}</span> <span className="text-muted">· {milestone.deliverable}</span>
                        </span>
                        <span className="tabular-nums text-muted">{milestone.percent}%</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </Section>
            <Section title="Before you bid">
              <Card className="flex flex-col gap-4">
                <Points title="Risks" items={analysis.risks} tone="risk" empty="None stood out." />
                <Points title="Missing information" items={analysis.missingInfo} tone="gap" />
                <Points title="Questions to ask the client" items={analysis.questionsForClient} />
              </Card>
            </Section>
          </div>

          <Section
            title="Proposal"
            description="Written from your profile only. Review and edit it, then copy it into Upwork yourself: nothing is sent from here."
            actions={
              proposal && (
                <Button variant="secondary" size="sm" onClick={() => void copy(proposal)}>
                  <Copy size={14} aria-hidden="true" /> Copy
                </Button>
              )
            }
          >
            <Card className="flex flex-col gap-4">
              {proposal ? (
                <Textarea
                  label="Cover letter"
                  rows={10}
                  value={proposal}
                  onChange={(event) => setProposal(event.target.value)}
                  onBlur={() => proposal !== record.proposal && void saveProposal({ id: record.id, proposal }).then(toastResult)}
                  hint={`${proposal.trim().split(/\s+/).length} words`}
                />
              ) : (
                <p className="text-sm text-muted">No proposal yet.</p>
              )}
              {record.screening.length > 0 && (
                <div className="flex flex-col gap-3">
                  <h3 className="text-label font-semibold tracking-wide text-muted uppercase">Screening questions</h3>
                  {record.screening.map((item) => (
                    <div key={item.question} className="flex flex-col gap-1 rounded-control bg-surface p-3 text-sm">
                      <span className="font-medium">{item.question}</span>
                      <span className="whitespace-pre-wrap text-pretty">{item.answer}</span>
                      <button type="button" className="self-start text-meta text-muted underline underline-offset-3 hover:text-ink" onClick={() => void copy(item.answer)}>
                        Copy answer
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <Textarea
                  className="min-w-[min(16rem,100%)] flex-1"
                  label="Anything to stress or leave out? (optional)"
                  rows={2}
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                />
                <Button
                  disabled={!aiReady || pending || Boolean(jobId)}
                  onClick={() =>
                    start(async () => {
                      const result = toastResult(await writeProposal({ id: record.id, instructions }));
                      if (result.ok) setJobId(result.data.jobId);
                    })
                  }
                >
                  <Sparkles size={14} aria-hidden="true" /> {proposal ? "Write again" : "Write the proposal"}
                </Button>
              </div>
            </Card>
          </Section>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            size="sm"
            options={[
              { value: "EVALUATING", label: "Evaluating" },
              { value: "APPLIED", label: "Applied" },
              { value: "SKIPPED", label: "Skipped" },
            ]}
            value={record.status}
            onValueChange={(status) => start(async () => void toastResult(await setUpworkStatus({ id: record.id, status })))}
          />
          {record.jobUrl && (
            <a href={record.jobUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-3">
              Open the job on Upwork
            </a>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-muted hover:text-ink">
              <FileText size={14} aria-hidden="true" className="mr-1 inline" />
              The post you pasted
            </summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded-control bg-surface p-3 font-sans text-meta whitespace-pre-wrap">{record.jobText}</pre>
          </details>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-meta text-muted" title="Estimated from the length of each prompt and answer: about four characters a token. Billed by your AI provider, not Upwork.">
            AI used: ~{((record.usage.analysisTokens ?? 0) + (record.usage.proposalTokens ?? 0)).toLocaleString()} tokens (estimate)
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={!aiReady || pending || Boolean(jobId)}
            onClick={() =>
              start(async () => {
                const result = toastResult(await reanalyzeUpwork({ id: record.id }));
                if (result.ok) setJobId(result.data.jobId);
              })
            }
          >
            <RefreshCw size={14} aria-hidden="true" /> Analyse again
          </Button>
          <Button variant="text" size="sm" className="text-danger!" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this analysis?"
        description="The post, the analysis and the proposal go."
        confirmLabel="Delete"
        onConfirm={() =>
          start(async () => {
            if (toastResult(await deleteUpwork({ id: record.id })).ok) router.push("/upwork");
          })
        }
      />
      {record.status === "APPLIED" && (
        <p className="flex items-center gap-2 text-sm text-success">
          <Check size={14} aria-hidden="true" /> Marked as applied.
        </p>
      )}
    </div>
  );
}
