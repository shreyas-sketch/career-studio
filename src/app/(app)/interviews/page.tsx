import { MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AiSetupNotice, EmptyState, relativeDay, Screen, ScorePips, Section } from "@/components/career/parts";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { FOCUS_LABELS } from "@/lib/career/interview-data";
import { interviewProgress, listInterviewSessions } from "@/lib/career/interviews";
import { applicationOptions, isAiConfigured } from "@/lib/career/shared-data";

import { NewInterview } from "./new-interview";

export const metadata: Metadata = { title: "Interview practice" };

/** Mock interviews for a specific role (agent 3): start one, see past sessions and how scores move. */
export default async function InterviewsPage({ searchParams }: PageProps<"/interviews">) {
  const params = await searchParams;
  const [sessions, progress, applications, aiReady] = await Promise.all([listInterviewSessions(), interviewProgress(), applicationOptions(), isAiConfigured()]);
  const preselect = typeof params.application === "string" ? params.application : "";

  return (
    <>
      <PageHeader
        title="Interview practice"
        description="Practise for a specific role: one question at a time, follow-ups when an answer is thin, and honest feedback built from your real experience."
      />
      <Screen wide>
        {!aiReady && <AiSetupNotice what="Interview practice" />}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Section title="New session" description="Pick the role, or paste its job description. The interviewer plans questions around it and your profile.">
            <NewInterview applications={applications} preselect={preselect} disabled={!aiReady} />
          </Section>

          <Section title="Your progress">
            {progress.timeline.length === 0 ? (
              <p className="text-sm text-muted">Finish a session to see your scores here, by competency, as they change.</p>
            ) : (
              <Card className="flex flex-col gap-4">
                <div className="flex items-end gap-1.5" aria-label="Average score of each finished session, oldest first">
                  {progress.timeline.slice(-12).map((point) => (
                    <span key={point.id} className="flex flex-1 flex-col items-center gap-1" title={`${point.title}: ${point.average ?? "–"}/5`}>
                      <span className="w-full rounded-t-[4px] bg-accent/80 motion-safe:animate-rise-in" style={{ height: `${Math.max(6, ((point.average ?? 0) / 5) * 72)}px` }} />
                    </span>
                  ))}
                </div>
                <ul className="flex flex-col gap-2">
                  {progress.competencies.map((item) => (
                    <li key={item.competency} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">{item.competency}</span>
                      <span className="flex shrink-0 items-center gap-2 text-meta tabular-nums text-muted">
                        {item.sessions > 1 && <span>{item.first.toFixed(1)} →</span>}
                        <span className="font-semibold text-ink">{item.latest.toFixed(1)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </Section>
        </div>

        <Section title="Sessions">
          {sessions.length === 0 ? (
            <EmptyState icon={<MessagesSquare size={20} aria-hidden="true" />} title="No sessions yet">
              Your first session takes about fifteen minutes for five questions. Answer as you would out loud; typing in full sentences gets the most useful feedback.
            </EmptyState>
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
              {sessions.map((session) => (
                <li key={session.id}>
                  <Link
                    href={`/interviews/${session.id}`}
                    className="flex h-full flex-col gap-2 rounded-card border border-line-card bg-card p-4 text-ink hover:border-line-strong hover:text-ink motion-safe:transition-colors"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="font-medium text-pretty">{session.title}</span>
                      <span className={session.status === "ACTIVE" ? "shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-text" : "shrink-0 text-xs text-muted"}>
                        {session.status === "ACTIVE" ? "In progress" : "Finished"}
                      </span>
                    </span>
                    <span className="text-meta text-muted">
                      {FOCUS_LABELS[session.focus]} · {session.answered} answered · {relativeDay(session.createdAt)}
                      {session.round ? ` · ${session.round.title || "Loop round"}` : ""}
                    </span>
                    {session.average !== null && <ScorePips score={session.average} />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </Screen>
    </>
  );
}
