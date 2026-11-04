"use client";

import { Download, FileDown, History, Palette, PenLine, RefreshCw, Sparkles, Target, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { JobProgress } from "@/components/career/job-progress";
import { JobSourceField, type ApplicationOption } from "@/components/career/job-source-field";
import { Points, relativeDay } from "@/components/career/parts";
import { DocumentPreview } from "@/components/documents/document-preview";
import { DownloadPdfButton } from "@/components/documents/download-pdf-button";
import { ResumeDocument } from "@/components/documents/resume-document";
import { PageHeader } from "@/components/page-header";
import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { PaperSize } from "@/generated/prisma/enums";
import type { ResumeCoaching } from "@/lib/ai/tasks/career/resume-coach";
import type { Unit } from "@/lib/application-data";
import { cn } from "@/lib/cn";
import type { ProfileData } from "@/lib/profile";
import { PAPER_SIZES, type ThemeData } from "@/lib/themes";

import { answerQuestion, coachVersion, deleteVersion, editUnit, improve, includeUnit, refreshVersion, renameVersion, restoreVersion, setVersionTheme, tailorVersion } from "../actions";

type Tab = "edit" | "coach" | "tailor" | "theme" | "history";
type VersionData = {
  id: string;
  name: string;
  target: string;
  jobDescription: string;
  units: Unit[];
  coach: ResumeCoaching | null;
  snapshots: { id: string; cause: string; createdAt: string }[];
  application: { id: string; company: string; role: string; title: string } | null;
};

/** Every part a resume can have, from the profile, so left-out parts can come back. */
function allParts(profile: ProfileData): { id: string; label: string }[] {
  return [
    { id: "summary", label: "Summary" },
    ...profile.experience.map((entry) => ({ id: `experience:${entry.id}`, label: `${entry.role || "Role"}${entry.company ? `, ${entry.company}` : ""}` })),
    ...profile.projects.map((entry) => ({ id: `project:${entry.id}`, label: `${entry.name || "Project"} (project)` })),
    { id: "skills", label: "Skills" },
    ...profile.education.map((entry) => ({ id: `education:${entry.id}`, label: entry.degree || entry.school || "Education" })),
    { id: "languages", label: "Languages" },
  ];
}

export function VersionEditor({
  version,
  profile,
  themes,
  themeId: initialThemeId,
  paper,
  language,
  includeReferences,
  applications,
  jobId: initialJob,
  aiReady,
  initialTab,
}: {
  version: VersionData;
  profile: ProfileData;
  themes: ThemeData[];
  themeId: string;
  paper: PaperSize;
  language: string | null;
  includeReferences: boolean;
  applications: ApplicationOption[];
  jobId: string | null;
  aiReady: boolean;
  initialTab: Tab;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [units, setUnits] = useState(version.units);
  const [themeId, setThemeId] = useState(initialThemeId);
  const [jobId, setJobId] = useState(initialJob);
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(version.name);
  const [target, setTarget] = useState(version.target);
  // The server's units win whenever they change (an AI rewrite, a restore).
  const [serverUnits, setServerUnits] = useState(version.units);
  if (version.units !== serverUnits) {
    setServerUnits(version.units);
    setUnits(version.units);
  }
  const theme = themes.find((entry) => entry.id === themeId) ?? themes[0]!;
  const included = new Set(units.map((unit) => unit.id));
  const parts = allParts(profile);
  const busy = Boolean(jobId);
  const run = (promise: Promise<{ ok: boolean; data?: { jobId: string } } | { ok: false; error: string }>) =>
    start(async () => {
      const result = toastResult((await promise) as never) as { ok: boolean; data?: { jobId: string } };
      if (result.ok && result.data?.jobId) setJobId(result.data.jobId);
    });

  return (
    <>
      <PageHeader
        title={version.name}
        before={
          <Link href="/resumes" className="text-sm text-muted hover:text-ink">
            ← Resumes
          </Link>
        }
        actions={
          <>
            <ExportMenu id={version.id} />
            <DownloadPdfButton href={`/api/pdf?doc=version&version=${version.id}`}>Download PDF</DownloadPdfButton>
          </>
        }
      />
      <div className="@container flex flex-1 flex-wrap border-t border-line">
        <DocumentPreview label={theme.name} meta={(pages) => `${PAPER_SIZES[paper].label} · ${pages} ${pages === 1 ? "page" : "pages"}`} notice={jobId ? <JobProgress jobId={jobId} onDone={() => setJobId(null)} compact /> : undefined}>
          <ResumeDocument theme={theme} profile={profile} paper={paper} units={units} language={language} includeReferences={includeReferences} />
        </DocumentPreview>

        <aside aria-label="Edit this resume" className="flex min-w-0 flex-[1_1_360px] flex-col border-t border-line bg-paper px-6 pt-6 pb-12 @min-[860px]:max-w-[480px] @min-[860px]:border-t-0 @min-[860px]:border-l">
          <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="flex flex-col gap-5">
            <TabsList variant="segmented">
              <TabsTrigger value="edit" title="Edit">
                <PenLine size={14} aria-hidden="true" />
                <span className="max-[460px]:sr-only">Edit</span>
              </TabsTrigger>
              <TabsTrigger value="coach" title="Coach">
                <Sparkles size={14} aria-hidden="true" />
                <span className="max-[460px]:sr-only">Coach</span>
              </TabsTrigger>
              <TabsTrigger value="tailor" title="Tailor">
                <Target size={14} aria-hidden="true" />
                <span className="max-[460px]:sr-only">Tailor</span>
              </TabsTrigger>
              <TabsTrigger value="theme" title="Theme">
                <Palette size={14} aria-hidden="true" />
                <span className="sr-only">Theme</span>
              </TabsTrigger>
              <TabsTrigger value="history" title="History">
                <History size={14} aria-hidden="true" />
                <span className="sr-only">History</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="edit" className="flex flex-col gap-5">
              <div className="grid gap-3">
                <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} onBlur={() => void renameVersion({ id: version.id, name, target }).then(toastResult).then(() => router.refresh())} />
                <Input label="Aims at" value={target} onChange={(event) => setTarget(event.target.value)} onBlur={() => void renameVersion({ id: version.id, name, target }).then(toastResult)} />
              </div>
              <p className="text-meta text-muted">Edit the words here; names, dates and contact details come from your profile, so change those there.</p>
              {units.map((unit) => (
                <UnitField
                  key={unit.id}
                  unit={unit}
                  disabled={busy}
                  aiReady={aiReady}
                  onChange={(text) => setUnits((current) => current.map((other) => (other.id === unit.id ? { ...other, text } : other)))}
                  onSave={(text) => void editUnit({ id: version.id, unitId: unit.id, text }).then(toastResult)}
                  onImprove={(instruction) => run(improve({ id: version.id, unitId: unit.id, instruction }))}
                  onRemove={() => start(async () => void toastResult(await includeUnit({ id: version.id, unitId: unit.id, include: false })))}
                />
              ))}
              {parts.some((part) => !included.has(part.id)) && (
                <div className="flex flex-col gap-2">
                  <span className="text-label text-muted">Left out of this resume</span>
                  <div className="flex flex-wrap gap-2">
                    {parts
                      .filter((part) => !included.has(part.id))
                      .map((part) => (
                        <button key={part.id} type="button" disabled={pending} onClick={() => start(async () => void toastResult(await includeUnit({ id: version.id, unitId: part.id, include: true })))} className="rounded-full border border-dashed border-line-strong px-3 py-1 text-meta hover:border-primary">
                          + {part.label}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="coach" className="flex flex-col gap-4">
              <p className="text-sm text-muted">The coach reads this resume against its target and asks for what&apos;s missing. Your answers become facts in your profile, then the part is rewritten with them.</p>
              <Button disabled={!aiReady || busy || pending} onClick={() => run(coachVersion({ id: version.id }))}>
                <Sparkles size={14} aria-hidden="true" /> {version.coach ? "Review again" : "Review this resume"}
              </Button>
              {version.coach && <Coaching coaching={version.coach} units={units} disabled={busy || !aiReady} onAnswer={(questionId, answer) => run(answerQuestion({ id: version.id, questionId, answer }))} onApply={(unitId, instruction) => run(improve({ id: version.id, unitId, instruction }))} />}
            </TabsContent>

            <TabsContent value="tailor">
              <Tailor applications={applications} initial={version.jobDescription} disabled={!aiReady || busy || pending} onTailor={(text) => run(tailorVersion({ id: version.id, jobDescription: text }))} />
            </TabsContent>

            <TabsContent value="theme" className="flex flex-col gap-2">
              <ul className="grid grid-cols-2 gap-2">
                {themes.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-pressed={entry.id === themeId}
                      onClick={() => {
                        setThemeId(entry.id);
                        void setVersionTheme({ id: version.id, themeId: entry.id }).then(toastResult);
                      }}
                      className={cn("flex w-full items-center gap-2 rounded-control border px-3 py-2 text-left text-sm", entry.id === themeId ? "border-primary bg-selected font-medium" : "border-line-card bg-card hover:border-line-strong")}
                    >
                      <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ background: entry.accent }} />
                      {entry.name}
                    </button>
                  </li>
                ))}
              </ul>
              <Link href="/resume" className="text-meta text-muted underline underline-offset-3">
                Make your own theme on the base resume
              </Link>
            </TabsContent>

            <TabsContent value="history" className="flex flex-col gap-3">
              <Button variant="secondary" size="sm" className="self-start" disabled={pending || busy} onClick={() => start(async () => void toastResult(await refreshVersion({ id: version.id })))}>
                <RefreshCw size={14} aria-hidden="true" /> Rebuild from my profile
              </Button>
              <ul className="flex flex-col gap-1.5">
                {version.snapshots.map((snapshot) => (
                  <li key={snapshot.id} className="flex items-center justify-between gap-3 rounded-control bg-card px-3 py-2 text-sm">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{snapshot.cause}</span>
                      <span className="text-meta text-muted">{relativeDay(snapshot.createdAt)} · {new Date(snapshot.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    </span>
                    <Button variant="text" size="sm" disabled={pending} onClick={() => start(async () => void toastResult(await restoreVersion({ id: version.id, snapshotId: snapshot.id })))}>
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
              <Button variant="text" size="sm" className="mt-4 self-start text-danger!" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} aria-hidden="true" /> Delete this resume
              </Button>
            </TabsContent>
          </Tabs>
        </aside>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this resume?"
        description="This version and its history go. Your profile stays as it is."
        confirmLabel="Delete"
        onConfirm={() =>
          start(async () => {
            if (toastResult(await deleteVersion({ id: version.id })).ok) router.push("/resumes");
          })
        }
      />
    </>
  );
}

function UnitField({ unit, disabled, aiReady, onChange, onSave, onImprove, onRemove }: { unit: Unit; disabled: boolean; aiReady: boolean; onChange: (text: string) => void; onSave: (text: string) => void; onImprove: (instruction: string) => void; onRemove: () => void }) {
  const saved = useRef(unit.text);
  useEffect(() => {
    saved.current = unit.text;
    // Only when the server's text changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit.id]);
  const lines = unit.text.split("\n").length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-label font-medium">{unit.label}</span>
        <span className="flex items-center gap-1">
          {aiReady && (unit.id.startsWith("experience:") || unit.id.startsWith("project:") || unit.id === "summary") && (
            <button type="button" disabled={disabled} onClick={() => onImprove(unit.id === "summary" ? "Sharpen it for the target: lead with the kind of work they do best and their strongest evidence." : "Make each point lead with the result where the profile has one, and cut filler.")} className="rounded-control px-2 py-0.5 text-meta text-muted hover:bg-hover hover:text-ink disabled:opacity-40">
              <Sparkles size={12} aria-hidden="true" className="mr-1 inline" />
              Sharpen
            </button>
          )}
          <button type="button" onClick={onRemove} className="rounded-control px-2 py-0.5 text-meta text-muted hover:bg-hover hover:text-ink">
            Leave out
          </button>
        </span>
      </div>
      <textarea
        value={unit.text}
        aria-label={unit.label}
        rows={Math.min(10, Math.max(2, lines + 1))}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          if (unit.text === saved.current) return;
          saved.current = unit.text;
          onSave(unit.text);
        }}
        className="w-full resize-y rounded-control border border-line-input bg-input px-3 py-2 text-sm leading-relaxed"
      />
      {unit.unverified && unit.unverified.length > 0 && (
        <p className="text-meta text-warning">Check these against your profile: {unit.unverified.join(", ")}</p>
      )}
    </div>
  );
}

function Coaching({ coaching, units, disabled, onAnswer, onApply }: { coaching: ResumeCoaching; units: Unit[]; disabled: boolean; onAnswer: (questionId: string, answer: string) => void; onApply: (unitId: string, instruction: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const label = (unitId: string) => units.find((unit) => unit.id === unitId)?.label ?? unitId;
  return (
    <div className="flex flex-col gap-5 motion-safe:animate-rise-in">
      <p className="text-sm text-pretty">{coaching.overall}</p>
      <Points title="Already working" items={coaching.strengths} tone="good" />
      {coaching.questions.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-label font-semibold tracking-wide text-muted uppercase">Questions only you can answer</h3>
          {coaching.questions.map((question) => (
            <div key={question.id} className="flex flex-col gap-2 rounded-card border border-line-card bg-card p-3">
              <span className="text-sm font-medium">{question.question}</span>
              <span className="text-meta text-muted">
                For {label(question.unitId)}: {question.why}
              </span>
              <Textarea rows={2} aria-label={question.question} placeholder={question.example} value={answers[question.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} />
              <Button size="sm" className="self-start" disabled={disabled || !(answers[question.id] ?? "").trim()} onClick={() => onAnswer(question.id, answers[question.id]!)}>
                Save to my profile and use it
              </Button>
            </div>
          ))}
        </div>
      )}
      {coaching.suggestions.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-label font-semibold tracking-wide text-muted uppercase">Suggestions</h3>
          {coaching.suggestions.map((suggestion, index) => (
            <div key={index} className="flex flex-col gap-1.5 rounded-control bg-card p-3 text-sm">
              <span className="text-meta text-muted">{label(suggestion.unitId)}</span>
              <span>{suggestion.suggestion}</span>
              <Button variant="secondary" size="sm" className="self-start" disabled={disabled} onClick={() => onApply(suggestion.unitId, suggestion.suggestion)}>
                Apply
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tailor({ applications, initial, disabled, onTailor }: { applications: ApplicationOption[]; initial: string; disabled: boolean; onTailor: (text: string) => void }) {
  const [applicationId, setApplicationId] = useState("");
  const [text, setText] = useState(initial);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Reorders and rewrites this resume for one posting, using only your profile. The current text goes to the history first.</p>
      <JobSourceField applications={applications} applicationId={applicationId} onApplicationChange={(application) => setApplicationId(application?.id ?? "")} text={text} onTextChange={setText} />
      <Button disabled={disabled || text.trim().length < 80} onClick={() => onTailor(text)}>
        <Target size={14} aria-hidden="true" /> Tailor to this job
      </Button>
    </div>
  );
}

function ExportMenu({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className={buttonClassName("secondary")}>
        <FileDown size={15} aria-hidden="true" /> Other formats
      </button>
      {open && (
        <ul className="absolute right-0 z-30 mt-1 flex w-48 flex-col rounded-card border border-line-popover bg-card p-1 shadow-menu motion-safe:animate-rise-in" onMouseLeave={() => setOpen(false)}>
          {[
            ["docx", "Word (.docx)"],
            ["md", "Markdown (.md)"],
            ["txt", "Plain text (.txt)"],
          ].map(([format, label]) => (
            <li key={format}>
              <a href={`/api/resume-versions/${id}/export?format=${format}`} className="flex items-center gap-2 rounded-control px-3 py-2 text-sm text-ink hover:bg-hover hover:text-ink" onClick={() => setOpen(false)}>
                <Download size={14} aria-hidden="true" /> {label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
