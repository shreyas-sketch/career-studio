"use client";

import { ArrowUpRight, Code2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { SOURCE_URL } from "@/lib/releases";

import { useSidebarCollapsed } from "./sidebar-frame";

const LABEL = "Source code";

/**
 * The link to Career Studio's source. Career Studio is AGPL-3.0 (from
 * Dossier), so everyone using it over the network is offered the source.
 */
export function RepositoryLink() {
  const collapsed = useSidebarCollapsed();
  return (
    <a
      href={SOURCE_URL}
      target="_blank"
      rel="noopener noreferrer"
      title={collapsed ? `${LABEL} (AGPL-3.0)` : undefined}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-control px-3 py-1.5 text-sm font-medium text-muted hover:bg-hover hover:text-ink motion-safe:transition-colors",
        collapsed && "justify-center px-1.5",
      )}
    >
      <Code2 size={16} aria-hidden="true" className="shrink-0" />
      <span className={cn(collapsed && "sr-only")}>{LABEL}</span>{" "}
      <span className="sr-only">(AGPL-3.0, opens in a new tab)</span>
      {!collapsed && <ArrowUpRight size={14} aria-hidden="true" className="ml-auto shrink-0" />}
    </a>
  );
}
