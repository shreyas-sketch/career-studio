import { NextResponse } from "next/server";

import { EXPORT_FORMATS, exportContent, toDocx, toMarkdown, toText, type ExportFormat } from "@/lib/career/resume-export";
import { loadResumeVersion } from "@/lib/career/resume-versions";
import { contentDisposition } from "@/lib/file-name";
import { loadProfile } from "@/lib/profile-data";
import { route } from "@/lib/route";
import { loadSettings } from "@/lib/settings-data";

const TYPES: Record<ExportFormat, string> = {
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** A resume version as Markdown, plain text or Word: `?format=md|txt|docx`. The PDF is /api/pdf?doc=version. */
export const GET = route<RouteContext<"/api/resume-versions/[id]/export">>(async (request, { params }) => {
  const format = request.nextUrl.searchParams.get("format") ?? "";
  if (!Object.hasOwn(EXPORT_FORMATS, format)) return NextResponse.json({ error: "Choose Markdown, plain text or Word." }, { status: 400 });
  const [version, profile, settings] = await Promise.all([loadResumeVersion((await params).id), loadProfile(), loadSettings()]);
  if (!version) return NextResponse.json({ error: "That resume no longer exists." }, { status: 404 });
  const content = exportContent(profile, version.units, settings.resumeLanguage);
  const kind = format as ExportFormat;
  const body = kind === "docx" ? await toDocx(content, settings.resumeLanguage) : kind === "md" ? toMarkdown(content, settings.resumeLanguage) : toText(content, settings.resumeLanguage);
  const fileName = `${[content.name, version.name].filter(Boolean).join(" - ").replace(/[\\/:*?"<>|]+/g, " ").trim() || "Resume"}.${kind}`;
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: { "content-type": TYPES[kind], "content-disposition": contentDisposition(fileName) },
  });
});
