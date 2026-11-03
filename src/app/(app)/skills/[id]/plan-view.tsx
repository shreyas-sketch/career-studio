"use client";

import { BookOpen, Check, Hammer, Megaphone, RefreshCw, Send, Target } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";

import { JobProgress } from "@/components/career/job-progress";
import { Points, Section } from "@/components/career/parts";
import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { READINESS, READINESS_LABELS, type SkillAssessment, type SkillPlanContent } from "@/lib/career/skill-plan-data";
import { cn } from "@/lib/cn";

import { deletePlan, rewritePlan, setPlanStatus, toggleStep } from "../actions";

const KIND_ICONS = { learn: BookOpen, practice: Target, build: Hammer, demonstrate: Megaphone, apply: Send } as const;
const IMPORTANCE = { "must-have": "Must-have", important: "Important", "nice-to-have": "Nice to have" } as const;

type PlanData = {
  id: string;
  status: "ACTIVE" | "DONE" | "ARCHIVED";
  assessment: SkillAssessment | null;
  content: SkillPlanContent | null;
  progress: string[];
  totals: { steps: number; done: number; hours: number; hoursDone: number };
  applicationId: string | null;
};

export function PlanView({ plan, jobId: initialJob, aiReady }: { plan: PlanData; jobId: string | null; aiReady: boolean }) {
  const router = useRouter();
  const [jobId, setJobId] = useState(initialJob);
  const [pending, start] = useTransition();
  const [done, setDone] = useOptimistic(plan.progress, (current: string[], change: { id: string; done: boolean }) =>
    change.done ? [...current, change.id] : current.filter((value) => value !== change.id),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { assessment, content } = plan;
  const steps = content?.phases.flatMap((phase) => phase.steps) ?? [];
  const finished = steps.filter((step) => done.includes(step.id));
  const percent = steps.length ? Math.round((finished.length / steps.length) * 100) : 0;
  const readinessIndex = assessment ? READINESS.indexOf(assessment.readiness) : -1;

  return (
    <div className="flex flex-col gap-8">
      <JobProgress jobId={jobId} idleLabel="Planning…" onDone={() => setJobId(null)} />

      {assessment && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="flex flex-col gap-5 motion-safe:animate-rise-in">
            <span className="text-label font-semibold tracking-wide text-accent-text uppercase">Where you stand</span>
            <p className="text-lead text-pretty">{assessment.summary}</p>
            <div className="flex flex-col gap-2">
              <div className="flex gap-1" aria-hidden="true">
                {READINESS.map((level, index) => (
                  <span key={level} className={cn("h-2 flex-1 rounded-full", index <= readinessIndex ? "bg-accent" : "bg-track")} />
                ))}
              </div>
              <span className="text-sm font-medium">{READINESS_LABELS[assessment.readiness]}</span>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <h3 className="text-label font-semibold tracking-wide text-muted uppercase">Your strengths here</h3>
                <ul className="flex flex-col gap-2">
                  {assessment.strengths.map((item) => (
                    <li key={item.strength} className="text-sm">
                      <span className="font-medium">{item.strength}</span> <span className="text-muted">{item.evidence}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-label font-semibold tracking-wide text-muted uppercase">What transfers</h3>
                <ul className="flex flex-col gap-2">
                  {assessment.transferable.map((item) => (
                    <li key={item.experience} className="text-sm">
                      <span className="font-medium">{item.experience}</span> <span className="text-muted">{item.howItTransfers}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
          <Card className="flex flex-col gap-4 motion-safe:animate-rise-in">
            <h3 className="text-label font-semibold tracking-wide text-muted uppercase">Gaps</h3>
            <ul className="flex flex-col gap-3">
              {assessment.gaps.map((gap) => (
                <li key={gap.skill} className="flex flex-col gap-0.5 text-sm">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{gap.skill}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", gap.importance === "must-have" ? "bg-danger-surface text-error" : gap.importance === "important" ? "bg-accent-soft text-accent-text" : "bg-track text-muted")}>
                      {IMPORTANCE[gap.importance]}
                    </span>
                  </span>
                  <span className="text-meta text-muted">Now: {gap.currentLevel}</span>
                </li>
              ))}
            </ul>
            <Points title="Assumptions" items={assessment.assumptions} />
          </Card>
        </div>
      )}

      {content && (
        <>
          <div className="flex flex-wrap items-center gap-4 rounded-card border border-line-card bg-card px-5 py-4">
            <span className="font-display text-3xl font-semibold tabular-nums">{percent}%</span>
            <span className="flex min-w-48 flex-1 flex-col gap-1.5">
              <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-track">
                <span className="block h-full rounded-full bg-accent motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${percent}%` }} />
              </span>
              <span className="text-meta text-muted">
                {finished.length} of {steps.length} steps · {finished.reduce((sum, step) => sum + step.hours, 0)} of {plan.totals.hours} hours
              </span>
            </span>
          </div>

          <Section title="The plan">
            <ol className="flex flex-col gap-6">
              {content.phases.map((phase, index) => (
                <li key={phase.title} className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="text-label font-semibold tracking-wide text-accent-text uppercase">
                      Phase {index + 1} · weeks {phase.weeks}
                    </span>
                    <h3 className="font-display text-xl font-medium">{phase.title}</h3>
                  </div>
                  <p className="text-sm text-muted">{phase.goal}</p>
                  <ul className="flex flex-col gap-2">
                    {phase.steps.map((step) => {
                      const isDone = done.includes(step.id);
                      const Icon = KIND_ICONS[step.kind];
                      return (
                        <li key={step.id}>
                          <label className={cn("flex cursor-pointer gap-4 rounded-card border bg-card p-4 motion-safe:transition-colors", isDone ? "border-accent/50 bg-accent-soft" : "border-line-card hover:border-line-strong")}>
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={isDone}
                              onChange={(event) => {
                                const next = event.target.checked;
                                start(async () => {
                                  setDone({ id: step.id, done: next });
                                  toastResult(await toggleStep({ id: plan.id, stepId: step.id, done: next }));
                                  router.refresh();
                                });
                              }}
                            />
                            <span aria-hidden="true" className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2", isDone ? "border-accent bg-accent text-on-primary" : "border-line-strong")}>
                              {isDone && <Check size={12} strokeWidth={3} />}
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col gap-1">
                              <span className={cn("flex flex-wrap items-center gap-2 font-medium", isDone && "text-muted line-through decoration-1")}>{step.title}</span>
                              <span className="text-sm text-pretty text-muted">{step.detail}</span>
                              {step.proof && <span className="text-meta text-muted">Done when: {step.proof}</span>}
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1 text-meta text-muted">
                              <span className="inline-flex items-center gap-1 capitalize">
                                <Icon size={13} aria-hidden="true" /> {step.kind}
                              </span>
                              <span className="tabular-nums">{step.hours} h</span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="flex flex-col gap-3">
              <span className="text-label font-semibold tracking-wide text-accent-text uppercase">Portfolio piece</span>
              <h3 className="font-display text-xl font-medium">{content.project.title}</h3>
              <p className="text-sm whitespace-pre-wrap text-pretty">{content.project.brief}</p>
              <Points title="Shows" items={content.project.demonstrates} tone="good" />
            </Card>
            <Card className="flex flex-col gap-4">
              <Points title="Use your strengths now" items={content.leverageNow} tone="good" />
              <Points title="What this plan can't promise" items={content.caveats} />
            </Card>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            size="sm"
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "DONE", label: "Done" },
              { value: "ARCHIVED", label: "Archived" },
            ]}
            value={plan.status}
            onValueChange={(status) => start(async () => void toastResult(await setPlanStatus({ id: plan.id, status })))}
          />
          {plan.applicationId && (
            <Link href={`/applications/${plan.applicationId}`} className={buttonClassName("text", "sm")}>
              Back to the application
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!aiReady || pending || Boolean(jobId)}
            onClick={() =>
              start(async () => {
                const result = toastResult(await rewritePlan({ id: plan.id }));
                if (result.ok) setJobId(result.data.jobId);
              })
            }
          >
            <RefreshCw size={14} aria-hidden="true" /> Plan again
          </Button>
          <Button variant="text" size="sm" className="text-danger!" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this plan?"
        description="The assessment, the plan and your progress go."
        confirmLabel="Delete"
        onConfirm={() =>
          start(async () => {
            if (toastResult(await deletePlan({ id: plan.id })).ok) router.push("/skills");
          })
        }
      />
    </div>
  );
}
