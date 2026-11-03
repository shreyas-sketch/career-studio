import "server-only";

import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

import type { Unit } from "@/lib/application-data";
import { documentLabels } from "@/lib/document-labels";
import type { ProfileData } from "@/lib/profile";
import { CONTACT_SEPARATOR, resumeContent, type ResumeContent } from "@/lib/resume-content";

// A resume version as plain text, Markdown and Word (agent 2). The PDF is
// Dossier's themed renderer; these are for pasting into forms and editing
// elsewhere, so they follow the content, not the theme.

export const EXPORT_FORMATS = { md: "Markdown", txt: "Plain text", docx: "Word" } as const;
export type ExportFormat = keyof typeof EXPORT_FORMATS;

type Section = { title: string; entries: { heading: string; meta: string; lines: string[] }[]; text?: string };

function sections(content: ResumeContent, language: string | null): Section[] {
  const labels = documentLabels(language);
  const list: Section[] = [];
  if (content.summary) list.push({ title: labels.profile, entries: [], text: content.summary });
  if (content.experience.length > 0)
    list.push({
      title: labels.experience,
      entries: content.experience.map((role) => ({
        heading: [role.role, role.company].filter(Boolean).join(", "),
        meta: [role.descriptor, role.dates].filter(Boolean).join(" · "),
        lines: role.bullets,
      })),
    });
  if (content.projects.length > 0)
    list.push({
      title: labels.projects,
      entries: content.projects.map((project) => ({ heading: project.name, meta: [project.link, project.dates].filter(Boolean).join(" · "), lines: project.bullets })),
    });
  if (content.education.length > 0)
    list.push({
      title: labels.education,
      entries: content.education.map((entry) => ({
        heading: [entry.degree, entry.school].filter(Boolean).join(", "),
        meta: entry.dates,
        lines: entry.notes ? entry.notes.split("\n").filter(Boolean) : [],
      })),
    });
  if (content.publications.length > 0)
    list.push({ title: labels.publications, entries: content.publications.map((entry) => ({ heading: entry.citation.replace(/\*+/g, ""), meta: entry.link, lines: [] })) });
  if (content.skills) list.push({ title: labels.skills, entries: [], text: content.skills });
  if (content.languages) list.push({ title: labels.languages, entries: [], text: content.languages });
  return list;
}

export function exportContent(profile: ProfileData, units: Unit[], language: string | null): ResumeContent {
  return resumeContent(profile, { units }, documentLabels(language));
}

export function toMarkdown(content: ResumeContent, language: string | null): string {
  const out = [`# ${content.name}`];
  if (content.headline) out.push(`**${content.headline}**`);
  if (content.contacts.length > 0) out.push(content.contacts.join(CONTACT_SEPARATOR));
  for (const section of sections(content, language)) {
    out.push("", `## ${section.title}`);
    if (section.text) out.push("", section.text);
    for (const entry of section.entries) {
      out.push("", `### ${entry.heading}`);
      if (entry.meta) out.push(`*${entry.meta}*`);
      if (entry.lines.length > 0) out.push("", ...entry.lines.map((line) => `- ${line}`));
    }
  }
  return `${out.join("\n").trim()}\n`;
}

export function toText(content: ResumeContent, language: string | null): string {
  const out = [content.name.toUpperCase()];
  if (content.headline) out.push(content.headline);
  if (content.contacts.length > 0) out.push(content.contacts.join(" | "));
  for (const section of sections(content, language)) {
    out.push("", section.title.toUpperCase());
    if (section.text) out.push(section.text);
    for (const entry of section.entries) {
      out.push("", entry.heading);
      if (entry.meta) out.push(entry.meta);
      out.push(...entry.lines.map((line) => `- ${line}`));
    }
  }
  return `${out.join("\n").trim()}\n`;
}

export async function toDocx(content: ResumeContent, language: string | null): Promise<Buffer> {
  const paragraphs: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: content.name, bold: true, size: 36 })] }),
  ];
  if (content.headline) paragraphs.push(new Paragraph({ children: [new TextRun({ text: content.headline, size: 24 })] }));
  if (content.contacts.length > 0) paragraphs.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: content.contacts.join("  ·  "), size: 18, color: "555555" })] }));
  for (const section of sections(content, language)) {
    paragraphs.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 80 },
        border: { bottom: { color: "999999", space: 1, style: BorderStyle.SINGLE, size: 4 } },
        children: [new TextRun({ text: section.title, bold: true, size: 24 })],
      }),
    );
    if (section.text) paragraphs.push(...section.text.split("\n").map((line) => new Paragraph({ children: [new TextRun({ text: line, size: 21 })] })));
    for (const entry of section.entries) {
      paragraphs.push(new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: entry.heading, bold: true, size: 21 })] }));
      if (entry.meta) paragraphs.push(new Paragraph({ children: [new TextRun({ text: entry.meta, italics: true, size: 19, color: "555555" })] }));
      for (const line of entry.lines) paragraphs.push(new Paragraph({ bullet: { level: 0 }, alignment: AlignmentType.LEFT, children: [new TextRun({ text: line, size: 21 })] }));
    }
  }
  const document = new Document({
    creator: "Career Studio",
    title: `${content.name} resume`,
    styles: { default: { document: { run: { font: "Calibri" } } } },
    sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } }, children: paragraphs }],
  });
  return Buffer.from(await Packer.toBuffer(document));
}
