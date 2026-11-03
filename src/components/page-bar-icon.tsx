"use client";

import { usePathname } from "next/navigation";

import { crewOfPath } from "@/lib/crew/crew";
import { currentSection } from "@/lib/nav";

import { CrewPendant } from "./crew/crew-pendant";

/**
 * At the start of the page bar: the crew member whose screen this is, hanging
 * from the top of the panel, or the section's own icon on the user's own screens.
 */
export function PageBarIcon() {
  // No path outside a router (e.g. in a test): then there's no section to show.
  const pathname = usePathname();
  if (!pathname) return null;
  const crew = crewOfPath(pathname);
  if (crew) return <CrewPendant id={crew} />;
  const Icon = currentSection(pathname)?.icon;
  return Icon ? <Icon size={26} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-muted" /> : null;
}
