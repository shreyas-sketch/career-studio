"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/cn";
import { highlighted } from "@/lib/fde/grounding";
import { ASSESSMENT_LABELS, type Assessment, type DiscoveredRole, type ReportResult, type Requirement, type Role, type RoleScore } from "@/lib/fde/types";

import { LongText } from "./profile-panel";
import { day, requirementsById, SourceLink, StatusMark, type Inspect } from "./shared";

const REACH_WORDS: Record<RoleScore["reach"], string> = { within_reach: "Within reach", stretch: "A stretch", aspirational: "Aspirational" };

/** A posting's text with the words in question marked. The whole text is always there. */
export function PostingText({ text, quotes }: { text: string; quotes: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (quotes.length === 0) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.querySelector("mark")?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  }, [quotes]);
  return (
    <div ref={ref} className="max-h-[46dvh] overflow-y-auto rounded-card border border-line-card bg-surface p-4 text-sm whitespace-pre-line text-pretty" tabIndex={0} aria-label="Full text of the posting">
      {highlighted(text, quotes).map((segment, index) =>
        segment.marked ? (
          <mark key={index} className="rounded-sm bg-flash text-ink">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </div>
  );
}

/** A role that's been found, while the benchmark is still being built. */
export function FoundRoleCard({ role }: { role: DiscoveredRole }) {
  return (
    <li className="rounded-card border border-line-card bg-card px-4 py-3 motion-safe:animate-rise-in">
      <p className="text-meta text-muted">{role.employer}</p>
      <p className="font-medium text-pretty">{role.title}</p>
      <p className="mt-1 text-meta text-muted">{[role.location, role.sourceLabel].filter(Boolean).join(", ")}</p>
      <SourceLink href={role.url} className="mt-1">Original posting</SourceLink>
    </li>
  );
}

export function RoleCard({ role, score, selected, onSelect }: { role: Role; score: RoleScore | null; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <article className={cn("flex h-full flex-col gap-1.5 rounded-card border bg-card px-4 py-3 motion-safe:transition-colors", selected ? "border-ink" : "border-line-card")}>
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-meta text-muted">{role.employer}</p>
          {score?.score != null ? (
            <p className="shrink-0 font-serif text-xl leading-none tabular-nums" title="Fit on this role's own requirements">
              <span className="sr-only">Fit </span>
              {score.score}
              {score.provisional && <span className="ml-0.5 text-meta font-normal text-warning" title="Provisional">*</span>}
            </p>
          ) : role.extractionError ? (
            <p className="shrink-0 text-meta text-muted">Couldn&apos;t be read</p>
          ) : null}
        </div>
        <h3 className="font-medium text-pretty">
          <button type="button" onClick={onSelect} aria-pressed={selected} className="text-left underline-offset-2 hover:underline">
            {role.title}
          </button>
        </h3>
        <p className="text-meta text-muted">{[role.location || "Location not stated", role.remotePolicy].filter(Boolean).join(", ")}</p>
        {role.otherLocations.length > 0 && <p className="text-meta text-muted">Also listed in {role.otherLocations.length} other {role.otherLocations.length === 1 ? "place" : "places"}</p>}
        <p className="text-meta text-muted">Level: {role.seniority || "Not stated"}</p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-meta">
            {role.status === "open" ? "Open" : role.status === "closed" ? "Closed" : "Status unknown"}
            {score && <span className="text-muted"> ({REACH_WORDS[score.reach].toLowerCase()})</span>}
          </span>
          <SourceLink href={role.url}>{role.sourceLabel}</SourceLink>
        </div>
      </article>
    </li>
  );
}

function evidenceText(assessment: Assessment | undefined) {
  if (!assessment || assessment.evidence.length === 0) return <span className="text-muted">{assessment?.note || "Nothing to quote."}</span>;
  return (
    <span className="flex flex-col gap-1">
      {assessment.evidence.map((entry) => (
        <span key={`${entry.sourceId}${entry.quote}`}>
          &ldquo;{entry.quote}&rdquo; <span className="text-muted">({entry.label})</span>
        </span>
      ))}
    </span>
  );
}

/** One role's own requirements against the profile. Nothing here comes from another employer. */
export function RoleDetail({ role, score, result, onInspect }: { role: Role; score: RoleScore | null; result: ReportResult; onInspect: (target: Inspect) => void }) {
  const byId = new Map(result.assessments.map((assessment) => [assessment.requirementId, assessment]));
  const technical = role.requirements.filter((requirement) => !requirement.eligibility);
  const conditions = role.requirements.filter((requirement) => requirement.eligibility);
  const rowsFor = (rows: Requirement[]) =>
    rows.map((requirement) => ({ requirement, assessment: byId.get(requirement.id) }));
  const ref = useRef<HTMLElement>(null);

  // The detail sits below every card, so choosing a role has to take the reader there.
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.focus({ preventScroll: true });
    ref.current?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }, [role.id]);

  return (
    <section ref={ref} tabIndex={-1} aria-label={`${role.title} at ${role.employer}`} className="flex scroll-mt-28 flex-col gap-4 rounded-panel max-sm:scroll-mt-44 border border-line-card bg-card p-6 outline-none max-sm:p-4">
      <header className="flex flex-col gap-1">
        <p className="text-meta text-muted">{role.employer}</p>
        <h3 className="font-serif text-section text-pretty">{role.title}</h3>
        <p className="text-meta text-muted">
          {[role.location, role.postedAt && `posted ${day(role.postedAt)}`, role.updatedAt && `updated ${day(role.updatedAt)}`, `checked ${day(role.checkedAt)}`].filter(Boolean).join(", ")}
        </p>
        <div className="flex flex-wrap gap-3">
          <SourceLink href={role.url}>Original posting on {role.sourceLabel}</SourceLink>
        </div>
      </header>

      {score && (
        <p className="text-sm text-pretty">
          {score.score === null ? (
            "Too little could be assessed to score this role."
          ) : (
            <>
              Fit <span className="font-medium tabular-nums">{score.score}</span> of 100 on this role&apos;s own requirements ({score.earned} of {score.possible} weighted points
              {score.unknownWeight > 0 ? `, ${score.unknownWeight} points couldn't be assessed` : ""}).{" "}
            </>
          )}
          {score.reachReason}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <h4 className="font-medium">Why it&apos;s in the sample</h4>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-pretty">
          {role.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>

      {technical.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="font-medium">Requirements compared</h4>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-left text-meta">
              <thead>
                <tr className="border-b border-line-strong">
                  <th scope="col" className="w-[26%] py-2 pr-3 font-medium">Role requirement</th>
                  <th scope="col" className="w-[32%] py-2 pr-3 font-medium">Profile evidence</th>
                  <th scope="col" className="w-[16%] py-2 pr-3 font-medium">Assessment</th>
                  <th scope="col" className="py-2 font-medium">Suggested action</th>
                </tr>
              </thead>
              <tbody>
                {rowsFor(technical).map(({ requirement, assessment }) => (
                  <tr key={requirement.id} onClick={() => onInspect({ kind: "requirement", requirementId: requirement.id })} className="cursor-pointer border-b border-line align-top hover:bg-hover">
                    <th scope="row" className="py-2.5 pr-3 font-normal">
                      <button type="button" className="text-left underline-offset-2 hover:underline" onClick={(event) => { event.stopPropagation(); onInspect({ kind: "requirement", requirementId: requirement.id }); }}>
                        {requirement.text}
                      </button>
                      {requirement.level === "preferred" && <span className="block text-muted">Preferred</span>}
                    </th>
                    <td className="py-2.5 pr-3 text-pretty">{evidenceText(assessment)}</td>
                    <td className="py-2.5 pr-3"><StatusMark status={assessment?.status ?? null} withLabel /></td>
                    <td className="py-2.5 text-pretty">{assessment?.action || <span className="text-muted">None</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-3 md:hidden">
            {rowsFor(technical).map(({ requirement, assessment }) => (
              <li key={requirement.id} className="border-t border-line pt-3">
                <button type="button" onClick={() => onInspect({ kind: "requirement", requirementId: requirement.id })} className="flex w-full flex-col items-start gap-1 text-left text-meta">
                  <span className="text-sm font-medium text-pretty">{requirement.text}{requirement.level === "preferred" ? " (preferred)" : ""}</span>
                  <StatusMark status={assessment?.status ?? null} withLabel />
                  <span className="text-pretty">{evidenceText(assessment)}</span>
                  {assessment?.action && <span className="text-pretty text-muted">Next: {assessment.action}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {conditions.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="font-medium">Stated conditions</h4>
          <p className="text-meta text-pretty text-muted">These are this employer&apos;s conditions. They don&apos;t count towards fit, and a profile often can&apos;t settle them.</p>
          <ul className="flex flex-col gap-2">
            {rowsFor(conditions).map(({ requirement, assessment }) => (
              <li key={requirement.id}>
                <button type="button" onClick={() => onInspect({ kind: "requirement", requirementId: requirement.id })} className="flex w-full flex-col items-start gap-0.5 text-left text-meta">
                  <span className="text-sm text-pretty">&ldquo;{requirement.excerpt}&rdquo;</span>
                  <span className="text-pretty text-muted">{assessment ? `${ASSESSMENT_LABELS[assessment.status]}: ${assessment.note}` : "Not compared."}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {role.extractionError && <p className="text-sm text-warning">{role.extractionError}</p>}

      <details>
        <summary className="cursor-pointer font-medium">Full posting</summary>
        <div className="mt-2">
          <LongText text={role.description} lines={12} />
        </div>
      </details>
    </section>
  );
}

/** The insight inspector: the requirement, its passage in context, and what the profile shows. */
export function InspectorBody({ target, roles, result, onInspect }: { target: Inspect; roles: Role[]; result: ReportResult; onInspect: (target: Inspect) => void }) {
  const lookup = requirementsById(roles);
  const byId = new Map(result.assessments.map((assessment) => [assessment.requirementId, assessment]));

  if (target.kind === "row") {
    const row = result.recurring.find((entry) => entry.key === target.key);
    if (!row) return null;
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          Asked for in {row.count} of {row.analyzed} analyzed roles, stated as required in {row.mustCount}. Each employer&apos;s own words:
        </p>
        <ul className="flex flex-col gap-3">
          {row.roles.map((entry) => {
            const role = roles.find((candidate) => candidate.id === entry.roleId);
            return (
              <li key={entry.requirementId} className="border-t border-line pt-3">
                <button type="button" onClick={() => onInspect({ kind: "requirement", requirementId: entry.requirementId })} className="flex w-full flex-col items-start gap-1 text-left">
                  <span className="text-meta font-medium">{role?.employer}: {role?.title}</span>
                  <span className="text-sm text-pretty">&ldquo;{entry.excerpt}&rdquo;</span>
                  <StatusMark status={entry.status} withLabel />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (target.kind === "role") {
    const role = roles.find((entry) => entry.id === target.roleId);
    if (!role) return null;
    return (
      <div className="flex flex-col gap-3">
        <SourceLink href={role.url}>Original posting on {role.sourceLabel}</SourceLink>
        <PostingText text={role.description} quotes={[]} />
      </div>
    );
  }

  const found = lookup.get(target.requirementId);
  if (!found) return null;
  const { requirement, role } = found;
  const assessment = byId.get(requirement.id);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-meta text-muted">{role.employer}: {role.title}</p>
        <p className="text-sm">{requirement.level === "must" ? "Stated as required." : "Stated as preferred, not required."}</p>
        <StatusMark status={assessment?.status ?? null} withLabel />
      </div>
      {assessment && (
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">What the profile shows</h3>
          {assessment.evidence.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {assessment.evidence.map((entry) => (
                <li key={`${entry.sourceId}${entry.quote}`} className="border-l-2 border-line-strong pl-3 text-sm text-pretty">
                  &ldquo;{entry.quote}&rdquo;
                  <span className="block text-meta text-muted">From: {entry.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No words in this profile back this.</p>
          )}
          <p className="text-sm text-pretty">{assessment.note}</p>
          {assessment.action && <p className="text-sm text-pretty"><span className="font-medium">Suggested action: </span>{assessment.action}</p>}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">In the posting</h3>
          <SourceLink href={role.url}>Original on {role.sourceLabel}</SourceLink>
        </div>
        <PostingText text={role.description} quotes={[requirement.excerpt]} />
      </div>
    </div>
  );
}
