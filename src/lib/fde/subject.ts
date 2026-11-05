import { LanguageLevel } from "@/generated/prisma/enums";
import { BASICS_FIELDS, type Basics, type DateSpan, type ProfileData } from "@/lib/profile";

import type { NormalizedProfile, ProfileDate } from "./types";

// The reviewed person's snapshot, in the shape the existing agents read and as
// evidence sources for quotes. It's built in memory for a task and thrown away.
// Nothing here reads, or is ever saved to, the account owner's own profile.

const span = (start: ProfileDate | null, end: ProfileDate | null, current = false): DateSpan => ({
  startYear: start?.year ?? null,
  startMonth: start?.month ?? null,
  endYear: end?.year ?? null,
  endMonth: end?.month ?? null,
  current,
});

const LEVELS: [RegExp, LanguageLevel][] = [
  [/native|bilingual/i, LanguageLevel.NATIVE],
  [/full professional/i, LanguageLevel.C1],
  [/professional working/i, LanguageLevel.B2],
  [/limited working/i, LanguageLevel.B1],
  [/elementary/i, LanguageLevel.A2],
];

export function toProfileData(profile: NormalizedProfile): ProfileData {
  const blank = Object.fromEntries(BASICS_FIELDS.map((field) => [field, ""])) as Record<(typeof BASICS_FIELDS)[number], string>;
  const skills = profile.skills.map((skill, index) => ({ id: `skill-${index}`, name: skill.name, group: "" }));
  const basics: Basics = { ...blank, name: profile.name, headline: profile.headline, summary: profile.about, city: profile.location, showAge: false };
  return {
    basics,
    photo: null,
    skills,
    languages: profile.languages.map((language, index) => ({ id: `lang-${index}`, name: language.name, level: LEVELS.find(([pattern]) => pattern.test(language.proficiency))?.[1] ?? LanguageLevel.B1 })),
    experience: profile.experience.map((job) => ({
      ...span(job.start, job.end, job.current),
      id: job.id,
      role: job.title,
      company: job.company,
      location: job.location,
      descriptor: "",
      bullets: job.description,
      skillIds: [],
    })),
    projects: profile.projects.map((project) => ({ ...span(null, null), id: project.id, name: project.title, link: project.link ?? "", bullets: project.description, skillIds: [] })),
    education: profile.education.map((school) => ({ ...span(school.start, school.end), id: school.id, degree: [school.degree, school.field].filter(Boolean).join(", "), school: school.school, notes: "" })),
    publications: profile.publications.map((entry) => ({ id: entry.id, citation: entry.title, link: entry.link ?? "", onResumes: false })),
    references: [],
    facts: profile.certifications.map((entry) => ({ id: entry.id, text: `Certification: ${entry.title}${entry.subtitle ? `, ${entry.subtitle}` : ""}` })),
  };
}

export type ProfileSource = { id: string; label: string; text: string };

/** Every piece of the profile that can back a claim, each with a stable id. */
export function profileSources(profile: NormalizedProfile): ProfileSource[] {
  const sources: ProfileSource[] = [];
  const add = (id: string, label: string, ...parts: (string | undefined)[]) => {
    const text = parts.filter(Boolean).join("\n").trim();
    if (text) sources.push({ id, label, text });
  };
  add("headline", "Headline", profile.headline);
  add("about", "About", profile.about);
  for (const job of profile.experience) add(job.id, [job.title, job.company].filter(Boolean).join(" at ") || "Experience", job.title, job.company, job.description, job.skills.length ? `Skills: ${job.skills.join(", ")}` : "");
  for (const school of profile.education) add(school.id, school.school || "Education", school.school, school.degree, school.field);
  if (profile.skills.length) add("skills", "Skills", profile.skills.map((skill) => skill.name).join(", "));
  for (const entry of profile.certifications) add(entry.id, `Certification: ${entry.title}`, entry.title, entry.subtitle);
  for (const entry of profile.projects) add(entry.id, `Project: ${entry.title}`, entry.title, entry.description);
  for (const entry of profile.publications) add(entry.id, `Publication: ${entry.title}`, entry.title, entry.description);
  for (const entry of profile.awards) add(entry.id, `Award: ${entry.title}`, entry.title, entry.description);
  for (const entry of profile.volunteering) add(entry.id, `Volunteering: ${entry.title}`, entry.title, entry.subtitle, entry.description);
  if (profile.languages.length) add("languages", "Languages", profile.languages.map((language) => [language.name, language.proficiency].filter(Boolean).join(" ")).join(", "));
  // Recommendations are other people's words, so they don't count as this person's evidence.
  return sources;
}
