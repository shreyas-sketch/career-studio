"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { ApplicationOption } from "@/components/career/job-source-field";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import { newVersion } from "./actions";

export function NewVersion({ versions, applications }: { versions: { id: string; name: string }[]; applications: ApplicationOption[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [copyOf, setCopyOf] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [pending, start] = useTransition();

  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          start(async () => {
            const result = toastResult(await newVersion({ name: name || target || "Untitled resume", target, copyOf: copyOf || null, applicationId: applicationId || null }));
            if (result.ok) router.push(`/resumes/${result.data.id}${applicationId ? "?tab=tailor" : ""}`);
          });
        }}
      >
        <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Product design, 2026" />
        <Input label="The role it aims at" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="Senior product designer, fintech" />
        <Select label="Start from" value={copyOf} onChange={(event) => setCopyOf(event.target.value)}>
          <option value="">Your profile</option>
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              A copy of “{version.name}”
            </option>
          ))}
        </Select>
        {applications.length > 0 && (
          <Select label="For an application (optional)" value={applicationId} onChange={(event) => setApplicationId(event.target.value)}>
            <option value="">None</option>
            {applications.map((application) => (
              <option key={application.id} value={application.id}>
                {application.label}
              </option>
            ))}
          </Select>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create resume"}
        </Button>
      </form>
    </Card>
  );
}
