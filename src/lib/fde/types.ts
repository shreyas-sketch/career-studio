import { z } from "zod";

// FDE Review: what's stored and shown for a report on another person's public
// profile. The subject is never the signed-in member: nothing here touches the
// account owner's profile, and the owner's preferences are never read.

// ─── The retrieved profile ───────────────────────────────────

export const PROFILE_SECTIONS = [
  "about",
  "experience",
  "education",
  "skills",
  "certifications",
  "projects",
  "publications",
  "languages",
  "awards",
  "volunteering",
  "recommendations",
  "courses",
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/**
 * An empty section and one the provider didn't return are different things:
 * only the first says the person listed nothing.
 */
export const SECTION_STATES = ["present", "empty", "not_retrieved", "restricted"] as const;
export type SectionState = (typeof SECTION_STATES)[number];

const dateSchema = z.object({ year: z.number().nullable(), month: z.number().nullable(), text: z.string() });
export type ProfileDate = z.output<typeof dateSchema>;

const experienceSchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  companyUrl: z.string().nullable(),
  logo: z.string().nullable(),
  location: z.string(),
  employmentType: z.string(),
  workplaceType: z.string(),
  start: dateSchema.nullable(),
  end: dateSchema.nullable(),
  current: z.boolean(),
  duration: z.string(),
  description: z.string(),
  skills: z.array(z.string()),
});

const educationSchema = z.object({
  id: z.string(),
  school: z.string(),
  degree: z.string(),
  field: z.string(),
  period: z.string(),
  start: dateSchema.nullable(),
  end: dateSchema.nullable(),
  logo: z.string().nullable(),
  skills: z.array(z.string()),
});

const namedEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  when: z.string(),
  description: z.string(),
  link: z.string().nullable(),
});
export type NamedEntry = z.output<typeof namedEntrySchema>;

export const normalizedProfileSchema = z.object({
  provider: z.string(),
  providerProfileId: z.string().nullable(),
  publicIdentifier: z.string().nullable(),
  url: z.string(),
  name: z.string(),
  headline: z.string(),
  location: z.string(),
  /** Keys into `images`, so a browser only ever asks for an image this snapshot has. */
  photo: z.string().nullable(),
  banner: z.string().nullable(),
  /** Remote image addresses, served through the checked proxy. */
  images: z.record(z.string(), z.string()),
  about: z.string(),
  currentPosition: z.string(),
  followers: z.number().nullable(),
  connections: z.number().nullable(),
  experience: z.array(experienceSchema),
  education: z.array(educationSchema),
  skills: z.array(z.object({ name: z.string(), endorsements: z.string() })),
  certifications: z.array(namedEntrySchema),
  projects: z.array(namedEntrySchema),
  publications: z.array(namedEntrySchema),
  languages: z.array(z.object({ name: z.string(), proficiency: z.string() })),
  awards: z.array(namedEntrySchema),
  volunteering: z.array(namedEntrySchema),
  recommendations: z.array(namedEntrySchema),
  courses: z.array(namedEntrySchema),
  sections: z.record(z.string(), z.enum(SECTION_STATES)),
  /** "full", "partial", or "identity" when only a name-level record came back. */
  quality: z.enum(["full", "partial", "identity"]),
  sourceAge: z.string().nullable(),
});
export type NormalizedProfile = z.output<typeof normalizedProfileSchema>;

// ─── Roles and requirements ──────────────────────────────────

export const REQUIREMENT_CATEGORIES = ["engineering", "ai_ml", "deployment_infra", "customer", "product_business", "domain", "leadership", "eligibility"] as const;
export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<RequirementCategory, string> = {
  engineering: "Software engineering",
  ai_ml: "AI and ML",
  deployment_infra: "Deployment and infrastructure",
  customer: "Customer-facing work",
  product_business: "Product and business sense",
  domain: "Domain knowledge",
  leadership: "Leadership",
  eligibility: "Stated eligibility",
};

