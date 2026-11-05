"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { fdeConfig, retrievalProvider } from "@/lib/fde/config";
import { parseManifest } from "@/lib/fde/linkedin-url";
import { fdePilotJob, pilotJobKey, type PilotItem } from "@/lib/fde/review";
import { refreshReview, retryReview, startReview as beginReview } from "@/lib/fde/start";
import { filtersSchema } from "@/lib/fde/types";
import { startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/tenancy/context";

const id = z.string().min(1).max(64);

export const startReview = action(z.object({ url: z.string().max(400), filters: filtersSchema }), async (input) => {
  const started = await beginReview(input);
  revalidatePath("/fde");
  return started;
});

export const refreshReport = action(z.object({ id, refreshMarket: z.boolean() }), async (input) => {
  const started = await refreshReview(input);
  revalidatePath("/fde");
  return started;
});

export const retryReport = action(z.object({ id }), async ({ id: reportId }) => {
  await retryReview(reportId);
  return null;
});

export const deleteReport = action(z.object({ id }), async ({ id: reportId }, { toast }) => {
  await prisma.fdeReport.deleteMany({ where: { id: reportId, ownerUserId: requireUserId() } });
  // A snapshot of someone's profile goes when the last report using it does.
  await prisma.fdeProfileSnapshot.deleteMany({ where: { reports: { none: {} } } });
  revalidatePath("/fde");
  toast("Report deleted.");
  return null;
});

/** Progress on a learning plan. This is all it does: no score ever reads it. */
export const setLearningStep = action(z.object({ id, stepId: z.string().max(80), done: z.boolean() }), async ({ id: reportId, stepId, done }) => {
  const report = await prisma.fdeReport.findFirst({ where: { id: reportId, ownerUserId: requireUserId() }, select: { learningProgress: true } });
  if (!report) throw new ActionError("That report doesn't exist.");
  const steps = new Set(report.learningProgress as string[]);
  if (done) steps.add(stepId);
  else steps.delete(stepId);
  await prisma.fdeReport.update({ where: { id: reportId }, data: { learningProgress: [...steps] } });
  return [...steps];
});

export const checkConnection = action(z.object({}), async () => retrievalProvider().checkConnection());

// ─── The pilot ───────────────────────────────────────────────

export const createPilot = action(
  z.object({ name: z.string().max(120), manifest: z.string().max(60_000), spendLimitUsd: z.number().positive().max(100), concurrency: z.number().int().min(1).max(3), filters: filtersSchema }),
  async ({ name, manifest, spendLimitUsd, concurrency, filters }) => {
    const parsed = parseManifest(manifest);
    if (parsed.urls.length === 0) throw new ActionError("The list has no valid profile addresses.");
    const items: PilotItem[] = parsed.urls.map(({ url, slug }) => ({ url, slug, state: "pending", reportId: null, note: "" }));
    const pilot = await prisma.fdePilot.create({
      data: { ownerUserId: requireUserId(), name: name.trim() || `Pilot of ${items.length}`, items, rejected: parsed.rejected, filters, concurrency, spendLimitMicro: Math.round(spendLimitUsd * 1_000_000), state: "draft" },
      select: { id: true },
    });
    revalidatePath("/fde/pilot");
    return { id: pilot.id };
  },
);

/** Runs the next few addresses. Nothing runs by itself: each batch is asked for. */
export const runPilotBatch = action(z.object({ id, count: z.number().int().min(1).max(200) }), async ({ id: pilotId, count }) => {
  const pilot = await prisma.fdePilot.findFirst({ where: { id: pilotId, ownerUserId: requireUserId() }, select: { id: true } });
  if (!pilot) throw new ActionError("That pilot doesn't exist.");
  if (!retrievalProvider().isConfigured()) throw new ActionError("TREG_API_TOKEN isn't set on the server, so there's nothing to read profiles with.");
  if (!fdeConfig().fixtureMode && count > 200) throw new ActionError("That's too many at once.");
  const jobId = await startJob(fdePilotJob, { id: pilotId, count }, { key: pilotJobKey(pilotId) });
  revalidatePath(`/fde/pilot/${pilotId}`);
  return { jobId };
});

export const deletePilot = action(z.object({ id }), async ({ id: pilotId }, { toast }) => {
  await prisma.fdeReport.deleteMany({ where: { pilotId, ownerUserId: requireUserId() } });
  await prisma.fdePilot.deleteMany({ where: { id: pilotId, ownerUserId: requireUserId() } });
  await prisma.fdeProfileSnapshot.deleteMany({ where: { reports: { none: {} } } });
  revalidatePath("/fde/pilot");
  toast("Pilot deleted.");
  return null;
});
