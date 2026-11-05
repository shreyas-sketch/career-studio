"use client";

import { cn } from "@/lib/cn";
import { categoryLabel } from "@/lib/fde/rubric";
import { ASSESSMENT_LABELS, type AssessmentStatus, type MarketScore, type RecurringRow, type ReportResult, type Role, type RoleScore } from "@/lib/fde/types";

import { StatusMark, type Inspect } from "./shared";

const GROUP_WORDS: Record<string, string> = { accessible: "Stated as open to this level", unstated: "Level not stated", aspirational: "Senior, aspirational" };

/** Every sampled role on one line. The number never stands apart from what it's made of. */
function SampleStrip({ market, roles, scores, onPick }: { market: MarketScore; roles: Role[]; scores: RoleScore[]; onPick: (roleId: string) => void }) {
  const score = (id: string) => scores.find((entry) => entry.roleId === id)?.score ?? null;
  const placed = roles.filter((role) => score(role.id) !== null);
  return (
    <div className="pt-7 pb-6">
      <div className="relative h-10">
        <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
        {market.low !== null && market.high !== null && (
          <div aria-hidden="true" className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-accent-soft" style={{ left: `${market.low}%`, width: `${Math.max(market.high - market.low, 1)}%` }} />
        )}
        {placed.map((role) => {
          const value = score(role.id) ?? 0;
          const senior = role.seniorityGroup === "aspirational";
          return (
            <button
              key={role.id}
              type="button"
              onClick={() => onPick(role.id)}
              title={`${role.employer}: ${value}`}
              aria-label={`${role.title} at ${role.employer}: fit ${value} of 100${senior ? ", senior role" : ""}`}
              className="group absolute top-0 flex h-full w-5 -translate-x-1/2 items-center justify-center rounded-control"
              style={{ left: `${value}%` }}
            >
              <span className={cn("block w-[3px] rounded-full bg-ink group-hover:bg-accent-text motion-safe:transition-colors", senior ? "h-3 opacity-55" : "h-6")} />
            </button>
          );
        })}
        {market.score !== null && (
          <div aria-hidden="true" className="pointer-events-none absolute -top-5 -translate-x-1/2 font-serif text-sm font-medium tabular-nums" style={{ left: `${market.score}%` }}>
            {market.score}
          </div>
        )}
      </div>
      <div aria-hidden="true" className="mt-1 flex justify-between text-meta text-muted tabular-nums">
        <span>0</span>
        <span>100</span>
      </div>
      <p className="mt-2 text-meta text-muted">Each mark is one role, and you can select it. Short marks are senior roles, which count for half. The band is the range if everything that couldn&apos;t be assessed went one way or the other.</p>
    </div>
  );
}

