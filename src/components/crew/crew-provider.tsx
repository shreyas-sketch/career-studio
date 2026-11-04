"use client";

import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { restingCrew, type CrewHandover, type CrewId, type CrewMemberState, type CrewSnapshot } from "@/lib/crew/crew";

const POLL_BUSY_MS = 1800;
const POLL_IDLE_MS = 12_000;
const POKE = "crew:poke";

type CrewContextValue = {
  members: Record<CrewId, CrewMemberState>;
  /** Work that finished since this page opened and is worth handing over, oldest first. */
  handovers: CrewHandover[];
  dismiss: (jobId: string) => void;
  /** Whether this is a real, followed crew: false outside the app shell. */
  live: boolean;
};

const fallback: CrewContextValue = { members: restingCrew(), handovers: [], dismiss: () => {}, live: false };
const CrewContext = createContext<CrewContextValue>(fallback);

export const useCrew = () => use(CrewContext);

/** Tells the crew to look again now, e.g. when a job has just started. */
export const pokeCrew = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(POKE));
};

const isBusy = (members: Record<string, { status: string }>) => Object.values(members).some(({ status }) => status === "working" || status === "queued");

/**
 * Follows the account's real jobs for the whole shell. It asks often while
 * something's running, rarely while nothing is, and not at all in a hidden tab.
 */
export function CrewProvider({ initial, children }: { initial?: CrewSnapshot; children: ReactNode }) {
  const [members, setMembers] = useState(initial?.members ?? fallback.members);
  const [handovers, setHandovers] = useState<CrewHandover[]>([]);
  // Whatever had already ended when the page opened isn't news.
  const seen = useRef(new Set(initial?.finished.map(({ jobId }) => jobId) ?? []));
  const startsEmpty = useRef(!initial);
  const schedule = useRef<(busy: boolean) => void>(() => {});

  // A Server Action or a refresh renders the shell again, with what the server
  // knows now. That's news too, and it must not disturb the polling below.
  const [shown, setShown] = useState(initial);
  if (initial && initial !== shown) {
    setShown(initial);
    setMembers(initial.members);
  }

  const busy = isBusy(members);

  // Runs once, for as long as the shell is there, however often it's rendered.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let asked = 0;
    let wasBusy = false;

    const next = (nowBusy: boolean) => {
      wasBusy = nowBusy;
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(look, nowBusy ? POLL_BUSY_MS : POLL_IDLE_MS);
    };

    const look = async () => {
      clearTimeout(timer);
      if (stopped || document.hidden) return;
      const ask = ++asked;
      let nowBusy = wasBusy;
      try {
        const response = await fetch("/api/crew", { cache: "no-store" });
        // A later look is on its way: its answer is the one to use.
        if (stopped || ask !== asked) return;
        if (response.ok) {
          const fresh = (await response.json()) as CrewSnapshot;
          if (stopped || ask !== asked) return;
          setMembers(fresh.members);
          nowBusy = isBusy(fresh.members);
          const ended = fresh.finished.filter(({ jobId }) => !seen.current.has(jobId));
          for (const { jobId } of ended) seen.current.add(jobId);
          const news = ended.filter(({ handsOver }) => handsOver).reverse();
          if (news.length > 0) setHandovers((current) => [...current, ...news]);
        }
      } catch {
        // Offline for a moment: look again later.
      }
      if (ask === asked) next(nowBusy);
    };

    schedule.current = next;
    const onVisible = () => {
      if (!document.hidden) void look();
    };
    const onPoke = () => void look();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(POKE, onPoke);
    if (startsEmpty.current) void look();
    return () => {
      stopped = true;
      schedule.current = () => {};
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(POKE, onPoke);
    };
  }, []);

  // Someone's started or stopped working: ask at the pace that suits, from now.
  useEffect(() => {
    schedule.current(busy);
  }, [busy]);

  const dismiss = useCallback((jobId: string) => setHandovers((current) => current.filter((item) => item.jobId !== jobId)), []);
  const value = useMemo<CrewContextValue>(() => ({ members, handovers, dismiss, live: true }), [members, handovers, dismiss]);
  return <CrewContext value={value}>{children}</CrewContext>;
}
