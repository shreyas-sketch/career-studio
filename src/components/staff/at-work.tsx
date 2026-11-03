"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { describeStep, STAFF, STAFF_IDS } from "@/lib/staff/staff";

import { RobotHead } from "./robot";
import { useStaff } from "./staff-provider";

/** Near the top of the sidebar: who's working right now. Not on Today, which shows it already, and not when no one is. */
export function AtWork() {
  const { members } = useStaff();
  const pathname = usePathname();
  const working = STAFF_IDS.map((id) => members[id]).filter(({ status }) => status === "working");
  if (working.length === 0 || pathname === "/") return null;
  return (
    <div className="mb-2 flex flex-col gap-1.5 rounded-control bg-hover px-3 py-2.5 group-data-collapsed/sidebar:hidden">
      <p className="text-xs font-medium text-muted">At work now</p>
      <ul className="flex flex-col gap-1.5">
        {working.slice(0, 3).map((member) => (
          <li key={member.id}>
            <Link href={STAFF[member.id].href} className="flex items-center gap-2 text-ink hover:text-ink">
              <RobotHead id={member.id} mood="working" className="w-8" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs font-medium">{STAFF[member.id].title}</span>
                <span className="truncate text-[11px] text-muted">{describeStep(member)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
