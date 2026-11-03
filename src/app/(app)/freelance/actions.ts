"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { OpportunityStatus } from "@/generated/prisma/enums";
import { action } from "@/lib/action";
import { setOpportunityStatus, startFreelanceRefresh, startOpportunityScore } from "@/lib/career/freelance";
import { freelancePrefsSchema, saveFreelancePrefs } from "@/lib/career/freelance-prefs";

const id = z.string().min(1).max(64);

export const savePrefs = action(freelancePrefsSchema, async (prefs, { toast }) => {
  await saveFreelancePrefs(prefs);
  revalidatePath("/freelance");
  toast("Preferences saved.");
  return null;
});

export const refreshOpportunities = action(z.object({}), async () => ({ jobId: await startFreelanceRefresh() }));

export const scoreOpportunity = action(z.object({ id }), async ({ id: opportunityId }) => ({ jobId: await startOpportunityScore(opportunityId) }));

export const setStatus = action(z.object({ id, status: z.enum(OpportunityStatus) }), async ({ id: opportunityId, status }) => {
  await setOpportunityStatus(opportunityId, status);
  revalidatePath("/freelance");
  return null;
});
