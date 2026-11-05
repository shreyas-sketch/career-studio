"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { deletePilot, runPilotBatch } from "../../actions";

const BATCH = 5;

export function PilotControls({ id, pending, done, running, nextEstimate, configured }: { id: string; pending: number; done: number; running: boolean; nextEstimate: string; configured: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [running, router]);
  const next = Math.min(pending, BATCH);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {pending > 0 && (
        <Button disabled={busy || running || !configured} onClick={() => start(async () => { toastResult(await runPilotBatch({ id, count: next })); router.refresh(); })}>
          {running ? "Running" : done === 0 ? `Run the first ${next}` : `Run the next ${next}`}
        </Button>
      )}
      {pending > 0 && !running && <span className="text-meta text-muted">Up to about {nextEstimate} in retrieval</span>}
      {!configured && <span className="text-sm text-warning">TREG_API_TOKEN isn&apos;t set on the server.</span>}
      <Button variant="secondary" disabled={busy || running} onClick={() => start(async () => { const result = toastResult(await deletePilot({ id })); if (result.ok) router.push("/fde/pilot"); })}>
        Delete pilot
      </Button>
    </div>
  );
}
