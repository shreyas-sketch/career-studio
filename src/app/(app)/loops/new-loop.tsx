"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { JobSourceField, type ApplicationOption } from "@/components/career/job-source-field";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ToggleChip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { ROUND_KIND_LABELS } from "@/lib/career/interview-data";

import { createLoop } from "./actions";

type Kind = keyof typeof ROUND_KIND_LABELS;
const DEFAULT: Kind[] = ["RECRUITER_SCREEN", "HIRING_MANAGER", "TECHNICAL", "FINAL"];

export function NewLoop({ applications, preselect }: { applications: ApplicationOption[]; preselect: string }) {
  const router = useRouter();
  const initial = applications.find((application) => application.id === preselect) ?? null;
  const [applicationId, setApplicationId] = useState(initial?.id ?? "");
  const [company, setCompany] = useState(initial?.company ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [jobDescription, setJobDescription] = useState(initial?.postingText ?? "");
  const [rounds, setRounds] = useState<Kind[]>(DEFAULT);
  const [pending, start] = useTransition();

  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          start(async () => {
            const result = toastResult(await createLoop({ company, role, jobDescription, applicationId: applicationId || null, rounds }));
            if (result.ok) router.push(`/loops/${result.data.id}`);
          });
        }}
      >
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
          hint="Optional, but prep is much better with it."
        />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
          <Input label="Company" value={company} onChange={(event) => setCompany(event.target.value)} />
          <Input label="Role" value={role} onChange={(event) => setRole(event.target.value)} />
        </div>
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1 text-label text-muted">Rounds they&apos;ve mentioned (you can change them later)</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(ROUND_KIND_LABELS) as Kind[]).map((kind) => (
              <ToggleChip
                key={kind}
                selected={rounds.includes(kind)}
                onClick={() => setRounds((current) => (current.includes(kind) ? current.filter((value) => value !== kind) : [...current, kind]))}
              >
                {ROUND_KIND_LABELS[kind]}
              </ToggleChip>
            ))}
          </div>
        </fieldset>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Start the loop"}
        </Button>
      </form>
    </Card>
  );
}
