import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AiSetupNotice, Screen } from "@/components/career/parts";
import { PageHeader } from "@/components/page-header";
import { roundJobKey } from "@/lib/career/interviews";
import { loadLoop } from "@/lib/career/loops";
import { isAiConfigured, openJob } from "@/lib/career/shared-data";

import { LoopView } from "./loop-view";

export const metadata: Metadata = { title: "Interview loop" };

export default async function LoopPage({ params }: PageProps<"/loops/[id]">) {
  const { id } = await params;
  const [loop, aiReady] = await Promise.all([loadLoop(id), isAiConfigured()]);
  if (!loop) notFound();
  const jobs = Object.fromEntries(await Promise.all(loop.rounds.map(async (round) => [round.id, await openJob(roundJobKey(round.id))] as const)));

  return (
    <>
      <PageHeader
        title={[loop.role, loop.company].filter(Boolean).join(" at ") || "Interview loop"}
        before={
          <Link href="/loops" className="text-sm text-muted hover:text-ink">
            ← Loops
          </Link>
        }
        description={
          loop.application ? (
            <>
              For your application{" "}
              <Link href={`/applications/${loop.application.id}`} className="underline underline-offset-3">
                {loop.application.role || loop.application.title}
              </Link>
              . Rounds in order: prepare each one, practise it with that interviewer, and note how it went so the next round builds on it.
            </>
          ) : (
            "Rounds in order: prepare each one, practise it with that interviewer, and note how it went so the next round builds on it."
          )
        }
      />
      <Screen wide>
        {!aiReady && <AiSetupNotice what="Round prep and practice" />}
        <LoopView
          loop={{
            id: loop.id,
            status: loop.status,
            notes: loop.notes,
            hasJobDescription: loop.jobDescription.trim().length > 0,
            rounds: loop.rounds.map((round) => ({
              id: round.id,
              kind: round.kind,
              title: round.title,
              interviewer: round.interviewer,
              perspective: round.perspective,
              scheduledAt: round.scheduledAt ? round.scheduledAt.toISOString() : null,
              durationMinutes: round.durationMinutes,
              status: round.status,
              notes: round.notes,
              prep: round.prep,
              sessions: round.sessions.map((session) => ({ ...session, createdAt: session.createdAt.toISOString() })),
            })),
          }}
          jobs={jobs}
          aiReady={aiReady}
        />
      </Screen>
    </>
  );
}
