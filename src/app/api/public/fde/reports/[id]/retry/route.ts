import { currentGuest, json, publicRoute } from "@/lib/public-fde/http";
import { retryReport } from "@/lib/public-fde/queue";

type Context = { params: Promise<{ id: string }> };

const MESSAGES = {
  not_found: "Report not found.",
  not_retryable: "This report can't be run again as it is.",
  paused: "New work is paused for a moment. Try again in a minute.",
  budget: "Today's report capacity is used up. Try again later.",
} as const;

export const POST = publicRoute<Context>(async (_request, { params }) => {
  const guestId = await currentGuest();
  const { id } = await params;
  if (!guestId) return json({ error: MESSAGES.not_found }, 404);
  const result = await retryReport(id, guestId);
  if (!result.ok) return json({ error: MESSAGES[result.code], code: result.code }, result.status, result.code === "paused" ? { "retry-after": "60" } : {});
  return json({ queued: true }, 202);
});
