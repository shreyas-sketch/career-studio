"use client";

import { ArrowDown, ArrowUp, ChevronDown, MessagesSquare, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { JobProgress } from "@/components/career/job-progress";
import { Points, ScorePips } from "@/components/career/parts";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ROUND_KIND_LABELS, type RoundPrep } from "@/lib/career/interview-data";
import { cn } from "@/lib/cn";

import { addRound, deleteLoop, moveRound, practiseRound, prepareRound, removeRound, updateLoop, updateRound } from "../actions";

type Kind = keyof typeof ROUND_KIND_LABELS;
type RoundData = {
  id: string;
  kind: Kind;
  title: string;
  interviewer: string;
  perspective: string;
  scheduledAt: string | null;
  durationMinutes: number | null;
  status: "UPCOMING" | "DONE" | "CANCELLED";
  notes: string;
  prep: RoundPrep | null;
  sessions: { id: string; status: string; createdAt: string; average: number | null; weaknesses: string[] }[];
};
type LoopData = { id: string; status: "ACTIVE" | "OFFER" | "CLOSED"; notes: string; hasJobDescription: boolean; rounds: RoundData[] };

/** A local datetime-input value from an ISO date, in the browser's zone. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function LoopView({ loop, jobs, aiReady }: { loop: LoopData; jobs: Record<string, string | null>; aiReady: boolean }) {
  const router = useRouter();
  const [newKind, setNewKind] = useState<Kind>("TECHNICAL");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const firstUpcoming = loop.rounds.find((round) => round.status === "UPCOMING")?.id;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex flex-col gap-4">
        {!loop.hasJobDescription && (
          <p className="rounded-card border border-line-card bg-card px-4 py-3 text-sm text-muted">
            This loop has no job description, so prep works from the role title alone. Add the posting under Loop notes for sharper prep.
          </p>
        )}
        <ol className="flex flex-col gap-4">
          {loop.rounds.map((round, index) => (
            <Round key={round.id} round={round} index={index} count={loop.rounds.length} jobId={jobs[round.id] ?? null} aiReady={aiReady} startOpen={round.id === firstUpcoming} />
          ))}
        </ol>
        <div className="flex flex-wrap items-end gap-3 rounded-card border border-dashed border-line-strong p-4">
          <Select label="Add a round" value={newKind} onChange={(event) => setNewKind(event.target.value as Kind)} className="min-w-52">
            {(Object.keys(ROUND_KIND_LABELS) as Kind[]).map((kind) => (
              <option key={kind} value={kind}>
                {ROUND_KIND_LABELS[kind]}
              </option>
            ))}
          </Select>
          <Button variant="secondary" disabled={pending} onClick={() => start(async () => void toastResult(await addRound({ loopId: loop.id, kind: newKind })))}>
            <Plus size={14} aria-hidden="true" /> Add round
          </Button>
        </div>
      </div>

      <aside className="flex flex-col gap-4">
        <Card className="flex flex-col gap-4">
          <SegmentedControl
            size="sm"
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "OFFER", label: "Offer" },
              { value: "CLOSED", label: "Closed" },
            ]}
            value={loop.status}
            onValueChange={(status) => start(async () => void toastResult(await updateLoop({ id: loop.id, status })))}
          />
          <AutosaveTextarea label="Loop notes" initial={loop.notes} rows={6} hint="Recruiter details, logistics, the job posting, anything worth keeping." save={(notes) => updateLoop({ id: loop.id, notes })} />
        </Card>
        <Button variant="text" size="sm" className="self-start text-danger!" onClick={() => setConfirmDelete(true)}>
          <Trash2 size={14} aria-hidden="true" /> Delete this loop
        </Button>
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this loop?"
          description="Its rounds, prep and notes go. Practice sessions you ran stay under Practice."
          confirmLabel="Delete loop"
          onConfirm={() =>
            start(async () => {
              if (toastResult(await deleteLoop({ id: loop.id })).ok) router.push("/loops");
            })
          }
        />
      </aside>
    </div>
  );
}

function Round({ round, index, count, jobId: initialJob, aiReady, startOpen }: { round: RoundData; index: number; count: number; jobId: string | null; aiReady: boolean; startOpen: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen || Boolean(initialJob));
  const [jobId, setJobId] = useState(initialJob);
  const [pending, start] = useTransition();
  const [difficulty, setDifficulty] = useState<"WARMUP" | "STANDARD" | "TOUGH">("STANDARD");
  const save = (changes: Omit<Parameters<typeof updateRound>[0], "id">) => updateRound({ id: round.id, ...changes });
  const title = round.title || ROUND_KIND_LABELS[round.kind];
  const latest = round.sessions[0];

  return (
    <li id={`round-${round.id}`} className="scroll-mt-32">
      <Card padding="none" className={cn("overflow-hidden", round.status === "CANCELLED" && "opacity-60")}>
        <div className="flex items-center gap-3 px-5 py-4">
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold tabular-nums", round.status === "DONE" ? "bg-accent text-on-primary" : "bg-accent-soft text-accent-text")}>
            {index + 1}
          </span>
          <button type="button" className="flex min-w-0 flex-1 flex-col text-left" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            <span className="truncate font-medium">{title}</span>
            <span className="truncate text-meta text-muted">
              {[round.scheduledAt ? new Date(round.scheduledAt).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "No date yet", round.interviewer, round.status === "DONE" ? "Done" : round.status === "CANCELLED" ? "Cancelled" : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </button>
          {latest?.average !== null && latest?.average !== undefined && <ScorePips score={latest.average} />}
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Move up" disabled={index === 0 || pending} onClick={() => start(async () => void toastResult(await moveRound({ id: round.id, direction: "up" })))} className="grid size-7 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink disabled:opacity-30">
              <ArrowUp size={14} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Move down" disabled={index === count - 1 || pending} onClick={() => start(async () => void toastResult(await moveRound({ id: round.id, direction: "down" })))} className="grid size-7 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink disabled:opacity-30">
              <ArrowDown size={14} aria-hidden="true" />
            </button>
            <button type="button" aria-label={open ? "Collapse" : "Expand"} onClick={() => setOpen((value) => !value)} className="grid size-7 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink">
              <ChevronDown size={16} aria-hidden="true" className={cn("motion-safe:transition-transform", open && "rotate-180")} />
            </button>
          </div>
        </div>

        {open && (
          <div className="flex flex-col gap-6 border-t border-line px-5 py-5 motion-safe:animate-rise-in">
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Kind" defaultValue={round.kind} onChange={(event) => void save({ kind: event.target.value as Kind }).then(toastResult).then(() => router.refresh())}>
                {(Object.keys(ROUND_KIND_LABELS) as Kind[]).map((kind) => (
                  <option key={kind} value={kind}>
                    {ROUND_KIND_LABELS[kind]}
                  </option>
                ))}
              </Select>
              <AutosaveInput label="Title" placeholder={ROUND_KIND_LABELS[round.kind]} initial={round.title} save={(value) => save({ title: value })} />
              <AutosaveInput label="Who's interviewing" placeholder="Priya, engineering manager" initial={round.interviewer} save={(value) => save({ interviewer: value })} />
              <AutosaveInput label="When" type="datetime-local" initial={toLocalInput(round.scheduledAt)} save={(value) => save({ scheduledAt: value ? new Date(value).toISOString() : null })} />
            </div>
            <AutosaveTextarea label="What they screen for" rows={2} initial={round.perspective} hint="Suggested from the kind of round; change it to what you know about them." save={(value) => save({ perspective: value })} />

            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-serif text-xl">Prep for this round</h3>
                <Button
                  size="sm"
                  variant={round.prep ? "secondary" : "primary"}
                  disabled={!aiReady || pending || Boolean(jobId)}
                  onClick={() =>
                    start(async () => {
                      const result = toastResult(await prepareRound({ id: round.id }));
                      if (result.ok) setJobId(result.data.jobId);
                    })
                  }
                >
                  <Sparkles size={14} aria-hidden="true" /> {round.prep ? "Prepare again" : "Prepare this round"}
                </Button>
              </div>
              <JobProgress jobId={jobId} idleLabel="Preparing…" onDone={() => setJobId(null)} compact />
              {round.prep ? <Prep prep={round.prep} /> : !jobId && <p className="text-sm text-muted">A plan for this interviewer: what they&apos;ll test, likely questions, which of your stories to have ready, questions to ask, and what earlier rounds changed.</p>}
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="font-serif text-xl">Practise it</h3>
              <div className="flex flex-wrap items-center gap-3">
                <SegmentedControl
                  size="sm"
                  options={[
                    { value: "WARMUP", label: "Warm-up" },
                    { value: "STANDARD", label: "Standard" },
                    { value: "TOUGH", label: "Tough" },
                  ]}
                  value={difficulty}
                  onValueChange={setDifficulty}
                />
                <Button
                  size="sm"
                  disabled={!aiReady || pending}
                  onClick={() =>
                    start(async () => {
                      const result = toastResult(await practiseRound({ id: round.id, focus: round.kind === "TECHNICAL" || round.kind === "SYSTEM_DESIGN" ? "TECHNICAL" : round.kind === "BEHAVIORAL" ? "BEHAVIORAL" : "MIXED", difficulty }));
                      if (result.ok) router.push(`/interviews/${result.data.id}`);
                    })
                  }
                >
                  <MessagesSquare size={14} aria-hidden="true" /> Mock this round
                </Button>
              </div>
              {round.sessions.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {round.sessions.map((session) => (
                    <li key={session.id}>
                      <Link href={`/interviews/${session.id}`} className="flex flex-wrap items-center gap-3 text-sm">
                        <span className="text-muted tabular-nums">{new Date(session.createdAt).toLocaleDateString()}</span>
                        {session.average !== null ? <ScorePips score={session.average} /> : <span className="text-muted">{session.status === "ACTIVE" ? "In progress" : "No answers"}</span>}
                        {session.weaknesses[0] && <span className="text-meta text-muted">Work on: {session.weaknesses[0]}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="font-serif text-xl">After the round</h3>
              <AutosaveTextarea label="How it went, and any feedback you got" rows={4} initial={round.notes} hint="The next round's prep reads this." save={(value) => save({ notes: value })} />
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl
                  size="sm"
                  options={[
                    { value: "UPCOMING", label: "Upcoming" },
                    { value: "DONE", label: "Done" },
                    { value: "CANCELLED", label: "Cancelled" },
                  ]}
                  value={round.status}
                  onValueChange={(status) => start(async () => { if (toastResult(await save({ status })).ok) router.refresh(); })}
                />
                <Button variant="text" size="sm" className="ml-auto text-danger!" onClick={() => start(async () => void toastResult(await removeRound({ id: round.id })))}>
                  Remove round
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>
    </li>
  );
}

function Prep({ prep }: { prep: RoundPrep }) {
  return (
    <div className="flex flex-col gap-5 rounded-control bg-surface p-4">
      {prep.carryForward.length > 0 && (
        <div className="rounded-control border-l-2 border-accent bg-card px-3 py-2">
          <Points title="From earlier rounds" items={prep.carryForward} tone="gap" />
        </div>
      )}
      {prep.focus.length > 0 && (
        <div className="flex flex-col gap-3">
          <h4 className="text-label font-semibold tracking-wide text-muted uppercase">What they&apos;ll look for</h4>
          <ul className="grid gap-3 sm:grid-cols-2">
            {prep.focus.map((item) => (
              <li key={item.area} className="flex flex-col gap-1 rounded-control bg-card p-3 text-sm">
                <span className="font-medium">{item.area}</span>
                <span className="text-meta text-muted">{item.why}</span>
                <span className="text-meta">{item.howToPrepare}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {prep.likelyQuestions.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-label font-semibold tracking-wide text-muted uppercase">Likely questions</h4>
          <ul className="flex flex-col gap-2">
            {prep.likelyQuestions.map((item) => (
              <li key={item.question} className="text-sm">
                <span className="font-medium">{item.question}</span> <span className="text-meta text-muted">{item.why}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Points title="Stories to have ready" items={prep.stories.map((story) => `${story.story}: ${story.useFor}`)} tone="good" />
        <Points title="Questions to ask them" items={prep.questionsToAsk} />
      </div>
      <Points title="Tips" items={prep.tips} />
    </div>
  );
}

/** A field that saves when it loses focus, if it changed. */
function AutosaveInput({ initial, save, ...props }: { initial: string; save: (value: string) => Promise<unknown>; label: string; placeholder?: string; type?: string }) {
  const [value, setValue] = useState(initial);
  const saved = useRef(initial);
  return (
    <Input
      {...props}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        if (value === saved.current) return;
        saved.current = value;
        void save(value).then((result) => toastResult(result as never));
      }}
    />
  );
}

function AutosaveTextarea({ initial, save, ...props }: { initial: string; save: (value: string) => Promise<unknown>; label: string; rows?: number; hint?: string }) {
  const [value, setValue] = useState(initial);
  const saved = useRef(initial);
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  useEffect(
    () => () => {
      // Leaving the page saves what's typed.
      if (latest.current !== saved.current) void save(latest.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return (
    <Textarea
      {...props}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        if (value === saved.current) return;
        saved.current = value;
        void save(value).then((result) => toastResult(result as never));
      }}
    />
  );
}
