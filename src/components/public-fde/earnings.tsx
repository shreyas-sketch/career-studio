"use client";

import { useMemo } from "react";

import { CareerPotential } from "@/components/fde/potential";
import { SourceLink, day } from "@/components/fde/shared";
import { marketPay, MIN_POSTINGS_FOR_AVERAGE, PAY_KIND_LABELS, SENIORITY_LABELS, type PayGroup, type PayLine } from "@/lib/fde/potential";
import type { ReportResult, Role } from "@/lib/fde/types";

// "Your FDE career and earning potential": the advertised ranges in this
// report's own verified postings, drawn on one scale per currency, then the
// existing breakdown (next roles, grouped pay, optional current pay). Only
// what postings state; nothing converted, inferred or promised.

const amount = (value: number, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0, notation: value >= 1_000_000 ? "compact" : "standard" }).format(value);

const compact = (value: number, currency: string) => new Intl.NumberFormat("en", { style: "currency", currency, notation: "compact", maximumFractionDigits: 0 }).format(value);

/** Which other kinds of pay the postings mention without giving a figure for them. */
function mentions(line: PayLine): string[] {
  const text = line.entries.flatMap((entry) => entry.excerpts).join(" ").toLowerCase();
  const found: string[] = [];
  if (/\bequity|stock|rsu|options?\b/.test(text)) found.push("equity");
  if (/\bbonus/.test(text)) found.push("bonus");
  if (/\bcommission/.test(text)) found.push("commission");
  return found;
}

function RangeLine({ group, line, scale }: { group: PayGroup; line: PayLine; scale: { min: number; max: number } }) {
  const span = scale.max - scale.min || 1;
  const at = (value: number) => `${((value - scale.min) / span) * 100}%`;
  const extras = mentions(line);
  return (
    <li className="flex flex-col gap-2 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm">
          <span className="font-medium">{group.location}</span>
          <span className="text-muted">, {SENIORITY_LABELS[group.seniority].toLowerCase()}, {PAY_KIND_LABELS[line.kind].toLowerCase()}</span>
        </p>
        {line.average !== null ? (
          <p className="text-right">
            <span className="font-serif text-2xl font-medium tabular-nums">{amount(line.average, group.currency)}</span>
            <span className="block text-meta text-muted">average of {line.entries.length} range midpoints</span>
          </p>
        ) : (
          <p className="text-right text-meta text-muted">
            {line.entries.length} {line.entries.length === 1 ? "posting" : "postings"}: too few for an average (needs {MIN_POSTINGS_FOR_AVERAGE})
          </p>
        )}
      </div>
      <div className="relative h-9" role="img" aria-label={`Advertised ranges from ${amount(line.low, group.currency)} to ${amount(line.high, group.currency)}${line.average !== null ? `, average of midpoints ${amount(line.average, group.currency)}` : ""}.`}>
        <div className="absolute inset-x-0 top-1/2 h-px bg-line-strong" aria-hidden="true" />
        {line.entries.map((entry, index) => (
          <div
            key={entry.roleId}
            aria-hidden="true"
            className="absolute h-1.5 rounded-full bg-primary/35"
            style={{ left: at(entry.min), width: `max(6px, calc(${at(entry.max)} - ${at(entry.min)}))`, top: `${6 + (index % 4) * 6}px` }}
            title={`${entry.employer}: ${amount(entry.min, group.currency)} to ${amount(entry.max, group.currency)}`}
          />
        ))}
        {line.average !== null && (
          <div aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: at(line.average) }} />
        )}
      </div>
      <div className="flex justify-between text-meta text-muted tabular-nums" aria-hidden="true">
        <span>{compact(scale.min, group.currency)}</span>
        <span>{compact(scale.max, group.currency)}</span>
      </div>
      {line.kind === "unclear" && <p className="text-meta text-pretty text-muted">These postings don&apos;t say whether the range is base salary or total pay, so it&apos;s kept apart from both.</p>}
      {extras.length > 0 && <p className="text-meta text-pretty text-muted">Also mentioned, with no figure counted here: {extras.join(", ")}.</p>}
    </li>
  );
}

