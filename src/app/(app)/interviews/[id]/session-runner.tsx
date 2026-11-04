"use client";

import { ChevronDown, CornerDownLeft, Flag, Mic, MicOff, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";

import { JobProgress } from "@/components/career/job-progress";
import { Points, Screen, ScorePips } from "@/components/career/parts";
import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { AnswerFeedback, InterviewPlan, InterviewReport } from "@/lib/career/interview-data";
import { cn } from "@/lib/cn";

import { endInterview, submitAnswer } from "../actions";

type TurnView = {
  id: string;
  index: number;
  kind: string;
  competency: string;
  question: string;
  answer: string;
  answered: boolean;
  feedback: AnswerFeedback | null;
};

type SessionView = {
  id: string;
  status: "ACTIVE" | "COMPLETED";
  questionTarget: number;
  interviewer: string;
  plan: InterviewPlan | null;
  report: InterviewReport | null;
  applicationId: string | null;
  role: string;
  jobDescription: string;
  turns: TurnView[];
};

/** A practice session: the transcript with feedback, the answer box, and the report at the end. */
export function SessionRunner({ session, jobId: initialJobId }: { session: SessionView; jobId: string | null }) {
  const router = useRouter();
  const [jobId, setJobId] = useState(initialJobId);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, startEnd] = useTransition();
  const open = session.status === "ACTIVE" ? session.turns.find((turn) => !turn.answered) : undefined;
  const mainAsked = session.turns.filter((turn) => turn.kind === "question").length;
  const answeredCount = session.turns.filter((turn) => turn.answered).length;
  const bottom = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const wasActive = useRef(session.status === "ACTIVE");

  // A new question or feedback arrives at the bottom: bring it into view.
  // When the interview has just finished, the report at the top is what to see.
  const lastId = session.turns.at(-1)?.id;
  useEffect(() => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    if (session.status === "COMPLETED") {
      if (wasActive.current) reportRef.current?.scrollIntoView({ behavior, block: "start" });
      wasActive.current = false;
      return;
    }
    if (lastId) bottom.current?.scrollIntoView({ behavior, block: "end" });
  }, [lastId, session.status]);

  return (
    <Screen>
      {session.report && (
        <div ref={reportRef} className="scroll-mt-32">
          <Report report={session.report} sessionId={session.id} applicationId={session.applicationId} role={session.role} />
        </div>
      )}

      {session.status === "ACTIVE" && session.turns.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-sm text-muted">
            <span className="font-medium text-ink">
              Question {Math.min(mainAsked, session.questionTarget)} of {session.questionTarget}
            </span>
            <span aria-hidden="true" className="flex gap-1">
              {Array.from({ length: session.questionTarget }, (_, index) => (
                <span key={index} className={cn("h-1.5 w-6 rounded-full", index < mainAsked - (open ? 1 : 0) ? "bg-accent" : index < mainAsked ? "bg-accent/40" : "bg-track")} />
              ))}
            </span>
          </div>
          {answeredCount > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setConfirmEnd(true)} disabled={ending || Boolean(jobId && !open)}>
              <Flag size={14} aria-hidden="true" /> End and get my report
            </Button>
          )}
        </div>
      )}

      {session.interviewer && (
        <p className="rounded-card border border-line-card bg-card px-4 py-3 text-sm text-muted">
          <span className="font-medium text-ink">Your interviewer: </span>
          {session.interviewer}
        </p>
      )}

      <ol className="flex flex-col gap-6" aria-label="The interview so far">
        {session.turns.map((turn) => (
          <li key={turn.id} className="flex flex-col gap-3 motion-safe:animate-rise-in">
            <Bubble who="interviewer" meta={`${turn.kind === "follow-up" ? "Follow-up" : "Question"}${turn.competency ? ` · ${turn.competency}` : ""}`}>
              {turn.question}
            </Bubble>
            {turn.answered && (
              <Bubble who="you">{turn.answer.trim() ? turn.answer : <span className="text-muted italic">Skipped</span>}</Bubble>
            )}
            {turn.feedback && <Feedback feedback={turn.feedback} />}
          </li>
        ))}
      </ol>

      <JobProgress jobId={jobId} idleLabel="The interviewer is thinking…" onDone={() => setJobId(null)} />

      {open && !jobId && <AnswerBox key={open.id} sessionId={session.id} turnId={open.id} onSent={setJobId} />}

      {session.turns.length === 0 && !jobId && session.status === "ACTIVE" && (
        <p className="text-sm text-muted">Getting the interview ready… If nothing appears, reload the page.</p>
      )}
      <div ref={bottom} />

      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title="End the interview now?"
        description="You'll get a report on the answers you've given so far. Any open question is dropped."
        confirmLabel="End and report"
        onConfirm={() =>
          startEnd(async () => {
            const result = toastResult(await endInterview({ sessionId: session.id }));
            if (result.ok) {
              setJobId(result.data.jobId);
              router.refresh();
            }
          })
        }
      />
    </Screen>
  );
}

