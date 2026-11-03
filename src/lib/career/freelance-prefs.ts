import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";

// Freelance preferences (agents 5 and 6), kept as one Setting row like
// Dossier's other settings, so export, import and "Delete everything"
// already carry them.

const KEY = "career.freelance";

export const freelancePrefsSchema = z.object({
  /** What they sell, e.g. "Webflow sites, landing page design". */
  services: z.string().max(500).default(""),
  /** Words to search the sources for; empty uses the profile's headline and skills. */
  keywords: z.array(z.string().max(60)).max(12).default([]),
  minimumHourlyUsd: z.number().min(0).max(2000).nullable().default(null),
  hoursPerWeek: z.number().int().min(0).max(80).nullable().default(null),
  /** Where they can work from and when, e.g. "Remote only, CET working hours". */
  constraints: z.string().max(500).default(""),
  /** Contract types they want. */
  kinds: z.array(z.enum(["freelance", "contract", "part-time"])).default(["freelance", "contract"]),
  /** Anything they never want, e.g. "crypto", "unpaid tests". */
  avoid: z.string().max(500).default(""),
  /** The service fee they usually see on Upwork, to prefill the analyst. */
  upworkFeePercent: z.number().min(0).max(50).nullable().default(null),
  connectsBalance: z.number().int().min(0).max(100_000).nullable().default(null),
});
export type FreelancePrefs = z.output<typeof freelancePrefsSchema>;

export async function loadFreelancePrefs(): Promise<FreelancePrefs> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (!row) return freelancePrefsSchema.parse({});
  try {
    return freelancePrefsSchema.parse(JSON.parse(row.value));
  } catch {
    return freelancePrefsSchema.parse({});
  }
}

export async function saveFreelancePrefs(prefs: z.input<typeof freelancePrefsSchema>): Promise<FreelancePrefs> {
  const value = freelancePrefsSchema.parse(prefs);
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });
  return value;
}

/** The preferences as the model reads them. */
export function prefsForPrompt(prefs: FreelancePrefs): string {
  return [
    prefs.services && `Services offered: ${prefs.services}`,
    prefs.minimumHourlyUsd !== null && `Minimum rate: $${prefs.minimumHourlyUsd}/hour`,
    prefs.hoursPerWeek !== null && `Available: about ${prefs.hoursPerWeek} hours a week`,
    prefs.constraints && `Constraints: ${prefs.constraints}`,
    prefs.kinds.length > 0 && `Wants: ${prefs.kinds.join(", ")} work`,
    prefs.avoid && `Avoids: ${prefs.avoid}`,
  ]
    .filter(Boolean)
    .join("\n");
}
