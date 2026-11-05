"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ConnectionCheck } from "@/lib/fde/providers/types";

import { checkConnection } from "../fde/actions";

export type FdeSettingsView = {
  provider: string;
  isFixture: boolean;
  tokenSet: boolean;
  runLimit: string;
  dailyLimit: string;
  spentToday: string;
  accountDailyReports: number;
  shortlistSize: number;
  benchmarkHours: number;
  retentionDays: number;
};

const LINKS: [string, string][] = [
  ["Sign up or sign in to Treg", "https://treg.to/app"],
  ["Treg documentation", "https://treg.to/docs"],
  ["HarvestAPI tools on Treg", "https://treg.to/tools/harvestapi"],
  ["The profile tool and its price", "https://treg.to/catalog/linkedin/user.profile"],
  ["HarvestAPI's documentation", "https://docs.harvestapi.io/"],
];

/** Whether the review can read profiles, without ever showing or taking a token here. */
export function FdeSection({ view }: { view: FdeSettingsView }) {
  const [check, setCheck] = useState<ConnectionCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="font-serif text-section">Profile and job retrieval</h2>
            <p className="text-sm text-pretty text-muted">The server reads LinkedIn through {view.isFixture ? "sample data" : "Treg and HarvestAPI"}. It&apos;s set once on the server, not per account, and the AI connection in AI provider is separate.</p>
          </div>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted">Provider</dt>
            <dd className="text-right">{view.provider}</dd>
            <dt className="text-muted">TREG_API_TOKEN</dt>
            <dd className="text-right">{view.isFixture ? "Not needed in fixture mode" : view.tokenSet ? "Set on the server" : "Not set"}</dd>
            <dt className="text-muted">Limit per run</dt>
            <dd className="text-right tabular-nums">{view.runLimit}</dd>
            <dt className="text-muted">Daily limit, whole server</dt>
            <dd className="text-right tabular-nums">{view.dailyLimit}</dd>
            <dt className="text-muted">Spent today, whole server</dt>
            <dd className="text-right tabular-nums">{view.spentToday}</dd>
            <dt className="text-muted">Reviews per account per day</dt>
            <dd className="text-right tabular-nums">{view.accountDailyReports}</dd>
            <dt className="text-muted">Roles in a sample</dt>
            <dd className="text-right tabular-nums">{view.shortlistSize}</dd>
            <dt className="text-muted">A market sample is reused for</dt>
            <dd className="text-right tabular-nums">{view.benchmarkHours} hours</dd>
            <dt className="text-muted">Reports are kept for</dt>
            <dd className="text-right tabular-nums">{view.retentionDays} days</dd>
          </dl>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await checkConnection({});
                  if (result.ok) {
                    setCheck(result.data);
                    setError(null);
                  } else setError(result.error);
                })
              }
            >
              {pending ? "Checking" : "Check the connection"}
            </Button>
            <span className="text-meta text-muted">This uses a free tool, so it costs nothing.</span>
          </div>
          {check && <p role="status" className={check.ok ? "text-sm text-success" : "text-sm text-error"}>{check.message}</p>}
          {error && <p role="status" className="text-sm text-error">{error}</p>}
        </div>
      </Card>
      {!view.tokenSet && !view.isFixture && (
        <Card>
          <div className="flex flex-col gap-3 text-sm">
            <h2 className="font-serif text-section">One thing left to set up</h2>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-pretty">
              <li>Create a Treg account and copy a team or agent token.</li>
              <li>Add it as the variable TREG_API_TOKEN on the server. On Railway: your service, then Variables, then New Variable.</li>
              <li>Let the service redeploy, then come back and check the connection.</li>
            </ol>
            <p className="text-pretty text-muted">Never paste the token into a chat, a screenshot or this app. It belongs only in the server&apos;s variables.</p>
            <ul className="flex flex-col gap-1">
              {LINKS.map(([label, href]) => (
                <li key={href}>
                  <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{label}</a>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
    </div>
  );
}
