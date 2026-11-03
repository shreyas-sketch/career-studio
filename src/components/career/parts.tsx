import { KeyRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { buttonClassName } from "@/components/ui/button";
import { cn } from "@/lib/cn";

// Small pieces shared by Career Studio's agent screens.

/** Shown instead of an agent's actions until the account has an AI provider. */
export function AiSetupNotice({ what }: { what: string }) {
  return (
    <div className="flex flex-wrap items-start gap-4 rounded-card border border-warning-line bg-warning-surface px-5 py-4">
      <KeyRound size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium">Connect your AI provider first</p>
        <p className="text-sm text-pretty text-muted">
          {what} runs on your own AI account. Add your provider and key in Settings; it&apos;s stored encrypted and only used for your work.
        </p>
      </div>
      <Link href="/settings?section=ai" className={buttonClassName("primary", "sm")}>
        Set up AI
      </Link>
    </div>
  );
}

/** The content column of an agent screen. */
export function Screen({ children, className, wide = false }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("flex w-full flex-col gap-8 px-10 pb-16 max-sm:px-4", wide ? "max-w-[1180px]" : "max-w-[920px]", className)}>{children}</div>;
}

/** A titled block inside a screen. */
export function Section({ title, description, actions, children, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-section">{title}</h2>
          {description && <p className="max-w-[640px] text-sm text-pretty text-muted">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** A friendly empty state with what to do first. */
export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-panel border border-dashed border-line-strong px-6 py-8 motion-safe:animate-rise-in">
      <span className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent-text">{icon}</span>
      <h3 className="font-display text-xl font-medium">{title}</h3>
      <div className="max-w-[560px] text-sm text-pretty text-muted">{children}</div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** A 0–100 fit score as a small meter with its number. */
export function FitMeter({ score, label = "Fit" }: { score: number | null; label?: string }) {
  if (score === null) return <span className="text-meta text-muted">Not scored</span>;
  const tone = score >= 80 ? "bg-success" : score >= 60 ? "bg-accent" : "bg-status-rejected";
  return (
    <span className="inline-flex items-center gap-2" title={`${label} ${score} of 100`}>
      <span aria-hidden="true" className="h-1.5 w-16 overflow-hidden rounded-full bg-track">
        <span className={cn("block h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500", tone)} style={{ width: `${score}%` }} />
      </span>
      <span className="text-meta font-semibold tabular-nums">{score}</span>
      <span className="sr-only">
        {label} {score} out of 100
      </span>
    </span>
  );
}

/** A 1–5 score as five pips. */
export function ScorePips({ score, max = 5 }: { score: number | null; max?: number }) {
  if (score === null) return null;
  return (
    <span className="inline-flex items-center gap-1" title={`${score} of ${max}`}>
      {Array.from({ length: max }, (_, index) => (
        <span key={index} aria-hidden="true" className={cn("size-2 rounded-full", index < Math.round(score) ? "bg-accent" : "bg-track")} />
      ))}
      <span className="ml-1 text-meta font-semibold tabular-nums">{score}</span>
      <span className="sr-only">out of {max}</span>
    </span>
  );
}

/** A verdict as a coloured label. */
export function Verdict({ verdict }: { verdict: "pursue" | "consider" | "skip" }) {
  const styles = {
    pursue: "bg-teal-soft text-teal",
    consider: "bg-accent-soft text-accent-text",
    skip: "bg-danger-surface text-error",
  } as const;
  const labels = { pursue: "Worth pursuing", consider: "Consider", skip: "Probably skip" } as const;
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", styles[verdict])}>{labels[verdict]}</span>;
}

/** A labelled list of short points. */
export function Points({ title, items, tone = "plain", empty }: { title: string; items: string[]; tone?: "plain" | "good" | "gap" | "risk"; empty?: string }) {
  if (items.length === 0 && !empty) return null;
  const marker = { plain: "bg-faint", good: "bg-teal", gap: "bg-accent", risk: "bg-status-rejected" }[tone];
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-label font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item, index) => (
            <li key={index} className="flex gap-2.5 text-sm leading-relaxed text-pretty">
              <span aria-hidden="true" className={cn("mt-[0.55em] size-1.5 shrink-0 rounded-full", marker)} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Relative date for lists: "today", "3 days ago", or the date. */
export function relativeDay(date: Date | string | null, now = new Date()): string {
  if (!date) return "";
  const then = typeof date === "string" ? new Date(date) : date;
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
