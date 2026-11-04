"use client";

import { Bookmark, ExternalLink, Handshake, Receipt, RefreshCw, Sparkles, Sprout, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { JobProgress } from "@/components/career/job-progress";
import { EmptyState, FitMeter, Points, relativeDay, Section, Verdict } from "@/components/career/parts";
import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ToggleChip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { OpportunityFit } from "@/lib/ai/tasks/career/freelance";
import type { FreelancePrefs } from "@/lib/career/freelance-prefs";
import type { Relevance } from "@/lib/career/freelance-relevance";
import { cn } from "@/lib/cn";
import type { JobView } from "@/lib/jobs/runner";

import { refreshOpportunities, savePrefs, scoreOpportunity, setStatus } from "./actions";

type Opportunity = {
  id: string;
  source: string;
  sourceName: string;
  title: string;
  client: string;
  url: string;
  description: string;
  budget: string;
  kind: string;
  location: string;
  tags: string[];
  postedAt: string | null;
  score: number | null;
  fit: OpportunityFit | null;
  status: "NEW" | "SAVED" | "PURSUING" | "DISMISSED";
  relevance: Relevance;
};

type RefreshResult = { added: number; scored: number; sources: { source: string; found: number; error: string | null; stale: boolean }[] };

export function FreelanceBoard({
  prefs,
  suggestedKeywords,
  filter,
  jobId: initialJob,
  aiReady,
  sources,
  opportunities,
}: {
  prefs: FreelancePrefs;
  suggestedKeywords: string[];
  filter: "open" | "saved" | "pursuing" | "dismissed";
  jobId: string | null;
  aiReady: boolean;
  sources: { key: string; name: string; site: string; note: string }[];
  opportunities: Opportunity[];
}) {
  const [jobId, setJobId] = useState(initialJob);
  const [pending, start] = useTransition();
  const [lastRun, setLastRun] = useState<RefreshResult | null>(null);
  const [editing, setEditing] = useState(!prefs.services && prefs.keywords.length === 0);
  // What they've marked stays in view; only new listings can be set aside.
  const setAside = (opportunity: Opportunity) => opportunity.status === "NEW" && (opportunity.relevance.tier === "low" || opportunity.relevance.tier === "none");
  const lowRelevance = opportunities.filter(setAside);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Show" className="flex flex-wrap gap-2">
            {(["open", "saved", "pursuing", "dismissed"] as const).map((value) => (
              <Link key={value} href={value === "open" ? "/freelance" : `/freelance?show=${value}`} aria-current={filter === value ? "page" : undefined} className={cn("rounded-full border px-3 py-1.5 text-meta capitalize", filter === value ? "border-primary bg-selected font-medium text-primary-text" : "border-line-field bg-input text-ink hover:border-line-strong")}>
                {value === "open" ? "All open" : value}
              </Link>
            ))}
          </nav>
          <Button
            disabled={pending || Boolean(jobId)}
            onClick={() =>
              start(async () => {
                const result = toastResult(await refreshOpportunities({}));
                if (result.ok) setJobId(result.data.jobId);
              })
            }
          >
            <RefreshCw size={14} aria-hidden="true" /> Find new opportunities
          </Button>
        </div>

        <JobProgress
          jobId={jobId}
          idleLabel="Checking sources…"
          onDone={(job: JobView) => {
            setJobId(null);
            setLastRun(job.result as RefreshResult);
          }}
        />
        {lastRun && (
          <p role="status" className="rounded-card border border-line-card bg-card px-4 py-3 text-sm">
            {lastRun.added === 0 ? "No new matches this time." : `${lastRun.added} new ${lastRun.added === 1 ? "match" : "matches"}${lastRun.scored ? `, ${lastRun.scored} scored` : ""}.`}{" "}
            <span className="text-muted">
              {lastRun.sources
                .map((source) => `${sources.find((entry) => entry.key === source.source)?.name ?? source.source}: ${source.error ? `unavailable (${source.error})` : `${source.found} listings${source.stale ? ", from earlier" : ""}`}`)
                .join(" · ")}
            </span>
          </p>
        )}

        {opportunities.length === 0 ? (
          <EmptyState icon={<Handshake size={20} aria-hidden="true" />} title={filter === "open" ? "No opportunities yet" : `Nothing ${filter}`}>
            {filter === "open"
              ? "Set what you sell and your keywords, then find new opportunities. Listings come straight from the sources on the right, and the best matches get a fit score."
              : "Opportunities you mark show up here."}
          </EmptyState>
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {opportunities
                .filter((opportunity) => !setAside(opportunity))
                .map((opportunity) => (
                  <OpportunityCard key={opportunity.id} opportunity={opportunity} aiReady={aiReady} />
                ))}
            </ul>
            {lowRelevance.length > 0 && (
              <details className="flex flex-col gap-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Low relevance ({lowRelevance.length}) <span className="font-normal text-muted">Your keywords only come up in passing.</span>
                </summary>
                <ul className="mt-3 flex flex-col gap-3">
                  {lowRelevance.map((opportunity) => (
                    <OpportunityCard key={opportunity.id} opportunity={opportunity} aiReady={aiReady} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>

      <aside className="flex flex-col gap-6">
        <Section title="What you're looking for" actions={!editing && <Button variant="text" size="sm" onClick={() => setEditing(true)}>Edit</Button>}>
          {editing ? (
            <Prefs prefs={prefs} suggested={suggestedKeywords} onSaved={() => setEditing(false)} />
          ) : (
            <Card className="flex flex-col gap-2 text-sm">
              {prefs.services && <p>{prefs.services}</p>}
              <p className="text-muted">
                Searching: {(prefs.keywords.length > 0 ? prefs.keywords : suggestedKeywords).join(", ") || "your profile"}
                {prefs.keywords.length === 0 && " (from your profile)"}
              </p>
              <p className="text-muted">
                {[prefs.minimumHourlyUsd !== null && `From $${prefs.minimumHourlyUsd}/h`, prefs.hoursPerWeek !== null && `${prefs.hoursPerWeek} h/week`, prefs.kinds.join(", ")].filter(Boolean).join(" · ")}
              </p>
            </Card>
          )}
        </Section>
        <Section title="Sources">
          <ul className="flex flex-col gap-2 text-sm">
            {sources.map((source) => (
              <li key={source.key}>
                <a href={source.site} target="_blank" rel="noopener" className="font-medium underline underline-offset-3">
                  {source.name}
                </a>{" "}
                <span className="text-muted">{source.note}</span>
              </li>
            ))}
          </ul>
          <p className="text-meta text-pretty text-muted">
            Listings link back to their source, which owns them. Upwork and Freelancer.com need approved API access to list their jobs; for Upwork, paste a job into the{" "}
            <Link href="/upwork" className="underline underline-offset-3">
              Upwork analyst
            </Link>
            .
          </p>
        </Section>
      </aside>
    </div>
  );
}

function OpportunityCard({ opportunity, aiReady }: { opportunity: Opportunity; aiReady: boolean }) {
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const status = (next: Opportunity["status"]) => start(async () => void toastResult(await setStatus({ id: opportunity.id, status: next })));
  const skillParams = new URLSearchParams({ skill: opportunity.fit?.gaps[0] ?? "", role: opportunity.title });

  return (
    <li>
      <Card className="flex flex-col gap-3 motion-safe:animate-rise-in">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="text-left font-medium text-pretty hover:underline">
              {opportunity.title}
            </button>
            <span className="text-meta text-muted">
              {[opportunity.client, opportunity.budget || "Pay not stated", opportunity.kind, opportunity.location, relativeDay(opportunity.postedAt)].filter(Boolean).join(" · ")}
            </span>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {opportunity.fit ? <Verdict verdict={opportunity.fit.verdict} /> : null}
            <FitMeter score={opportunity.score} />
          </div>
        </div>

        <p className="text-meta text-muted">{opportunity.relevance.why}</p>

        {opportunity.fit && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
            <Points title="Why it fits" items={opportunity.fit.reasons} tone="good" />
            <Points title="Gaps" items={opportunity.fit.gaps} tone="gap" />
            <Points title="Concerns" items={opportunity.fit.concerns} tone="risk" />
          </div>
        )}
        {open && <p className="max-h-72 overflow-auto rounded-control bg-surface p-3 text-sm whitespace-pre-wrap text-pretty">{opportunity.description || "The source gave no description."}</p>}
        <JobProgress jobId={jobId} idleLabel="Checking the fit…" onDone={() => setJobId(null)} compact />

        <div className="flex flex-wrap items-center gap-2">
          <a href={opportunity.url} target="_blank" rel="noopener" className={buttonClassName("secondary", "sm")}>
            Open on {opportunity.sourceName} <ExternalLink size={13} aria-hidden="true" />
          </a>
          {opportunity.score === null && (
            <Button
              variant="secondary"
              size="sm"
              disabled={!aiReady || pending || Boolean(jobId)}
              onClick={() =>
                start(async () => {
                  const result = toastResult(await scoreOpportunity({ id: opportunity.id }));
                  if (result.ok) setJobId(result.data.jobId);
                })
              }
            >
              <Sparkles size={13} aria-hidden="true" /> Check fit
            </Button>
          )}
          {opportunity.status !== "SAVED" && opportunity.status !== "PURSUING" && (
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => status("SAVED")}>
              <Bookmark size={13} aria-hidden="true" /> Save
            </Button>
          )}
          {opportunity.status !== "PURSUING" && (
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => status("PURSUING")}>
              Pursuing
            </Button>
          )}
          <Link href={`/upwork?text=${encodeURIComponent(`${opportunity.title}\n\n${opportunity.description}\n\nPay: ${opportunity.budget || "not stated"}`.slice(0, 6000))}`} className={buttonClassName("text", "sm")}>
            <Receipt size={13} aria-hidden="true" /> Price it
          </Link>
          {opportunity.fit?.gaps[0] && (
            <Link href={`/skills?${skillParams}`} className={buttonClassName("text", "sm")}>
              <Sprout size={13} aria-hidden="true" /> Plan for the gap
            </Link>
          )}
          {opportunity.status === "DISMISSED" ? (
            <Button variant="text" size="sm" className="ml-auto" onClick={() => status("NEW")}>
              Restore
            </Button>
          ) : (
            <button type="button" aria-label="Dismiss" title="Dismiss: it won't come back" onClick={() => status("DISMISSED")} className="ml-auto grid size-7 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink">
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
        {pending && <span className="sr-only">Saving…</span>}
      </Card>
    </li>
  );
}

function Prefs({ prefs, suggested, onSaved }: { prefs: FreelancePrefs; suggested: string[]; onSaved: () => void }) {
  const [services, setServices] = useState(prefs.services);
  const [keywords, setKeywords] = useState(prefs.keywords.join(", "));
  const [rate, setRate] = useState(prefs.minimumHourlyUsd?.toString() ?? "");
  const [hours, setHours] = useState(prefs.hoursPerWeek?.toString() ?? "");
  const [constraints, setConstraints] = useState(prefs.constraints);
  const [avoid, setAvoid] = useState(prefs.avoid);
  const [kinds, setKinds] = useState(prefs.kinds);
  const [fee, setFee] = useState(prefs.upworkFeePercent?.toString() ?? "");
  const [pending, start] = useTransition();
  const num = (value: string) => (value.trim() === "" ? null : Number(value));

  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          start(async () => {
            const result = toastResult(
              await savePrefs({
                services,
                keywords: keywords.split(",").map((word) => word.trim()).filter(Boolean).slice(0, 12),
                minimumHourlyUsd: num(rate),
                hoursPerWeek: num(hours),
                constraints,
                kinds,
                avoid,
                upworkFeePercent: num(fee),
                connectsBalance: prefs.connectsBalance,
              }),
            );
            if (result.ok) onSaved();
          });
        }}
      >
        <Textarea label="What you sell" rows={2} value={services} onChange={(event) => setServices(event.target.value)} placeholder="Webflow sites and landing page design for SaaS" />
        <Input label="Keywords to search" value={keywords} onChange={(event) => setKeywords(event.target.value)} hint={`Comma-separated. Empty uses your profile: ${suggested.slice(0, 4).join(", ") || "add a headline and skills"}.`} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Minimum $/hour" type="number" min={0} value={rate} onChange={(event) => setRate(event.target.value)} />
          <Input label="Hours a week" type="number" min={0} max={80} value={hours} onChange={(event) => setHours(event.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-label text-muted">Kinds of work</span>
          <div className="flex flex-wrap gap-2">
            {(["freelance", "contract", "part-time"] as const).map((kind) => (
              <ToggleChip key={kind} selected={kinds.includes(kind)} onClick={() => setKinds((current) => (current.includes(kind) ? current.filter((value) => value !== kind) : [...current, kind]))}>
                {kind}
              </ToggleChip>
            ))}
          </div>
        </div>
        <Input label="Constraints" value={constraints} onChange={(event) => setConstraints(event.target.value)} placeholder="Remote only, IST working hours" />
        <Input label="Avoid" value={avoid} onChange={(event) => setAvoid(event.target.value)} placeholder="crypto, unpaid tests" />
        <Input label="Upwork fee you usually see (%)" type="number" min={0} max={50} step="0.1" value={fee} onChange={(event) => setFee(event.target.value)} hint="Prefills the Upwork analyst." />
        <Button type="submit" disabled={pending}>
          Save preferences
        </Button>
      </form>
    </Card>
  );
}
