import Link from "next/link";
import type { ReactNode } from "react";

import { CrewGlyph } from "@/components/crew/shapes";
import { buttonClassName } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import type { CrewId } from "@/lib/crew/crew";
import { DASHBOARD_PERIODS, DEFAULT_QUIET_DAYS, type DashboardFigures, type DashboardPeriod } from "@/lib/dashboard";
import type { DayPeriod } from "@/lib/greeting";
import { STATUSES } from "@/lib/status";

import { ActivityChart } from "./activity-chart";
import { CrewHero } from "./crew-hero";
import { FunnelChart } from "./funnel-chart";
import { Greeting } from "./greeting";
import { PeriodFilter, PeriodScoped } from "./period-filter";
import { QuietDays } from "./quiet-days";

const card = "flex flex-col rounded-panel border border-line-card bg-card";
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The dashboard (DSH-1 to DSH-6): the funnel, where things stand, what's worth a look, and the calendar. */
export function Dashboard({
  figures,
  firstName,
  period,
  range = "all",
  quietDays = DEFAULT_QUIET_DAYS,
  empty,
  calendar,
  scoutFinds = 0,
}: {
  figures: DashboardFigures;
  firstName: string;
  period: DayPeriod;
  /** The time filter (E9-8). */
  range?: DashboardPeriod;
  /** Days without news before a follow-up is suggested (E9-9). */
  quietDays?: number;
  /** No applications at all yet. */
  empty: boolean;
  /** The calendar (E15-6), which the time filter doesn't scope. */
  calendar?: ReactNode;
  /** Postings the job agent found, waiting for a look. */
  scoutFinds?: number;
}) {
  const { sent, heardBack } = figures;
  // The summary follows the time filter, so it says which period it covers.
  const within = range === "all" ? null : DASHBOARD_PERIODS.find((entry) => entry.value === range)?.label.toLowerCase();
  return (
    <>
      <CrewHero
        title={<Greeting name={firstName} serverPeriod={period} />}
        standing={
          sent > 0
            ? `${within ? `In the ${within} you've` : "You've"} sent ${plural(sent, "application", "applications")} and heard back from ${heardBack}.`
            : within
              ? `Nothing sent in the ${within}.`
              : "Nothing sent yet."
        }
        action={
          <Link href="/new?fresh=1" className={buttonClassName("primary", "md", "hover:text-on-primary")}>
            + New application
          </Link>
        }
      />

      {empty ? (
        <Columns calendar={calendar}>
          <Welcome />
        </Columns>
      ) : (
        <>
        <Desk items={figures.attention} quietDays={quietDays} scoutFinds={scoutFinds} />
        <PeriodFilter period={range}>
          <Columns calendar={calendar}>
            <PeriodScoped className="grid max-w-[1200px] grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-start gap-5">
              <Funnel figures={figures} />
              <ActivityChart weeks={figures.weeks} />
              <WhereThingsStand byStatus={figures.byStatus} />
            </PeriodScoped>
          </Columns>
        </PeriodFilter>
        </>
      )}
    </>
  );
}

/**
 * The cards, with the calendar beside them where there's room for both.
 * Where there isn't, it comes after them, as wide as one card.
 */
function Columns({ calendar, children }: { calendar?: ReactNode; children: ReactNode }) {
  return (
    <div className="@container px-10 pb-[72px] max-sm:px-4">
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 @min-[1240px]:grid-cols-[minmax(0,1200px)_400px]">
        {children}
        {calendar && <div className="min-w-0 @min-[780px]:max-w-[calc(50%-10px)] @min-[1240px]:max-w-none">{calendar}</div>}
      </div>
    </div>
  );
}

/** "Your funnel" (DSH-2): how far every sent application got, closed ones included, as a Sankey diagram. */
function Funnel({ figures }: { figures: DashboardFigures }) {
  const { funnel, sent, heardBackPercent, reachedInterview } = figures;
  return (
    <section aria-labelledby="funnel-heading" className={`${card} col-span-full gap-6 p-7`}>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="funnel-heading" className="font-serif text-section">
            Your funnel
          </h2>
          <p className="text-control text-muted">How far each application you&apos;ve sent has made it, and where the ones that stopped are now.</p>
        </div>
        <dl className="flex gap-7">
          <Figure value={String(sent)} label="sent" />
          <Figure value={heardBackPercent === null ? "None yet" : `${heardBackPercent}%`} label="heard back" />
          <Figure value={String(reachedInterview)} label="reached interview" />
        </dl>
      </div>
      <FunnelChart funnel={funnel} />
    </section>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col-reverse gap-0.5">
      <dt className="text-label text-muted">{label}</dt>
      <dd className="font-serif text-[32px] leading-none tabular-nums">{value}</dd>
    </div>
  );
}

