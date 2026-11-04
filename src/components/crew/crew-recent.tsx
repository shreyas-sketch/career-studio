"use client";

import Link from "next/link";

import { CREW } from "@/lib/crew/crew";

import { useCrew } from "./crew-provider";

/** The latest results, for whoever missed the note: folded away, and only there when there are some. */
export function CrewRecent({ className }: { className?: string }) {
  const { recent } = useCrew();
  if (recent.length === 0) return null;
  return (
    <details className={className}>
      <summary className="cursor-pointer text-meta font-medium text-muted hover:text-ink">Recent results ({recent.length})</summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {recent.map(({ jobId, crew, what, about, href, error, at }) => (
          <li key={jobId} className="flex flex-wrap items-baseline gap-x-2 text-meta">
            <Link href={href} className="font-medium underline underline-offset-3">
              {error ? `Review: ${what}` : what}
              {about ? ` for ${about}` : ""}
            </Link>
            <span className="text-muted">
              {CREW[crew].name} · {new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
