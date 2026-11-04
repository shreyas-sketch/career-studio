import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const state = vi.hoisted(() => ({ version: null as unknown, session: { userId: "u1" } as unknown, origin: true }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => state.session }));
vi.mock("@/lib/tenancy/context", () => ({ runAsUser: (_id: string, run: () => unknown) => run() }));
vi.mock("@/lib/career/resume-versions", () => ({ loadResumeVersion: async () => state.version }));
vi.mock("@/lib/profile-data", () => ({ loadProfile: async () => ({}) }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: async () => ({ resumeLanguage: "en" }) }));
vi.mock("@/lib/career/resume-export", async (original) => ({
  ...(await original<typeof import("@/lib/career/resume-export")>()),
  exportContent: () => ({ name: "Ada/Example: \"QA\"", sections: [] }),
  toMarkdown: () => "# Ada Example\n\nSynthetic résumé — QA",
  toText: () => "ADA EXAMPLE\n\nSynthetic résumé — QA",
  toDocx: async () => Buffer.from("PK-fake-docx"),
}));

const ask = (format: string) =>
  GET(new NextRequest(`http://localhost/api/resume-versions/v1/export?format=${format}`, { headers: { host: "localhost", "sec-fetch-site": "same-origin" } }), { params: Promise.resolve({ id: "v1" }) } as never);

beforeEach(() => {
  state.version = { name: "Data roles", units: [] };
  state.session = { userId: "u1" };
});

describe("downloading a resume version", () => {
  it.each([
    ["md", "text/markdown; charset=utf-8", "# Ada Example"],
    ["txt", "text/plain; charset=utf-8", "ADA EXAMPLE"],
    ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "PK-fake-docx"],
  ])("sends %s as a file to save, with its type and contents", async (format, type, start) => {
    const response = await ask(format);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(type);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const disposition = response.headers.get("content-disposition")!;
    expect(disposition).toMatch(/^attachment; filename="[^"/\\:*?<>|]+\.\w+"; filename\*=UTF-8''/);
    expect(disposition).toContain(`.${format}"`);
    expect(await response.text()).toContain(start);
  });

  it("keeps a resume's non-English characters in the text formats", async () => {
    expect(await (await ask("md")).text()).toContain("résumé — QA");
  });

  it("refuses a format it doesn't have", async () => {
    expect((await ask("exe")).status).toBe(400);
    expect((await ask("__proto__")).status).toBe(400);
  });

  it("answers 404 for a version that isn't in this account, and 401 when signed out", async () => {
    state.version = null;
    expect((await ask("md")).status).toBe(404);
    state.session = null;
    expect((await ask("md")).status).toBe(401);
  });
});
