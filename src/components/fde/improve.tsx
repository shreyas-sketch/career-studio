"use client";

import { Copy } from "lucide-react";
import { useState, useTransition } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { toast, toastResult } from "@/components/toast";
import { copyText } from "@/lib/copy-text";
import { payHeadline } from "@/lib/fde/pay";
import type { FreelanceResult, ReportResult, Requirement, Role } from "@/lib/fde/types";

import { setLearningStep } from "@/app/(app)/fde/actions";

import { day, SourceLink, type Inspect } from "./shared";

function CopyButton({ text, what }: { text: string; what: string }) {
  return (
    <button
      type="button"
      onClick={async () => toast((await copyText(text)) ? "Copied." : "Couldn't copy. Select the text instead.")}
      aria-label={`Copy suggested ${what}`}
      className="inline-flex shrink-0 items-center gap-1 rounded-control px-2 py-1 text-meta text-muted hover:bg-hover hover:text-ink"
    >
      <Copy size={13} aria-hidden="true" />
      Copy
    </button>
  );
}

export function StrengthsAndGaps({ result, onInspect, roles }: { result: ReportResult; roles: Role[]; onInspect: (target: Inspect) => void }) {
  const analyzed = roles.filter((role) => role.requirements.length > 0).length;
  const eligibility = [...new Set(roles.flatMap((role) => role.requirements.filter((requirement) => requirement.eligibility && requirement.eligibility !== "years" && requirement.eligibility !== "degree")))];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <h3 className="font-medium">Shown in the profile</h3>
        {result.strengths.length === 0 ? (
          <p className="text-sm text-muted">No requirement was clearly shown with quotable words.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {result.strengths.map((strength) => (
              <li key={strength.key} className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{strength.label} <span className="font-normal text-muted">({strength.roleCount} of {analyzed} roles)</span></span>
                <span className="text-sm text-pretty text-muted">&ldquo;{strength.quote}&rdquo; ({strength.sourceLabel})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="font-medium">Priority gaps in the evidence</h3>
        {result.gaps.length === 0 ? (
          <p className="text-sm text-muted">No recurring gap in this sample.</p>
        ) : (
          <ol className="flex list-decimal flex-col gap-2 pl-5">
            {result.gaps.map((gap) => (
              <li key={gap.key} className="text-sm">
                <button type="button" onClick={() => onInspect({ kind: "row", key: gap.key })} className="text-left underline-offset-2 hover:underline">{gap.label}</button>{" "}
                <span className="text-muted">({gap.roleCount} {gap.roleCount === 1 ? "role" : "roles"}, required in {gap.mustCount})</span>
              </li>
            ))}
          </ol>
        )}
        <p className="text-meta text-pretty text-muted">These are things this profile doesn&apos;t show, not things the person can&apos;t do.</p>
      </div>
      {eligibility.length > 0 && (
        <EligibilityList requirements={eligibility} roles={roles} onInspect={onInspect} />
      )}
      {result.employerSpecific.length > 0 && (
        <details className="lg:col-span-2">
          <summary className="cursor-pointer font-medium">Asked by one employer only ({result.employerSpecific.length})</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {result.employerSpecific.map((requirement) => {
              const role = roles.find((entry) => entry.id === requirement.roleId);
              return (
                <li key={requirement.id} className="text-sm text-pretty">
                  <button type="button" onClick={() => onInspect({ kind: "requirement", requirementId: requirement.id })} className="text-left underline-offset-2 hover:underline">
                    {role?.employer}: {requirement.text}
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}

function EligibilityList({ requirements, roles, onInspect }: { requirements: Requirement[]; roles: Role[]; onInspect: (target: Inspect) => void }) {
  return (
    <details className="lg:col-span-2">
      <summary className="cursor-pointer font-medium">Conditions to check with each employer ({requirements.length})</summary>
      <p className="mt-2 text-meta text-pretty text-muted">Location, travel, authorization and clearance as each posting states them. Nothing here assumes the person meets them or doesn&apos;t.</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {requirements.map((requirement) => (
          <li key={requirement.id} className="text-sm text-pretty">
            <button type="button" onClick={() => onInspect({ kind: "requirement", requirementId: requirement.id })} className="text-left underline-offset-2 hover:underline">
              {roles.find((role) => role.id === requirement.roleId)?.employer}: &ldquo;{requirement.excerpt}&rdquo;
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Suggestions({ result }: { result: ReportResult }) {
  const insights = result.insights;
  if (!insights) return result.checks.insightsFailed ? <p className="text-sm text-warning">The suggestions couldn&apos;t be written this time. The scores above aren&apos;t affected.</p> : null;
  return (
    <div className="flex flex-col gap-5">
      {insights.summary && <p className="max-w-[720px] text-lead text-pretty">{insights.summary}</p>}
      {insights.rewrites.length > 0 && (
        <ul className="flex flex-col gap-3">
          {insights.rewrites.map((rewrite, index) => (
            <li key={index} className="flex flex-col gap-2 rounded-card border border-line-card bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium text-pretty">{rewrite.target}</h3>
                <CopyButton text={rewrite.suggested} what={rewrite.target} />
              </div>
              {rewrite.original && <p className="text-meta whitespace-pre-line text-pretty text-muted">Now: {rewrite.original}</p>}
              <p className="text-sm whitespace-pre-line text-pretty">{rewrite.suggested}</p>
              {rewrite.why && <p className="text-meta text-pretty text-muted">{rewrite.why}</p>}
            </li>
          ))}
        </ul>
      )}
      {insights.rewritesWithheld > 0 && <p className="text-meta text-muted">{insights.rewritesWithheld} {insights.rewritesWithheld === 1 ? "suggestion was" : "suggestions were"} held back for adding a fact the profile doesn&apos;t have.</p>}
      {insights.questions.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">Questions to fill the blanks</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-pretty">
            {insights.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** `persist` off keeps ticks in this page only, e.g. for the public review, which has no account to save them to. */
export function LearningPlanView({ reportId, result, initial, persist = true }: { reportId: string; result: ReportResult; initial: string[]; persist?: boolean }) {
  const [done, setDone] = useState(() => new Set(initial));
  const [, start] = useTransition();
  const plan = result.plan;
  if (!plan) return result.checks.planFailed ? <p className="text-sm text-warning">A plan that fits in 5 hours a week for 8 weeks couldn&apos;t be written this time.</p> : null;
  const portfolio = result.insights?.portfolio ?? [];
  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-[720px] text-sm text-pretty">
        To build: <span className="font-medium">{plan.skill}</span>. {plan.totalHours} hours in all, within {plan.hoursPerWeek} hours a week for {plan.weeks} weeks. This is future work, not experience: ticking a step {persist ? "records progress here" : "marks it on this page only"} and doesn&apos;t change any score.
      </p>
      <ol className="flex flex-col gap-5">
        {plan.plan.phases.map((phase) => (
          <li key={phase.title} className="flex flex-col gap-2">
            <h3 className="font-medium text-pretty">
              {phase.title} <span className="font-normal text-muted">(weeks {phase.weeks})</span>
            </h3>
            {phase.goal && <p className="text-sm text-pretty text-muted">{phase.goal}</p>}
            <ul className="flex flex-col gap-2">
              {phase.steps.map((step) => (
                <li key={step.id}>
                  <Checkbox
                    label={
                      <span className="flex flex-col">
                        <span className="text-pretty">{step.title} <span className="text-muted tabular-nums">({step.hours} h)</span></span>
                        <span className="text-meta text-pretty text-muted">{step.detail}</span>
                      </span>
                    }
                    checked={done.has(step.id)}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setDone((current) => {
                        const next = new Set(current);
                        if (checked) next.add(step.id);
                        else next.delete(step.id);
                        return next;
                      });
                      if (persist) {
                        start(async () => {
                          toastResult(await setLearningStep({ id: reportId, stepId: step.id, done: checked }));
                        });
                      }
                    }}
                  />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {(portfolio.length > 0 || plan.plan.project.title) && (
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">Portfolio work to consider</h3>
          <ul className="flex flex-col gap-3">
            {plan.plan.project.title && (
              <li className="text-sm text-pretty">
                <span className="font-medium">{plan.plan.project.title}. </span>
                {plan.plan.project.brief}
              </li>
            )}
            {portfolio.map((idea) => (
              <li key={idea.title} className="text-sm text-pretty">
                <span className="font-medium">{idea.title}. </span>
                {idea.brief}
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.plan.caveats.length > 0 && <p className="text-meta text-pretty text-muted">{plan.plan.caveats.join(" ")}</p>}
    </div>
  );
}

export function FreelanceMatches({ freelance }: { freelance: FreelanceResult | null }) {
  if (!freelance) return <p className="text-sm text-muted">This starts once the profile has been read.</p>;
  if (freelance.state === "failed") return <p className="text-sm text-warning">{freelance.error}</p>;
  const failed = freelance.sources.filter((source) => source.error);
  return (
    <div className="flex flex-col gap-4">
      {freelance.state === "running" && <p className="text-sm text-muted motion-safe:animate-pulse-soft">Checking freelance sources for work that fits this profile.</p>}
      {freelance.keywords.length > 0 && <p className="text-meta text-pretty text-muted">Searched for words from this profile: {freelance.keywords.join(", ")}. {freelance.preferences}</p>}
      {freelance.state === "done" && freelance.matches.length === 0 && <p className="text-sm">No relevant paid listing was found on the sources checked. Nothing is shown in place of real listings.</p>}
      {freelance.matches.length > 0 && (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
          {freelance.matches.map((match) => {
            const pay = payHeadline(match.pay);
            return (
              <li key={match.id} className="flex flex-col gap-2 rounded-card border border-line-card bg-card p-4">
                <p className={pay.basis ? "font-serif text-2xl leading-tight tabular-nums" : "font-serif text-xl leading-tight text-muted"}>{pay.amount}</p>
                {pay.basis && (
                  <p className="text-meta">
                    {pay.basis}. {pay.label}. <span className="text-muted">As listed: {match.pay.raw}</span>
                  </p>
                )}
                <h3 className="font-medium text-pretty">{match.title}</h3>
                <p className="text-meta text-muted">{[match.client, match.kind, match.location].filter(Boolean).join(", ")}</p>
                <p className="text-meta text-pretty">{match.relevanceWhy.replace("your keywords", "this profile's terms")}</p>
                {match.fit && match.fit.reasons.length > 0 && <p className="text-meta text-pretty text-muted">{match.fit.reasons[0]}</p>}
                <p className="text-meta text-pretty text-muted">Take-home is unknown: fees, Connects and hours aren&apos;t stated here.</p>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="text-meta text-muted">{match.status}{match.postedAt ? `, posted ${day(match.postedAt)}` : ""}</span>
                  <SourceLink href={match.url}>Open on {match.source}</SourceLink>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {failed.length > 0 && <p className="text-meta text-pretty text-muted">Couldn&apos;t be checked: {failed.map((source) => source.source).join(", ")}.</p>}
    </div>
  );
}
