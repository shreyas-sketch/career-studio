// Where a finished job's result is, for the notes and the recent results: its
// own page when it has one, so "Open" lands on what was just made.

type FinishedJob = { id: string; type: string; applicationId: string | null; input: unknown };

const inputId = (input: unknown, field: string): string | null => {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>)[field] : null;
  return typeof value === "string" && value ? encodeURIComponent(value) : null;
};

/** `loops` says which loop a round belongs to; a job on nothing in particular goes to its screen. */
export function resultHref(job: FinishedJob, screen: string, loops: ReadonlyMap<string, string>): string {
  if (job.applicationId) return `/applications/${job.applicationId}`;
  const id = inputId(job.input, "id");
  const session = inputId(job.input, "sessionId");
  const round = inputId(job.input, "roundId");
  switch (job.type) {
    case "skill-plan":
      return id ? `/skills/${id}` : screen;
    case "upwork-analyze":
    case "upwork-proposal":
      return id ? `/upwork/${id}` : screen;
    case "resume-version-tailor":
    case "resume-version-coach":
    case "resume-version-improve":
      return id ? `/resumes/${id}` : screen;
    case "interview-start":
    case "interview-answer":
    case "interview-finish":
      return session ? `/interviews/${session}` : screen;
    case "round-prepare": {
      const loop = round && loops.get(round);
      return loop ? `/loops/${loop}` : screen;
    }
    case "import-profile":
      return `/profile/import?job=${encodeURIComponent(job.id)}`;
    case "draft-reply":
      return "/inbox";
    case "startups-refresh":
      return "/startups";
    case "posting-score":
      return "/jobs";
    default:
      return screen;
  }
}

/** The rounds these jobs prepared, to look up which loop each is in. */
export function roundIds(jobs: { type: string; input: unknown }[]): string[] {
  return [...new Set(jobs.filter(({ type }) => type === "round-prepare").flatMap(({ input }) => inputId(input, "roundId") ?? []))];
}
