import { CalendarRange } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AiSetupNotice, EmptyState, Screen, Section } from "@/components/career/parts";
import { PageHeader } from "@/components/page-header";
import { ROUND_KIND_LABELS } from "@/lib/career/interview-data";
import { listLoops, upcomingRounds } from "@/lib/career/loops";
import { applicationOptions, isAiConfigured } from "@/lib/career/shared-data";
import { cn } from "@/lib/cn";

import { NewLoop } from "./new-loop";

export const metadata: Metadata = { title: "Interview loops" };

const when = (date: Date | null) =>
  date ? date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Date not set";

/**
 * Interview loops (agent 4): every hiring process with several rounds, across
 * companies. Different from Practice, which is one session: here are the
 * rounds, their dates, who's interviewing, prep per round, and how it went.
 */
export default async function LoopsPage({ searchParams }: PageProps<"/loops">) {
  const params = await searchParams;
  const [loops, upcoming, applications, aiReady] = await Promise.all([listLoops(), upcomingRounds(), applicationOptions(), isAiConfigured()]);
  // eslint-disable-next-line react-hooks/purity -- a server component renders once per request
  const now = Date.now();
  const taken = new Set(loops.flatMap((loop) => (loop.applicationId ? [loop.applicationId] : [])));

  return (
    <>
      <PageHeader
        title="Interview loops"
        description="Every hiring process you're in, round by round: who you'll meet, when, what they look for, a prep plan for each round, and what earlier rounds taught you."
      />
      <Screen wide>
        {!aiReady && <AiSetupNotice what="Round prep and practice" />}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Section title="Coming up" description="The next rounds across all your loops.">
            {upcoming.length === 0 ? (
              <EmptyState icon={<CalendarRange size={20} aria-hidden="true" />} title="No rounds scheduled">
                Start a loop when a company invites you to interview. Add the rounds they&apos;ve told you about and their dates; Career Studio prepares you for each.
              </EmptyState>
            ) : (
              <ol className="flex flex-col gap-2">
                {upcoming.map((round) => {
                  const soon = round.scheduledAt && round.scheduledAt.getTime() - now < 3 * 86_400_000;
                  return (
                    <li key={round.id}>
                      <Link href={`/loops/${round.loop.id}#round-${round.id}`} className="flex items-center gap-4 rounded-card border border-line-card bg-card px-4 py-3 text-ink hover:border-line-strong hover:text-ink">
                        <span className={cn("w-28 shrink-0 text-meta tabular-nums", soon ? "font-semibold text-accent-text" : "text-muted")}>{when(round.scheduledAt)}</span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">{round.title || ROUND_KIND_LABELS[round.kind]}</span>
                          <span className="truncate text-meta text-muted">
                            {[round.loop.role, round.loop.company].filter(Boolean).join(" at ")}
                          </span>
                        </span>
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", round.prepared ? "bg-teal-soft text-teal" : "bg-track text-muted")}>
                          {round.prepared ? "Prepared" : "No prep yet"}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>
          <Section title="New loop">
            <NewLoop applications={applications.filter((application) => !taken.has(application.id))} preselect={typeof params.application === "string" ? params.application : ""} />
          </Section>
        </div>

        {loops.length > 0 && (
          <Section title="Your loops">
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {loops.map((loop) => (
                <li key={loop.id}>
                  <Link href={`/loops/${loop.id}`} className="flex h-full flex-col gap-3 rounded-card border border-line-card bg-card p-4 text-ink hover:border-line-strong hover:text-ink">
                    <span className="flex items-start justify-between gap-2">
                      <span className="flex flex-col">
                        <span className="font-medium">{loop.company || "Company"}</span>
                        <span className="text-meta text-muted">{loop.role || "Role"}</span>
                      </span>
                      <span className="text-xs font-semibold text-muted">{loop.status === "ACTIVE" ? "Active" : loop.status === "OFFER" ? "Offer" : "Closed"}</span>
                    </span>
                    <span className="flex gap-1" aria-label={`${loop.done} of ${loop.rounds.length} rounds done`}>
                      {loop.rounds.map((round) => (
                        <span key={round.id} title={round.title || ROUND_KIND_LABELS[round.kind]} className={cn("h-1.5 flex-1 rounded-full", round.status === "DONE" ? "bg-accent" : round.status === "CANCELLED" ? "bg-line-strong" : "bg-track")} />
                      ))}
                    </span>
                    <span className="text-meta text-muted">
                      {loop.next ? `Next: ${loop.next.title || ROUND_KIND_LABELS[loop.next.kind]}${loop.next.scheduledAt ? `, ${when(loop.next.scheduledAt)}` : ""}` : "No upcoming rounds"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </Screen>
    </>
  );
}
