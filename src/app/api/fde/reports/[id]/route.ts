import { NextResponse } from "next/server";

import { loadReportView } from "@/lib/fde/report";
import { route } from "@/lib/route";

/** A report as it stands, for its page to follow while the review runs. Only ever the owner's. */
export const GET = route<RouteContext<"/api/fde/reports/[id]">>(async (_request, { params }) => {
  const report = await loadReportView((await params).id);
  if (!report) return NextResponse.json({ error: "That report doesn't exist." }, { status: 404 });
  return NextResponse.json(report);
});
