import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ReportScreen } from "@/components/fde/report-screen";
import { loadReportView } from "@/lib/fde/report";

export const metadata: Metadata = { title: "FDE review" };

export default async function FdeReportPage({ params }: PageProps<"/fde/[id]">) {
  const report = await loadReportView((await params).id);
  if (!report) notFound();
  return <ReportScreen initial={report} />;
}
