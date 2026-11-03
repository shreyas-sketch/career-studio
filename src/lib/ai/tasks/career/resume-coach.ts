import { z } from "zod";

import type { Unit } from "@/lib/application-data";
import { factSources, unverifiedFacts } from "@/lib/ai/fact-guard";
import { factTexts, type ProfileData } from "@/lib/profile";

import { NO_EM_DASHES, postingForPrompt, profileForPrompt, system, truthfulness, UNTRUSTED_POSTING, type Task } from "../prompt-parts";

// The resume coach (agent 2): reviews a resume version for its target, and
// asks for the facts it's missing rather than making them up. Answers go to
// the profile's "Facts about me", so every later document has them too.

export const COACH_RESUME_VERSION = "coach-resume@1";
export const IMPROVE_UNIT_VERSION = "improve-unit@1";

const text = (max: number) => z.string().transform((value) => value.trim().slice(0, max));

export const coachSchema = z.object({
  overall: text(800),
  strengths: z.array(z.string()).transform((items) => items.map((item) => item.trim().slice(0, 300)).filter(Boolean).slice(0, 5)),
  /** Questions for facts the resume needs and the profile doesn't have. */
  questions: z
    .array(z.object({ id: z.string(), unitId: z.string(), question: text(400), why: text(300), example: text(300) }))
    .transform((items) => items.slice(0, 8)),
  /** Changes that need no new facts. */
  suggestions: z.array(z.object({ unitId: z.string(), suggestion: text(500) })).transform((items) => items.slice(0, 8)),
});
export type ResumeCoaching = z.output<typeof coachSchema>;

export type CoachInput = { units: Unit[]; target: string; jobDescription: string; profile: ProfileData };

const coachAnswer = z.object({
  overall: z.string(),
  strengths: z.array(z.string()),
  questions: z.array(z.object({ id: z.string(), unitId: z.string(), question: z.string(), why: z.string(), example: z.string() })),
  suggestions: z.array(z.object({ unitId: z.string(), suggestion: z.string() })),
});

export const coachResume: Task<CoachInput, ResumeCoaching> = async (provider, input, { signal }) => {
  const ids = new Set(input.units.map((unit) => unit.id));
  const answer = await provider.complete({
    system: system(
      `You are a resume coach reviewing one resume for the role it targets, as JSON.
- overall: two or three honest sentences: how well it makes the case for this target, and the most important improvement.
- strengths: what already works.
- questions: up to six questions for facts the resume needs and doesn't have: missing results and numbers (how much, how many, how often), the candidate's own part in team work, scope (team size, budget, users), tools, or anything the target asks for that the resume is silent on. Each with: a short id, unitId (the resume part it would improve, from the ids given), the question in plain words, why it matters for this target, and an example of the kind of answer that helps (generic, never a made-up fact about them).
- suggestions: up to six concrete changes that need no new facts (reorder, cut, merge, sharpen wording, lead with impact), each for a unitId.
Ask; never assume. Don't ask for something the profile or its facts already answer.`,
      UNTRUSTED_POSTING,
      NO_EM_DASHES,
    ),
    messages: [
      {
        role: "user",
        content: [
          `The target: ${input.target || "(not stated: judge it as a general resume for their field)"}`,
          input.jobDescription.trim() ? `The job description it's tailored to:\n${postingForPrompt(input.jobDescription)}` : null,
          `The resume, part by part (id, label, text):\n${JSON.stringify(input.units.map(({ id, label, text }) => ({ id, label, text })), null, 2)}`,
          `The candidate's full profile, with their facts:\n${profileForPrompt(input.profile)}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: coachAnswer,
    schemaName: "resume_coaching",
    creativity: "FAITHFUL",
    effort: "medium",
    signal,
  });
  const coaching = coachSchema.parse(answer);
  // Only parts that exist; ids made unique.
  const seen = new Set<string>();
  coaching.questions = coaching.questions
    .filter((question) => ids.has(question.unitId) && question.question)
    .map((question, index) => {
      let id = question.id.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 40) || `q${index + 1}`;
      if (seen.has(id)) id = `q${index + 1}`;
      seen.add(id);
      return { ...question, id };
    });
  coaching.suggestions = coaching.suggestions.filter((suggestion) => ids.has(suggestion.unitId) && suggestion.suggestion);
  return { data: coaching, promptVersion: COACH_RESUME_VERSION };
};

export type ImproveInput = {
  unit: Unit;
  units: Unit[];
  target: string;
  jobDescription: string;
  /** What to change: a coach suggestion, or "use the new fact". */
  instruction: string;
  profile: ProfileData;
};

const improveAnswer = z.object({ text: z.string() });

/** Rewrites one part of a resume version, checked by the fact guard against the profile and its facts. */
export const improveUnit: Task<ImproveInput, Unit> = async (provider, input, { signal, strict }) => {
  const isBullets = input.unit.id.startsWith("experience:") || input.unit.id.startsWith("project:");
  const answer = await provider.complete({
    system: system(
      `You rewrite one part of a resume, as JSON with its new text. Keep its form: ${
        isBullets ? "bullet points, one per line, without bullet characters, each starting with a strong verb and leading with the result where there is one" : "the same kind of text as now"
      }. Follow the instruction, keep it relevant to the target, and don't repeat what other parts already say.`,
      truthfulness(strict),
      "The candidate's facts (factsAboutMe in the profile) are true and theirs: use them where they fit.",
      UNTRUSTED_POSTING,
      NO_EM_DASHES,
    ),
    messages: [
      {
        role: "user",
        content: [
          `The target: ${input.target || "(general)"}`,
          `The instruction: ${input.instruction}`,
          `The part to rewrite (${input.unit.label}):\n${input.unit.text}`,
          `The rest of the resume:\n${input.units.filter((unit) => unit.id !== input.unit.id).map((unit) => `${unit.label}: ${unit.text}`).join("\n\n")}`,
          `The candidate's profile:\n${profileForPrompt(input.profile)}`,
          input.jobDescription.trim() ? `The job description:\n${postingForPrompt(input.jobDescription)}` : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: improveAnswer,
    schemaName: "resume_part",
    creativity: "BALANCED",
    effort: "low",
    signal,
  });
  const next = answer.text.replace(/^[•\-*]\s*/gm, "").trim().slice(0, 6000);
  // The fact guard: names and numbers must come from the profile, its facts or the job.
  const sources = factSources([profileForPrompt(input.profile), factTexts(input.profile.facts).join("\n"), input.jobDescription, input.unit.text]);
  const unverified = strict ? unverifiedFacts(next, sources) : [];
  return { data: { ...input.unit, text: next || input.unit.text, ...(unverified.length > 0 ? { unverified } : {}) }, promptVersion: IMPROVE_UNIT_VERSION };
};
