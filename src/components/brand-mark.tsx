import { cn } from "@/lib/cn";

/**
 * Career Studio's mark: a studio frame (the square) with a rising path and
 * an amber point where it arrives. In the primary colours, so it turns over
 * in the dark scheme. Decorative: put the name next to it.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <rect width="64" height="64" rx="15" className="fill-primary" />
      <path d="M16 44 L28 32 L36 38 L48 22" fill="none" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" className="stroke-on-primary" />
      <circle cx="48" cy="22" r="6" className="fill-accent" />
    </svg>
  );
}
