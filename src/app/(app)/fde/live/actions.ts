"use server";

import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { adminEmail, checkServices, liveStatus } from "@/lib/public-fde/admin";
import { updateControls } from "@/lib/public-fde/ops";
import { prepareMarket } from "@/lib/public-fde/worker";

// The public review's operator controls. Signed in isn't enough: the account
// must be one of PUBLIC_FDE_ADMIN_EMAILS.

async function requireAdmin(): Promise<string> {
  const email = await adminEmail();
  if (!email) throw new ActionError("This page is for the review's operator.");
  return email;
}

export const loadLive = action(z.object({}), async () => {
  await requireAdmin();
  return liveStatus();
});

export const setControls = action(
  z.object({
    intakePaused: z.boolean().optional(),
    profilePaused: z.boolean().optional(),
    analysisPaused: z.boolean().optional(),
    profileLane: z.number().int().min(0).max(20).optional(),
    analysisLane: z.number().int().min(0).max(20).optional(),
  }),
  async (input, { toast }) => {
    const email = await requireAdmin();
    const resuming = input.profilePaused === false || input.analysisPaused === false;
    await updateControls(
      {
        ...(input.intakePaused !== undefined ? { intakePaused: input.intakePaused } : {}),
        ...(input.profilePaused !== undefined ? { profilePaused: input.profilePaused } : {}),
        ...(input.analysisPaused !== undefined ? { analysisPaused: input.analysisPaused } : {}),
        ...(resuming ? { pauseReason: "" } : {}),
        ...(input.profileLane !== undefined || input.analysisLane !== undefined
          ? { lanes: { ...(input.profileLane !== undefined ? { profile: input.profileLane } : {}), ...(input.analysisLane !== undefined ? { analysis: input.analysisLane } : {}) } }
          : {}),
      },
      email,
    );
    toast("Saved. Every worker picks this up within a second or two.");
    return liveStatus();
  },
);

export const runChecks = action(z.object({}), async () => {
  await requireAdmin();
  return checkServices();
});

export const warmMarket = action(z.object({}), async (_input, { toast }) => {
  await requireAdmin();
  const result = await prepareMarket();
  toast(result.message);
  return result;
});
