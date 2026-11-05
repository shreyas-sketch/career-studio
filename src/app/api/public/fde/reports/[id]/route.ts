import { currentGuest, json, publicRoute } from "@/lib/public-fde/http";
import { deleteGuestReport } from "@/lib/public-fde/retention";
import { loadPublicReport } from "@/lib/public-fde/view";

// A visitor's own report, as the page polls it. Anyone else's id, guessed or
// copied, is simply not found: the answer never says whether it exists.

type Context = { params: Promise<{ id: string }> };

export const GET = publicRoute<Context>(async (_request, { params }) => {
  const guestId = await currentGuest();
  const { id } = await params;
  const report = guestId ? await loadPublicReport(id, guestId) : null;
  if (!report) return json({ error: "Report not found." }, 404);
  return json(report);
});

export const DELETE = publicRoute<Context>(async (_request, { params }) => {
  const guestId = await currentGuest();
  const { id } = await params;
  if (!guestId || !(await deleteGuestReport(id, guestId))) return json({ error: "Report not found." }, 404);
  return json({ deleted: true });
});
