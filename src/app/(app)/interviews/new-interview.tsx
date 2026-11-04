"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { JobSourceField, type ApplicationOption } from "@/components/career/job-source-field";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DIFFICULTY_LABELS, FOCUS_LABELS } from "@/lib/career/interview-data";

import { startInterview } from "./actions";

type Focus = keyof typeof FOCUS_LABELS;
type Difficulty = keyof typeof DIFFICULTY_LABELS;

/** The form that starts a practice session. */
export function NewInterview({ applications, preselect, disabled, roundId = null }: { applications: ApplicationOption[]; preselect: string; disabled: boolean; roundId?: string | null }) {
  const router = useRouter();
  const initial = applications.find((application) => application.id === preselect) ?? null;
  const [applicationId, setApplicationId] = useState(initial?.id ?? "");
  const [company, setCompany] = useState(initial?.company ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [jobDescription, setJobDescription] = useState(initial?.postingText ?? "");
  const [focus, setFocus] = useState<Focus>("MIXED");
  const [difficulty, setDifficulty] = useState<Difficulty>("STANDARD");
  const [questions, setQuestions] = useState(5);
  const [pending, start] = useTransition();

  return (
    <Card>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          start(async () => {
            const result = toastResult(
              await startInterview({ company, role, jobDescription, focus, difficulty, questionTarget: questions, applicationId: applicationId || null, roundId }),
            );
            if (result.ok) router.push(`/interviews/${result.data.id}`);
          });
        }}
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Input label="Role" value={role} onChange={(event) => setRole(event.target.value)} placeholder="Senior product designer" />
          <Input label="Company" value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Optional" />
        </div>
        <JobSourceField
          applications={applications}
          applicationId={applicationId}
          onApplicationChange={(application) => {
            setApplicationId(application?.id ?? "");
            if (application) {
              setCompany(application.company);
              setRole(application.role);
            }
          }}
          text={jobDescription}
          onTextChange={setJobDescription}
        />
        <div className="flex flex-col gap-2">
          <span className="text-label text-muted">Focus</span>
          <SegmentedControl options={Object.entries(FOCUS_LABELS).map(([value, label]) => ({ value: value as Focus, label }))} value={focus} onValueChange={setFocus} />
        </div>
        <div className="flex flex-wrap gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-label text-muted">Interviewer</span>
            <SegmentedControl options={Object.entries(DIFFICULTY_LABELS).map(([value, label]) => ({ value: value as Difficulty, label }))} value={difficulty} onValueChange={setDifficulty} />
          </div>
          <label className="flex flex-col gap-2">
            <span className="text-label text-muted">Main questions</span>
            <span className="flex flex-wrap items-center gap-3">
              <input type="range" min={2} max={10} value={questions} onChange={(event) => setQuestions(Number(event.target.value))} className="w-36 accent-[var(--color-primary)]" />
              <span className="w-6 text-sm font-semibold tabular-nums">{questions}</span>
            </span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={pending || disabled}>
            {pending ? "Setting up…" : "Start practising"}
          </Button>
          <span className="text-meta text-muted">About {questions * 3} minutes. You can end early any time.</span>
        </div>
      </form>
    </Card>
  );
}
