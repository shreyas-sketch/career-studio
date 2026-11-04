"use client";

import type { ReactNode } from "react";

import { useCrew } from "@/components/crew/crew-provider";
import { CrewRecent } from "@/components/crew/crew-recent";
import { KineticMobile } from "@/components/crew/kinetic-mobile";
import { crewSummary } from "@/lib/crew/crew";

/**
 * The top of Today: the crew hanging on the wall, and under the shorter end
 * of the mobile, the greeting and one sentence on what's actually happening.
 */
export function CrewHero({ title, standing, action }: { title: ReactNode; standing: string; action: ReactNode }) {
  const { members } = useCrew();
  return (
    // pt-2: the shell's 8px above the panel, as above the page bar on other screens.
    <div className="-mx-px bg-paper pt-2">
      <div className="@container/hero relative overflow-hidden rounded-t-panel border border-b-0 border-line-card bg-surface">
        <KineticMobile>
          <div className="flex flex-col items-start gap-3 px-10 pt-6 pb-8 max-sm:px-4 @min-[980px]/hero:absolute @min-[980px]/hero:bottom-8 @min-[980px]/hero:left-0 @min-[980px]/hero:max-w-[47cqw] @min-[980px]/hero:p-0 @min-[980px]/hero:pl-10">
            <h1 className="font-serif text-[clamp(38px,4.4cqw,58px)] leading-[1.02] font-medium tracking-[-0.025em] text-pretty">{title}</h1>
            <p className="max-w-[520px] text-lead text-pretty">
              {crewSummary(members)} <span className="text-muted">{standing}</span>
            </p>
            <div className="pt-1">{action}</div>
          </div>
        </KineticMobile>
        <CrewRecent className="px-10 pb-5 max-sm:px-4" />
      </div>
    </div>
  );
}
