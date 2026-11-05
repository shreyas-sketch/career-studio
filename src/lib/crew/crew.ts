// The crew: Career Studio's seven agents as the user meets them. Shared by the
// server (which reads their real jobs) and the browser (which draws them).

export const CREW_IDS = ["scout", "tailor", "interviewer", "usher", "prospector", "appraiser", "coach"] as const;
export type CrewId = (typeof CREW_IDS)[number];

export type CrewMember = {
  id: CrewId;
  name: string;
  /** What they do for the user, in plain words. */
  trade: string;
  /** Their screen. */
  href: string;
};

export const CREW: Record<CrewId, CrewMember> = {
  scout: { id: "scout", name: "Scout", trade: "Finds jobs worth your time", href: "/agent" },
  tailor: { id: "tailor", name: "Tailor", trade: "Fits your resume and letters to each job", href: "/resumes" },
  interviewer: { id: "interviewer", name: "Interviewer", trade: "Practices interviews with you", href: "/interviews" },
  usher: { id: "usher", name: "Usher", trade: "Walks you through every interview round", href: "/loops" },
  prospector: { id: "prospector", name: "Prospector", trade: "Digs up freelance work", href: "/freelance" },
  appraiser: { id: "appraiser", name: "Appraiser", trade: "Sizes up Upwork jobs and bids", href: "/upwork" },
  coach: { id: "coach", name: "Coach", trade: "Plans the skills you need next", href: "/skills" },
};

type JobRole = {
  crew: CrewId;
  /** What was done, for "Scored a posting 3 hours ago". */
  did: string;
  /** Worth handing to the user when it finishes; small steps inside a screen they're using aren't. */
  handsOver?: boolean;
};

/** Which crew member does each background job. */
const JOB_ROLES: Record<string, JobRole> = {
  "agent-scan": { crew: "scout", did: "Checked for new postings", handsOver: true },
  "posting-score": { crew: "scout", did: "Scored a posting" },
  "startups-refresh": { crew: "scout", did: "Checked who's hiring at startups", handsOver: true },
  "read-posting": { crew: "scout", did: "Read a posting" },
  "agent-draft": { crew: "tailor", did: "Prepared a draft application", handsOver: true },
  "write-documents": { crew: "tailor", did: "Tailored a resume and cover letter", handsOver: true },
  "connector-draft": { crew: "tailor", did: "Saved a draft from Claude", handsOver: true },
  "regenerate-unit": { crew: "tailor", did: "Rewrote part of a document" },
  refine: { crew: "tailor", did: "Refined a document" },
  "write-email": { crew: "tailor", did: "Wrote an application email" },
  "draft-reply": { crew: "tailor", did: "Drafted a reply", handsOver: true },
  "import-profile": { crew: "tailor", did: "Read your resume into your profile", handsOver: true },
  "zip-pdfs": { crew: "tailor", did: "Packed your PDFs" },
  "resume-version-tailor": { crew: "tailor", did: "Tailored a resume version", handsOver: true },
  "resume-version-coach": { crew: "tailor", did: "Reviewed a resume version", handsOver: true },
  "resume-version-improve": { crew: "tailor", did: "Improved a resume version", handsOver: true },
  "interview-start": { crew: "interviewer", did: "Planned a practice interview" },
  "interview-answer": { crew: "interviewer", did: "Listened to your answer" },
  "interview-finish": { crew: "interviewer", did: "Wrote your interview report", handsOver: true },
  "round-prepare": { crew: "usher", did: "Prepared an interview round", handsOver: true },
  "freelance-refresh": { crew: "prospector", did: "Checked the freelance sources", handsOver: true },
  "opportunity-score": { crew: "prospector", did: "Checked an opportunity's fit" },
  "upwork-analyze": { crew: "appraiser", did: "Appraised an Upwork job", handsOver: true },
  "upwork-proposal": { crew: "appraiser", did: "Wrote a proposal", handsOver: true },
  "skill-plan": { crew: "coach", did: "Wrote a skill plan", handsOver: true },
  "fde-review": { crew: "scout", did: "Compared a profile with current FDE roles", handsOver: true },
  "fde-freelance": { crew: "prospector", did: "Found paid work for a reviewed profile", handsOver: true },
  "fde-pilot": { crew: "scout", did: "Ran a batch of FDE reviews", handsOver: true },
};

export const jobRole = (type: string): JobRole | undefined => JOB_ROLES[type];

const within = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/** Whose screen a path is; undefined for the user's own (Today, Profile, Settings). */
export function crewOfPath(pathname: string): CrewId | undefined {
  if (["/jobs", "/startups", "/agent", "/fde"].some((base) => within(pathname, base))) return "scout";
  if (["/resumes", "/resume", "/applications", "/new", "/inbox"].some((base) => within(pathname, base))) return "tailor";
  if (within(pathname, "/interviews")) return "interviewer";
  if (within(pathname, "/loops")) return "usher";
  if (within(pathname, "/freelance") || pathname === "/opportunities") return "prospector";
  if (within(pathname, "/upwork")) return "appraiser";
  if (within(pathname, "/skills")) return "coach";
  return undefined;
}

export type CrewStatus = "working" | "queued" | "stuck" | "resting";

/** One member as they are right now, read from their real jobs. */
export type CrewMemberState = {
  id: CrewId;
  status: CrewStatus;
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

/** A piece of work that just finished, to hand over. */
export type CrewHandover = {
  jobId: string;
  crew: CrewId;
  what: string;
  about: string | null;
  href: string;
  /** When it ended. */
  at: string;
  /** Why it failed, written for the user; null when it didn't. */
  error: string | null;
  handsOver: boolean;
};

export type CrewSnapshot = {
  members: Record<CrewId, CrewMemberState>;
  /** Newest first. */
  finished: CrewHandover[];
};

export const restingCrew = (): Record<CrewId, CrewMemberState> =>
  Object.fromEntries(
    CREW_IDS.map((id): [CrewId, CrewMemberState] => [id, { id, status: "resting", step: null, about: null, jobs: 0, last: null, error: null }]),
  ) as Record<CrewId, CrewMemberState>;

/** Lowercases the start of a job's step so it reads inside a sentence, keeping names like "Y Combinator". */
const inSentence = (step: string) => step.charAt(0).toLowerCase() + step.slice(1);

/** "Tailor is tailoring the resume for Stripe." */
export function describeWork({ id, step, about }: Pick<CrewMemberState, "id" | "step" | "about">): string {
  const doing = step ? `is ${inSentence(step)}` : "is getting started";
  return `${CREW[id].name} ${doing}${about ? ` for ${about}` : ""}.`;
}

/** The one sentence under the greeting: only what's actually happening. */
export function crewSummary(members: Record<CrewId, CrewMemberState>): string {
  const working = CREW_IDS.map((id) => members[id]).filter((member) => member.status === "working");
  const queued = CREW_IDS.filter((id) => members[id].status === "queued");
  if (working.length === 1) return describeWork(working[0]!);
  if (working.length > 1) {
    const names = working.map(({ id }) => CREW[id].name);
    return `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are working for you right now.`;
  }
  if (queued.length > 0) return `${CREW[queued[0]!].name} is about to start.`;
  return "Nobody's working right now. Give the crew something to do.";
}
