"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { usePathname } from "next/navigation";
import { createContext, use, useState, useSyncExternalStore, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { rememberPreference, SIDEBAR_COOKIE } from "@/lib/ui-preferences";

const CollapsedContext = createContext<{ collapsed: boolean; expand: () => void }>({ collapsed: false, expand: () => {} });

/** Whether the sidebar is collapsed to its icons, for the parts that need more than CSS. */
export function useSidebarCollapsed(): boolean {
  return use(CollapsedContext).collapsed;
}

/** Opens a collapsed sidebar, for a part that needs its full width (the update notice). */
export function useExpandSidebar(): () => void {
  return use(CollapsedContext).expand;
}

const NARROW = "(max-width: 767px)";

/** Whether the window is too narrow to keep the sidebar open beside the screen. */
function useNarrow(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = window.matchMedia?.(NARROW);
      query?.addEventListener("change", changed);
      return () => query?.removeEventListener("change", changed);
    },
    () => window.matchMedia?.(NARROW).matches ?? false,
    () => false,
  );
}

/**
 * The sidebar's frame, collapsible to a strip of icons.
 * The choice is kept in a cookie, so the server renders the next page the
 * same way. Inside, `group-data-collapsed/sidebar:` variants hide what
 * doesn't fit, so the server-rendered parts need no state of their own.
 */
export function SidebarFrame({
  initialCollapsed,
  brand,
  children,
}: {
  initialCollapsed: boolean;
  /** The logo, which the expand button replaces on hover while collapsed. */
  brand: ReactNode;
  children: ReactNode;
}) {
  const [stored, setStored] = useState(initialCollapsed);
  const narrow = useNarrow();
  const pathname = usePathname();
  // On a phone it's a strip of icons. Opened, it lies over the screen until the
  // next page, and the choice isn't remembered: it's only for this one trip.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const collapsed = narrow ? openedOn === null || openedOn !== pathname : stored;
  const change = (next: boolean) => {
    if (narrow) {
      setOpenedOn(next ? null : pathname);
      return;
    }
    setStored(next);
    rememberPreference(SIDEBAR_COOKIE, next ? "collapsed" : "expanded");
  };
  const toggle = () => change(!collapsed);
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <CollapsedContext value={{ collapsed, expand: () => change(false) }}>
      {/* Holds the strip's place while the sidebar is fixed over the screen. */}
      <div aria-hidden="true" className="w-12 shrink-0 md:hidden" />
      <aside
        data-collapsed={collapsed || undefined}
        className={cn(
          "group/sidebar scrollbar-subtle top-0 flex h-screen shrink-0 flex-col self-start overflow-x-hidden overflow-y-auto border-r border-line bg-sidebar motion-safe:transition-[width] motion-safe:duration-200 max-md:fixed max-md:left-0 max-md:z-40 md:sticky",
          collapsed ? "w-12" : "w-[260px] max-md:shadow-dialog",
        )}
      >
        <div
          className={cn(
            "group/header relative flex items-center gap-2 border-b border-line",
            collapsed ? "justify-center px-1 py-3" : "pt-3 pr-3 pb-4 pl-4",
          )}
        >
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2",
              // Collapsed, the logo and the expand button share one slot.
              collapsed &&
                "flex-none group-hover/header:opacity-0 group-has-[button:focus-visible]/header:opacity-0 motion-safe:transition-opacity",
            )}
          >
            {brand}
          </div>
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink",
              collapsed &&
                "absolute inset-0 m-auto size-8 bg-surface opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100 motion-safe:transition-opacity",
            )}
          >
            <Icon size={16} aria-hidden="true" />
          </button>
        </div>
        {children}
      </aside>
    </CollapsedContext>
  );
}
