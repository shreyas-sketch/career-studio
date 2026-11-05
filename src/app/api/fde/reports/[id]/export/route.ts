import { NextResponse } from "next/server";

import { exportReport } from "@/lib/fde/report";
import { route } from "@/lib/route";

/** The owner's copy of a report, as a file. */
export const GET = route<RouteContext<"/api/fde/reports/[id]/export">>(async (_request, { params }) => {
  const report = await exportReport((await params).id);
  if (!report) return NextResponse.json({ error: "That report doesn't exist." }, { status: 404 });
  return new NextResponse(JSON.stringify(report, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="fde-review.json"` },
  });
});