export function Readiness({ result, roles, rubric, rubricExplained, onPick }: { result: ReportResult; roles: Role[]; rubric: string; rubricExplained: string[]; onPick: (roleId: string) => void }) {
  const market = result.market;
  if (!market) return null;
  const compared = roles.filter((role) => result.roleScores.some((score) => score.roleId === role.id));
  return (
    <section aria-labelledby="readiness" className="flex flex-col gap-2">
      <h2 id="readiness" className="font-serif text-section">Market readiness</h2>
      {market.score === null ? (
        <p className="max-w-[680px] rounded-card border border-warning-line bg-warning-surface px-5 py-4 text-sm text-pretty">Score withheld. {market.withheld}</p>
      ) : (
        <>
          <p className="max-w-[720px] text-lead text-pretty">
            <span className="font-serif text-[40px] leading-none font-medium tabular-nums">{market.score}</span> of 100 on evidence, across {market.roleCount} {market.roleCount === 1 ? "role" : "roles"} at {market.employerCount} {market.employerCount === 1 ? "employer" : "employers"}.
            {market.low !== null && market.high !== null && market.low !== market.high && ` It could be anywhere from ${market.low} to ${market.high} given what couldn't be assessed.`}
          </p>
          {market.provisional && (
            <p className="max-w-[720px] text-sm text-pretty text-warning">
              Provisional. {market.provisionalWhy.join(" ")}
            </p>
          )}
          <SampleStrip market={market} roles={compared} scores={result.roleScores} onPick={onPick} />
        </>
      )}
      <p className="max-w-[720px] text-sm text-pretty text-muted">A score describes evidence against this sourced market sample. It isn&apos;t a hiring probability or a universal employability rating, and missing evidence isn&apos;t proof of missing ability.</p>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">By kind of requirement</h3>
          <ul className="flex flex-col gap-2">
            {Object.entries(market.categories)
              .sort(([, a], [, b]) => b.possible - a.possible)
              .map(([name, value]) => {
                const percent = value.possible > 0 ? Math.round((100 * value.earned) / value.possible) : 0;
                return (
                  <li key={name} className="grid grid-cols-[minmax(0,1fr)_72px_32px] items-center gap-3 text-meta">
                    <span className="truncate">{categoryLabel(name)}</span>
                    <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-track">
                      <span className="block h-full rounded-full bg-ink" style={{ width: `${percent}%` }} />
                    </span>
                    <span className="text-right tabular-nums">{percent}</span>
                  </li>
                );
              })}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">By level</h3>
          <ul className="flex flex-col gap-2">
            {Object.entries(market.groups)
              .filter(([, group]) => group.count > 0)
              .map(([name, group]) => (
                <li key={name} className="flex items-baseline justify-between gap-3 text-meta">
                  <span>
                    {GROUP_WORDS[name] ?? name} ({group.count})
                  </span>
                  <span className="tabular-nums">{group.score ?? "No score"}</span>
                </li>
              ))}
            <li className="flex items-baseline justify-between gap-3 text-meta text-muted">
              <span>Requirements that could be assessed</span>
              <span className="tabular-nums">{Math.round(market.coverage * 100)}%</span>
            </li>
          </ul>
          <details className="mt-2">
            <summary className="cursor-pointer text-meta underline underline-offset-2">How this is worked out ({rubric})</summary>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-meta text-pretty text-muted">
              {rubricExplained.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </section>
  );
}

const ORDER: AssessmentStatus[] = ["demonstrated", "partial", "not_shown", "cannot_assess"];

function strongest(row: RecurringRow, roleId: string): RecurringRow["roles"][number] | null {
  const entries = row.roles.filter((entry) => entry.roleId === roleId);
  if (entries.length === 0) return null;
  return [...entries].sort((a, b) => ORDER.indexOf(a.status ?? "cannot_assess") - ORDER.indexOf(b.status ?? "cannot_assess"))[0];
}

/** Requirements down, roles across. On a phone it becomes one card per requirement. */
export function RequirementMatrix({ rows, roles, onInspect }: { rows: RecurringRow[]; roles: Role[]; onInspect: (target: Inspect) => void }) {
  if (rows.length === 0) return <p className="text-sm text-muted">No requirement appears in more than one role in this sample.</p>;
  return (
    <>
      <div className="hidden max-w-full overflow-x-auto rounded-card border border-line-card bg-card md:block">
        <table className="w-full border-collapse text-left text-meta">
          <caption className="sr-only">How often each requirement appears across the analyzed roles, and what the profile shows for it in each.</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="sticky left-0 z-10 min-w-[190px] bg-card px-4 py-3 font-medium">Requirement</th>
              {roles.map((role) => (
                <th key={role.id} scope="col" className="min-w-[76px] px-2 py-3 align-bottom font-medium">
                  <button type="button" onClick={() => onInspect({ kind: "role", roleId: role.id })} className="text-left underline-offset-2 hover:underline" title={role.title}>
                    {role.employer}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-line last:border-b-0">
                <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-2.5 font-normal">
                  <span className="block text-sm">{row.label}</span>
                  <button type="button" onClick={() => onInspect({ kind: "row", key: row.key })} className="text-muted underline underline-offset-2 hover:text-ink">
                    {row.count} of {row.analyzed} analyzed roles
                  </button>
                </th>
                {roles.map((role) => {
                  const cell = strongest(row, role.id);
                  return (
                    <td key={role.id} className="px-2 py-2.5">
                      {cell ? (
                        <button
                          type="button"
                          onClick={() => onInspect({ kind: "requirement", requirementId: cell.requirementId })}
                          aria-label={`${row.label} at ${role.employer}: ${cell.status ? ASSESSMENT_LABELS[cell.status] : "not yet compared"}${cell.level === "preferred" ? ", preferred" : ""}`}
                          className="grid size-7 place-items-center rounded-control hover:bg-hover"
                        >
                          <StatusMark status={cell.status} />
                        </button>
                      ) : (
                        <span className="pl-2.5 text-faint" aria-label="Not asked">
                          <span aria-hidden="true">-</span>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <li key={row.key} className="rounded-card border border-line-card bg-card p-4">
            <p className="font-medium text-pretty">{row.label}</p>
            <button type="button" onClick={() => onInspect({ kind: "row", key: row.key })} className="text-meta text-muted underline underline-offset-2">
              {row.count} of {row.analyzed} analyzed roles
            </button>
            <ul className="mt-2 flex flex-col">
              {roles.flatMap((role) => {
                const cell = strongest(row, role.id);
                if (!cell) return [];
                return [
                  <li key={role.id}>
                    <button type="button" onClick={() => onInspect({ kind: "requirement", requirementId: cell.requirementId })} className="flex min-h-10 w-full items-center justify-between gap-3 text-left text-meta">
                      <span className="min-w-0 truncate">{role.employer}</span>
                      <StatusMark status={cell.status} withLabel className="shrink-0" />
                    </button>
                  </li>,
                ];
              })}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );
}

export function MatrixKey() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1">
      {ORDER.map((status) => (
        <li key={status}>
          <StatusMark status={status} withLabel />
        </li>
      ))}
    </ul>
  );
}
