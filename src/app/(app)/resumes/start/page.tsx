import type { Metadata } from "next";
import Link from "next/link";

import { AiSetupNotice, Screen } from "@/components/career/parts";
import { PageHeader } from "@/components/page-header";
import { isAiConfigured } from "@/lib/career/shared-data";

import { GuidedStart } from "./guided-start";

export const metadata: Metadata = { title: "Start your resume" };

export default async function GuidedStartPage() {
  const aiReady = await isAiConfigured();
  return (
    <>
      <PageHeader
        title="Start your resume"
        before={
          <Link href="/resumes" className="text-sm text-muted hover:text-ink">
            ← Resumes
          </Link>
        }
        description="Tell it in your own words; plain notes are fine. Your answers are sorted into your profile, and you review every entry before it's saved. Nothing is added that you didn't write."
      />
      <Screen>
        {!aiReady && <AiSetupNotice what="Sorting your answers into a profile" />}
        <GuidedStart disabled={!aiReady} />
      </Screen>
    </>
  );
}
