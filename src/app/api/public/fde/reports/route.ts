import { z } from "zod";

import { clientIp } from "@/lib/auth/client-ip";
import { checkFormToken, hashIp } from "@/lib/public-fde/guest";
import { currentGuest, json, publicRoute } from "@/lib/public-fde/http";
import { submitReport } from "@/lib/public-fde/queue";

// Starting a report. Answers 202 with the report's id as soon as it's safely
// queued (or the id of the one this visitor already started for the same
// address or the same click), never waiting for the work itself.

const body = z.object({
  url: z.string().trim().min(1).max(300),
  clientKey: z.string().max(64).nullable().optional(),
  formToken: z.string().max(200),
  confirmOwn: z.literal(true),
  // A field people never see; anything in it came from a script filling every input.
  website: z.string().max(0).optional(),
});

const REFUSALS: Record<string, string> = {
  disabled: "The FDE review isn't open right now.",
  paused: "New reports are paused for a moment. Try again in a minute.",
  guest_quota: "You've started as many reports as this browser can today.",
  network_quota: "A lot of reports came from this network in the last hour. Try again a little later.",
  capacity: "Every place in this session's queue is taken right now. Try again in a couple of minutes.",
  budget: "Today's report capacity is used up. Try again later.",
};

export const POST = publicRoute(async (request) => {
  const guestId = await currentGuest();
  if (!guestId) return json({ error: "Reload the page and try again." }, 401);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const confirm = parsed.error.issues.some((issue) => issue.path[0] === "confirmOwn");
    return json({ error: confirm ? "Confirm that this is your own profile." : "Check the form and try again." }, 400);
  }
  const token = checkFormToken(parsed.data.formToken, guestId);
  if (token === "too_fast") return json({ error: "One moment, then try again." }, 429, { "retry-after": "2" });
  if (token !== "ok") return json({ error: "This page has been open a long time. Reload it and try again." }, 400);

  const result = await submitReport({ guestId, url: parsed.data.url, clientKey: parsed.data.clientKey ?? null, ipHash: hashIp(clientIp(request.headers)) });
  if (!result.ok) {
    if (result.code === "invalid_url") return json({ error: result.message, field: "url" }, 422);
    const retryAfter = "retryAfter" in result ? { "retry-after": String(result.retryAfter) } : {};
    return json({ error: REFUSALS[result.code], code: result.code }, result.status, retryAfter);
  }
  const location = `/fde-review/r/${result.id}`;
  return json({ id: result.id, reused: result.reused, location }, result.reused ? 200 : 202, { location });
});
