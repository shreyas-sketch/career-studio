import type { Metadata } from "next";
import { cookies } from "next/headers";

import { PublicReport } from "@/components/public-fde/report";
import { decodeGuest, GUEST_COOKIE } from "@/lib/public-fde/guest";
import { loadPublicReport } from "@/lib/public-fde/view";

export const metadata: Metadata = { title: "Your review" };

// A visitor's own report. The guest cookie decides, nothing else: anyone
// else's id (guessed, shared or copied from a screen) shows the same "not
// available" as one that never existed.
export default async function PublicReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guestId = decodeGuest((await cookies()).get(GUEST_COOKIE)?.value);
  const report = guestId ? await loadPublicReport(id, guestId).catch(() => null) : null;
  if (!report) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-8 py-20 max-sm:px-4">
        <h1 className="font-serif text-[32px] font-medium">This report isn&apos;t available</h1>
        <p className="mt-2 text-pretty text-muted">Reports open only in the browser that started them, and they&apos;re deleted after a few days. If you started one, open it from that browser.</p>
        <a className="mt-6 inline-block underline underline-offset-2" href="/fde-review">Start a review</a>
      </div>
    );
  }
  return <PublicReport initial={report} />;
}
