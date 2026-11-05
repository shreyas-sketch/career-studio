"use client";

import { AlertTriangle, Check, CircleDashed, Loader2, Minus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";

import { deleteReport, refreshReport, retryReport } from "@/app/(app)/fde/actions";
import { Section } from "@/components/career/parts";
import { PageHeader } from "@/components/page-header";
import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/cn";
import { STAGE_LABELS, type ReportResult, type ReportStage, type ReportView, type Role, type StageState } from "@/lib/fde/types";

import { MatrixKey, Readiness, RequirementMatrix } from "./comparison";
import { FreelanceMatches, LearningPlanView, StrengthsAndGaps, Suggestions } from "./improve";
import { CareerPotential } from "./potential";
import { ProfilePanel } from "./profile-panel";
import { FoundRoleCard, InspectorBody, RoleCard, RoleDetail } from "./roles";
import { day, money, requirementsById, Sheet, SourceLink, STATE_LABELS, tenure, when, type Inspect } from "./shared";

const POLL_MS = 2500;

const STAGE_ICON: Record<StageState, ReactNode> = {
  pending: <CircleDashed size={16} aria-hidden="true" className="text-faint" />,
  running: <Loader2 size={16} aria-hidden="true" className="text-accent-text motion-safe:animate-spin" />,
  done: <Check size={16} aria-hidden="true" className="text-success" />,
  partial: <AlertTriangle size={16} aria-hidden="true" className="text-warning" />,
  failed: <X size={16} aria-hidden="true" className="text-error" />,
  skipped: <Minus size={16} aria-hidden="true" className="text-faint" />,
};

const STATE_WORDS: Record<StageState, string> = { pending: "Not started", running: "In progress", done: "Done", partial: "Done in part", failed: "Failed", skipped: "Not run" };

function StageRail({ stages, running }: { stages: ReportStage[]; running: boolean }) {
  return (
    <ol aria-label="Progress of this review" aria-live={running ? "polite" : undefined} className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
      {stages.map((stage) => (
        <li key={stage.key} className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0">{STAGE_ICON[stage.state]}</span>
          <span className="flex min-w-0 flex-col">
            <span className={cn("text-sm", stage.state === "pending" || stage.state === "skipped" ? "text-muted" : "font-medium")}>
              {STAGE_LABELS[stage.key]}
              <span className="sr-only">: {STATE_WORDS[stage.state]}</span>
            </span>
            {stage.detail && stage.state !== "pending" && stage.state !== "skipped" && <span className="text-meta text-pretty text-muted">{stage.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** What went wrong and what fixes it. Every state says so plainly. */
function StateNotice({ report, onRetry, retrying }: { report: ReportView; onRetry: () => void; retrying: boolean }) {
  if (report.state === "complete" || report.state === "running" || !report.errorMessage) return null;
  const retry = (
    <Button variant="secondary" size="sm" onClick={onRetry} disabled={retrying}>
      {retrying ? "Starting" : "Try again"}
    </Button>
  );
  const fix: ReactNode =
    report.errorCode === "not_configured" || report.errorCode === "invalid_credentials" || report.errorCode === "permission" ? (
      <div className="flex flex-wrap gap-2">
        <Link href="/settings?section=fde" className={buttonClassName("secondary", "sm")}>Open the setup</Link>
        {retry}
      </div>
    ) : report.errorCode === "ai_not_configured" ? (
      <div className="flex flex-wrap gap-2">
        <Link href="/settings?section=ai" className={buttonClassName("secondary", "sm")}>Set up AI</Link>
        {retry}
      </div>
    ) : report.errorCode === "identity_only" ? null : (
      retry
    );
  const danger = report.state === "failed" || report.state === "quota";
  return (
    <div role="status" className={cn("flex flex-wrap items-start justify-between gap-4 rounded-card border px-5 py-4", danger ? "border-danger-line bg-danger-surface" : "border-warning-line bg-warning-surface")}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium">{STATE_LABELS[report.state]}</p>
        <p className="text-sm text-pretty">{report.errorMessage}</p>
      </div>
      {fix}
    </div>
  );
}

function BenchmarkNote({ report }: { report: ReportView }) {
  const benchmark = report.benchmark;
  if (!benchmark) return null;
  const origin = report.benchmarkOrigin === "cached" ? "Reused a saved benchmark" : report.benchmarkOrigin === "refreshed" ? "Searched again on request" : "Searched for this report";
  return (
    <details>
      <summary className="cursor-pointer text-sm underline underline-offset-2">
        {origin}: version {benchmark.version} from {when(benchmark.discoveredAt)}. How this sample was chosen
      </summary>
      <Coverage coverage={benchmark.coverage} expiresAt={benchmark.expiresAt} />
    </details>
  );
}

function Coverage({ coverage, expiresAt }: { coverage: ReportResult["searchCoverage"]; expiresAt?: string }) {
  if (!coverage) return null;
  return (
    <div className="mt-3 flex flex-col gap-4 text-sm">
      <p className="max-w-[720px] text-pretty">{coverage.selectionRationale}</p>
      <dl className="grid max-w-[720px] grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-meta">
        <dt className="text-muted">Scope</dt>
        <dd>{coverage.scope}</dd>
        <dt className="text-muted">Searched for</dt>
        <dd>{coverage.queries.join(", ")}, and equivalent titles whose text describes the same work</dd>
        <dt className="text-muted">Searched at</dt>
        <dd>{when(coverage.searchedAt)}</dd>
        <dt className="text-muted">Possible roles</dt>
        <dd>{coverage.candidates} found, {coverage.duplicatesMerged} duplicates merged</dd>
        {expiresAt && (
          <>
            <dt className="text-muted">Valid until</dt>
            <dd>{when(expiresAt)}</dd>
          </>
        )}
      </dl>
      {coverage.limits.length > 0 && (
        <ul className="flex max-w-[720px] list-disc flex-col gap-1 pl-5 text-meta text-pretty text-warning">
          {coverage.limits.map((limit) => <li key={limit}>{limit}</li>)}
        </ul>
      )}
      <details>
        <summary className="cursor-pointer text-meta underline underline-offset-2">Sources ({coverage.sources.length})</summary>
        <ul className="mt-2 flex flex-col gap-1 text-meta">
          {coverage.sources.map((source) => (
            <li key={source.source}>
              {source.source}: {source.status === "ok" ? `${source.found} found` : source.status === "failed" ? "failed" : "not used"}. <span className="text-muted">{source.note}</span>
            </li>
          ))}
        </ul>
      </details>
      {coverage.excluded.length > 0 && (
        <details>
          <summary className="cursor-pointer text-meta underline underline-offset-2">Left out ({coverage.excluded.length})</summary>
          <ul className="mt-2 flex flex-col gap-1 text-meta">
            {coverage.excluded.map((entry, index) => (
              <li key={`${entry.url}${index}`} className="text-pretty">
                <SourceLink href={entry.url}>{entry.employer}: {entry.title}</SourceLink> <span className="text-muted">{entry.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Costs({ report }: { report: ReportView }) {
  if (report.usage.length === 0) return null;
  const names: Record<string, string> = { profile: "Profile read", discovery: "Job searches", job_detail: "Job details", model: "AI model" };
  return (
    <details>
      <summary className="cursor-pointer text-sm underline underline-offset-2">What this report used</summary>
      <dl className="mt-2 grid max-w-[520px] grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-meta">
        {report.usage.map((entry) => (
          <div key={entry.kind} className="contents">
            <dt className="text-muted">{names[entry.kind] ?? entry.kind} ({entry.calls} {entry.calls === 1 ? "call" : "calls"}{entry.cached ? `, ${entry.cached} from the provider's archive` : ""})</dt>
            <dd className="text-right tabular-nums">{entry.kind === "model" ? `about ${entry.tokens.toLocaleString("en-US")} tokens${entry.costMicro ? `, about ${money(entry.costMicro)}` : ""}` : money(entry.costMicro)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-meta text-muted">Retrieval costs are what the provider reported. Model tokens are estimated from the text sent and received.</p>
    </details>
  );
}

const JUMPS = [
  ["profile", "Profile"],
  ["roles", "Roles"],
  ["compare", "Compare"],
  ["improve", "Improve"],
  ["paid", "Paid work"],
] as const;

export function ReportScreen({ initial }: { initial: ReportView }) {
  const router = useRouter();
  const [report, setReport] = useState(initial);
  const [offline, setOffline] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();

  const running = report.state === "running" || report.freelance?.state === "running";

  useEffect(() => {
    if (!running) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/fde/reports/${report.id}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const next = (await response.json()) as ReportView;
        if (!stopped) {
          setReport(next);
          setOffline(false);
        }
      } catch {
        if (!stopped) setOffline(true);
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [running, report.id]);

  const roles: Role[] = useMemo(() => report.benchmark?.roles ?? [], [report.benchmark]);
  const scoreOf = (id: string) => report.result.roleScores.find((score) => score.roleId === id) ?? null;
  const groups = useMemo(() => {
    const scored = [...roles].sort((a, b) => (report.result.roleScores.find((score) => score.roleId === b.id)?.score ?? -1) - (report.result.roleScores.find((score) => score.roleId === a.id)?.score ?? -1));
    return [
      { name: "Accessible levels", roles: scored.filter((role) => role.seniorityGroup === "accessible") },
      { name: "Level not stated", roles: scored.filter((role) => role.seniorityGroup === "unstated") },
      { name: "Senior, aspirational", roles: scored.filter((role) => role.seniorityGroup === "aspirational") },
    ].filter((group) => group.roles.length > 0);
  }, [roles, report.result.roleScores]);
  const selectedRole = roles.find((role) => role.id === selected) ?? null;
  const comparedRoles = roles.filter((role) => role.requirements.length > 0);
  const hasComparison = report.result.assessments.length > 0 || report.result.market !== null;

  const inspectTitle = (() => {
    if (!inspect) return "";
    if (inspect.kind === "row") return report.result.recurring.find((row) => row.key === inspect.key)?.label ?? "Requirement";
    if (inspect.kind === "role") return roles.find((role) => role.id === inspect.roleId)?.title ?? "Role";
    return requirementsById(roles).get(inspect.requirementId)?.requirement.text ?? "Requirement";
  })();

  const title = report.subjectName || report.profile?.name || report.url.split("/in/")[1] || "FDE review";

  return (
    <>
      <PageHeader
        title={title}
        before={<Link href="/fde" className="text-sm text-muted underline underline-offset-2 hover:text-ink">FDE review</Link>}
        actions={
          <>
            <a href={`/api/fde/reports/${report.id}/export`} className={cn(buttonClassName("secondary", "sm"), "max-sm:hidden")}>Export</a>
            <Button variant="secondary" size="sm" disabled={report.state === "running"} onClick={() => setRefreshOpen(true)}>Refresh</Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
          </>
        }
      />
      <div className="flex w-full max-w-[1320px] flex-col gap-8 px-10 pb-16 max-sm:px-4">
        {report.profile?.isFixture && (
          <p role="note" className="rounded-card border border-warning-line bg-warning-surface px-5 py-3 text-sm font-medium text-pretty">
            Fixture data, not a live LinkedIn read. This person is invented{report.benchmarkOrigin ? ", and the comparison proves nothing about a real profile" : ""}.
          </p>
        )}
        {report.refreshOf && <p className="text-sm"><Link className="underline" href={`/fde/${report.refreshOf}`}>See the report this one refreshes</Link>. It&apos;s kept as it was.</p>}
        {report.newerReportId && <p className="text-sm">This report has been refreshed. <Link className="underline" href={`/fde/${report.newerReportId}`}>Open the newer one</Link>.</p>}
        {offline && <p role="status" className="text-sm text-warning">Can&apos;t reach the server right now. Trying again.</p>}

        <StageRail stages={report.stages} running={report.state === "running"} />
        <StateNotice report={report} retrying={pending} onRetry={() => start(async () => { const result = toastResult(await retryReport({ id: report.id })); if (result.ok) { setReport({ ...report, state: "running", errorCode: null, errorMessage: null }); } })} />

        <nav aria-label="Sections of this report" className="fixed right-0 bottom-0 left-12 z-20 flex justify-between overflow-x-auto border-t border-line bg-surface px-1 py-1.5 md:hidden">
          {JUMPS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="shrink-0 rounded-control px-1.5 py-1.5 text-[13px] whitespace-nowrap hover:bg-hover">{label}</a>
          ))}
        </nav>

        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div id="profile" className="scroll-mt-28 max-sm:scroll-mt-44">
            {report.profile ? (
              <ProfilePanel profile={report.profile} origin={report.profileOrigin} />
            ) : (
              <div className="rounded-panel border border-line-card bg-card p-5 text-sm text-pretty">
                <p className="font-medium">Profile not read yet</p>
                <p className="mt-1 text-muted">{report.state === "running" ? "It appears here as soon as it's read." : "Nothing about this person was retrieved, and nothing is shown in its place."}</p>
                <div className="mt-2"><SourceLink href={report.url}>Open the address on LinkedIn</SourceLink></div>
              </div>
            )}
          </div>

          <div id="roles" className="flex min-w-0 scroll-mt-28 max-sm:scroll-mt-44 flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="font-serif text-section">Current FDE openings</h2>
              <p className="max-w-[640px] text-sm text-pretty text-muted">A curated market sample, not an exhaustive or definitive ranking. Each role is scored on its own requirements only.</p>
            </div>
            {roles.length > 0 ? (
              <>
                <BenchmarkNote report={report} />
                {groups.map((group) => (
                  <div key={group.name} className="flex flex-col gap-2">
                    <h3 className="font-medium">{group.name} <span className="font-normal text-muted tabular-nums">({group.roles.length})</span></h3>
                    <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {group.roles.map((role) => (
                        <RoleCard key={role.id} role={role} score={scoreOf(role.id)} selected={selected === role.id} onSelect={() => setSelected(selected === role.id ? null : role.id)} />
                      ))}
                    </ul>
                  </div>
                ))}
                {selectedRole && <RoleDetail role={selectedRole} score={scoreOf(selectedRole.id)} result={report.result} onInspect={setInspect} />}
              </>
            ) : report.result.discovered.length > 0 ? (
              <>
                <p className="text-sm text-muted">{report.state === "running" ? "Found so far. These are checked and narrowed down next." : "These roles were found, but not compared."}</p>
                {report.state !== "running" && report.result.searchCoverage && (
                  <details>
                    <summary className="cursor-pointer text-sm underline underline-offset-2">How this search went</summary>
                    <Coverage coverage={report.result.searchCoverage} />
                  </details>
                )}
                <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {report.result.discovered.map((role) => <FoundRoleCard key={role.id} role={role} />)}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted">{report.state === "running" ? "Roles appear here as they're found." : "No roles to show."}</p>
            )}
          </div>
        </div>

        {hasComparison && (
          <div id="compare" className="flex scroll-mt-28 max-sm:scroll-mt-44 flex-col gap-10">
            <Readiness result={report.result} roles={roles} rubric={report.rubric} rubricExplained={report.rubricExplained} onPick={(roleId) => { setSelected(roleId); document.getElementById("roles")?.scrollIntoView({ block: "start" }); }} />
            <Section title="What the sampled roles ask for" description="Requirements that appear in two or more roles. Select a mark to see the passage and the evidence.">
              <MatrixKey />
              <RequirementMatrix rows={report.result.recurring} roles={comparedRoles} onInspect={setInspect} />
              <StrengthsAndGaps result={report.result} roles={comparedRoles} onInspect={setInspect} />
              {report.result.monthsOfExperience !== null && <p className="text-meta text-muted">Work experience from the profile&apos;s dates: about {tenure(report.result.monthsOfExperience)}, counting overlapping roles once.</p>}
              {(report.result.checks.claimsDowngraded > 0 || report.result.checks.requirementsDropped > 0) && (
                <p className="text-meta text-pretty text-muted">
                  Checked against the sources: {report.result.checks.requirementsDropped} {report.result.checks.requirementsDropped === 1 ? "requirement" : "requirements"} and {report.result.checks.claimsDowngraded} {report.result.checks.claimsDowngraded === 1 ? "claim" : "claims"} dropped because the quote wasn&apos;t in the document.
                </p>
              )}
            </Section>
          </div>
        )}

        {roles.length > 0 && report.state !== "running" && (
          <div id="potential" className="scroll-mt-28 max-sm:scroll-mt-44">
            <Section title="Your FDE career and earning potential" description="For the person in this report, from the openings sampled above and what the profile shows.">
              <CareerPotential result={report.result} roles={roles} />
            </Section>
          </div>
        )}

        {(report.result.insights || report.result.plan || report.result.checks.insightsFailed || report.result.checks.planFailed) && (
          <div id="improve" className="flex scroll-mt-28 max-sm:scroll-mt-44 flex-col gap-10">
            <Section title="Improvements to the profile" description="Reworded from what's already there. Placeholders in brackets mark numbers only the person can supply.">
              <Suggestions result={report.result} />
            </Section>
            <Section title="A plan to close the top gap">
              <LearningPlanView reportId={report.id} result={report.result} initial={report.learningProgress} />
            </Section>
          </div>
        )}

        <div id="paid" className="scroll-mt-28 max-sm:scroll-mt-44">
          <Section title="Freelance matches" description="Stop looks for real, paid listings that match this person's own profile, using none of your preferences.">
            <FreelanceMatches freelance={report.freelance} />
          </Section>
        </div>

        <div className="flex flex-col gap-2 border-t border-line pt-5 max-md:pb-14">
          <Costs report={report} />
          <p className="text-meta text-muted">Started {day(report.createdAt)}. Private to this account.</p>
          <a href={`/api/fde/reports/${report.id}/export`} className="text-sm underline underline-offset-2 sm:hidden">Export this report</a>
        </div>
      </div>

      <Sheet open={inspect !== null} onClose={() => setInspect(null)} title={inspectTitle}>
        {inspect && <InspectorBody target={inspect} roles={roles} result={report.result} onInspect={setInspect} />}
      </Sheet>

      <Sheet open={refreshOpen} onClose={() => setRefreshOpen(false)} title="Refresh this report">
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-pretty">A refresh reads the profile again and makes a new report. This one stays as it is, even if the refresh fails.</p>
          <div className="flex flex-col gap-2">
            <Button
              disabled={pending}
              onClick={() => start(async () => { const result = toastResult(await refreshReport({ id: report.id, refreshMarket: false })); if (result.ok) router.push(`/fde/${result.data.id}`); })}
            >
              Refresh the profile, reuse the market sample
            </Button>
            <p className="text-meta text-pretty text-muted">One paid profile read. Comparing again uses your AI model. The report says the sample was reused.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => start(async () => { const result = toastResult(await refreshReport({ id: report.id, refreshMarket: true })); if (result.ok) router.push(`/fde/${result.data.id}`); })}
            >
              Refresh the profile and search the market again
            </Button>
            <p className="text-meta text-pretty text-muted">Also pays for job searches and details, and reads the postings again.</p>
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this report?"
        description="The report goes, along with its copy of this person's profile if no other report uses it."
        confirmLabel="Delete report"
        onConfirm={() => start(async () => { const result = toastResult(await deleteReport({ id: report.id })); if (result.ok) router.push("/fde"); })}
      />
    </>
  );
}
