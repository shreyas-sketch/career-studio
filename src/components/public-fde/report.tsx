"use client";

import { AlertTriangle, Check, CircleDashed, Loader2, Minus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { MatrixKey, Readiness, RequirementMatrix } from "@/components/fde/comparison";
import { FreelanceMatches, LearningPlanView, StrengthsAndGaps, Suggestions } from "@/components/fde/improve";
import { ProfilePanel } from "@/components/fde/profile-panel";
import { FoundRoleCard, InspectorBody, RoleCard, RoleDetail } from "@/components/fde/roles";
import { requirementsById, Sheet, SourceLink, tenure, when, type Inspect } from "@/components/fde/shared";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/cn";
import { STAGE_LABELS, type ReportStage, type Role, type StageState } from "@/lib/fde/types";
import type { PublicReportView } from "@/lib/public-fde/view";

import { EarningPotential } from "./earnings";

// A visitor's own report. It follows the server's real progress (polling,
// slower while the tab is hidden, and straight back after a reconnect) and
// shows each part as soon as it exists: the profile first, then the roles,
// then the comparison. Nothing is shown that the server didn't send.

const STAGE_ICON: Record<StageState, ReactNode> = {
  pending: <CircleDashed size={18} aria-hidden="true" className="text-faint" />,
  running: <Loader2 size={18} aria-hidden="true" className="text-primary-text motion-safe:animate-spin" />,
  done: <Check size={18} aria-hidden="true" className="text-success" />,
  partial: <AlertTriangle size={18} aria-hidden="true" className="text-warning" />,
  failed: <X size={18} aria-hidden="true" className="text-error" />,
  skipped: <Minus size={18} aria-hidden="true" className="text-faint" />,
};
const STATE_WORDS: Record<StageState, string> = { pending: "not started", running: "in progress", done: "done", partial: "done in part", failed: "didn't finish", skipped: "not run" };

/** The stages a visitor sees, in plain words. */
const PUBLIC_STAGE_LABELS: Record<ReportStage["key"], string> = {
  ...STAGE_LABELS,
  reading_profile: "Reading your profile",
  discovering_roles: "Discovering FDE roles",
  verifying_openings: "Verifying openings",
  building_benchmark: "Reading what each role asks for",
  matching_evidence: "Matching your evidence",
  writing_insights: "Preparing insights",
};

function StageRail({ stages, live }: { stages: ReportStage[]; live: boolean }) {
  return (
    <ol aria-label="Progress of your review" className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {stages.map((stage) => (
        <li key={stage.key} className="flex items-start gap-2.5">
          <span className="mt-0.5 shrink-0">{live || stage.state !== "running" ? STAGE_ICON[stage.state] : STAGE_ICON.pending}</span>
          <span className="flex min-w-0 flex-col">
            <span className={cn("text-sm", stage.state === "pending" || stage.state === "skipped" ? "text-muted" : "font-medium")}>
              {PUBLIC_STAGE_LABELS[stage.key]}
              <span className="sr-only">: {STATE_WORDS[stage.state]}</span>
            </span>
            {stage.detail && stage.state !== "pending" && stage.state !== "skipped" && <span className="text-meta text-pretty text-muted">{stage.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

const duration = (seconds: number) => (seconds < 90 ? "about a minute" : `about ${Math.round(seconds / 60)} minutes`);

function StatusPanel({ report, offline, onRetry, retrying }: { report: PublicReportView; offline: boolean; onRetry: () => void; retrying: boolean }) {
  const { status } = report;
  const waiting = status.phase === "queued_profile" || status.phase === "queued_analysis" || status.phase === "waiting";
  const tone = status.phase === "failed" ? "danger" : status.phase === "restricted" || status.phase === "partial" || status.phase === "waiting" ? "warning" : "plain";
  return (
    <div
      className={cn(
        "flex flex-col gap-5 rounded-panel border px-6 py-5 max-sm:px-4",
        tone === "danger" ? "border-danger-line bg-danger-surface" : tone === "warning" ? "border-warning-line bg-warning-surface" : "border-line-card bg-card",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div role="status" aria-live="polite" className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-serif text-[22px] leading-snug font-medium text-pretty">{status.headline}</p>
          {status.detail && <p className="max-w-[70ch] text-sm text-pretty">{status.detail}</p>}
          {waiting && status.place && (
            <p className="text-sm tabular-nums">
              {status.place.ahead === 0 ? "You're next." : `${status.place.ahead} ${status.place.ahead === 1 ? "report is" : "reports are"} ahead of yours.`}
              {status.place.etaSeconds !== null && (
                <span className="text-muted"> Roughly {duration(status.place.etaSeconds)} to go, judging by the last {status.place.basis} reports.</span>
              )}
            </p>
          )}
          {status.ref && <p className="text-meta text-muted">Reference: <span className="font-mono">{status.ref}</span></p>}
          {offline && <p className="text-sm text-warning">Can&apos;t reach the server right now. Your report is safe on the server; this page will catch up when the connection is back.</p>}
        </div>
        {status.retryable && (
          <Button variant="secondary" size="sm" disabled={retrying} onClick={onRetry}>
            {retrying ? "Starting again" : "Try again"}
          </Button>
        )}
      </div>
      <StageRail stages={report.stages} live={!status.final} />
    </div>
  );
}

const JUMPS = [
  ["profile", "Profile"],
  ["earnings", "Pay"],
  ["roles", "Roles"],
  ["compare", "Compare"],
  ["improve", "Improve"],
  ["paid", "Freelance"],
] as const;

export function PublicReport({ initial }: { initial: PublicReportView }) {
  const router = useRouter();
  const [report, setReport] = useState(initial);
  const [offline, setOffline] = useState(false);
  const [gone, setGone] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const failures = useRef(0);

  const live = !report.status.final || report.freelance?.state === "running";

  useEffect(() => {
    if (!live || gone) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (stopped) return;
      try {
        const response = await fetch(`/api/public/fde/reports/${report.id}`, { cache: "no-store" });
        if (response.status === 404) {
          setGone(true);
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const next = (await response.json()) as PublicReportView;
        if (!stopped) {
          setReport(next);
          setOffline(false);
          failures.current = 0;
        }
      } catch {
        failures.current++;
        if (!stopped) setOffline(failures.current >= 2);
      }
      // Every 2.5 s while visible, gently slower after failures, and every 15 s in a background tab.
      const base = document.visibilityState === "visible" ? 2_500 : 15_000;
      const delay = Math.min(base * 2 ** Math.min(failures.current, 3), 30_000);
      if (!stopped) timer = setTimeout(poll, delay);
    };
    timer = setTimeout(poll, 1_500);
    const wake = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [live, gone, report.id]);

  const roles: Role[] = useMemo(() => report.benchmark?.roles ?? [], [report.benchmark]);
  const scoreOf = (id: string) => report.result.roleScores.find((score) => score.roleId === id) ?? null;
  const groups = useMemo(() => {
    const scored = [...roles].sort((a, b) => (report.result.roleScores.find((s) => s.roleId === b.id)?.score ?? -1) - (report.result.roleScores.find((s) => s.roleId === a.id)?.score ?? -1));
    return [
      { name: "Accessible levels", roles: scored.filter((role) => role.seniorityGroup === "accessible") },
      { name: "Level not stated", roles: scored.filter((role) => role.seniorityGroup === "unstated") },
      { name: "Senior, aspirational", roles: scored.filter((role) => role.seniorityGroup === "aspirational") },
    ].filter((group) => group.roles.length > 0);
  }, [roles, report.result.roleScores]);
  const selectedRole = roles.find((role) => role.id === selected) ?? null;
  const comparedRoles = roles.filter((role) => role.requirements.length > 0);
  const hasComparison = report.result.assessments.length > 0 || report.result.market !== null;
  const compared = report.status.phase === "complete" || report.status.phase === "partial";

  const inspectTitle = (() => {
    if (!inspect) return "";
    if (inspect.kind === "row") return report.result.recurring.find((row) => row.key === inspect.key)?.label ?? "Requirement";
    if (inspect.kind === "role") return roles.find((role) => role.id === inspect.roleId)?.title ?? "Role";
    return requirementsById(roles).get(inspect.requirementId)?.requirement.text ?? "Requirement";
  })();

  const retry = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/public/fde/reports/${report.id}/retry`, { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.ok) {
        setReport({ ...report, status: { ...report.status, phase: "queued_profile", headline: "Back in line", detail: "Your report picks up where it stopped.", final: false, retryable: false, ref: null } });
      } else {
        setReport({ ...report, status: { ...report.status, detail: data.error ?? report.status.detail } });
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    const response = await fetch(`/api/public/fde/reports/${report.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (response?.ok || response?.status === 404) router.push("/fde-review?deleted=1");
  };

  if (gone) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-8 py-20 max-sm:px-4">
        <h1 className="font-serif text-[32px] font-medium">This report isn&apos;t available</h1>
        <p className="mt-2 text-pretty text-muted">It was deleted, or it was opened in a different browser from the one that started it.</p>
        <a className="mt-6 inline-block underline underline-offset-2" href="/fde-review">Start a review</a>
      </div>
    );
  }

  const name = report.profile?.name || report.subjectName || "Your FDE review";

  return (
    <>
      <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-10 px-8 pt-10 pb-24 max-sm:px-4 max-sm:pt-6">
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-[40px] leading-[1.05] font-medium tracking-[-0.02em] text-balance max-sm:text-[30px]">{name}</h1>
          {report.profile?.headline && <p className="max-w-[70ch] text-lead text-pretty text-muted">{report.profile.headline}</p>}
        </div>

        <StatusPanel report={report} offline={offline} onRetry={() => void retry()} retrying={busy} />

        {report.profile?.isFixture && (
          <p role="note" className="rounded-card border border-warning-line bg-warning-surface px-5 py-3 text-sm font-medium text-pretty">
            Test data, not a live LinkedIn read. This person is invented and the comparison proves nothing about a real profile.
          </p>
        )}

        <nav aria-label="Sections of this report" className="sticky top-0 z-20 -mx-8 flex gap-1 overflow-x-auto border-y border-line bg-paper/95 px-8 py-2 backdrop-blur max-sm:-mx-4 max-sm:px-4">
          {JUMPS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="shrink-0 rounded-control px-2.5 py-1.5 text-sm whitespace-nowrap hover:bg-hover">
              {label}
            </a>
          ))}
        </nav>

        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-10 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div id="profile" className="scroll-mt-20 lg:sticky lg:top-16">
            {report.profile ? (
              <ProfilePanel profile={report.profile} origin={report.profileOrigin} mediaBase={report.mediaBase} />
            ) : (
              <div className="rounded-panel border border-line-card bg-card p-5 text-sm text-pretty">
                <p className="font-medium">Profile not read yet</p>
                <p className="mt-1 text-muted">{report.status.final ? "Nothing from this profile was retrieved, and nothing is shown in its place." : "It appears here as soon as it's read."}</p>
                <div className="mt-2"><SourceLink href={report.url}>Open the address on LinkedIn</SourceLink></div>
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-14">
            {hasComparison && (
              <div id="compare" className="scroll-mt-20">
                <Readiness
                  result={report.result}
                  roles={roles}
                  rubric={report.rubric}
                  rubricExplained={report.rubricExplained}
                  onPick={(roleId) => {
                    setSelected(roleId);
                    document.getElementById("roles")?.scrollIntoView({ block: "start" });
                  }}
                />
              </div>
            )}

            {roles.length > 0 && <EarningPotential result={report.result} roles={roles} ready={compared && hasComparison} />}

            <section id="roles" aria-labelledby="roles-title" className="flex scroll-mt-20 flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h2 id="roles-title" className="font-serif text-section">Current FDE openings</h2>
                <p className="max-w-[640px] text-sm text-pretty text-muted">
                  Found and verified for this session, the same sample for everyone, and not chosen to suit any profile. Each role is scored on its own requirements. Select one to see it side by side with your profile.
                </p>
              </div>
              {roles.length > 0 ? (
                <>
                  {report.benchmark && (
                    <details className="text-sm">
                      <summary className="cursor-pointer underline underline-offset-2">How this sample was chosen ({when(report.benchmark.discoveredAt)})</summary>
                      <div className="mt-3 flex max-w-[720px] flex-col gap-3">
                        <p className="text-pretty">{report.benchmark.coverage.selectionRationale}</p>
                        <p className="text-meta text-muted">{report.benchmark.coverage.candidates} possible roles found, {report.benchmark.coverage.duplicatesMerged} duplicates merged, {report.benchmark.coverage.excluded.length} left out as closed, unverifiable or not customer-facing engineering.</p>
                        {report.benchmark.coverage.limits.length > 0 && (
                          <ul className="list-disc pl-5 text-meta text-pretty text-warning">{report.benchmark.coverage.limits.map((limit) => <li key={limit}>{limit}</li>)}</ul>
                        )}
                      </div>
                    </details>
                  )}
                  {groups.map((group) => (
                    <div key={group.name} className="flex flex-col gap-2">
                      <h3 className="font-medium">
                        {group.name} <span className="font-normal text-muted tabular-nums">({group.roles.length})</span>
                      </h3>
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
                  <p className="text-sm text-muted">Found so far. These are checked and narrowed down next.</p>
                  <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {report.result.discovered.map((role) => <FoundRoleCard key={role.id} role={role} />)}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-muted">{report.status.final ? "No roles to show." : "Roles appear here as soon as the market sample is ready."}</p>
              )}
            </section>

            {hasComparison && (
              <section aria-labelledby="matrix-title" className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <h2 id="matrix-title" className="font-serif text-section">What these roles ask for, and what your profile shows</h2>
                  <p className="max-w-[640px] text-sm text-pretty text-muted">Requirements that appear in two or more roles. Select a mark to see the posting&apos;s words next to the evidence from your profile.</p>
                </div>
                <MatrixKey />
                <RequirementMatrix rows={report.result.recurring} roles={comparedRoles} onInspect={setInspect} />
                <StrengthsAndGaps result={report.result} roles={comparedRoles} onInspect={setInspect} />
                {report.result.monthsOfExperience !== null && (
                  <p className="text-meta text-muted">Work experience from your profile&apos;s dates: about {tenure(report.result.monthsOfExperience)}, counting overlapping roles once.</p>
                )}
              </section>
            )}

            {(report.result.insights || report.result.plan || report.result.checks.insightsFailed || report.result.checks.planFailed) && (
              <section id="improve" aria-labelledby="improve-title" className="flex scroll-mt-20 flex-col gap-10">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    <h2 id="improve-title" className="font-serif text-section">Make your profile show what you can do</h2>
                    <p className="max-w-[640px] text-sm text-pretty text-muted">Rewrites use only what&apos;s already on your profile. Brackets mark numbers only you can supply.</p>
                  </div>
                  <Suggestions result={report.result} />
                </div>
                <div className="flex flex-col gap-4">
                  <h2 className="font-serif text-section">A plan for your top gap, with portfolio work</h2>
                  <LearningPlanView reportId={report.id} result={report.result} initial={[]} persist={false} />
                </div>
              </section>
            )}

            <section id="paid" aria-labelledby="paid-title" className="flex scroll-mt-20 flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h2 id="paid-title" className="font-serif text-section">Paid freelance work that fits now</h2>
                <p className="max-w-[640px] text-sm text-pretty text-muted">Real listings matched to your profile, with the pay each one states and whether it&apos;s hourly or fixed. Listings change quickly; check each one before applying.</p>
              </div>
              {report.freelance || compared ? <FreelanceMatches freelance={report.freelance} /> : <p className="text-sm text-muted">Checked after the comparison.</p>}
            </section>

            <div className="flex flex-col gap-3 border-t border-line pt-6 text-sm">
              <p className="text-pretty text-muted">
                Started {when(report.createdAt)}. Visible only in this browser, and deleted automatically after a few days.
              </p>
              <Button variant="secondary" size="sm" className="w-fit" disabled={busy} onClick={() => setConfirmDelete(true)}>
                Delete my report
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Sheet open={inspect !== null} onClose={() => setInspect(null)} title={inspectTitle}>
        {inspect && <InspectorBody target={inspect} roles={roles} result={report.result} onInspect={setInspect} />}
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete your report?"
        description="Your report and its copy of your profile are deleted now. This can't be undone."
        confirmLabel="Delete report"
        onConfirm={() => void remove()}
      />
    </>
  );
}
