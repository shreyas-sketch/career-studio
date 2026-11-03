"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { describeStep, describeWork, moodOf, STAFF, STAFF_IDS, type StaffId, type StaffMemberState, type StaffMood } from "@/lib/staff/staff";

import { Robot } from "./robot";
import { useStaff } from "./staff-provider";

/** How long a robot looks pleased when a job ends. */
const DONE_MS = 4500;

const ago = (iso: string, now: number) => {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
};

/** A member's present state, in words. */
function statusOf(member: StaffMemberState, now: number | null): string {
  if (member.status === "working") return describeStep(member);
  if (member.status === "queued") return `About to start${member.about ? ` for ${member.about}` : ""}`;
  if (member.status === "stuck") return `Stopped: ${member.error ?? "this needs another try"}`;
  if (member.last && now !== null) return `${member.last.what}${member.last.about ? ` for ${member.last.about}` : ""}, ${ago(member.last.at, now)}`;
  return STAFF[member.id].remit;
}

function Tile({ member, mood, now }: { member: StaffMemberState; mood: StaffMood; now: number | null }) {
  const [attentive, setAttentive] = useState(false);
  const engaged = mood !== "idle";
  const status = statusOf(member, now);

  return (
    <li className="min-w-0">
      <Link
        href={STAFF[member.id].href}
        data-status={member.status}
        title={engaged ? undefined : status}
        onPointerEnter={() => setAttentive(true)}
        onPointerLeave={() => setAttentive(false)}
        onFocus={() => setAttentive(true)}
        onBlur={() => setAttentive(false)}
        // A row with the robot at its side on a phone; a column with the robot above it from there up.
        className="group flex items-center gap-3 text-ink hover:text-ink @min-[560px]/floor:flex-col @min-[560px]/floor:gap-2 @min-[560px]/floor:text-center"
      >
        <Robot
          id={member.id}
          mood={mood}
          attentive={attentive}
          watching
          beat={member.step}
          className={cn(
            "w-16 shrink-0 motion-safe:transition-opacity motion-safe:duration-500 @min-[560px]/floor:w-full @min-[560px]/floor:max-w-[124px]",
            engaged ? "opacity-100" : "opacity-75 group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          {/* Room for two lines where a title might wrap, so the words under every robot start level. */}
          <span
            className={cn(
              "font-display text-[13.5px] leading-[1.25] motion-safe:transition-colors motion-safe:duration-500 @min-[560px]/floor:min-h-[2.4em] @min-[1020px]/floor:min-h-0 @min-[1020px]/floor:whitespace-nowrap",
              engaged ? "font-semibold text-ink" : "font-normal text-muted group-hover:text-ink group-focus-visible:text-ink",
            )}
          >
            {STAFF[member.id].title}
          </span>
          {engaged ? (
            <span className={cn("line-clamp-2 min-h-[2.6em] text-xs leading-[1.3] text-pretty motion-safe:animate-rise-in", member.status === "stuck" ? "text-signal-fault" : "text-muted")}>{status}</span>
          ) : (
            <>
              <span aria-hidden="true" className="hidden min-h-[2.6em] @min-[560px]/floor:block" />
              <span className="sr-only">{status}</span>
            </>
          )}
        </span>
      </Link>
    </li>
  );
}

/**
 * The staff, in a row that doesn't move. A robot with work brightens, takes up
 * its tool and says what it's doing in the job's own words; when the job ends
 * it looks pleased, then settles. The rest wait, dimmed, with what they did last
 * a hover away. Every robot keeps its size and its place, so a glance at the
 * same spot always answers the same question.
 */
export function StaffFloor({ className }: { className?: string }) {
  const { members } = useStaff();
  // The clock only runs in the browser, so the server's page and the first render agree.
  const [now, setNow] = useState<number | null>(null);
  const [justDone, setJustDone] = useState<ReadonlySet<StaffId>>(new Set());
  const wasBusy = useRef(new Set<StaffId>());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  // A job ending is an event worth marking; only a real ending gets this.
  useEffect(() => {
    const busy = STAFF_IDS.filter((id) => members[id].status === "working" || members[id].status === "queued");
    const finished = [...wasBusy.current].filter((id) => members[id].status === "idle");
    wasBusy.current = new Set(busy);
    if (finished.length === 0) return;
    const show = setTimeout(() => setJustDone((current) => new Set([...current, ...finished])), 0);
    const hide = setTimeout(() => setJustDone((current) => new Set([...current].filter((id) => !finished.includes(id)))), DONE_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [members]);

  const working = STAFF_IDS.map((id) => members[id]).filter(({ status }) => status === "working");

  return (
    <div className={cn("@container/floor", className)}>
      <ul className="grid grid-cols-1 gap-x-3 gap-y-2 @min-[560px]/floor:grid-cols-4 @min-[560px]/floor:gap-y-5 @min-[860px]/floor:grid-cols-7">
        {STAFF_IDS.map((id) => (
          <Tile key={id} member={members[id]} mood={justDone.has(id) && members[id].status === "idle" ? "done" : moodOf(members[id].status)} now={now} />
        ))}
      </ul>
      {/* Said once for people who can't see it move. */}
      <p role="status" aria-live="polite" className="sr-only">
        {working.map(describeWork).join(" ")}
      </p>
    </div>
  );
}
