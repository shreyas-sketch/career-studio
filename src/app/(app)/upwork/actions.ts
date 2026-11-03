"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { UpworkStatus } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { createUpworkAnalysis, updateUpworkInputs, upworkAnalyzeJob, upworkJobKey, upworkProposalJob } from "@/lib/career/upwork";
import { startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";

const id = z.string().min(1).max(64);
const inputs = z.object({
  connectsRequired: z.number().int().min(0).max(500).nullable(),
  boostConnects: z.number().int().min(0).max(2000),
  connectPriceUsd: z.number().min(0).max(10),
  serviceFeePercent: z.number().min(0).max(50).nullable(),
  minimumHourlyUsd: z.number().min(0).max(2000).nullable(),
  connectsBalance: z.number().int().min(0).max(100_000).nullable(),
});

export const analyzeUpwork = action(z.object({ jobText: z.string().max(30_000), jobUrl: z.string().max(2000), inputs }), async ({ jobText, jobUrl, inputs: numbers }) => {
  if (jobText.trim().length < 80) throw new ActionError("Paste the whole job post: title, description, budget and anything the client says about themselves.");
  const result = await createUpworkAnalysis({ jobText, jobUrl, inputs: numbers });
  revalidatePath("/upwork");
  return result;
});

export const saveUpworkInputs = action(z.object({ id, inputs }), async ({ id: analysisId, inputs: numbers }) => {
  await updateUpworkInputs(analysisId, numbers);
  revalidatePath(`/upwork/${analysisId}`);
  return null;
});

export const reanalyzeUpwork = action(z.object({ id }), async ({ id: analysisId }) => ({
  jobId: await startJob(upworkAnalyzeJob, { id: analysisId }, { key: upworkJobKey(analysisId) }),
}));

export const writeProposal = action(z.object({ id, instructions: z.string().max(1000) }), async ({ id: analysisId, instructions }) => ({
  jobId: await startJob(upworkProposalJob, { id: analysisId, instructions }, { key: upworkJobKey(analysisId) }),
}));

export const saveProposal = action(z.object({ id, proposal: z.string().max(10_000) }), async ({ id: analysisId, proposal }) => {
  await prisma.upworkAnalysis.update({ where: { id: analysisId }, data: { proposal } });
  return null;
});

export const setUpworkStatus = action(z.object({ id, status: z.enum(UpworkStatus) }), async ({ id: analysisId, status }) => {
  await prisma.upworkAnalysis.update({ where: { id: analysisId }, data: { status } });
  revalidatePath("/upwork");
  return null;
});

export const deleteUpwork = action(z.object({ id }), async ({ id: analysisId }, { toast }) => {
  await prisma.upworkAnalysis.deleteMany({ where: { id: analysisId } });
  revalidatePath("/upwork");
  toast("Analysis deleted.");
  return null;
});
