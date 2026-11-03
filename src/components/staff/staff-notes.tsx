"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { STAFF } from "@/lib/staff/staff";

import { RobotHead } from "./robot";
import { useStaff } from "./staff-provider";

const STAYS_MS = 9000;

/**
 * Finished work, reported: a short note from whoever did it, wherever the user
 * is, linked to the result. Only real results come this way, and the page
 * behind it refreshes, so the result is there too.
 */
export function StaffNotes() {
  const { reports, dismiss } = useStaff();
  const router = useRouter();
  const pathname = usePathname();
  const timed = useRef(new Set<string>());
  const newest = reports.at(-1)?.jobId;

  useEffect(() => {
    if (newest) router.refresh();
  }, [newest, router]);

  // Each note's own time, from when it arrived, whatever else arrives meanwhile.
  useEffect(() => {
    for (const { jobId } of reports) {
      if (timed.current.has(jobId)) continue;
      timed.current.add(jobId);
      setTimeout(() => dismiss(jobId), STAYS_MS);
    }
  }, [reports, dismiss]);

  // Someone already looking at the result doesn't need a note about it.
  const notes = reports.filter(({ href }) => pathname !== href && !pathname?.startsWith(`${href}/`)).slice(-3);

  return (
    <ul aria-live="polite" className="pointer-events-none fixed right-5 bottom-5 z-40 flex w-[320px] max-w-[calc(100vw-40px)] flex-col gap-2">
      {notes.map(({ jobId, staff, what, about, href, error }) => (
        <li key={jobId} className="pointer-events-auto rounded-toast border border-line-card bg-card px-4 py-3 shadow-toast motion-safe:animate-rise-in">
          <p className="flex items-center gap-2 font-display text-[14px] font-semibold">
            <RobotHead id={staff} mood={error ? "stuck" : "done"} className="w-8" />
            {STAFF[staff].title}
          </p>
          <p className="text-meta text-pretty text-muted">
            {error ?? what}
            {!error && about ? ` for ${about}` : ""}
          </p>
          <div className="mt-1.5 flex items-center gap-3 text-meta">
            <Link href={href} onClick={() => dismiss(jobId)} className="font-medium underline underline-offset-3">
              {error ? "Review" : "Open"}
            </Link>
            <button type="button" onClick={() => dismiss(jobId)} className="text-muted hover:text-ink">
              Dismiss
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
