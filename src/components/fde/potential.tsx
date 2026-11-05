"use client";

import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  comparePay,
  comparesWith,
  marketPay,
  MIN_POSTINGS_FOR_AVERAGE,
  nextRoles,
  PAY_KIND_LABELS,
  parseCurrentAmount,
  SENIORITY_LABELS,
  type CurrentPay,
  type MarketPay,
  type PayGroup,
  type PayLine,
} from "@/lib/fde/potential";
import type { ReportResult, Role } from "@/lib/fde/types";

import { SourceLink } from "./shared";

const amount = (value: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
/** Averages of midpoints aren't exact, so they don't pretend to be. */
const rounded = (value: number, currency: string) => amount(Math.round(value / 1000) * 1000, currency);
const postings = (count: number) => `${count} ${count === 1 ? "posting" : "postings"}`;

function Comparison({ line, group, current }: { line: PayLine; group: PayGroup; current: CurrentPay }) {
  const result = comparePay(line, current);
  if (result.kind === "too_few") {
    if (result.toHigh <= 0) return <p className="text-meta text-pretty">Insufficient data for an estimate. The figure entered is at or above this stated range, so it shows no increase.</p>;
    const increase = result.toLow > 0 ? `+${amount(result.toLow, group.currency)} to +${amount(result.toHigh, group.currency)}` : `Up to +${amount(result.toHigh, group.currency)}`;
    return (
      <p className="rounded-control border border-line-card bg-surface px-3 py-2 text-pretty">
        <span className="font-medium tabular-nums">{increase} a year against the stated range</span>
        <span className="block text-meta text-muted">Insufficient data for an estimate: {postings(line.entries.length)}. Not a salary you can expect.</span>
      </p>
    );
  }
  if (result.difference <= 0) {
    return <p className="text-meta text-pretty">Estimated average is {rounded(-result.difference, group.currency)} below the figure entered, so this group shows no increase.</p>;
  }
  return (
    <p className="rounded-control border border-line-card bg-surface px-3 py-2 text-pretty">
      <span className="font-serif text-xl text-success tabular-nums">+{rounded(result.difference, group.currency)} a year, about {result.percent}%</span>
      <span className="block text-meta text-muted">Estimated potential increase, comparing the figure entered with this group&apos;s average. Not a salary you can expect.</span>
    </p>
  );
}

function PayRow({ line, group, current }: { line: PayLine; group: PayGroup; current: CurrentPay | null }) {
  const compare = comparesWith(group, line, current);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">{PAY_KIND_LABELS[line.kind]}</p>
      {line.average !== null ? (
        <p className="text-pretty">
          <span className="font-serif text-xl tabular-nums">About {rounded(line.average, group.currency)}</span>
          <span className="block text-meta text-muted">
            Estimate: the average of the midpoints of {postings(line.entries.length)}, whose ranges run from {amount(line.low, group.currency)} to {amount(line.high, group.currency)}.
          </span>
        </p>
      ) : (
        <p className="text-pretty">
          <span className="tabular-nums">{amount(line.low, group.currency)} to {amount(line.high, group.currency)}</span>
          <span className="block text-meta text-muted">Stated range. Insufficient data for an average: {postings(line.entries.length)}, and an average needs {MIN_POSTINGS_FOR_AVERAGE}.</span>
        </p>
      )}
      {line.kind === "unclear" && <p className="text-meta text-pretty text-muted">These postings don&apos;t say clearly whether this is base salary or total pay, so it&apos;s kept apart from both.</p>}
      {compare && current && <Comparison line={line} group={group} current={current} />}
      <details className="text-meta">
        <summary className="cursor-pointer text-muted underline underline-offset-2">Sources</summary>
        <ul className="mt-2 flex flex-col gap-2">
          {line.entries.map((entry) => (
            <li key={entry.roleId} className="flex flex-col gap-0.5">
              <SourceLink href={entry.url}>{entry.employer}, {entry.title}</SourceLink>
              <span className="text-muted">{entry.statedLocation}. As posted: &ldquo;{entry.excerpts.join(" ")}&rdquo;</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function CurrentPayForm({ pay, onChange }: { pay: MarketPay; onChange: (current: CurrentPay | null) => void }) {
  const currencies = useMemo(() => [...new Set(pay.groups.map((group) => group.currency))], [pay]);
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState(currencies[0] ?? "USD");
  const [kind, setKind] = useState<CurrentPay["kind"]>("base");

  const apply = (next: { value?: string; currency?: string; kind?: CurrentPay["kind"] }) => {
    const figure = next.value ?? value;
    const parsed = parseCurrentAmount(figure);
    onChange(parsed === null ? null : { amount: parsed, currency: next.currency ?? currency, kind: next.kind ?? kind });
  };

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line-card bg-card p-4">
      <div>
        <h4 className="font-medium">Compare with current pay, if you choose to</h4>
        <p className="text-meta text-pretty text-muted">Optional. Only this page uses the figure: it isn&apos;t saved, added to the report or sent to the server or an AI model. It goes when you leave.</p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <Input
          label="Current yearly pay"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          placeholder="Leave empty to skip"
          onChange={(event) => {
            setValue(event.target.value);
            apply({ value: event.target.value });
          }}
        />
        <Select
          label="Currency"
          value={currency}
          onChange={(event) => {
            setCurrency(event.target.value);
            apply({ currency: event.target.value });
          }}
        >
          {currencies.map((code) => <option key={code} value={code}>{code}</option>)}
        </Select>
        <Select
          label="This figure is"
          value={kind}
          onChange={(event) => {
            const next = event.target.value as CurrentPay["kind"];
            setKind(next);
            apply({ kind: next });
          }}
        >
          <option value="base">{PAY_KIND_LABELS.base}</option>
          <option value="total">{PAY_KIND_LABELS.total}</option>
        </Select>
      </div>
    </div>
  );
}

function AdvertisedPay({ roles }: { roles: Role[] }) {
  const pay = useMemo(() => marketPay(roles), [roles]);
  const [current, setCurrent] = useState<CurrentPay | null>(null);
  const matches = current ? pay.groups.some((group) => group.lines.some((line) => comparesWith(group, line, current))) : false;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-medium">Advertised pay in these openings</h3>
        <p className="text-sm text-pretty text-muted">
          {pay.statedCount} of {pay.roleCount} open roles state pay. Grouped by country, currency and level, with no currency conversion. Pay within a country varies by city, and equity and bonus are only counted where a posting includes them in its range.
        </p>
      </div>
      {pay.groups.length === 0 ? (
        <p className="text-sm text-pretty">Insufficient data: none of the sampled postings state pay, so no market figure is shown.</p>
      ) : (
        <>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
            {pay.groups.map((group) => (
              <li key={group.key} className="flex flex-col gap-3 rounded-card border border-line-card bg-card p-4">
                <p className="text-sm text-muted">{group.location}, {group.currency}, {SENIORITY_LABELS[group.seniority].toLowerCase()}</p>
                {group.lines.map((line) => <PayRow key={line.kind} line={line} group={group} current={current} />)}
              </li>
            ))}
          </ul>
          <CurrentPayForm pay={pay} onChange={setCurrent} />
          {current ? (
            !matches && <p className="text-sm text-pretty">No group here states {PAY_KIND_LABELS[current.kind].toLowerCase()} in {current.currency}, so nothing is compared. Figures aren&apos;t converted between pay types or currencies.</p>
          ) : (
            <p className="text-sm text-pretty text-muted">Without current pay, this shows what the market advertises. It can&apos;t say whether anyone would earn more.</p>
          )}
        </>
      )}
      {pay.unused.length > 0 && (
        <details className="text-meta">
          <summary className="cursor-pointer text-muted underline underline-offset-2">Roles not counted ({pay.unused.length})</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {pay.unused.map((posting) => (
              <li key={posting.roleId} className="flex flex-col gap-0.5">
                <SourceLink href={posting.url}>{posting.employer}, {posting.title}</SourceLink>
                <span className="text-muted">{posting.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function NextRoles({ result, roles }: { result: ReportResult; roles: Role[] }) {
  const tiers = useMemo(() => nextRoles(result, roles), [result, roles]);
  if (tiers.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">Realistic next roles</h3>
        <p className="text-sm text-pretty text-muted">These need a completed comparison with the profile, which this report doesn&apos;t have.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {tiers.map((tier) => (
        <div key={tier.reach} className="flex flex-col gap-2">
          <div>
            <h3 className="font-medium">{tier.title}</h3>
            <p className="text-sm text-pretty text-muted">{tier.description}</p>
          </div>
          <ul className="flex flex-col gap-3">
            {tier.roles.map((next) => (
              <li key={next.role.id} className="flex flex-col gap-1 border-t border-line pt-3 text-sm">
                <p className="font-medium text-pretty">
                  {next.role.title}, {next.role.employer}
                  {next.score !== null && <span className="font-normal text-muted tabular-nums"> (evidence fit {next.score})</span>}
                </p>
                <p className="text-meta text-pretty text-muted">{next.reason}</p>
                {next.gaps.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-1">
                    {next.gaps.map((gap) => (
                      <li key={gap.requirementId} className="text-pretty">
                        {gap.text}
                        <span className="text-muted"> ({gap.must ? "required" : "preferred"}).</span>
                        {gap.action && <span className="text-muted"> {gap.action}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-meta text-muted">No skill gap found in what could be assessed for this role.</p>
                )}
                {next.conditions.length > 0 && <p className="text-meta text-pretty text-muted">Also stated, and not assumed to be met: {next.conditions.join("; ")}.</p>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function TopGaps({ result }: { result: ReportResult }) {
  if (result.gaps.length === 0) return null;
  return (
    <p className="text-sm text-pretty">
      <span className="font-medium">Where to start: </span>
      {result.gaps.slice(0, 3).map((gap) => `${gap.label} (${gap.roleCount} ${gap.roleCount === 1 ? "role" : "roles"})`).join(", ")}.{" "}
      <a href="#improve" className="underline underline-offset-2">See the profile edits and the plan</a>.
    </p>
  );
}

/** Next roles and advertised pay, from this report's own openings. */
export function CareerPotential({ result, roles }: { result: ReportResult; roles: Role[] }) {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <NextRoles result={result} roles={roles} />
          <TopGaps result={result} />
        </div>
        <AdvertisedPay roles={roles} />
      </div>
      <p className="max-w-[720px] text-meta text-pretty text-muted">
        This describes advertised pay and stated requirements in this sample on the day it was checked. Developing these skills can make a profile more competitive, but completing the plan doesn&apos;t guarantee a job, an interview or any of these figures.
      </p>
    </div>
  );
}
