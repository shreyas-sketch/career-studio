"use client";

import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { idleStaff, type StaffId, type StaffMemberState, type StaffReport, type StaffSnapshot } from "@/lib/staff/staff";

const POLL_BUSY_MS = 1800;
const POLL_IDLE_MS = 12_000;
const POKE = "staff:poke";

type StaffContextValue = {
  members: Record<StaffId, StaffMemberState>;
  /** Work that ended since this page opened and is worth a note, oldest first. */
  reports: StaffReport[];
  dismiss: (jobId: string) => void;
};

const StaffContext = createContext<StaffContextValue>({ members: idleStaff(), reports: [], dismiss: () => {} });

export const useStaff = () => use(StaffContext);

/** Tells the staff to look again now, e.g. when a job has just started. */
export const pokeStaff = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(POKE));
};

/**
 * Follows the account's real jobs for the whole shell. It asks often while
 * something's running, rarely while nothing is, and not at all in a hidden tab.
 */
export function StaffProvider({ initial, children }: { initial?: StaffSnapshot; children: ReactNode }) {
  const [members, setMembers] = useState(initial?.members ?? idleStaff);
  const [reports, setReports] = useState<StaffReport[]>([]);
  // Whatever had already ended when the page opened isn't news.
  const seen = useRef(new Set(initial?.finished.map(({ jobId }) => jobId) ?? []));

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const look = async () => {
      clearTimeout(timer);
      if (stopped || document.hidden) return;
      let busy = false;
      try {
        const response = await fetch("/api/staff", { cache: "no-store" });
        if (response.ok) {
          const next = (await response.json()) as StaffSnapshot;
          if (stopped) return;
          setMembers(next.members);
          busy = Object.values(next.members).some(({ status }) => status === "working" || status === "queued");
          const fresh = next.finished.filter(({ jobId }) => !seen.current.has(jobId));
          for (const { jobId } of fresh) seen.current.add(jobId);
          const news = fresh.filter((report) => report.reports).reverse();
          if (news.length > 0) setReports((current) => [...current, ...news]);
        }
      } catch {
        // Offline for a moment: look again later.
      }
      if (!stopped) timer = setTimeout(look, busy ? POLL_BUSY_MS : POLL_IDLE_MS);
    };

    const onVisible = () => {
      if (!document.hidden) void look();
    };
    const onPoke = () => void look();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(POKE, onPoke);
    timer = setTimeout(look, initial ? POLL_IDLE_MS : 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(POKE, onPoke);
    };
  }, [initial]);

  const dismiss = useCallback((jobId: string) => setReports((current) => current.filter((item) => item.jobId !== jobId)), []);
  const value = useMemo(() => ({ members, reports, dismiss }), [members, reports, dismiss]);
  return <StaffContext value={value}>{children}</StaffContext>;
}
