"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { JobSourceField, type ApplicationOption } from "@/components/career/job-source-field";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { startSkillPlan } from "./actions";

export function NewPlan({ applications, disabled, prefill }: { applications: ApplicationOption[]; disabled: boolean; prefill: { skill: string; role: string; applicationId: string } }) {
  const router = useRouter();
  const initial = applications.find((application) => application.id === prefill.applicationId) ?? null;
  const [applicationId, setApplicationId] = useState(initial?.id ?? "");
  const [targetRole, setTargetRole] = useState(prefill.role || initial?.role || "");
  const [jobDescription, setJobDescription] = useState(initial?.postingText ?? "");
  const [skill, setSkill] = useState(prefill.skill);
  const [hours, setHours] = useState(5);
  const [weeks, setWeeks] = useState(8);
  const [context, setContext] = useState("");
  const [pending, start] = useTransition();

  return (
    <Card>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          start(async () => {
            const result = toastResult(await startSkillPlan({ targetRole, jobDescription, skill, hoursPerWeek: hours, weeks, context, applicationId: applicationId || null }));
            if (result.ok) router.push(`/skills/${result.data.id}`);
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Skill to develop" value={skill} onChange={(event) => setSkill(event.target.value)} placeholder="SQL for product analytics" />
          <Input label="Target role or kind of work" value={targetRole} onChange={(event) => setTargetRole(event.target.value)} placeholder="Product analyst" />
        </div>
        <JobSourceField
          applications={applications}
          applicationId={applicationId}
          onApplicationChange={(application) => {
            setApplicationId(application?.id ?? "");
            if (application) setTargetRole(application.role);
          }}
          text={jobDescription}
          onTextChange={setJobDescription}
          label="A job description you're aiming at (recommended)"
          hint="The plan is much more specific with a real posting."
        />
        <div className="flex flex-wrap gap-8">
          <label className="flex flex-col gap-2">
            <span className="text-label text-muted">Hours a week</span>
            <span className="flex items-center gap-3">
              <input type="range" min={1} max={30} value={hours} onChange={(event) => setHours(Number(event.target.value))} className="w-40 accent-[var(--color-primary)]" />
              <span className="w-8 text-sm font-semibold tabular-nums">{hours}</span>
            </span>
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-label text-muted">For how many weeks</span>
            <span className="flex items-center gap-3">
              <input type="range" min={1} max={26} value={weeks} onChange={(event) => setWeeks(Number(event.target.value))} className="w-40 accent-[var(--color-primary)]" />
              <span className="w-8 text-sm font-semibold tabular-nums">{weeks}</span>
            </span>
          </label>
          <span className="self-end text-meta text-muted">{hours * weeks} hours in all</span>
        </div>
        <Textarea
          label="Your starting point (optional)"
          rows={3}
          value={context}
          onChange={(event) => setContext(event.target.value)}
          hint="Anything your profile doesn't say: what you've tried, what you know already, how you learn best."
        />
        <Button type="submit" size="lg" disabled={pending || disabled}>
          {pending ? "Starting…" : "Make my plan"}
        </Button>
      </form>
    </Card>
  );
}
