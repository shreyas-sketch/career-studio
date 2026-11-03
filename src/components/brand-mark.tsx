import { cn } from "@/lib/cn";

/**
 * Career Studio's mark: one arm of the mobile, a red shape against a blue one,
 * in balance. Decorative: put the name next to it.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("size-8 shrink-0 overflow-visible", className)}>
      <path d="M8 21Q32 13 56 19M32 2V16" fill="none" strokeWidth="2.6" strokeLinecap="round" className="stroke-wire" />
      <circle cx="32" cy="16.5" r="2.8" className="fill-wire" />
      <path d="M8 21V29" strokeWidth="1.8" className="stroke-wire" />
      <path d="M8 29C20 31 30 42 26 54C14 58 0 54-4 44C-3 37 2 31 8 29Z" className="fill-crew-scout" />
      <path d="M56 19V25" strokeWidth="1.8" className="stroke-wire" />
      <path d="M56 25A15 15 0 1 1 55.9 25Z" className="fill-crew-tailor" />
    </svg>
  );
}
