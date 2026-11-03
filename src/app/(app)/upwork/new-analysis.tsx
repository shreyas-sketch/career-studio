"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { analyzeUpwork } from "./actions";
import { NumbersFields, type Numbers } from "./numbers";

export function NewAnalysis({
  disabled,
  prefill,
  defaults,
}: {
  disabled: boolean;
  prefill: string;
  defaults: { serviceFeePercent: number | null; minimumHourlyUsd: number | null; connectsBalance: number | null; connectPriceUsd: number };
}) {
  const router = useRouter();
  const [jobText, setJobText] = useState(prefill);
  const [jobUrl, setJobUrl] = useState("");
  const [numbers, setNumbers] = useState<Numbers>({ connectsRequired: null, boostConnects: 0, ...defaults });
  const [pending, start] = useTransition();

  return (
    <Card>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          start(async () => {
            const result = toastResult(await analyzeUpwork({ jobText, jobUrl, inputs: numbers }));
            if (result.ok) router.push(`/upwork/${result.data.id}`);
          });
        }}
      >
        <Textarea
          label="The job post"
          hint="Everything from the title down: description, budget, duration, experience level, screening questions, and what the client's box says about them."
          rows={10}
          value={jobText}
          onChange={(event) => setJobText(event.target.value)}
          textareaClassName="text-sm"
        />
        <Input label="Link to the job (optional)" type="url" value={jobUrl} onChange={(event) => setJobUrl(event.target.value)} placeholder="https://www.upwork.com/jobs/…" />
        <NumbersFields value={numbers} onChange={setNumbers} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={pending || disabled}>
            {pending ? "Starting…" : "Analyse this job"}
          </Button>
          <span className="text-meta text-muted">You can fill in the numbers later; the money is worked out from them, never guessed.</span>
        </div>
      </form>
    </Card>
  );
}
