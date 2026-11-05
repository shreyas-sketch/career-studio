"use client";

import { Building2, ChevronRight, GraduationCap, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { PROFILE_SECTIONS, type NamedEntry, type ReportView, type SectionState } from "@/lib/fde/types";

import { SourceLink, when } from "./shared";

type Profile = NonNullable<ReportView["profile"]>;

const SECTION_NAMES: Record<string, string> = {
  about: "About",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  certifications: "Certifications",
  projects: "Projects",
  publications: "Publications",
  languages: "Languages",
  awards: "Awards",
  volunteering: "Volunteering",
  recommendations: "Recommendations",
  courses: "Courses",
};

const STATE_WORDS: Record<SectionState, string> = { present: "Retrieved", empty: "Empty on this profile", not_retrieved: "Not retrieved", restricted: "Restricted" };

/** An image from the snapshot, or nothing at all: a blocked or expired one just leaves the fallback showing. */
function SnapshotImage({ profile, imageKey, alt, className, fallback, eager = false }: { profile: Profile; imageKey: string | null; alt: string; className?: string; fallback: ReactNode; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // An image that failed before the page became interactive never reaches onError.
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth === 0) setFailed(true);
  }, []);
  if (!imageKey || failed || !profile.imageKeys.includes(imageKey)) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element -- served by the checked same-origin proxy
  return <img ref={ref} src={`/api/fde/media/${profile.snapshotId}/${encodeURIComponent(imageKey)}`} alt={alt} className={className} onError={() => setFailed(true)} loading={eager ? "eager" : "lazy"} />;
}