/** A closed list, so "6 of 10 roles" counts the same thing in every role. */
export const REQUIREMENT_KEYS = {
  python: "Python",
  typescript_javascript: "TypeScript or JavaScript",
  other_languages: "Other programming languages",
  software_engineering: "Production software engineering",
  apis_integrations: "APIs and integrations",
  data_sql: "Data and SQL",
  llm_applications: "LLM applications",
  rag_agents: "RAG and agents",
  evals: "Evaluation of AI systems",
  ml_fundamentals: "ML fundamentals",
  cloud_infra: "Cloud infrastructure",
  containers_kubernetes: "Containers and Kubernetes",
  security_compliance: "Security and compliance",
  production_ownership: "Owning systems in production",
  customer_facing: "Working directly with customers",
  requirements_discovery: "Discovery and scoping",
  onsite_delivery: "On-site or embedded delivery",
  technical_communication: "Technical communication",
  stakeholder_management: "Stakeholder management",
  product_sense: "Product sense",
  domain_expertise: "Industry knowledge",
  leadership_mentoring: "Leadership and mentoring",
  ambiguity: "Working through ambiguity",
  years_experience: "Years of experience",
  degree: "Degree",
  travel: "Travel",
  location: "Location",
  work_authorization: "Work authorization",
  clearance: "Security clearance",
  language: "Spoken language",
  other: "Employer-specific",
} as const;
export type RequirementKey = keyof typeof REQUIREMENT_KEYS;

export const ELIGIBILITY_KINDS = ["years", "location", "travel", "work_authorization", "degree", "clearance", "language"] as const;
export type EligibilityKind = (typeof ELIGIBILITY_KINDS)[number];

export const requirementSchema = z.object({
  id: z.string(),
  roleId: z.string(),
  text: z.string(),
  /** The exact words in this role's posting; checked against it before saving. */
  excerpt: z.string(),
  level: z.enum(["must", "preferred"]),
  category: z.enum(REQUIREMENT_CATEGORIES),
  key: z.string(),
  eligibility: z.enum(ELIGIBILITY_KINDS).nullable(),
  years: z.object({ min: z.number(), max: z.number().nullable() }).nullable(),
});
export type Requirement = z.output<typeof requirementSchema>;

export const ROLE_SOURCES = ["greenhouse", "lever", "ashby", "linkedin", "fixture"] as const;
export type RoleSource = (typeof ROLE_SOURCES)[number];

export const ROLE_STATUSES = ["open", "closed", "unknown"] as const;
export type RoleStatus = (typeof ROLE_STATUSES)[number];

export const SENIORITY_GROUPS = ["accessible", "aspirational", "unstated"] as const;
export type SeniorityGroup = (typeof SENIORITY_GROUPS)[number];

export const roleSchema = z.object({
  /** Stable across refreshes: the source and its own id. */
  id: z.string(),
  source: z.enum(ROLE_SOURCES),
  sourceLabel: z.string(),
  externalId: z.string(),
  title: z.string(),
  employer: z.string(),
  location: z.string(),
  remotePolicy: z.string(),
  seniority: z.string(),
  seniorityGroup: z.enum(SENIORITY_GROUPS),
  url: z.string(),
  applyUrl: z.string().nullable(),
  description: z.string(),
  /** False when the source gave less than a full posting. */
  fullText: z.boolean(),
  postedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  checkedAt: z.string(),
  status: z.enum(ROLE_STATUSES),
  /** Other places the same requisition is listed; copies never count twice. */
  otherLocations: z.array(z.string()),
  /** Why it's in the shortlist, in words the reader can check. */
  reasons: z.array(z.string()),
  requirements: z.array(requirementSchema),
  /** Set when reading this posting's requirements failed: it can't be compared. */
  extractionError: z.string().nullable(),
});
export type Role = z.output<typeof roleSchema>;

/** A role found so far, shown while the benchmark is still being built. */
export const discoveredRoleSchema = roleSchema.pick({ id: true, title: true, employer: true, location: true, sourceLabel: true, status: true, url: true, seniority: true });
export type DiscoveredRole = z.output<typeof discoveredRoleSchema>;

export const filtersSchema = z.object({
  location: z.string().trim().max(120).default(""),
  remoteOnly: z.boolean().default(false),
  seniority: z.enum(["any", "accessible", "aspirational"]).default("any"),
});
export type FdeFilters = z.output<typeof filtersSchema>;

export const coverageSchema = z.object({
  scope: z.string(),
  queries: z.array(z.string()),
  searchedAt: z.string(),
  sources: z.array(z.object({ source: z.string(), status: z.enum(["ok", "failed", "skipped"]), found: z.number(), note: z.string() })),
  selectionRationale: z.string(),
  candidates: z.number(),
  duplicatesMerged: z.number(),
  excluded: z.array(z.object({ title: z.string(), employer: z.string(), reason: z.string(), url: z.string() })),
  target: z.object({ min: z.number(), max: z.number(), employers: z.number() }),
  limits: z.array(z.string()),
});
export type Coverage = z.output<typeof coverageSchema>;

// ─── The comparison ──────────────────────────────────────────

export const ASSESSMENTS = ["demonstrated", "partial", "not_shown", "cannot_assess"] as const;
export type AssessmentStatus = (typeof ASSESSMENTS)[number];

