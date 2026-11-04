import { FilePlus2, FileStack, FileUp, Wand2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { relativeDay, Screen, Section } from "@/components/career/parts";
import { PageHeader } from "@/components/page-header";
import { listResumeVersions } from "@/lib/career/resume-versions";
import { applicationOptions } from "@/lib/career/shared-data";
import { loadProfile } from "@/lib/profile-data";

import { NewVersion } from "./new-version";

export const metadata: Metadata = { title: "Resumes" };

/** Agent 2: the base resume, named versions, and ways to start. */
export default async function ResumesPage() {
  const [versions, profile, applications] = await Promise.all([listResumeVersions(), loadProfile(), applicationOptions()]);
  const thin = profile.experience.length === 0;

  return (
    <>
      <PageHeader
        title="Resumes"
        description="One profile, as many resumes as you need: a version per kind of role, tailored to a posting, coached until every line shows what you did. Nothing is invented: what's missing is asked for."
      />
      <Screen wide>
        {thin && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
            <Link href="/resumes/start" className="flex gap-4 rounded-panel border border-accent/40 bg-card p-5 text-ink hover:border-accent hover:text-ink">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-text">
                <Wand2 size={18} aria-hidden="true" />
              </span>
              <span className="flex flex-col gap-1">
                <span className="font-medium">Start from scratch</span>
                <span className="text-sm text-muted">A few guided questions about your work so far. You review everything before it goes into your profile.</span>
              </span>
            </Link>
            <Link href="/profile/import" className="flex gap-4 rounded-panel border border-line-card bg-card p-5 text-ink hover:border-line-strong hover:text-ink">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-track">
                <FileUp size={18} aria-hidden="true" />
              </span>
              <span className="flex flex-col gap-1">
                <span className="font-medium">Import a resume you have</span>
                <span className="text-sm text-muted">PDF, Word or text. It&apos;s read into your profile, and you choose what to keep.</span>
              </span>
            </Link>
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Section title="Your resumes">
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
              <li>
                <Link href="/resume" className="flex h-full flex-col gap-2 rounded-card border border-line-card bg-card p-4 text-ink hover:border-line-strong hover:text-ink">
                  <span className="flex items-center gap-2 font-medium">
                    <FileStack size={16} aria-hidden="true" /> Base resume
                  </span>
                  <span className="text-meta text-muted">Your whole profile, word for word. Every application starts here.</span>
                </Link>
              </li>
              {versions.map((version) => (
                <li key={version.id}>
                  <Link href={`/resumes/${version.id}`} className="flex h-full flex-col gap-2 rounded-card border border-line-card bg-card p-4 text-ink hover:border-line-strong hover:text-ink">
                    <span className="font-medium">{version.name}</span>
                    <span className="text-meta text-muted">
                      {[version.target, version.application ? `for ${version.application.company}` : null, version.jobDescription ? "tailored" : null, `edited ${relativeDay(version.updatedAt)}`].filter(Boolean).join(" · ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {versions.length === 0 && (
              <p className="flex items-center gap-2 text-sm text-muted">
                <FilePlus2 size={15} aria-hidden="true" /> Make a version for each kind of role you go for; each keeps its own wording, theme and history.
              </p>
            )}
          </Section>
          <Section title="New version">
            <NewVersion versions={versions.map((version) => ({ id: version.id, name: version.name }))} applications={applications} />
          </Section>
        </div>
      </Screen>
    </>
  );
}