function Bubble({ who, meta, children }: { who: "interviewer" | "you"; meta?: string; children: React.ReactNode }) {
  const mine = who === "you";
  return (
    <div className={cn("flex gap-3", mine && "flex-row-reverse")}>
      <span aria-hidden="true" className={cn("grid size-8 shrink-0 place-items-center rounded-full", mine ? "bg-primary text-on-primary" : "bg-accent-soft text-accent-text")}>
        {mine ? <UserRound size={15} /> : <Sparkles size={15} />}
      </span>
      <div className={cn("flex max-w-[640px] flex-col gap-1", mine && "items-end")}>
        <span className="text-meta text-muted">{mine ? "You" : meta || "Interviewer"}</span>
        <div
          className={cn(
            "rounded-[14px] px-4 py-3 text-field leading-relaxed whitespace-pre-wrap text-pretty",
            mine ? "rounded-tr-[4px] bg-primary text-on-primary" : "rounded-tl-[4px] border border-line-card bg-card",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function Feedback({ feedback }: { feedback: AnswerFeedback }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ml-11 flex max-w-[640px] flex-col gap-3 rounded-card border border-line-card bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ScorePips score={feedback.score} />
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="inline-flex items-center gap-1 text-meta font-medium text-muted hover:text-ink">
          {open ? "Less" : "Strengths, gaps and a stronger answer"}
          <ChevronDown size={14} aria-hidden="true" className={cn("motion-safe:transition-transform", open && "rotate-180")} />
        </button>
      </div>
      <p className="text-sm text-pretty">{feedback.summary}</p>
      {open && (
        <div className="flex flex-col gap-4 motion-safe:animate-rise-in">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
            <Points title="What worked" items={feedback.strengths} tone="good" />
            <Points title="What was missing" items={feedback.gaps} tone="gap" />
          </div>
          {feedback.strongerAnswer && (
            <div className="flex flex-col gap-2">
              <h3 className="text-label font-semibold tracking-wide text-muted uppercase">A stronger answer, from your own experience</h3>
              <p className="rounded-control border-l-2 border-accent bg-card px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-pretty">{feedback.strongerAnswer}</p>
            </div>
          )}
          {feedback.missingFacts.length > 0 && (
            <div className="flex flex-col gap-1.5 text-sm">
              <Points title="Facts your profile doesn't have yet" items={feedback.missingFacts} />
              <Link href="/profile#facts" className="text-meta font-medium underline underline-offset-3">
                Add them to your profile
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const noSubscription = () => () => {};

type Recognition = { start(): void; stop(): void; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; continuous: boolean; interimResults: boolean; lang: string };

function AnswerBox({ sessionId, turnId, onSent }: { sessionId: string; turnId: string; onSent: (jobId: string) => void }) {
  const [answer, setAnswer] = useState("");
  const [pending, start] = useTransition();
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  // Dictation only where the browser offers speech recognition (Chrome, Edge, Safari).
  const canDictate = useSyncExternalStore(
    noSubscription,
    () => "SpeechRecognition" in window || "webkitSpeechRecognition" in window,
    () => false,
  );
  useEffect(() => {
    area.current?.focus({ preventScroll: true });
    return () => recognition.current?.stop();
  }, []);
  const words = answer.trim() ? answer.trim().split(/\s+/).length : 0;

  function send(text: string) {
    recognition.current?.stop();
    start(async () => {
      const result = toastResult(await submitAnswer({ sessionId, turnId, answer: text }));
      if (result.ok) onSent(result.data.jobId);
    });
  }

  function toggleDictation() {
    if (listening) return recognition.current?.stop();
    const Speech = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
    if (!Speech) return;
    const rec = new Speech();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = document.documentElement.lang || "en-US";
    const before = answer.trim();
    let heard = "";
    rec.onresult = (event) => {
      heard = Array.from(event.results)
        .filter((result) => result.isFinal)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ");
      setAnswer([before, heard].filter(Boolean).join(" "));
    };
    rec.onend = () => setListening(false);
    recognition.current = rec;
    rec.start();
    setListening(true);
  }

  return (
    <form
      className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-panel border border-line-card bg-card p-3 shadow-dialog"
      onSubmit={(event) => {
        event.preventDefault();
        if (answer.trim()) send(answer);
      }}
    >
      <label htmlFor="answer" className="sr-only">
        Your answer
      </label>
      <textarea
        ref={area}
        id="answer"
        rows={5}
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && answer.trim()) {
            event.preventDefault();
            send(answer);
          }
        }}
        placeholder="Answer as you would out loud. Specific examples, your own part in them, and the result."
        className="w-full resize-y rounded-control bg-input px-3 py-2.5 text-field leading-relaxed outline-none placeholder:text-muted"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-meta text-muted tabular-nums">
          {words} {words === 1 ? "word" : "words"}
          {words > 0 && words < 40 && " · a little short for a full answer"}
        </span>
        <div className="flex items-center gap-2">
          {canDictate && (
            <Button type="button" variant="secondary" size="sm" onClick={toggleDictation} aria-pressed={listening}>
              {listening ? <MicOff size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
              {listening ? "Stop dictating" : "Dictate"}
            </Button>
          )}
          <button type="button" className={buttonClassName("text", "sm")} disabled={pending} onClick={() => send("")}>
            Skip
          </button>
          <Button type="submit" size="sm" disabled={pending || !answer.trim()}>
            {pending ? "Sending…" : "Answer"}
            <CornerDownLeft size={14} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </form>
  );
}

function Report({ report, sessionId, applicationId, role }: { report: InterviewReport; sessionId: string; applicationId: string | null; role: string }) {
  const params = new URLSearchParams({ skill: report.recurringWeaknesses[0] ?? "", role, ...(applicationId ? { application: applicationId } : {}), from: sessionId });
  return (
    <Card className="flex flex-col gap-6 border-accent/40 motion-safe:animate-rise-in">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-label font-semibold tracking-wide text-accent-text uppercase">Your report</span>
          <p className="max-w-[560px] text-lead text-pretty">{report.readiness}</p>
        </div>
        <div className="flex flex-col items-end">
          <span className="font-serif text-[44px] leading-none font-semibold tabular-nums">{report.overall.toFixed(1)}</span>
          <span className="text-meta text-muted">average of 5</span>
        </div>
      </div>
      {report.competencies.length > 0 && (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
          {report.competencies.map((item) => (
            <li key={item.competency} className="flex flex-col gap-1.5 rounded-control bg-surface p-3">
              <span className="flex items-center justify-between gap-2 text-sm font-medium">
                {item.competency}
                <ScorePips score={item.score} />
              </span>
              {item.note && <span className="text-meta text-pretty text-muted">{item.note}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-3">
        <Points title="Strengths" items={report.strengths} tone="good" />
        <Points title="Came up more than once" items={report.recurringWeaknesses} tone="gap" />
        <Points title="Practise next" items={report.practiceNext} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`/interviews${applicationId ? `?application=${applicationId}` : ""}`} className={buttonClassName("primary", "sm")}>
          Practise again
        </Link>
        {report.recurringWeaknesses.length > 0 && (
          <Link href={`/skills?${params}`} className={buttonClassName("secondary", "sm")}>
            Make a plan to close the gap
          </Link>
        )}
        {applicationId && (
          <Link href={`/applications/${applicationId}`} className={buttonClassName("secondary", "sm")}>
            Back to the application
          </Link>
        )}
      </div>
    </Card>
  );
}