export const ASSESSMENT_LABELS: Record<AssessmentStatus, string> = {
  demonstrated: "Demonstrated",
  partial: "Partial",
  not_shown: "Not shown in this profile",
  cannot_assess: "Cannot assess",
};

export const assessmentSchema = z.object({
  requirementId: z.string(),
  roleId: z.string(),
  status: z.enum(ASSESSMENTS),
  /** Exact words from the profile snapshot, each checked against it. */
  evidence: z.array(z.object({ sourceId: z.string(), label: z.string(), quote: z.string() })),
  note: z.string(),
  action: z.string(),
});
export type Assessment = z.output<typeof assessmentSchema>;

const categoryScoreSchema = z.object({ earned: z.number(), possible: z.number() });

export const roleScoreSchema = z.object({
  roleId: z.string(),
  /** Null when too little could be assessed to give a number. */
  score: z.number().nullable(),
  low: z.number().nullable(),
  high: z.number().nullable(),
  earned: z.number(),
  possible: z.number(),
  unknownWeight: z.number(),
  coverage: z.number(),
  provisional: z.boolean(),
  categories: z.record(z.string(), categoryScoreSchema),
  counts: z.record(z.string(), z.number()),
  reach: z.enum(["within_reach", "stretch", "aspirational"]),
  reachReason: z.string(),
});
export type RoleScore = z.output<typeof roleScoreSchema>;

export const marketScoreSchema = z.object({
  rubric: z.string(),
  score: z.number().nullable(),
  withheld: z.string().nullable(),
  provisional: z.boolean(),
  provisionalWhy: z.array(z.string()),
  low: z.number().nullable(),
  high: z.number().nullable(),
  roleCount: z.number(),
  employerCount: z.number(),
  weightTotal: z.number(),
  coverage: z.number(),
  categories: z.record(z.string(), categoryScoreSchema),
  groups: z.record(z.string(), z.object({ count: z.number(), score: z.number().nullable() })),
});
export type MarketScore = z.output<typeof marketScoreSchema>;

export const recurringRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  category: z.enum(REQUIREMENT_CATEGORIES),
  count: z.number(),
  analyzed: z.number(),
  mustCount: z.number(),
  roles: z.array(z.object({ roleId: z.string(), requirementId: z.string(), level: z.enum(["must", "preferred"]), status: z.enum(ASSESSMENTS).nullable(), excerpt: z.string() })),
});
export type RecurringRow = z.output<typeof recurringRowSchema>;

export const gapSchema = z.object({ key: z.string(), label: z.string(), roleCount: z.number(), mustCount: z.number(), weight: z.number() });
export type EvidenceGap = z.output<typeof gapSchema>;

export const strengthSchema = z.object({ key: z.string(), label: z.string(), roleCount: z.number(), quote: z.string(), sourceLabel: z.string(), sourceId: z.string() });
export type Strength = z.output<typeof strengthSchema>;

const rewriteSchema = z.object({ target: z.string(), original: z.string(), suggested: z.string(), why: z.string() });
export type Rewrite = z.output<typeof rewriteSchema>;

export const insightsSchema = z.object({
  summary: z.string(),
  rewrites: z.array(rewriteSchema),
  /** Suggestions dropped because they added a name or number the profile doesn't have. */
  rewritesWithheld: z.number(),
  questions: z.array(z.string()),
  portfolio: z.array(z.object({ title: z.string(), brief: z.string(), proves: z.array(z.string()) })),
  writtenWith: z.string(),
});
export type FdeInsights = z.output<typeof insightsSchema>;

// ─── Freelance matches ───────────────────────────────────────

export const PAY_BASES = ["hourly", "fixed", "per_task", "daily", "monthly", "annual", "unstated"] as const;
export type PayBasis = (typeof PAY_BASES)[number];

