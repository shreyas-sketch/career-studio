import type { ReactNode } from "react";

// The public review's own chrome: the Career Studio name and nothing that
// leads into the private app (no sidebar, no account menu, no other agents).

export function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <a href="#main" className="sr-only rounded-control bg-card px-3 py-2 focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50">
        Skip to content
      </a>
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-[1240px] items-center justify-between gap-4 px-8 py-4 max-sm:px-4">
          <a href="/fde-review" className="font-serif text-lg font-medium tracking-tight">
            Career Studio
          </a>
          <span className="text-sm text-muted">FDE Review</span>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-1 px-8 py-6 text-meta text-muted max-sm:px-4">
          <p className="text-pretty">A score describes evidence in a public profile against a sample of current openings. It isn&apos;t a hiring decision, and missing evidence isn&apos;t missing ability.</p>
        </div>
      </footer>
    </div>
  );
}

/** How a visitor's data is used, short enough to read before submitting. */
export function DataNotice({ retentionHours }: { retentionHours: number }) {
  const days = Math.round(retentionHours / 24);
  const kept = retentionHours % 24 === 0 ? `${days} ${days === 1 ? "day" : "days"}` : `${retentionHours} hours`;
  return (
    <details className="group text-sm">
      <summary className="cursor-pointer text-pretty text-muted underline underline-offset-2">How your profile data is used</summary>
      <ul className="mt-3 flex max-w-[560px] list-disc flex-col gap-1.5 pl-5 text-pretty text-muted">
        <li>We read what&apos;s publicly visible on the profile you give, through a LinkedIn data service. Private fields aren&apos;t available and aren&apos;t guessed.</li>
        <li>Its text is sent to an AI model (Claude) to compare with current job postings. It isn&apos;t used to train models.</li>
        <li>Your report is visible only in this browser. There&apos;s no public link and no gallery.</li>
        <li>It&apos;s deleted automatically after {kept}, or straight away with &ldquo;Delete my report&rdquo;.</li>
        <li>Only review your own profile.</li>
      </ul>
    </details>
  );
}
