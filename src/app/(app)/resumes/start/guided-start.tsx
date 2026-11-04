"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ProgressSteps } from "@/components/ui/progress-steps";
import { Textarea } from "@/components/ui/textarea";

import { startGuided } from "../actions";

type Role = { role: string; company: string; dates: string; did: string };
const EMPTY_ROLE: Role = { role: "", company: "", dates: "", did: "" };
const STEPS = ["About you", "Your work", "Skills and education"] as const;

export function GuidedStart({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [headline, setHeadline] = useState("");
  const [location, setLocation] = useState("");
  const [roles, setRoles] = useState<Role[]>([{ ...EMPTY_ROLE }]);
  const [education, setEducation] = useState("");
  const [skills, setSkills] = useState("");
  const [extra, setExtra] = useState("");
  const [pending, start] = useTransition();
  const setRole = (index: number, change: Partial<Role>) => setRoles((current) => current.map((role, i) => (i === index ? { ...role, ...change } : role)));

  return (
    <Card className="flex flex-col gap-6">
      <ProgressSteps steps={STEPS} current={step} />
      {step === 0 && (
        <div className="flex flex-col gap-4 motion-safe:animate-rise-in">
          <Input label="Your full name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          <Input label="What you do, in a line" hint="e.g. “Product designer for fintech” or “Final-year computer science student”" value={headline} onChange={(event) => setHeadline(event.target.value)} />
          <Input label="Where you're based" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Pune, India" />
        </div>
      )}
      {step === 1 && (
        <div className="flex flex-col gap-5 motion-safe:animate-rise-in">
          <p className="text-sm text-muted">Most recent first. Jobs, internships, freelance clients, volunteering and big projects all count. For each, say what you did and, where you know it, what came of it: numbers help, but only ones you&apos;re sure of.</p>
          {roles.map((role, index) => (
            <fieldset key={index} className="flex flex-col gap-3 rounded-card border border-line-card p-4">
              <legend className="px-1 text-label text-muted">Role {index + 1}</legend>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
                <Input label="Title" value={role.role} onChange={(event) => setRole(index, { role: event.target.value })} />
                <Input label="Where" value={role.company} onChange={(event) => setRole(index, { company: event.target.value })} />
                <Input label="When" value={role.dates} onChange={(event) => setRole(index, { dates: event.target.value })} placeholder="Mar 2023 – now" />
              </div>
              <Textarea label="What you did, and what came of it" rows={4} value={role.did} onChange={(event) => setRole(index, { did: event.target.value })} hint="One point per line." />
              {roles.length > 1 && (
                <Button variant="text" size="sm" className="self-start" onClick={() => setRoles((current) => current.filter((_, i) => i !== index))}>
                  <X size={13} aria-hidden="true" /> Remove
                </Button>
              )}
            </fieldset>
          ))}
          {roles.length < 6 && (
            <Button variant="secondary" size="sm" className="self-start" onClick={() => setRoles((current) => [...current, { ...EMPTY_ROLE }])}>
              <Plus size={14} aria-hidden="true" /> Another role
            </Button>
          )}
        </div>
      )}
      {step === 2 && (
        <div className="flex flex-col gap-4 motion-safe:animate-rise-in">
          <Textarea label="Skills and tools" rows={3} value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="Figma, user research, SQL, English (fluent), Hindi (native)" />
          <Textarea label="Education and certificates" rows={3} value={education} onChange={(event) => setEducation(event.target.value)} placeholder="B.Des, NID Ahmedabad, 2019–2023" />
          <Textarea label="Anything else worth knowing" rows={3} value={extra} onChange={(event) => setExtra(event.target.value)} hint="Awards, side projects, what you want next. It's kept as facts about you for the AI, never printed as is." />
        </div>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
        <Button variant="text" disabled={step === 0} onClick={() => setStep((value) => value - 1)}>
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep((value) => value + 1)}>Next</Button>
        ) : (
          <Button
            disabled={pending || disabled}
            onClick={() =>
              start(async () => {
                const result = toastResult(await startGuided({ name, headline, location, roles, education, skills, extra }));
                if (result.ok) router.push(`/profile/import?job=${result.data.jobId}`);
              })
            }
          >
            {pending ? "Sending…" : "Build my profile"}
          </Button>
        )}
      </div>
    </Card>
  );
}
