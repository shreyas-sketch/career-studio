import "server-only";

import { accountsQuery } from "@/lib/accounts/db";
import { prisma } from "@/lib/prisma";

import { fdeConfig, USD } from "./config";
import { ProviderError, type Charge } from "./providers/types";
import type { UsageKind } from "./types";

// Every paid call asks here first. A limit stops the call before it's made, so
// a run can't overspend by retrying or by a long list of addresses. Reported
// charges are recorded per kind, so profile reads, discovery, job details and
// model use stay separate.

const today = (now = new Date()) => now.toISOString().slice(0, 10);

export async function spentToday(now = new Date()): Promise<number> {
  const { rows } = await accountsQuery<{ cost_micro: string }>(`SELECT cost_micro FROM cs_shared.fde_spend WHERE day = $1`, [today(now)]);
  return Number(rows[0]?.cost_micro ?? 0);
}

async function addToToday(costMicro: number): Promise<void> {
  if (costMicro <= 0) return;
  await accountsQuery(
    `INSERT INTO cs_shared.fde_spend (day, cost_micro) VALUES ($1, $2)
     ON CONFLICT (day) DO UPDATE SET cost_micro = cs_shared.fde_spend.cost_micro + EXCLUDED.cost_micro`,
    [today(), costMicro],
  );
}

export class SpendMeter {
  private readonly total: { spent: number };
  constructor(
    private readonly reportId: string | null,
    private readonly runLimitMicro: number = fdeConfig().runSpendLimitMicro,
    private readonly dailyLimitMicro: number = fdeConfig().dailySpendLimitMicro,
    total: { spent: number } = { spent: 0 },
  ) {
    this.total = total;
  }

  /** The same limit and running total, recording against one report of a batch. */
  forReport(reportId: string): SpendMeter {
    return new SpendMeter(reportId, this.runLimitMicro, this.dailyLimitMicro, this.total);
  }

  get totalMicro(): number {
    return this.total.spent;
  }

  private get spent(): number {
    return this.total.spent;
  }

  /** Refuses a call that could take this run or today's total over its limit. */
  async authorize(estimateMicro: number): Promise<void> {
    if (this.spent + estimateMicro > this.runLimitMicro) {
      throw new ProviderError("spend_limit", `This run reached its limit of $${(this.runLimitMicro / USD).toFixed(2)} (FDE_RUN_SPEND_LIMIT_USD), so the next paid call wasn't made.`);
    }
    if ((await spentToday()) + estimateMicro > this.dailyLimitMicro) {
      throw new ProviderError("spend_limit", `Today's limit of $${(this.dailyLimitMicro / USD).toFixed(2)} (FDE_DAILY_SPEND_LIMIT_USD) has been reached, so the next paid call wasn't made.`);
    }
  }

  async record(kind: UsageKind, charge: Charge): Promise<void> {
    this.total.spent += charge.costMicro;
    await addToToday(charge.costMicro);
    await prisma.fdeUsage.create({
      data: { reportId: this.reportId, kind, provider: charge.provider, tool: charge.tool, costMicro: charge.costMicro, cached: charge.cached, callId: charge.callId },
    });
  }

  async recordModel(tool: string, provider: string, tokens: number): Promise<void> {
    const rate = fdeConfig().modelUsdPerMillionTokens;
    await prisma.fdeUsage.create({
      data: { reportId: this.reportId, kind: "model", provider, tool, tokens, estimated: true, costMicro: rate === null ? 0 : Math.round(tokens * rate) },
    });
  }
}
