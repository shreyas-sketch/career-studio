"use client";

import { Check, Circle, CircleDashed, CircleDot, ExternalLink, HelpCircle, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";
export { money, STATE_LABELS } from "@/lib/fde/format";
import { ASSESSMENT_LABELS, type AssessmentStatus, type Requirement, type Role } from "@/lib/fde/types";

const STATUS_ICON: Record<AssessmentStatus, LucideIcon> = { demonstrated: Check, partial: CircleDot, not_shown: Circle, cannot_assess: HelpCircle };
const STATUS_TONE: Record<AssessmentStatus, string> = {
  demonstrated: "text-success",
  partial: "text-accent-text",
  not_shown: "text-ink",
  cannot_assess: "text-muted",
};

/** A status as shape and words, never colour alone. */
export function StatusMark({ status, withLabel = false, className }: { status: AssessmentStatus | null; withLabel?: boolean; className?: string }) {
  if (!status) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-muted", className)}>
        <CircleDashed size={15} aria-hidden="true" />
        {withLabel && <span className="text-meta">Not yet compared</span>}
      </span>
    );
  }
  const Icon = STATUS_ICON[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5", STATUS_TONE[status], className)}>
      <Icon size={15} aria-hidden="true" className="shrink-0" />
      {withLabel ? <span className="text-meta">{ASSESSMENT_LABELS[status]}</span> : <span className="sr-only">{ASSESSMENT_LABELS[status]}</span>}
    </span>
  );
}

export function SourceLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={cn("inline-flex items-center gap-1 text-meta underline underline-offset-2 hover:text-ink", className)}>
      {children}
      <ExternalLink size={12} aria-hidden="true" className="shrink-0" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** A panel over the page: at the side on a desktop, from the bottom on a phone. Native dialog, so focus stays inside and Escape closes it. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-[min(620px,100vw)] max-w-none overflow-hidden bg-card text-ink shadow-dialog backdrop:bg-black/35 max-md:inset-x-0 max-md:top-auto max-md:bottom-0 max-md:h-[88dvh] max-md:max-h-[88dvh] max-md:w-full max-md:rounded-t-panel"
    >
      {open && (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4 max-sm:px-4">
            <h2 className="font-serif text-xl text-pretty">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="-m-1 rounded-control p-1 text-muted hover:bg-hover hover:text-ink">
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 max-sm:px-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export type Inspect = { kind: "requirement"; requirementId: string } | { kind: "row"; key: string } | { kind: "role"; roleId: string };

export const requirementsById = (roles: readonly Role[]): Map<string, { requirement: Requirement; role: Role }> =>
  new Map(roles.flatMap((role) => role.requirements.map((requirement) => [requirement.id, { requirement, role }] as const)));

export function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";
}

export function day(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-GB", { dateStyle: "medium" }) : "";
}

export const tenure = (months: number | null) => (months === null ? "" : months < 24 ? `${months} months` : `${Math.floor(months / 12)} years`);
