"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { CREW } from "@/lib/crew/crew";

import { useCrew } from "./crew-provider";
import { CrewGlyph } from "./shapes";

const STAYS_MS = 9000;

/**
 * Finished work, handed over: a slip of paper falls in from the member who
 * did it and settles in the corner, wherever the user is. Only real results
 * come this way. The page behind it refreshes, so the result is there too.
 */
export function CrewHandovers() {
  const { handovers, dismiss } = useCrew();
  const router = useRouter();
  const pathname = usePathname();
  const timed = useRef(new Set<string>());
  const newest = handovers.at(-1)?.jobId;

  useEffect(() => {
    if (newest) router.refresh();
  }, [newest, router]);

  // Each slip's own time, from when it landed, whatever else arrives meanwhile.
  useEffect(() => {
    for (const { jobId } of handovers) {
      if (timed.current.has(jobId)) continue;
      timed.current.add(jobId);
      setTimeout(() => dismiss(jobId), STAYS_MS);
    }
  }, [handovers, dismiss]);

  // Someone already looking at the result doesn't need it brought to them.
  const slips = handovers.filter(({ href }) => pathname !== href && !pathname?.startsWith(`${href}/`)).slice(-3);

  return (
    <ul aria-live="polite" className="pointer-events-none fixed right-5 bottom-5 z-40 flex w-[300px] max-w-[calc(100vw-40px)] flex-col gap-2">
      {slips.map(({ jobId, crew, what, about, href, error }, index) => (
        <li
          key={jobId}
          className="pointer-events-auto relative rounded-toast border border-line-card bg-card px-4 pt-3.5 pb-3 shadow-toast motion-safe:animate-slip-fall"
          style={{ rotate: index % 2 ? "0.7deg" : "-0.8deg" }}
        >
          <span className="absolute -top-3.5 right-3">
            <CrewGlyph id={crew} size={30} status={error ? "stuck" : undefined} eye />
          </span>
          <p className="font-serif text-[15px] font-medium">{CREW[crew].name}</p>
          <p className="pr-8 text-meta text-pretty text-muted">
            {error ?? what}
            {!error && about ? ` for ${about}` : ""}
          </p>
          <div className="mt-1.5 flex items-center gap-3 text-meta">
            <Link href={href} onClick={() => dismiss(jobId)} className="font-medium underline underline-offset-3">
              {error ? "Take a look" : "Open it"}
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
