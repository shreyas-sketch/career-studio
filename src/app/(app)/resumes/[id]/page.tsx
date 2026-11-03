import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { loadResumeVersion, versionJobKey } from "@/lib/career/resume-versions";
import { applicationOptions, isAiConfigured, openJob } from "@/lib/career/shared-data";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { loadThemes } from "@/lib/theme-data";
import { BUILT_IN_THEMES } from "@/lib/themes";

import { VersionEditor } from "./version-editor";

export const metadata: Metadata = { title: "Resume" };

export default async function ResumeVersionPage({ params, searchParams }: PageProps<"/resumes/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [version, profile, themes, settings, applications, aiReady] = await Promise.all([loadResumeVersion(id), loadProfile(), loadThemes(), loadSettings(), applicationOptions(), isAiConfigured()]);
  if (!version) notFound();
  const jobId = await openJob(versionJobKey(id));
  const themeId = themes.some((theme) => theme.id === version.themeId) ? version.themeId! : themes.some((theme) => theme.id === settings.baseThemeId) ? settings.baseThemeId : BUILT_IN_THEMES[0]!.id;
  const tab = typeof query.tab === "string" ? query.tab : null;

  return (
    <VersionEditor
      version={{
        id: version.id,
        name: version.name,
        target: version.target,
        jobDescription: version.jobDescription,
        units: version.units,
        coach: version.coach,
        snapshots: version.snapshots.map((snapshot) => ({ ...snapshot, createdAt: snapshot.createdAt.toISOString() })),
        application: version.application,
      }}
      profile={profile}
      themes={themes}
      themeId={themeId}
      paper={settings.paper}
      language={settings.resumeLanguage}
      includeReferences={settings.includeRefs}
      applications={applications}
      jobId={jobId}
      aiReady={aiReady}
      initialTab={tab === "tailor" || tab === "coach" || tab === "theme" || tab === "history" ? tab : "edit"}
    />
  );
}
