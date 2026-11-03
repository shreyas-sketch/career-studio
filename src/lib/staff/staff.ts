// The staff: Career Studio's seven agents as the user meets them, by what they
// do. Shared by the server (which reads their real jobs) and the browser.

export const STAFF_IDS = ["search", "editor", "coach", "coordinator", "researcher", "analyst", "advisor"] as const;
export type StaffId = (typeof STAFF_IDS)[number];

export type StaffMember = {
  id: StaffId;
  /** Their title, as it starts a line. */
  title: string;
  /** What they do for the user, in plain words. */
  remit: string;
  /** Their screen. */
  href: string;
};

export const STAFF: Record<StaffId, StaffMember> = {
  search: { id: "search", title: "Search analyst", remit: "Finds and scores roles for you", href: "/agent" },
  editor: { id: "editor", title: "Resume editor", remit: "Fits your resume and letters to each role", href: "/resumes" },
  coach: { id: "coach", title: "Interview coach", remit: "Runs practice interviews with you", href: "/interviews" },
  coordinator: { id: "coordinator", title: "Interview coordinator", remit: "Prepares you for each round", href: "/loops" },
  researcher: { id: "researcher", title: "Freelance researcher", remit: "Finds contract and freelance work", href: "/freelance" },
  analyst: { id: "analyst", title: "Bid analyst", remit: "Appraises Upwork jobs and bids", href: "/upwork" },
  advisor: { id: "advisor", title: "Skills advisor", remit: "Plans the skills to build next", href: "/skills" },
};

type JobRole = {
  staff: StaffId;
  /** What was done, for "Scored a posting, 3 h ago". */
  did: string;
  /** Worth a note when it finishes; small steps inside a screen in use aren't. */
  reports?: boolean;
};

/** Who does each background job. */
const JOB_ROLES: Record<string, JobRole> = {
  "agent-scan": { staff: "search", did: "Checked for new postings", reports: true },
  "posting-score": { staff: "search", did: "Scored a posting" },
  "startups-refresh": { staff: "search", did: "Checked who's hiring at startups", reports: true },
  "read-posting": { staff: "search", did: "Read a posting" },
  "agent-draft": { staff: "editor", did: "Prepared a draft application", reports: true },
  "write-documents": { staff: "editor", did: "Tailored a resume and cover letter", reports: true },
  "connector-draft": { staff: "editor", did: "Saved a draft from Claude", reports: true },
  "regenerate-unit": { staff: "editor", did: "Rewrote part of a document" },
  refine: { staff: "editor", did: "Refined a document" },
  "write-email": { staff: "editor", did: "Wrote an application email" },
  "draft-reply": { staff: "editor", did: "Drafted a reply", reports: true },
  "import-profile": { staff: "editor", did: "Read your resume into your profile", reports: true },
  "zip-pdfs": { staff: "editor", did: "Packed your PDFs" },
  "resume-version-tailor": { staff: "editor", did: "Tailored a resume version", reports: true },
  "resume-version-coach": { staff: "editor", did: "Reviewed a resume version", reports: true },
  "resume-version-improve": { staff: "editor", did: "Improved a resume version", reports: true },
  "interview-start": { staff: "coach", did: "Planned a practice interview" },
  "interview-answer": { staff: "coach", did: "Assessed an answer" },
  "interview-finish": { staff: "coach", did: "Wrote an interview report", reports: true },
  "round-prepare": { staff: "coordinator", did: "Prepared an interview round", reports: true },
  "freelance-refresh": { staff: "researcher", did: "Checked the freelance sources", reports: true },
  "opportunity-score": { staff: "researcher", did: "Checked an opportunity's fit" },
  "upwork-analyze": { staff: "analyst", did: "Appraised an Upwork job", reports: true },
  "upwork-proposal": { staff: "analyst", did: "Wrote a proposal", reports: true },
  "skill-plan": { staff: "advisor", did: "Wrote a skill plan", reports: true },
};

export const jobRole = (type: string): JobRole | undefined => JOB_ROLES[type];

export type StaffStatus = "working" | "queued" | "stuck" | "idle";

/** How a robot looks, which always follows from its real work. */
export type StaffMood = "idle" | "working" | "waiting" | "stuck" | "done";

export const moodOf = (status: StaffStatus): StaffMood => (status === "queued" ? "waiting" : status);

const within = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/** Whose screen a path is; undefined for the user's own (Today, Profile, Settings). */
export function staffOfPath(pathname: string): StaffId | undefined {
  if (["/jobs", "/startups", "/agent"].some((base) => within(pathname, base))) return "search";
  if (["/resumes", "/resume", "/applications", "/new", "/inbox"].some((base) => within(pathname, base))) return "editor";
  if (within(pathname, "/interviews")) return "coach";
  if (within(pathname, "/loops")) return "coordinator";
  if (within(pathname, "/freelance")) return "researcher";
  if (within(pathname, "/upwork")) return "analyst";
  if (within(pathname, "/skills")) return "advisor";
  return undefined;
}

/** One member as they are right now, read from their real jobs. */
export type StaffMemberState = {
  id: StaffId;
  status: StaffStatus;
  /** The job's own named step, while working. */
  step: string | null;
  /** The company it's for, when the job works on an application. */
  about: string | null;
  /** Jobs in hand. */
  jobs: number;
  /** What they finished last. */
  last: { at: string; what: string; about: string | null } | null;
  /** Why the newest job failed, written for the user, while that's the latest news. */
  error: string | null;
};

/** A piece of work that just ended, to report. */
export type StaffReport = {
  jobId: string;
  staff: StaffId;
  what: string;
  about: string | null;
  href: string;
  /** Why it failed, written for the user; null when it didn't. */
  error: string | null;
  reports: boolean;
};

export type StaffSnapshot = {
  members: Record<StaffId, StaffMemberState>;
  /** Newest first. */
  finished: StaffReport[];
};

export const idleStaff = (): Record<StaffId, StaffMemberState> =>
  Object.fromEntries(
    STAFF_IDS.map((id): [StaffId, StaffMemberState] => [id, { id, status: "idle", step: null, about: null, jobs: 0, last: null, error: null }]),
  ) as Record<StaffId, StaffMemberState>;

/** Lowercases the start of a job's step so it reads inside a sentence, keeping names like "Y Combinator". */
const inSentence = (step: string) => step.charAt(0).toLowerCase() + step.slice(1);
const lowerTitle = (id: StaffId) => inSentence(STAFF[id].title);

/** "Tailoring the resume for Stripe", in the job's own words. */
export function describeStep({ step, about }: Pick<StaffMemberState, "step" | "about">): string {
  return `${step ?? "Getting started"}${about ? ` for ${about}` : ""}`;
}

/** "Your resume editor is tailoring the resume for Stripe." */
export function describeWork(member: Pick<StaffMemberState, "id" | "step" | "about">): string {
  const doing = member.step ? `is ${inSentence(member.step)}` : "is getting started";
  return `Your ${lowerTitle(member.id)} ${doing}${member.about ? ` for ${member.about}` : ""}.`;
}
