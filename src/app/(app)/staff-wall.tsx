import type { ReactNode } from "react";

import { StaffFloor } from "@/components/staff/staff-floor";

/** The top of Today: the greeting, where the search stands, and the staff. */
export function StaffWall({ title, standing, action }: { title: ReactNode; standing: string; action: ReactNode }) {
  return (
    // pt-2: the shell's 8px above the panel, as above the page bar on other screens.
    <div className="-mx-px bg-paper pt-2">
      <div className="signal-wall @container/wall overflow-hidden rounded-t-panel border border-b-0 border-line-card bg-surface text-ink">
        <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-4 px-10 pt-9 pb-7 max-sm:px-4 max-sm:pt-7">
          <div className="flex flex-col gap-1.5">
            <h1 className="font-display text-[clamp(30px,3.3cqw,40px)] leading-[1.1] font-medium tracking-[-0.026em] text-pretty">{title}</h1>
            <p className="text-lead text-pretty text-muted">{standing}</p>
          </div>
          {action}
        </div>
        {/* A rule between the two, so the row reads as a section and not as something floating. */}
        <div className="mx-10 border-t border-line-card max-sm:mx-4" />
        <StaffFloor className="px-10 pt-6 pb-5 max-sm:px-4" />
      </div>
    </div>
  );
}
