import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/career/parts";
import { adminEmail, liveStatus } from "@/lib/public-fde/admin";

import { LiveConsole } from "./live-console";

export const metadata: Metadata = { title: "Public FDE review: live" };

// The operator's console for the public review at /fde-review. Signed-in
// accounts that aren't in PUBLIC_FDE_ADMIN_EMAILS get a plain 404.
export default async function LivePage() {
  if (!(await adminEmail())) notFound();
  const initial = await liveStatus();
  return (
    <>
      <PageHeader
        title="Public FDE review: live"
        description="The shareable review at /fde-review. Queue, spend and controls for every server process. Nothing here shows a visitor's profile."
      />
      <Screen wide>
        <LiveConsole initial={initial} />
      </Screen>
    </>
  );
}
