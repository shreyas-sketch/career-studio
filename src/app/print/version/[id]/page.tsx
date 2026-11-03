import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ResumeDocument } from "@/components/documents/resume-document";
import { loadResumeVersion } from "@/lib/career/resume-versions";
import { verifyPrintAccess } from "@/lib/pdf/print-access";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { loadTheme } from "@/lib/theme-data";
import { BUILT_IN_THEMES, printCss } from "@/lib/themes";

export const metadata: Metadata = { title: "Resume", robots: { index: false } };

/** A resume version on its own, for the PDF renderer to print (Career Studio, agent 2). */
export default async function PrintResumeVersionPage({ params }: PageProps<"/print/version/[id]">) {
  const { id } = await params;
  await verifyPrintAccess(`/print/version/${id}`);
  const [version, profile, settings] = await Promise.all([loadResumeVersion(id), loadProfile(), loadSettings()]);
  if (!version) notFound();
  const theme = (version.themeId ? await loadTheme(version.themeId) : null) ?? (await loadTheme(settings.baseThemeId)) ?? BUILT_IN_THEMES[0];

  return (
    <>
      <style>{printCss(theme, settings.paper)}</style>
      <ResumeDocument theme={theme} profile={profile} paper={settings.paper} units={version.units} includeReferences={settings.includeRefs} language={settings.resumeLanguage} />
    </>
  );
}