export const paySchema = z.object({
  /** What the listing says, unchanged. */
  raw: z.string(),
  stated: z.boolean(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  currency: z.string().nullable(),
  basis: z.enum(PAY_BASES),
  /** A client's budget is what they mean to spend, not earnings. */
  isBudget: z.boolean(),
});
export type ListedPay = z.output<typeof paySchema>;

export const freelanceMatchSchema = z.object({
  id: z.string(),
  source: z.string(),
  title: z.string(),
  client: z.string(),
  url: z.string(),
  kind: z.string(),
  location: z.string(),
  pay: paySchema,
  postedAt: z.string().nullable(),
  fetchedAt: z.string().nullable(),
  status: z.string(),
  relevance: z.string(),
  relevanceWhy: z.string(),
  fit: z.object({ score: z.number(), verdict: z.string(), reasons: z.array(z.string()), concerns: z.array(z.string()) }).nullable(),
});
export type FreelanceMatch = z.output<typeof freelanceMatchSchema>;

export const freelanceResultSchema = z.object({
  state: z.enum(["pending", "running", "done", "failed"]),
  keywords: z.array(z.string()),
  preferences: z.string(),
  matches: z.array(freelanceMatchSchema),
  sources: z.array(z.object({ source: z.string(), found: z.number(), error: z.string().nullable(), stale: z.boolean(), fetchedAt: z.string().nullable() })),
  error: z.string().nullable(),
});
export type FreelanceResult = z.output<typeof freelanceResultSchema>;

// ─── The report's progress ───────────────────────────────────

export const STAGE_KEYS = ["reading_profile", "discovering_roles", "verifying_openings", "building_benchmark", "matching_evidence", "writing_insights"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export const STAGE_LABELS: Record<StageKey, string> = {
  reading_profile: "Reading the profile",
  discovering_roles: "Discovering FDE roles",
  verifying_openings: "Verifying openings",
  building_benchmark: "Building the benchmark",
  matching_evidence: "Matching evidence",
  writing_insights: "Writing insights",
};

export const STAGE_STATES = ["pending", "running", "done", "partial", "failed", "skipped"] as const;
export type StageState = (typeof STAGE_STATES)[number];

export const stagesSchema = z.array(
  z.object({
    key: z.enum(STAGE_KEYS),
    state: z.enum(STAGE_STATES),
    detail: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
  }),
);
export type ReportStage = z.output<typeof stagesSchema>[number];

export const REPORT_STATES = ["running", "complete", "partial", "restricted", "failed", "quota"] as const;
export type ReportState = (typeof REPORT_STATES)[number];

export const PROFILE_ORIGINS = ["first_fetch", "cached", "refreshed"] as const;
export type ProfileOrigin = (typeof PROFILE_ORIGINS)[number];

export const USAGE_KINDS = ["profile", "discovery", "job_detail", "model"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

// ─── A report as stored and as the page sees it ──────────────

export type LearningPlan = {
  skill: string;
  hoursPerWeek: number;
  weeks: number;
  totalHours: number;
  assessment: { strengths: string[]; transferable: string[]; gaps: string[]; readiness: string; assumptions: string[] };
  plan: {
    phases: { title: string; weeks: string; goal: string; steps: { id: string; title: string; detail: string; kind: string; hours: number; done?: boolean }[] }[];
    project: { title: string; brief: string; demonstrates: string[] };
    leverageNow: string[];
    caveats: string[];
  };
};

export type ReportResult = {
  discovered: DiscoveredRole[];
  /** How the search went, for a report that stopped before saving a benchmark. */
  searchCoverage?: Coverage | null;
  assessments: Assessment[];
  roleScores: RoleScore[];
  market: MarketScore | null;
  recurring: RecurringRow[];
  employerSpecific: Requirement[];
  gaps: EvidenceGap[];
  strengths: Strength[];
  insights: FdeInsights | null;
  plan: LearningPlan | null;
  monthsOfExperience: number | null;
  /** Claims dropped because their quote wasn't really in the document. */
  checks: { requirementsDropped: number; claimsDowngraded: number; failedRoles: string[]; insightsFailed: boolean; planFailed: boolean };
};

export const emptyResult = (): ReportResult => ({
  discovered: [],
  assessments: [],
  roleScores: [],
  market: null,
  recurring: [],
  employerSpecific: [],
  gaps: [],
  strengths: [],
  insights: null,
  plan: null,
  monthsOfExperience: null,
  checks: { requirementsDropped: 0, claimsDowngraded: 0, failedRoles: [], insightsFailed: false, planFailed: false },
});

export type UsageSummary = { kind: string; calls: number; costMicro: number; tokens: number; estimated: boolean; cached: number };

export type ReportView = {
  id: string;
  url: string;
  subjectName: string;
  state: ReportState;
  errorCode: string | null;
  errorMessage: string | null;
  filters: FdeFilters;
  stages: ReportStage[];
  profileOrigin: ProfileOrigin | null;
  benchmarkOrigin: string | null;
  profile: (Omit<NormalizedProfile, "images"> & { imageKeys: string[]; snapshotId: string; retrievedAt: string; isFixture: boolean }) | null;
  benchmark: { id: string; version: number; discoveredAt: string; expiresAt: string; coverage: Coverage; roles: Role[] } | null;
  result: ReportResult;
  freelance: FreelanceResult | null;
  learningProgress: string[];
  usage: UsageSummary[];
  createdAt: string;
  updatedAt: string;
  refreshOf: string | null;
  newerReportId: string | null;
  rubric: string;
  rubricExplained: string[];
};