/** "Where things stand" (DSH-4): every application by its status now. */
function WhereThingsStand({ byStatus }: { byStatus: Record<ApplicationStatus, number> }) {
  const present = STATUSES.filter(({ value }) => byStatus[value] > 0);
  return (
    <section aria-labelledby="standing-heading" className={`${card} gap-[18px] px-7 py-[26px]`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="standing-heading" className="text-[15px] font-medium">
          Where things stand
        </h2>
        <Link href="/applications?view=board" className="text-meta text-muted underline underline-offset-3 hover:text-ink">
          Open board
        </Link>
      </div>
      {/* The legend below says the same in words. */}
      <div aria-hidden="true" className="flex h-3 gap-0.5 overflow-hidden rounded-[6px] bg-hover">
        {present.map(({ value, color }) => (
          <span key={value} style={{ flex: byStatus[value], backgroundColor: color }} />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-5 gap-y-1">
        {STATUSES.map(({ value, label }) => (
          <li key={value} className={`flex items-center gap-[9px] py-1.5 text-sm ${byStatus[value] > 0 ? "text-ink" : "text-muted"}`}>
            <StatusDot status={value} />
            <span className="flex-1">{label}</span>
            <span className="tabular-nums">{byStatus[value]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * "On your desk" (DSH-5): what the crew has handed over and is waiting on the
 * user for: offers, drafts, quiet applications, interviews and the job agent's
 * finds. Each slip is clipped by whoever it came from. Nothing goes on it to
 * fill the space.
 */
function Desk({ items, quietDays, scoutFinds }: { items: DashboardFigures["attention"]; quietDays: number; scoutFinds: number }) {
  const count = items.length + (scoutFinds > 0 ? 1 : 0);
  return (
    <section aria-labelledby="attention-heading" className="flex flex-col gap-5 px-10 pt-2 pb-12 max-sm:px-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="attention-heading" className="font-serif text-section">
          On your desk
        </h2>
        {count > 0 && <span className="text-meta text-muted">{plural(count, "thing needs", "things need")} you</span>}
      </div>
      {count === 0 ? (
        <p className="text-sm text-muted">The crew isn&apos;t waiting on you for anything.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,270px),1fr))] gap-x-4 gap-y-6">
          {scoutFinds > 0 && (
            <Slip id="scout-finds" crew="scout" tilt={0} href="/agent" title={`${plural(scoutFinds, "posting", "postings")} found for you`} reason="Scored against your profile, the best first." action="Review" />
          )}
          {items.map((item, index) => (
            <Slip
              key={item.id}
              id={item.id}
              crew={item.status === "INTERVIEW" ? "usher" : "tailor"}
              tilt={index + 1}
              href={`/applications/${item.id}${item.tab ? `?tab=${item.tab}` : ""}`}
              title={[item.company, item.role].filter(Boolean).join(", ")}
              reason={item.reason}
              action={item.action}
              soon={item.soon}
              status={item.status}
            />
          ))}
        </ul>
      )}
      <QuietDays days={quietDays} />
    </section>
  );
}

// Slips land a little crooked, and straighten when you reach for them.
const TILTS = ["-0.9deg", "0.6deg", "-0.4deg", "1deg", "-0.7deg", "0.5deg"];

function Slip({
  id,
  crew,
  tilt,
  href,
  title,
  reason,
  action,
  soon,
  status,
}: {
  id: string;
  crew: CrewId;
  tilt: number;
  href: string;
  title: string;
  reason: string;
  action: string;
  soon?: boolean;
  status?: ApplicationStatus;
}) {
  return (
    <li key={id} className="relative" style={{ rotate: TILTS[tilt % TILTS.length] }}>
      <span className="absolute -top-3 right-4 z-10">
        <CrewGlyph id={crew} size={30} eye />
      </span>
      <Link
        href={href}
        className="flex h-full flex-col gap-1 rounded-toast border border-line-card bg-card px-4 pt-4 pb-3 text-ink shadow-control hover:text-ink hover:shadow-toast motion-safe:transition-shadow"
      >
        <span className="flex items-center gap-2 pr-9 text-field leading-snug font-medium">
          {status && <StatusDot status={status} />}
          <span className="min-w-0">{title}</span>
        </span>
        <span className="flex-1 text-meta leading-[1.45] text-pretty text-muted">{reason}</span>
        <span className="mt-1.5 flex items-center gap-2 text-meta font-medium">
          <span className="underline underline-offset-3">{action}</span>
          {soon && <span className="rounded-[4px] bg-warning-surface px-1.5 py-0.5 text-xs font-normal text-warning">Soon</span>}
        </span>
      </Link>
    </li>
  );
}

/** Before the first application: where to begin. */
function Welcome() {
  return (
    <Panel>
      <h2 className="font-serif text-section">Hand the crew something to work with</h2>
      <p className="text-sm text-muted">
        Start with your profile: your roles, skills and education are what every tailored resume and cover letter is built from.
        Then paste a job posting, and your funnel and next steps will show up here.
      </p>
      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Link href="/profile" className={buttonClassName("secondary")}>
          Fill in your profile
        </Link>
        <Link href="/new?fresh=1" className={buttonClassName("primary", "md", "hover:text-on-primary")}>
          + New application
        </Link>
      </div>
    </Panel>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className={`${card} max-w-[640px] items-start gap-3 p-7`}>{children}</div>;
}
