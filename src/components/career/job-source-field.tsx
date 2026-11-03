"use client";

import { useId, useState } from "react";

import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** A saved application whose posting can be reused, so nothing is pasted twice. */
export type ApplicationOption = { id: string; label: string; company: string; role: string; postingText: string };

/**
 * Where an agent gets its job description: one of the user's applications
 * (its posting, company and role come along), or pasted here.
 */
export function JobSourceField({
  applications,
  applicationId,
  onApplicationChange,
  text,
  onTextChange,
  label = "Job description",
  hint,
  required = false,
}: {
  applications: ApplicationOption[];
  applicationId: string;
  onApplicationChange: (application: ApplicationOption | null) => void;
  text: string;
  onTextChange: (text: string) => void;
  label?: string;
  hint?: string;
  required?: boolean;
}) {
  const id = useId();
  const [pasting, setPasting] = useState(!applicationId);
  const chosen = applications.find((application) => application.id === applicationId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      {applications.length > 0 && (
        <Select
          id={`${id}-application`}
          label="From one of your applications"
          value={applicationId}
          onChange={(event) => {
            const next = applications.find((application) => application.id === event.target.value) ?? null;
            setPasting(!next);
            onApplicationChange(next);
            if (next) onTextChange(next.postingText);
          }}
        >
          <option value="">None: paste a job description</option>
          {applications.map((application) => (
            <option key={application.id} value={application.id}>
              {application.label}
            </option>
          ))}
        </Select>
      )}
      {pasting || !chosen ? (
        <Textarea
          id={`${id}-text`}
          label={label}
          hint={hint ?? "Paste the whole posting: responsibilities, requirements, anything about the team."}
          rows={8}
          value={text}
          required={required}
          onChange={(event) => onTextChange(event.target.value)}
          textareaClassName="max-h-[420px] text-sm"
        />
      ) : (
        <div className="rounded-control border border-line-field bg-card px-3 py-2.5 text-sm text-muted">
          Using the posting saved with <span className="font-medium text-ink">{chosen.label}</span> ({chosen.postingText.length.toLocaleString()} characters).{" "}
          <button type="button" className="underline underline-offset-3 hover:text-ink" onClick={() => setPasting(true)}>
            Edit it here
          </button>
        </div>
      )}
    </div>
  );
}
