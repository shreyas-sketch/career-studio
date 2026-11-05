"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parseManifest } from "@/lib/fde/linkedin-url";

import { createPilot } from "../actions";

export function NewPilot() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [manifest, setManifest] = useState("");
  const [limit, setLimit] = useState("1");
  const [pending, start] = useTransition();
  const parsed = useMemo(() => parseManifest(manifest), [manifest]);
  return (
    <form
      className="flex flex-col gap-4 rounded-panel border border-line-card bg-card p-7 max-sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const result = toastResult(await createPilot({ name, manifest, spendLimitUsd: Number(limit) || 1, concurrency: 2, filters: { location: "", remoteOnly: false, seniority: "any" } }));
          if (result.ok) router.push(`/fde/pilot/${result.data.id}`);
        });
      }}
    >
      <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Pilot, November" />
      <Textarea label="Public profile addresses, one per line" rows={8} value={manifest} onChange={(event) => setManifest(event.target.value)} placeholder="https://www.linkedin.com/in/their-name" />
      {manifest.trim() && (
        <p className="text-meta text-muted" role="status">
          {parsed.urls.length} distinct {parsed.urls.length === 1 ? "profile" : "profiles"}, {parsed.duplicates} duplicates, {parsed.rejected.length} invalid
        </p>
      )}
      <Input label="Spending limit in dollars" inputMode="decimal" value={limit} onChange={(event) => setLimit(event.target.value)} hint="A hard stop on paid retrieval across the whole pilot. Your AI model's costs are separate." />
      <div>
        <Button type="submit" disabled={pending || parsed.urls.length === 0}>See the estimate</Button>
      </div>
    </form>
  );
}
