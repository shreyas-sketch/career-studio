// A market sample for the public FDE review's end-to-end spec: invented
// employers and postings, labelled as test data, with requirements whose
// excerpts are in their own text (as the real benchmark guarantees) and pay
// stated the way real postings state it. It's written straight into the test
// database, so the spec never searches real job boards.

const SCHEMA = "u_f0de00000000000000000001";
export const RUBRIC_VERSION = "fde-fit@1";
export const PUBLIC_SCOPE_KEY = JSON.stringify([RUBRIC_VERSION, "", false, "any"]);

type Seed = { employer: string; title: string; location: string; level: "accessible" | "aspirational" | "unstated"; seniority: string; pay: string | null };

const SEEDS: Seed[] = [
  { employer: "Northwind Labs (test)", title: "Forward Deployed Engineer", location: "New York, NY", level: "accessible", seniority: "Mid level", pay: "The base salary range for this role in New York is USD 170,000 - 215,000." },
  { employer: "Lumen Systems (test)", title: "Forward Deployed Software Engineer", location: "San Francisco, CA", level: "accessible", seniority: "Mid level", pay: "The base salary range for this position in San Francisco is USD 185,000 - 240,000." },
  { employer: "Harbor AI (test)", title: "Forward Deployed Engineer, Enterprise", location: "Austin, TX", level: "accessible", seniority: "Mid level", pay: "The base salary range for this role in Austin is USD 160,000 - 205,000." },
  { employer: "Copperline (test)", title: "Forward Deployed AI Engineer", location: "Seattle, WA", level: "accessible", seniority: "Mid level", pay: "The base salary range for this role in Seattle is USD 175,000 - 225,000, plus equity." },
  { employer: "Fieldstone (test)", title: "Senior Forward Deployed Engineer", location: "New York, NY", level: "aspirational", seniority: "Senior", pay: "The base salary range for this role in New York is USD 230,000 - 290,000." },
  { employer: "Northwind Labs (test)", title: "Staff Forward Deployed Engineer", location: "San Francisco, CA", level: "aspirational", seniority: "Staff", pay: "Total compensation range: USD 320,000 - 410,000, including bonus and equity." },
  { employer: "Kestrel Data (test)", title: "Forward Deployed Engineer", location: "London, United Kingdom", level: "unstated", seniority: "", pay: "The salary range for this role in London is £85,000 - £110,000." },
  { employer: "Orbital Health (test)", title: "Forward Deployed Engineer", location: "Remote, India", level: "unstated", seniority: "", pay: null },
  { employer: "Pinecrest (test)", title: "Forward Deployed Engineer, Public Sector", location: "Washington, DC", level: "accessible", seniority: "Mid level", pay: null },
];

const LINES = {
  python: "You write production Python every day and review others' code.",
  customer: "You work directly with customers on site to understand their workflows.",
  llm: "You build LLM applications that solve real problems for our users.",
  cloud: "Experience deploying services on AWS or GCP is required.",
  apis: "You integrate our platform with customer APIs and data systems.",
  evals: "Familiarity with evals for language models is a plus.",
  years: "3+ years of software engineering experience.",
};

const REQUIREMENTS: { key: keyof typeof LINES; text: string; category: string; level: "must" | "preferred"; eligibility: string | null; years: { min: number; max: null } | null }[] = [
  { key: "python", text: "Python", category: "engineering", level: "must", eligibility: null, years: null },
  { key: "customer", text: "Customer facing", category: "customer", level: "must", eligibility: null, years: null },
  { key: "llm", text: "Llm applications", category: "ai_ml", level: "must", eligibility: null, years: null },
  { key: "cloud", text: "Cloud infra", category: "deployment_infra", level: "must", eligibility: null, years: null },
  { key: "apis", text: "Apis integrations", category: "engineering", level: "must", eligibility: null, years: null },
  { key: "evals", text: "Evals", category: "ai_ml", level: "preferred", eligibility: null, years: null },
  { key: "years", text: "Years experience", category: "eligibility", level: "must", eligibility: "years", years: { min: 3, max: null } },
];

export function marketRoles(now = new Date()) {
  const day = (offset: number) => new Date(now.getTime() - offset * 86_400_000).toISOString();
  return SEEDS.map((seed, index) => {
    const id = `fixture:e2e-${index + 1}`;
    const description = [
      `${seed.employer} is hiring a ${seed.title} in ${seed.location}. This posting is test data for automated checks.`,
      "What you'll do:",
      LINES.customer,
      LINES.llm,
      LINES.apis,
      "What we look for:",
      LINES.python,
      LINES.cloud,
      LINES.years,
      LINES.evals,
      ...(seed.pay ? ["Compensation:", seed.pay] : []),
    ].join("\n");
    return {
      id,
      source: "fixture",
      sourceLabel: "Test data",
      externalId: `e2e-${index + 1}`,
      title: seed.title,
      employer: seed.employer,
      location: seed.location,
      remotePolicy: seed.location.startsWith("Remote") ? "Remote" : "On site or hybrid",
      seniority: seed.seniority,
      seniorityGroup: seed.level,
      url: `https://example.com/jobs/e2e-${index + 1}`,
      applyUrl: null,
      description,
      fullText: true,
      postedAt: day(3 + index),
      updatedAt: day(1),
      checkedAt: now.toISOString(),
      status: "open",
      otherLocations: [],
      reasons: ["Customer-facing engineering in the posting's own words.", "Verified open when checked."],
      requirements: REQUIREMENTS.map((requirement) => ({
        id: `${id}:${requirement.key}`,
        roleId: id,
        text: requirement.text,
        excerpt: LINES[requirement.key],
        level: requirement.level,
        category: requirement.category,
        key: requirement.key,
        eligibility: requirement.eligibility,
        years: requirement.years,
      })),
      extractionError: null,
    };
  });
}

export function marketCoverage(now = new Date()) {
  return {
    scope: "Worldwide, any level (test data)",
    queries: ["Forward Deployed Engineer"],
    searchedAt: now.toISOString(),
    sources: [{ source: "Test data", status: "ok", found: SEEDS.length, note: "Invented postings for automated checks." }],
    selectionRationale: "Test data: nine invented openings at eight employers, chosen to show every part of a report.",
    candidates: SEEDS.length,
    duplicatesMerged: 0,
    excluded: [],
    target: { min: 8, max: 12, employers: 5 },
    limits: [],
  };
}

/** The SQL that puts this sample in the public review's service tenant, valid for a day. */
export function seedStatement(): { text: string; values: unknown[] } {
  const now = new Date();
  return {
    text: `INSERT INTO "${SCHEMA}"."FdeBenchmark" (id, "scopeKey", version, filters, roles, coverage, "rubricVersion", "discoveredAt", "expiresAt")
           VALUES ($1, $2, (SELECT coalesce(max(version), 0) + 1 FROM "${SCHEMA}"."FdeBenchmark" WHERE "scopeKey" = $2), $3, $4, $5, $6, now(), now() + interval '1 day')`,
    values: [`e2e-${now.getTime()}`, PUBLIC_SCOPE_KEY, JSON.stringify({ location: "", remoteOnly: false, seniority: "any" }), JSON.stringify(marketRoles(now)), JSON.stringify(marketCoverage(now)), RUBRIC_VERSION],
  };
}

export const PUBLIC_SCHEMA = SCHEMA;