/** All of a long text, collapsed until asked for. Nothing is ever cut. */
export function LongText({ text, lines = 5 }: { text: string; lines?: number }) {
  const [open, setOpen] = useState(false);
  const long = text.length > lines * 75 || text.split("\n").length > lines;
  return (
    <div className="flex flex-col items-start gap-1">
      <p className={cn("text-sm whitespace-pre-line text-pretty", !open && long && "line-clamp-5")}>{text}</p>
      {long && (
        <button type="button" className="text-meta underline underline-offset-2 hover:text-ink" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}

function Expandable({ title, count, defaultOpen = false, children }: { title: string; count?: number; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen} className="group border-t border-line py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-muted group-open:rotate-90 motion-safe:transition-transform" />
        {title}
        {count !== undefined && <span className="text-meta font-normal text-muted tabular-nums">{count}</span>}
      </summary>
      <div className="mt-3 flex flex-col gap-4 pl-6">{children}</div>
    </details>
  );
}

const Entries = ({ entries }: { entries: NamedEntry[] }) => (
  <>
    {entries.map((entry) => (
      <div key={entry.id} className="flex flex-col gap-1">
        <p className="text-sm font-medium text-pretty">{entry.link ? <SourceLink href={entry.link} className="text-sm font-medium">{entry.title}</SourceLink> : entry.title}</p>
        {(entry.subtitle || entry.when) && <p className="text-meta text-muted">{[entry.subtitle, entry.when].filter(Boolean).join(", ")}</p>}
        {entry.description && <LongText text={entry.description} />}
      </div>
    ))}
  </>
);

const dates = (start: { text: string } | null, end: { text: string } | null, current: boolean) => [start?.text, current ? "Present" : end?.text].filter(Boolean).join(" to ");

export function ProfilePanel({ profile, origin }: { profile: Profile; origin: ReportView["profileOrigin"] }) {
  const placeholder = (
    <span className="grid size-full place-items-center bg-track text-muted">
      <UserRound size={34} aria-hidden="true" />
      <span className="sr-only">No picture available</span>
    </span>
  );
  return (
    <article className="overflow-hidden rounded-panel border border-line-card bg-card">
      <div className="h-24 bg-track">
        <SnapshotImage profile={profile} imageKey={profile.banner} alt="" className="size-full object-cover" fallback={null} eager />
      </div>
      <div className="px-5 pb-3">
        <div className="-mt-10 size-20 overflow-hidden rounded-full border-[3px] border-card bg-track">
          <SnapshotImage profile={profile} imageKey={profile.photo} alt={`${profile.name}'s profile picture`} className="size-full object-cover" fallback={placeholder} eager />
        </div>
        <h2 className="mt-2 font-serif text-2xl text-pretty">{profile.name || "Name not returned"}</h2>
        {profile.headline && <p className="text-sm text-pretty">{profile.headline}</p>}
        {profile.location && <p className="mt-1 text-meta text-muted">{profile.location}</p>}
        {profile.currentPosition && <p className="mt-1 text-meta text-muted">Now: {profile.currentPosition}</p>}
        {(profile.followers !== null || profile.connections !== null) && (
          <p className="mt-1 text-meta text-muted tabular-nums">
            {[profile.followers !== null && `${profile.followers.toLocaleString("en-US")} followers`, profile.connections !== null && `${profile.connections.toLocaleString("en-US")} connections`].filter(Boolean).join(", ")}
          </p>
        )}
        <div className="mt-2">
          <SourceLink href={profile.url}>Open on LinkedIn</SourceLink>
        </div>
      </div>

      <div className="px-5 pb-2">
        {profile.about && (
          <Expandable title="About" defaultOpen>
            <LongText text={profile.about} />
          </Expandable>
        )}
        {profile.experience.length > 0 && (
          <Expandable title="Experience" count={profile.experience.length} defaultOpen>
            {profile.experience.map((job) => (
              <div key={job.id} className="flex gap-3">
                <span className="size-9 shrink-0 overflow-hidden rounded-control bg-track">
                  <SnapshotImage profile={profile} imageKey={job.logo} alt="" className="size-full object-contain" fallback={<span className="grid size-full place-items-center text-muted"><Building2 size={16} aria-hidden="true" /></span>} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="text-sm font-medium text-pretty">{job.title || "Title not returned"}</p>
                  <p className="text-meta text-muted">{[job.company, job.employmentType, job.workplaceType].filter(Boolean).join(", ")}</p>
                  <p className="text-meta text-muted">{[dates(job.start, job.end, job.current), job.duration, job.location].filter(Boolean).join(", ")}</p>
                  {job.description && <LongText text={job.description} />}
                  {job.skills.length > 0 && <p className="text-meta text-muted">Skills: {job.skills.join(", ")}</p>}
                </div>
              </div>
            ))}
          </Expandable>
        )}
        {profile.education.length > 0 && (
          <Expandable title="Education" count={profile.education.length}>
            {profile.education.map((school) => (
              <div key={school.id} className="flex gap-3">
                <span className="size-9 shrink-0 overflow-hidden rounded-control bg-track">
                  <SnapshotImage profile={profile} imageKey={school.logo} alt="" className="size-full object-contain" fallback={<span className="grid size-full place-items-center text-muted"><GraduationCap size={16} aria-hidden="true" /></span>} />
                </span>
                <div className="flex min-w-0 flex-col">
                  <p className="text-sm font-medium text-pretty">{school.school}</p>
                  <p className="text-meta text-muted">{[school.degree, school.field].filter(Boolean).join(", ")}</p>
                  <p className="text-meta text-muted">{school.period || dates(school.start, school.end, false)}</p>
                </div>
              </div>
            ))}
          </Expandable>
        )}
        {profile.skills.length > 0 && (
          <Expandable title="Skills" count={profile.skills.length}>
            <ul className="flex flex-wrap gap-1.5">
              {profile.skills.map((skill) => (
                <li key={skill.name} className="rounded-control bg-track px-2 py-0.5 text-meta">{skill.name}</li>
              ))}
            </ul>
          </Expandable>
        )}
        {profile.certifications.length > 0 && <Expandable title="Certifications" count={profile.certifications.length}><Entries entries={profile.certifications} /></Expandable>}
        {profile.projects.length > 0 && <Expandable title="Projects" count={profile.projects.length}><Entries entries={profile.projects} /></Expandable>}
        {profile.publications.length > 0 && <Expandable title="Publications" count={profile.publications.length}><Entries entries={profile.publications} /></Expandable>}
        {profile.languages.length > 0 && (
          <Expandable title="Languages" count={profile.languages.length}>
            <ul className="flex flex-col gap-1">
              {profile.languages.map((language) => (
                <li key={language.name} className="text-sm">{[language.name, language.proficiency].filter(Boolean).join(": ")}</li>
              ))}
            </ul>
          </Expandable>
        )}
        {profile.awards.length > 0 && <Expandable title="Awards" count={profile.awards.length}><Entries entries={profile.awards} /></Expandable>}
        {profile.volunteering.length > 0 && <Expandable title="Volunteering" count={profile.volunteering.length}><Entries entries={profile.volunteering} /></Expandable>}
        {profile.recommendations.length > 0 && <Expandable title="Recommendations" count={profile.recommendations.length}><Entries entries={profile.recommendations} /></Expandable>}
        {profile.courses.length > 0 && <Expandable title="Courses" count={profile.courses.length}><Entries entries={profile.courses} /></Expandable>}

        <Expandable title="What was retrieved">
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-meta">
            <dt className="text-muted">Provider</dt>
            <dd className="text-right">{profile.provider}</dd>
            <dt className="text-muted">Read at</dt>
            <dd className="text-right">{when(profile.retrievedAt)}</dd>
            <dt className="text-muted">This report</dt>
            <dd className="text-right">{origin === "cached" ? "Used an earlier read" : origin === "refreshed" ? "Read again on request" : "First read"}</dd>
            {profile.sourceAge && (
              <>
                <dt className="text-muted">Provider&apos;s copy from</dt>
                <dd className="text-right">{when(profile.sourceAge) || profile.sourceAge}</dd>
              </>
            )}
            {PROFILE_SECTIONS.map((section) => (
              <div key={section} className="contents">
                <dt className="text-muted">{SECTION_NAMES[section]}</dt>
                <dd className="text-right">{STATE_WORDS[(profile.sections[section] as SectionState | undefined) ?? "not_retrieved"]}</dd>
              </div>
            ))}
          </dl>
        </Expandable>
      </div>
    </article>
  );
}
