import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { DIFFICULTY_LABELS, FOCUS_LABELS } from "@/lib/career/interview-data";
import { interviewJobKey, loadInterviewSession } from "@/lib/career/interviews";
import { openJob } from "@/lib/career/shared-data";

import { SessionRunner } from "./session-runner";

export const metadata: Metadata = { title: "Practice session" };

export default async function InterviewSessionPage({ params }: PageProps<"/interviews/[id]">) {
  const { id } = await params;
  const session = await loadInterviewSession(id);
  if (!session) notFound();
  const jobId = await openJob(interviewJobKey(id));

  return (
    <>
      <PageHeader
        title={session.title || "Practice session"}
        before={
          <Link href={session.round ? `/loops/${session.round.loopId}` : "/interviews"} className="text-sm text-muted hover:text-ink">
            ← {session.round ? "Interview loop" : "Practice"}
          </Link>
        }
        description={[FOCUS_LABELS[session.focus], `${DIFFICULTY_LABELS[session.difficulty]} interviewer`, `${session.questionTarget} main questions`, session.round ? `Round: ${session.round.title || "practice"}` : null]
          .filter(Boolean)
          .join(" · ")}
      />
      <SessionRunner
        session={{
          id: session.id,
          status: session.status,
          questionTarget: session.questionTarget,
          interviewer: session.interviewer,
          plan: session.plan,
          report: session.report,
          applicationId: session.application?.id ?? null,
          role: session.role,
          jobDescription: session.jobDescription,
          turns: session.turns.map((turn) => ({
            id: turn.id,
            index: turn.index,
            kind: turn.kind,
            competency: turn.competency,
            question: turn.question,
            answer: turn.answer,
            answered: turn.answeredAt !== null,
            feedback: turn.feedback,
          })),
        }}
        jobId={jobId}
      />
    </>
  );
}
