"use client";

import { useEffect, useState, useTransition } from "react";

import { Section } from "@/components/career/parts";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { LiveStatus } from "@/lib/public-fde/admin";

import { loadLive, runChecks, setControls, warmMarket } from "./actions";

const STAGES: [string, string][] = [
  ["profile_queued", "Waiting to read"],
  ["profile_running", "Reading profile"],
  ["analysis_queued", "Waiting for analysis"],
  ["analysis_running", "Analysing"],
  ["finished", "Finished"],
  ["failed", "Failed"],
];

const money = (usd: number) => `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
const minutes = (seconds: number | null) => (seconds === null ? "—" : seconds < 90 ? `${Math.round(seconds)} s` : `${(seconds / 60).toFixed(1)} min`);

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-card border border-line-card bg-card px-4 py-3">
      <div className="text-meta text-muted">{label}</div>
      <div className={`mt-1 text-xl font-medium tabular-nums ${tone === "warn" ? "text-warning" : ""}`}>{value}</div>
    </div>
  );
}

export function LiveConsole({ initial }: { initial: LiveStatus }) {
  const [live, setLive] = useState(initial);
  const [checks, setChecks] = useState<{ model: { ok: boolean; message: string }; data: { ok: boolean; message: string } } | null>(null);
  const [pending, start] = useTransition();
  const [profileLane, setProfileLane] = useState(initial.controls.lanes.profile);
  const [analysisLane, setAnalysisLane] = useState(initial.controls.lanes.analysis);

  useEffect(() => {
    const timer = setInterval(async () => {
      const result = await loadLive({});
      if (result.ok) setLive(result.data);
    }, 5_000);
    return () => clearInterval(timer);
  }, []);

  const apply = (input: Parameters<typeof setControls>[0]) =>
    start(async () => {
      const result = await setControls(input);
      toastResult(result);
      if (result.ok) setLive(result.data);
    });

  const { controls, config } = live;
  const open = (live.counts.profile_queued ?? 0) + (live.counts.profile_running ?? 0) + (live.counts.analysis_queued ?? 0) + (live.counts.analysis_running ?? 0);

  return (
    <div className="flex flex-col gap-10">
      {(controls.profilePaused || controls.analysisPaused || controls.intakePaused) && (
        <p role="status" className="rounded-card border border-warning-line bg-warning-surface px-5 py-4 text-sm text-pretty">
          {controls.intakePaused && "New reports are paused. "}
          {controls.profilePaused && "Profile reading is paused. "}
          {controls.analysisPaused && "Analysis is paused. "}
          {controls.pauseReason}
        </p>
      )}
      {(!config.modelKeySet || !config.tregTokenSet) && (
        <p className="rounded-card border border-warning-line bg-warning-surface px-5 py-4 text-sm text-pretty">
          {!config.modelKeySet && "ANTHROPIC_API_KEY isn't set: reports are accepted and profiles read, but analysis waits until it is. "}
          {!config.tregTokenSet && "TREG_API_TOKEN isn't set: profiles can't be read."}
        </p>
      )}

      <Section title="Right now" description={`Model ${config.model}. Updates every 5 seconds.`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {STAGES.map(([key, label]) => (
            <Stat key={key} label={label} value={String(live.counts[key] ?? 0)} tone={key === "failed" && (live.counts[key] ?? 0) > 0 ? "warn" : undefined} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Open reports" value={`${open} / ${config.maxOpenReports}`} />
          <Stat label="Longest wait" value={minutes(live.oldestWaitingSeconds)} />
          <Stat label="Median analysis (last hour)" value={minutes(live.medianAnalysisSeconds)} />
          <Stat label="Finished in the last hour" value={String(live.finishedLastHour)} />
        </div>
      </Section>

      <Section title="Controls" description="Pausing never loses a report: queued ones keep their place and carry on when resumed.">
        <div className="flex flex-wrap gap-2">
          <Button variant={controls.intakePaused ? "primary" : "secondary"} disabled={pending} onClick={() => apply({ intakePaused: !controls.intakePaused })}>
            {controls.intakePaused ? "Accept new reports" : "Pause new reports"}
          </Button>
          <Button variant={controls.profilePaused ? "primary" : "secondary"} disabled={pending} onClick={() => apply({ profilePaused: !controls.profilePaused })}>
            {controls.profilePaused ? "Resume profile reading" : "Pause profile reading"}
          </Button>
          <Button variant={controls.analysisPaused ? "primary" : "secondary"} disabled={pending} onClick={() => apply({ analysisPaused: !controls.analysisPaused })}>
            {controls.analysisPaused ? "Resume analysis" : "Pause analysis"}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => apply({ intakePaused: true, profilePaused: true, analysisPaused: true })}>
            Stop everything
          </Button>
        </div>
        <form
          className="mt-5 flex flex-wrap items-end gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            apply({ profileLane, analysisLane });
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            Profiles read at once
            <input type="number" min={0} max={20} value={profileLane} onChange={(event) => setProfileLane(Number(event.target.value))} className="w-28 rounded-control border border-line-input bg-input px-3 py-2 tabular-nums" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Reports analysed at once
            <input type="number" min={0} max={20} value={analysisLane} onChange={(event) => setAnalysisLane(Number(event.target.value))} className="w-28 rounded-control border border-line-input bg-input px-3 py-2 tabular-nums" />
          </label>
          <Button type="submit" variant="secondary" disabled={pending}>Save</Button>
          <p className="text-meta text-muted">Each analysis makes up to 3 model requests at once. Lower this if the model service starts limiting requests.</p>
        </form>
      </Section>

      <Section title="Before the call">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={pending} onClick={() => start(async () => { const result = await runChecks({}); toastResult(result); if (result.ok) setChecks(result.data); })}>
            Check both services (free)
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => start(async () => { toastResult(await warmMarket({})); const result = await loadLive({}); if (result.ok) setLive(result.data); })}>
            Prepare market now
          </Button>
        </div>
        {checks && (
          <ul className="mt-4 flex flex-col gap-1 text-sm">
            <li className={checks.model.ok ? "" : "text-warning"}>Model: {checks.model.message}</li>
            <li className={checks.data.ok ? "" : "text-warning"}>Profile and job data: {checks.data.message}</li>
          </ul>
        )}
        <p className="mt-4 text-sm text-pretty">
          {live.benchmark
            ? `Market sample v${live.benchmark.version}: ${live.benchmark.roles} roles across ${live.benchmark.employers} employers, built ${new Date(live.benchmark.discoveredAt).toLocaleString()}, reused until ${new Date(live.benchmark.expiresAt).toLocaleString()}.`
            : "No market sample yet. The first report builds it (a few minutes) and everyone after reuses it; preparing it now avoids that wait."}
        </p>
      </Section>

      <Section title="Spend today" description="Real charges: the data service's own figures and the model's reported tokens at the configured price.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Spent" value={money(live.spentTodayUsd)} />
          <Stat label="Set aside for open reports" value={money(live.reservedUsd)} />
          <Stat label="Left of today's budget" value={money(live.budgetLeftUsd)} tone={live.budgetLeftUsd < config.reservePerReportUsd * 5 ? "warn" : undefined} />
          <Stat label="Daily budget" value={money(config.dailyBudgetUsd)} />
        </div>
        {live.spend.length > 0 && (
          <table className="mt-4 w-full text-sm tabular-nums">
            <thead className="text-left text-meta text-muted">
              <tr><th className="py-1 font-normal">Kind</th><th className="font-normal">Calls</th><th className="font-normal">Tokens in / out</th><th className="text-right font-normal">Cost</th></tr>
            </thead>
            <tbody>
              {live.spend.map((row) => (
                <tr key={row.kind} className="border-t border-line">
                  <td className="py-1.5">{row.kind}</td><td>{row.calls}</td><td>{row.tokensIn.toLocaleString()} / {row.tokensOut.toLocaleString()}</td><td className="text-right">{money(row.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Cool-downs and incidents" description="Visitors see only a reference like FDE-1A2B3C4D; find it here.">
        {live.cooldowns.length > 0 && (
          <ul className="mb-4 flex flex-col gap-1 text-sm">
            {live.cooldowns.map((cooldown) => (
              <li key={cooldown.provider}>{cooldown.provider} paused until {new Date(cooldown.until).toLocaleTimeString()} ({cooldown.reason})</li>
            ))}
          </ul>
        )}
        {live.incidents.length === 0 ? (
          <p className="text-sm text-muted">Nothing has gone wrong.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {live.incidents.map((incident) => (
              <li key={incident.ref} className="flex flex-wrap gap-x-3 py-2">
                <span className="font-mono">{incident.ref}</span>
                <span className="text-muted">{new Date(incident.at).toLocaleTimeString()}</span>
                <span>{incident.scope}: {incident.code}</span>
                <span className="w-full text-pretty text-muted">{incident.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
