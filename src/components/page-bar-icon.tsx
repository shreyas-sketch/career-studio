"use client";

import { usePathname } from "next/navigation";

import { currentSection } from "@/lib/nav";
import { moodOf, staffOfPath } from "@/lib/staff/staff";

import { RobotHead } from "./staff/robot";
import { useStaff } from "./staff/staff-provider";

/**
 * At the start of the page bar: the member of staff whose screen this is, in
 * the mood of their real work, or the section's own icon on the user's own screens.
 */
export function PageBarIcon() {
  // No path outside a router (e.g. in a test): then there's no section to show.
  const pathname = usePathname();
  const { members } = useStaff();
  if (!pathname) return null;
  const staff = staffOfPath(pathname);
  if (staff) return <RobotHead id={staff} mood={moodOf(members[staff].status)} className="w-[46px]" />;
  const Icon = currentSection(pathname)?.icon;
  return Icon ? <Icon size={26} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-muted" /> : null;
}
