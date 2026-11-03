import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { getAiProvider } from "@/lib/ai";
import { analyzeUpworkJob, writeUpworkProposal } from "@/lib/ai/tasks/career/upwork";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { loadFreelancePrefs, prefsForPrompt } from "@/lib/career/freelance-prefs";
import { analysisSchema, economics, estimateTokens, inputsSchema, screeningSchema } from "@/lib/career/upwork-data";
import { defineJob, startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";

export const upworkJobKey = (id: string) => `upwork:${id}`;

/** A title from the post's first line, for the list. */
export function titleFromPost(text: string): string {
  const first = text.trim().split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  return first.replace(/^#+\s*/, "").slice(0, 120) || "Upwork job";
}

/** Saves a pasted post with the user's numbers, and starts the analysis. */
export async function createUpworkAnalysis(input: { jobText: string; jobUrl: string; inputs: z.input<typeof inputsSchema> }): Promise<{ id: string; jobId: string }> {
  const record = await prisma.upworkAnalysis.create({
    data: {
      title: titleFromPost(input.jobText),
      jobText: input.jobText.slice(0, 30_000),
      jobUrl: input.jobUrl.slice(0, 2000),
      inputs: inputsSchema.parse(input.inputs) as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  const jobId = await startJob(upworkAnalyzeJob, { id: record.id }, { key: upworkJobKey(record.id) });
  return { id: record.id, jobId };
}

export async function updateUpworkInputs(id: string, inputs: z.input<typeof inputsSchema>): Promise<void> {
  await prisma.upworkAnalysis.update({ where: { id }, data: { inputs: inputsSchema.parse(inputs) as Prisma.InputJsonValue } });
}

/** AI usage per step, as estimated tokens, kept with the analysis. */
const usageSchema = z.object({ analysisTokens: z.number().optional(), proposalTokens: z.number().optional() });

export const upworkAnalyzeJob = defineJob({
  type: "upwork-analyze",
  input: z.object({ id: z.string() }),
  result: z.object({ tokens: z.number() }),
  async run({ id }, { step, signal }) {
    await step("Reading the job post");
    const record = await prisma.upworkAnalysis.findUniqueOrThrow({ where: { id } });
    const [profile, prefs, provider, options] = await Promise.all([loadProfile(), loadFreelancePrefs(), getAiProvider(), loadTaskOptions()]);
    await step("Weighing fit, price and scope");
    const { data, promptVersion } = await analyzeUpworkJob(
      provider,
      { jobText: record.jobText, inputs: inputsSchema.parse(record.inputs), profile, preferences: prefsForPrompt(prefs) },
      { ...options, signal },
    );
    const tokens = estimateTokens(data.usage.prompt, data.usage.answer);
    await prisma.upworkAnalysis.update({
      where: { id },
      data: { analysis: { ...data.analysis, usage: { analysisTokens: tokens } } as Prisma.InputJsonValue, analyzedWith: promptVersion },
    });
    return { tokens };
  },
});

export const upworkProposalJob = defineJob({
  type: "upwork-proposal",
  input: z.object({ id: z.string(), instructions: z.string().max(1000) }),
  result: z.object({ tokens: z.number() }),
  async run({ id, instructions }, { step, signal }) {
    const record = await prisma.upworkAnalysis.findUniqueOrThrow({ where: { id } });
    const analysis = analysisSchema.parse(record.analysis);
    const [profile, provider, options] = await Promise.all([loadProfile(), getAiProvider(), loadTaskOptions()]);
    await step("Writing your proposal");
    const { data, promptVersion } = await writeUpworkProposal(provider, { jobText: record.jobText, analysis, profile, instructions, strict: options.strict }, { ...options, signal });
    const tokens = estimateTokens(data.usage.prompt, data.usage.answer);
    const usage = usageSchema.parse((record.analysis as { usage?: unknown } | null)?.usage ?? {});
    await prisma.upworkAnalysis.update({
      where: { id },
      data: {
        proposal: data.proposal,
        screening: data.screening as Prisma.InputJsonValue,
        proposalWith: promptVersion,
        analysis: { ...(record.analysis as object), usage: { ...usage, proposalTokens: tokens } } as Prisma.InputJsonValue,
      },
    });
    return { tokens };
  },
});

/** An analysis with its numbers worked out, for its screen. */
export async function loadUpworkAnalysis(id: string) {
  const record = await prisma.upworkAnalysis.findUnique({ where: { id } });
  if (!record) return null;
  const inputs = inputsSchema.parse(record.inputs);
  const parsed = record.analysis ? analysisSchema.safeParse(record.analysis) : null;
  const analysis = parsed?.success ? parsed.data : null;
  const usage = usageSchema.parse((record.analysis as { usage?: unknown } | null)?.usage ?? {});
  return {
    ...record,
    inputs,
    analysis,
    usage,
    screening: record.screening ? screeningSchema.parse(record.screening) : [],
    economics: analysis ? economics(analysis, inputs) : null,
  };
}

export async function listUpworkAnalyses() {
  const records = await prisma.upworkAnalysis.findMany({ orderBy: { updatedAt: "desc" }, take: 200 });
  return records.map((record) => {
    const analysis = record.analysis ? analysisSchema.safeParse(record.analysis) : null;
    return {
      id: record.id,
      title: record.title,
      status: record.status,
      updatedAt: record.updatedAt,
      verdict: analysis?.success ? analysis.data.suitability.verdict : null,
      score: analysis?.success ? analysis.data.suitability.score : null,
      hasProposal: Boolean(record.proposal),
    };
  });
}
