"use client";

import { AlertCircle, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { CrewGlyph } from "@/components/crew/shapes";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { useJob } from "@/hooks/use-job";
import { cn } from "@/lib/cn";
import { CREW, jobRole } from "@/lib/crew/crew";
import { retry } from "@/lib/jobs/actions";
import type { JobView } from "@/lib/jobs/runner";

/**
 * Follows an AI step running in the background: its current step while it
 * works, a retry when it fails, and a refresh of the page when it's done so
 * the result shows. Renders nothing once the job is done.
 */
export function JobProgress({
  jobId,
  idleLabel = "Working…",
  className,
  onDone,
  compact = false,
}: {
  jobId: string | null;
  idleLabel?: string;
  className?: string;
  onDone?: (job: JobView) => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const [revision, setRevision] = useState(0);
  const [retrying, startRetry] = useTransition();
  const job = useJob(jobId, revision, (next) => {
    if (next.status === "DONE") {
      onDone?.(next);
      router.refresh();
    }
  });
  if (!jobId || !job || job.status === "DONE") return null;

  if (job.status === "FAILED") {
    return (
      <div role="alert" className={cn("flex flex-wrap items-start gap-3 rounded-card border border-danger-line bg-danger-surface px-4 py-3 text-sm", className)}>
        <AlertCircle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-error" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-medium text-error-strong">That didn&apos;t work.</span>
          <span className="text-pretty text-ink">{job.error}</span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={retrying}
          onClick={() =>
            startRetry(async () => {
              if (toastResult(await retry({ id: job.id })).ok) setRevision((count) => count + 1);
            })
          }
        >
          <RotateCcw size={14} aria-hidden="true" />
          {retrying ? "Retrying…" : "Try again"}
        </Button>
      </div>
    );
  }

  const crew = jobRole(job.type)?.crew;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-3 rounded-card border border-line-card bg-card text-sm motion-safe:animate-rise-in",
        compact ? "px-3 py-2" : "px-4 py-3.5",
        className,
      )}
    >
      {crew ? (
        <CrewGlyph id={crew} status={job.status === "QUEUED" ? "queued" : "working"} size={26} eye />
      ) : (
        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-accent motion-safe:animate-pulse-soft" />
      )}
      {crew && <span className="font-serif text-[15px] font-medium">{CREW[crew].name}</span>}
      <span className={crew ? "text-muted" : "font-medium"}>{job.step ?? idleLabel}</span>
      {job.status === "QUEUED" && <span className="text-muted">Waiting for a free slot…</span>}
    </div>
  );
}
