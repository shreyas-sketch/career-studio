import { makeFormToken } from "@/lib/public-fde/guest";
import { ensureGuest, json, publicRoute } from "@/lib/public-fde/http";
import { intakeState } from "@/lib/public-fde/view";

// The landing page asks here when it opens: it gets a guest cookie (made now
// if there's none) and a fresh form token bound to it. No account involved.

export const POST = publicRoute(async (request) => {
  const guestId = await ensureGuest(request);
  const intake = await intakeState();
  return json({ formToken: makeFormToken(guestId), intake });
});