function Ranges({ roles }: { roles: Role[] }) {
  const pay = useMemo(() => marketPay(roles), [roles]);
  const byCurrency = useMemo(() => {
    const map = new Map<string, PayGroup[]>();
    for (const group of pay.groups) map.set(group.currency, [...(map.get(group.currency) ?? []), group]);
    return [...map.entries()].sort((a, b) => b[1].reduce((n, g) => n + g.lines.reduce((m, l) => m + l.entries.length, 0), 0) - a[1].reduce((n, g) => n + g.lines.reduce((m, l) => m + l.entries.length, 0), 0));
  }, [pay]);
  const dated = roles.filter((role) => pay.groups.some((group) => group.lines.some((line) => line.entries.some((entry) => entry.roleId === role.id))));
  const posted = dated.map((role) => role.postedAt).filter((value): value is string => Boolean(value)).sort();
  const checked = dated.map((role) => role.checkedAt).sort();

  if (pay.groups.length === 0) {
    return (
      <p className="max-w-[640px] text-sm text-pretty">
        None of the {pay.roleCount} verified openings state a pay range, so no market figure is shown. Nothing is estimated in its place.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {byCurrency.map(([currency, groups]) => {
        const lines = groups.flatMap((group) => group.lines.map((line) => ({ group, line })));
        const scale = { min: Math.min(...lines.map(({ line }) => line.low)), max: Math.max(...lines.map(({ line }) => line.high)) };
        const pad = (scale.max - scale.min) * 0.06 || scale.max * 0.1;
        return (
          <section key={currency} aria-label={`Advertised pay in ${currency}`} className="flex flex-col gap-4">
            <h3 className="text-sm font-medium">In {currency}</h3>
            <ul className="flex flex-col gap-4">
              {lines.map(({ group, line }) => (
                <RangeLine key={`${group.key}-${line.kind}`} group={group} line={line} scale={{ min: Math.max(0, scale.min - pad), max: scale.max + pad }} />
              ))}
            </ul>
          </section>
        );
      })}
      <p className="max-w-[720px] text-meta text-pretty text-muted">
        Method: each bar is one posting&apos;s advertised range, as written. Where at least {MIN_POSTINGS_FOR_AVERAGE} comparable postings state pay, the dark line is the average of their range midpoints. That&apos;s what employers advertise, not what anyone is paid. Groups never mix countries, currencies, levels or pay types, and nothing is converted.{" "}
        {pay.statedCount} of {pay.roleCount} openings state pay
        {posted.length > 0 ? `; posted ${day(posted[0])}${posted.length > 1 && posted.at(-1) !== posted[0] ? ` to ${day(posted.at(-1))}` : ""}` : ""}
        {checked.length > 0 ? `; checked ${day(checked.at(-1))}` : ""}.
      </p>
      <details className="text-meta">
        <summary className="cursor-pointer text-muted underline underline-offset-2">The postings behind these figures</summary>
        <ul className="mt-2 flex flex-col gap-1.5">
          {pay.groups.flatMap((group) =>
            group.lines.flatMap((line) =>
              line.entries.map((entry) => (
                <li key={`${group.key}-${line.kind}-${entry.roleId}`} className="text-pretty">
                  <SourceLink href={entry.url}>{entry.employer}, {entry.title}</SourceLink>{" "}
                  <span className="text-muted tabular-nums">
                    {amount(entry.min, group.currency)} to {amount(entry.max, group.currency)}, {PAY_KIND_LABELS[line.kind].toLowerCase()}, {entry.statedLocation}
                  </span>
                </li>
              )),
            ),
          )}
        </ul>
      </details>
    </div>
  );
}

/** The whole section. It sits right after the score, not at the end of the report. */
export function EarningPotential({ result, roles, ready }: { result: ReportResult; roles: Role[]; ready: boolean }) {
  return (
    <section id="earnings" aria-labelledby="earnings-title" className="scroll-mt-24 overflow-hidden rounded-panel border border-line-card bg-card">
      <div className="flex flex-col gap-2 border-b border-line bg-primary/[0.06] px-6 py-6 max-sm:px-4">
        <h2 id="earnings-title" className="font-serif text-[30px] leading-tight font-medium text-balance max-sm:text-[26px]">
          Your FDE career and earning potential
        </h2>
        <p className="max-w-[680px] text-sm text-pretty text-muted">
          What the verified openings in this report advertise, and the realistic next roles for this profile. It describes the market, not an offer: completing a plan doesn&apos;t guarantee a job or any of these figures.
        </p>
      </div>
      <div className="flex flex-col gap-10 px-6 py-6 max-sm:px-4">
        <Ranges roles={roles} />
        {ready ? (
          <CareerPotential result={result} roles={roles} />
        ) : (
          <p className="text-sm text-muted">Realistic next roles and the comparison with your current pay appear once your profile has been compared with these openings.</p>
        )}
      </div>
    </section>
  );
}
