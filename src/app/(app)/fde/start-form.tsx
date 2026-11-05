"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { parseProfileUrl } from "@/lib/fde/linkedin-url";

import { startReview } from "./actions";

export function StartForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [location, setLocation] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [seniority, setSeniority] = useState<"any" | "accessible" | "aspirational">("any");
  const [pending, start] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const parsed = parseProfileUrl(url);
        if (!parsed.ok) {
          setError(parsed.error);
          return;
        }
        setError(undefined);
        start(async () => {
          const result = toastResult(await startReview({ url, filters: { location: location.trim(), remoteOnly, seniority } }));
          if (result.ok) router.push(`/fde/${result.data.id}`);
        });
      }}
    >
      <Input
        label="Public LinkedIn profile"
        value={url}
        onChange={(event) => {
          setUrl(event.target.value);
          setError(undefined);
        }}
        placeholder="https://www.linkedin.com/in/their-name"
        inputMode="url"
        autoComplete="off"
        error={error}
        hint="Anyone's public profile. It stays private to this account and never touches your own profile."
      />
      <details className="group rounded-control">
        <summary className="cursor-pointer text-sm text-muted hover:text-ink">Narrow the market search (optional)</summary>
        <div className="mt-3 flex flex-col gap-4">
          <p className="text-sm text-pretty text-muted">The search is global unless you narrow it here. Your own saved preferences aren&apos;t used.</p>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
            <Input label="Location" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Any location" />
            <Select label="Seniority" value={seniority} onChange={(event) => setSeniority(event.target.value as typeof seniority)}>
              <option value="any">All levels</option>
              <option value="accessible">Leave out senior roles</option>
              <option value="aspirational">Senior roles only</option>
            </Select>
          </div>
          <Checkbox label="Remote roles only" checked={remoteOnly} onChange={(event) => setRemoteOnly(event.target.checked)} />
        </div>
      </details>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Starting" : "Review this profile"}
        </Button>
      </div>
    </form>
  );
}
