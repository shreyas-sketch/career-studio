import type { ReportState } from "./types";

// Small wording helpers, shared by server and client pages.

export const STATE_LABELS: Record<ReportState, string> = {
  running: "In progress",
  complete: "Complete",
  partial: "Partly complete",
  restricted: "Profile restricted",
  failed: "Failed",
  quota: "Provider limit reached",
};

export function money(micro: number): string {
  const dollars = micro / 1_000_000;
  return `$${dollars.toFixed(dollars < 1 ? 4 : 2)}`;
}
