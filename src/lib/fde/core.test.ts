import { beforeAll, describe, expect, it } from "vitest";

import { checkedAssessments, eligibilityAssessment } from "@/lib/ai/tasks/fde/evidence";
import { checkedInsights } from "@/lib/ai/tasks/fde/insights";
import { checkedRequirements, isPreferredInPosting } from "@/lib/ai/tasks/fde/requirements";
import { LanguageLevel } from "@/generated/prisma/enums";

import { fromAshby, fromGreenhouseJob, fromLever, greenhouseList } from "./ats";
import { cleanQuote, highlighted, isGrounded } from "./grounding";
import { parseManifest, parseProfileUrl } from "./linkedin-url";
import { dedupe, dutySentence, seniorityOf, shortlist, titleMatches, verifyResponsibilities, type Candidate } from "./market-filter";
import { isFreelanceWork, parsePay, payHeadline } from "./pay";
import { estimatePilot } from "./pilot-estimate";
import { demonstratedStrengths, priorityGaps, recurringRequirements, scoreMarket, scoreRole } from "./rubric";
import { profileSources, toProfileData } from "./subject";
import { createFixtureProvider } from "./providers/fixture";
import type { Assessment, Requirement, Role } from "./types";

let sampleProfile: Awaited<ReturnType<ReturnType<typeof createFixtureProvider>["readProfile"]>>["profile"];
beforeAll(async () => {
  sampleProfile = (await createFixtureProvider().readProfile("https://www.linkedin.com/in/fixture-full", { fresh: false })).profile;
});

describe("profile addresses", () => {
  it("accepts a person's address, whatever its form, and gives one canonical address", () => {
    for (const input of ["https://www.linkedin.com/in/Jane-Doe/", "linkedin.com/in/jane-doe?utm_source=x", "https://in.linkedin.com/in/jane-doe", "http://linkedin.com/in/jane-doe/details/experience"]) {
      expect(parseProfileUrl(input)).toEqual({ ok: true, url: "https://www.linkedin.com/in/jane-doe", slug: "jane-doe" });
    }
  });

  it("refuses look-alikes, company pages and other schemes", () => {
    for (const input of ["", "https://linkedin.com.evil.test/in/jane", "https://evil.test/linkedin.com/in/jane", "ftp://linkedin.com/in/jane", "https://www.linkedin.com/company/acme", "https://user:pw@linkedin.com/in/jane", "https://linkedin.com:8443/in/jane", "https://localhost/in/jane", "https://169.254.169.254/in/jane", "javascript:alert(1)"]) {
      expect(parseProfileUrl(input).ok, input).toBe(false);
    }
  });

  it("keeps a manifest's distinct addresses and says what's wrong with the rest", () => {
    const manifest = parseManifest("https://linkedin.com/in/a-b\nhttps://www.linkedin.com/in/A-B/\nlinkedin.com/in/c-d, nonsense");
    expect(manifest.urls.map((entry) => entry.slug)).toEqual(["a-b", "c-d"]);
    expect(manifest.duplicates).toBe(1);
    expect(manifest.rejected).toHaveLength(1);
  });
});

describe("grounding", () => {
  const text = "We need 3+ years of  Python.\nYou’ll work on-site with customers — often.";

  it("finds a quote despite spacing, case and curly quotes", () => {
    expect(isGrounded(text, "3+ years of python")).toBe(true);
    expect(isGrounded(text, "you'll work on-site with customers - often")).toBe(true);
  });

  it("refuses words that aren't there and quotes too short to mean anything", () => {
    expect(isGrounded(text, "5+ years of python")).toBe(false);
    expect(isGrounded(text, "we")).toBe(false);
  });

  it("strips what a model adds around a quote", () => {
    expect(cleanQuote(' - "3+ years of Python" ')).toBe("3+ years of Python");
  });

  it("marks passages without changing a character of the text", () => {
    const segments = highlighted(text, ["3+ years of python", "on-site with customers", "not in the text at all"]);
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
    expect(segments.filter((segment) => segment.marked).map((segment) => segment.text)).toEqual(["3+ years of  Python", "on-site with customers"]);
  });
});

const requirement = (id: string, roleId: string, overrides: Partial<Requirement> = {}): Requirement => ({ id, roleId, text: id, excerpt: `${id} excerpt`, level: "must", category: "engineering", key: "python", eligibility: null, years: null, ...overrides });
const assess = (requirementId: string, roleId: string, status: Assessment["status"], quote = "quoted words"): Assessment => ({ requirementId, roleId, status, evidence: status === "demonstrated" || status === "partial" ? [{ sourceId: "about", label: "About", quote }] : [], note: "", action: "" });
const role = (id: string, employer: string, requirements: Requirement[], overrides: Partial<Role> = {}): Role =>
  ({ id, employer, status: "open", seniorityGroup: "accessible", requirements, title: "Forward Deployed Engineer", ...overrides }) as Role;

describe("the rubric", () => {
  it("weighs must-haves twice, and gives half for partial", () => {
    const target = role("a", "A", [requirement("r1", "a"), requirement("r2", "a", { key: "cloud_infra", category: "deployment_infra" }), requirement("r3", "a", { level: "preferred", key: "evals" })]);
    const score = scoreRole(target, [assess("r1", "a", "demonstrated"), assess("r2", "a", "partial"), assess("r3", "a", "not_shown")], { partialProfile: false, monthsOfExperience: 60 });
    // earned 2 + 1 + 0 of 2 + 2 + 1
    expect(score.earned).toBe(3);
    expect(score.possible).toBe(5);
    expect(score.score).toBe(60);
    expect(score.coverage).toBe(1);
  });

  it("leaves Cannot assess out of the score, and shows it as a range", () => {
    const target = role("a", "A", [requirement("r1", "a"), requirement("r2", "a"), requirement("r3", "a")]);
    const score = scoreRole(target, [assess("r1", "a", "demonstrated"), assess("r2", "a", "cannot_assess"), assess("r3", "a", "not_shown")], { partialProfile: false, monthsOfExperience: 60 });
    expect(score.score).toBe(50);
    expect(score.low).toBe(33);
    expect(score.high).toBe(67);
    expect(score.provisional).toBe(true);
  });

  it("never lets eligibility into technical fit", () => {
    const target = role("a", "A", [requirement("r1", "a"), requirement("r2", "a"), requirement("r3", "a"), requirement("years", "a", { eligibility: "years", category: "eligibility", key: "years_experience", years: { min: 20, max: null } })]);
    const score = scoreRole(target, [assess("r1", "a", "demonstrated"), assess("r2", "a", "demonstrated"), assess("r3", "a", "demonstrated"), assess("years", "a", "not_shown")], { partialProfile: false, monthsOfExperience: 12 });
    expect(score.score).toBe(100);
    expect(score.reach).toBe("aspirational");
  });

  it("counts a requirement another role has against that role only", () => {
    const first = role("a", "A", [requirement("r1", "a")]);
    const second = role("b", "B", [requirement("r2", "b")]);
    const assessments = [assess("r1", "a", "demonstrated"), assess("r2", "b", "not_shown")];
    const options = { partialProfile: false, monthsOfExperience: 60 };
    expect(scoreRole(first, assessments, options).score).toBe(100);
    expect(scoreRole(second, assessments, options).score).toBe(0);
  });

  it("averages per role, with aspirational roles at half weight, and only open ones", () => {
    const options = { partialProfile: false, monthsOfExperience: 60 };
    const roles = [role("a", "A", [requirement("r1", "a")]), role("b", "B", [requirement("r2", "b")], { seniorityGroup: "aspirational" }), role("c", "C", [requirement("r3", "c")], { status: "closed" })];
    const assessments = [assess("r1", "a", "demonstrated"), assess("r2", "b", "not_shown"), assess("r3", "c", "demonstrated")];
    const market = scoreMarket(roles, roles.map((entry) => scoreRole(entry, assessments, options)), { profileQuality: "full" });
    // (1 × 100 + 0.5 × 0) / 1.5
    expect(market.score).toBe(67);
    expect(market.roleCount).toBe(2);
    expect(market.groups.accessible.score).toBe(100);
    expect(market.groups.aspirational.score).toBe(0);
    expect(market.provisional).toBe(true);
  });

  it("withholds the score for an identity-only profile", () => {
    const roles = [role("a", "A", [requirement("r1", "a")])];
    const market = scoreMarket(roles, roles.map((entry) => scoreRole(entry, [], { partialProfile: true, monthsOfExperience: null })), { profileQuality: "identity" });
    expect(market.score).toBeNull();
    expect(market.withheld).toMatch(/name-level/);
  });

  it("counts distinct roles for prevalence, not mentions, and keeps one-offs employer-specific", () => {
    const roles = [
      role("a", "A", [requirement("r1", "a"), requirement("r2", "a"), requirement("o1", "a", { key: "other" })]),
      role("b", "B", [requirement("r3", "b"), requirement("r4", "b", { key: "evals" })]),
    ];
    const { recurring, employerSpecific } = recurringRequirements(roles, []);
    expect(recurring).toHaveLength(1);
    expect(recurring[0]).toMatchObject({ key: "python", count: 2, analyzed: 2 });
    expect(employerSpecific.map((entry) => entry.id).sort()).toEqual(["o1", "r4"]);
  });

  it("lists gaps and strengths only from what was assessed that way", () => {
    const roles = [role("a", "A", [requirement("r1", "a"), requirement("r2", "a", { key: "evals" }), requirement("r3", "a", { key: "cloud_infra" })])];
    const assessments = [assess("r1", "a", "demonstrated"), assess("r2", "a", "not_shown"), assess("r3", "a", "cannot_assess")];
    expect(priorityGaps(roles, assessments).map((gap) => gap.key)).toEqual(["evals"]);
    expect(demonstratedStrengths(roles, assessments).map((strength) => strength.key)).toEqual(["python"]);
  });
});

describe("pay", () => {
  it("reads amount, currency and basis as listed", () => {
    expect(parsePay("$50 - $70 / hour")).toMatchObject({ stated: true, min: 50, max: 70, currency: "USD", basis: "hourly", isBudget: false });
    expect(parsePay("Budget: €2,500 fixed")).toMatchObject({ min: 2500, max: null, currency: "EUR", basis: "fixed", isBudget: true });
    expect(parsePay("120k-150k USD per year")).toMatchObject({ min: 120000, max: 150000, basis: "annual" });
  });

  it("says when pay isn't stated, rather than guessing", () => {
    for (const raw of ["", "Competitive", "negotiable", "2 years"]) {
      const pay = parsePay(raw);
      expect(pay.stated, raw).toBe(false);
      expect(payHeadline(pay).amount).toBe("Pay not stated");
    }
  });

  it("labels a budget as a budget", () => {
    expect(payHeadline(parsePay("Budget $500")).label).toMatch(/budget/i);
  });
});

const posting = (overrides: Partial<Candidate> = {}): Candidate => ({
  source: "greenhouse",
  sourceLabel: "Greenhouse board",
  externalId: "acme:1",
  requisitionId: null,
  title: "Forward Deployed Engineer",
  employer: "Acme",
  location: "New York",
  remotePolicy: "",
  url: "https://example.com/1",
  applyUrl: null,
  description: `You will work directly with customers to deploy our software in production. You write Python code every day and integrate with their systems. ${"We care about reliable delivery and clear thinking across every customer engagement. ".repeat(8)}`,
  postedAt: "2026-11-01T00:00:00.000Z",
  updatedAt: null,
  checkedAt: "2026-11-05T00:00:00.000Z",
  status: "open",
  otherLocations: [],
  ...overrides,
});
const options = { target: 10, min: 8, max: 12, minEmployers: 5, perEmployer: 2, established: new Set<string>() };
const anyFilters = { location: "", remoteOnly: false, seniority: "any" as const };

describe("what counts as the role", () => {
  it("accepts the role and real equivalents, and refuses other jobs using the words", () => {
    for (const title of ["Forward Deployed Engineer", "Forward-Deployed Software Engineer, Public Sector", "Senior FDE", "AI Deployment Engineer", "Applied AI Engineer"]) expect(titleMatches(title).match, title).toBe(true);
    for (const title of ["Forward Deployed Product Manager", "Forward Deployed Engineering Manager", "Forward Deployed Strategist", "Forward Deployed Architect", "Software Engineer", "Forward Deployed Banker", "Forward Deployed Engineer Intern"]) expect(titleMatches(title).match, title).toBe(false);
  });

  it("wants the posting's text to describe the work, not just the title", () => {
    expect(verifyResponsibilities(posting(), false).ok).toBe(true);
    expect(verifyResponsibilities(posting({ description: "We have a great office and free lunch. Software company." }), false).ok).toBe(false);
  });

  it("reports seniority only as stated", () => {
    expect(seniorityOf("Senior Forward Deployed Engineer", "")).toEqual({ seniority: "Senior", group: "aspirational" });
    expect(seniorityOf("Forward Deployed Engineer", "No level mentioned.")).toEqual({ seniority: "Not stated", group: "unstated" });
    expect(seniorityOf("Forward Deployed Engineer", "You have 3+ years of experience")).toEqual({ seniority: "Asks for 3+ years", group: "accessible" });
    expect(seniorityOf("Forward Deployed Engineer", "You have 8+ years of experience")).toEqual({ seniority: "Asks for 8+ years", group: "aspirational" });
  });

  it("merges geography copies of one requisition, and keeps the employer's own posting", () => {
    const { roles, merged } = dedupe([posting({ source: "linkedin", externalId: "9", location: "Remote" }), posting({ externalId: "acme:1", location: "New York" }), posting({ externalId: "acme:2", location: "London" })]);
    expect(merged).toBe(2);
    expect(roles).toHaveLength(1);
    expect(roles[0].source).toBe("greenhouse");
    expect(roles[0].otherLocations.sort()).toEqual(["London", "Remote"]);
  });

  it("keeps different roles at one employer apart", () => {
    const other = "Lead the delivery of our defence platform with government agencies and write Rust. ".repeat(10);
    expect(dedupe([posting(), posting({ externalId: "acme:3", description: other })]).roles).toHaveLength(2);
  });
});

describe("the reason a role is in the sample", () => {
  const boilerplate = "Acme powers millions of websites for customers ranging from bloggers to banks.";
  const duty = "As a Forward Deployed Engineer you'll work directly with strategic customers to deploy production systems.";

  it("quotes what the role does, not what the company says about itself", () => {
    expect(dutySentence(`${boilerplate} ${duty}`, /\bcustomers?\b/gi)).toBe(duty);
  });

  it("quotes nothing when only the company's description mentions customers", () => {
    expect(dutySentence(boilerplate, /\bcustomers?\b/gi)).toBe("");
    const [role] = shortlist([posting({ description: `${boilerplate} ${"Acme deploys software in production and writes code for a living. ".repeat(12)}` })], anyFilters, options).selected;
    expect(role.reasons.join(" ")).toContain("no sentence plainly says");
    expect(role.reasons.join(" ")).not.toContain("bloggers");
  });
});

describe("the shortlist", () => {
  const many = Array.from({ length: 7 }, (_, index) => posting({ employer: `Employer ${index}`, externalId: `e${index}:1`, url: `https://example.com/${index}` }));

  it("spreads across employers, explains itself and says when the sample falls short", () => {
    const { selected, limits } = shortlist(many, anyFilters, options);
    expect(new Set(selected.map((entry) => entry.employer)).size).toBe(7);
    expect(selected[0].reasons[0]).toContain("Forward Deployed Engineer");
    expect(selected[0].reasons.some((reason) => reason.startsWith("Customer-facing:"))).toBe(true);
    expect(limits[0]).toMatch(/Only 7 verified roles/);
  });

  it("leaves out closed, unverified, title-only and description-less roles, each with its reason", () => {
    const { selected, excluded } = shortlist(
      [posting({ status: "closed" }), posting({ status: "unknown", externalId: "2" }), posting({ title: "Forward Deployed Product Manager", externalId: "3" }), posting({ description: "Short.", externalId: "4" }), posting({ description: "A company that's growing. ".repeat(40), externalId: "5" })],
      anyFilters,
      options,
    );
    expect(selected).toEqual([]);
    expect(excluded.map((entry) => entry.reason)).toEqual(["It's closed.", "It couldn't be confirmed open.", "It isn't an engineering role.", "The full description wasn't available, and a snippet isn't enough.", "The posting doesn't describe customer-facing work."]);
  });

  it("takes no more than two from one employer, at different levels where it can", () => {
    const { selected } = shortlist([posting(), posting({ externalId: "2", title: "Senior Forward Deployed Engineer" }), posting({ externalId: "3", title: "Forward Deployed Software Engineer" })], anyFilters, options);
    expect(selected).toHaveLength(2);
    expect(new Set(selected.map((entry) => entry.seniorityGroup)).size).toBe(2);
  });

  it("applies the filters and never anything else", () => {
    expect(shortlist(many, { ...anyFilters, location: "Antarctica" }, options).selected).toEqual([]);
    expect(shortlist(many, { ...anyFilters, remoteOnly: true }, options).selected).toEqual([]);
    expect(shortlist([posting({ title: "Senior Forward Deployed Engineer" })], { ...anyFilters, seniority: "accessible" }, options).selected).toEqual([]);
  });

  it("picks the same roles for anyone: its input doesn't include a profile", () => {
    expect(shortlist(many, anyFilters, options).selected.map((entry) => entry.id)).toEqual(shortlist(many, anyFilters, options).selected.map((entry) => entry.id));
    expect(shortlist.length).toBe(3);
  });
});

describe("employers' boards", () => {
  const board = { source: "greenhouse" as const, slug: "acme", employer: "Acme" };
  const at = "2026-11-05T00:00:00.000Z";

  it("reads a Greenhouse job, whose HTML comes escaped", () => {
    const job = fromGreenhouseJob({ id: 7, title: "Forward Deployed Engineer", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/7", location: { name: "Remote, US" }, content: "&lt;p&gt;Work with &lt;strong&gt;customers&lt;/strong&gt;.&lt;/p&gt;", updated_at: "2026-11-01T00:00:00Z", requisition_id: "R-1" }, board, at);
    expect(job).toMatchObject({ externalId: "acme:7", location: "Remote, US", requisitionId: "R-1", status: "open", checkedAt: at, description: expect.stringContaining("Work with customers.") });
    expect(job?.description).not.toContain("<");
  });

  it("lists Greenhouse titles without reading each job", () => {
    expect(greenhouseList({ jobs: [{ id: 1, title: "A" }, { title: "No id" }] })).toEqual([{ id: "1", title: "A" }]);
    expect(greenhouseList(null)).toEqual([]);
  });

  it("reads Lever, keeping only matching titles and every section of the posting", () => {
    const jobs = fromLever([{ id: "x", text: "Forward Deployed Engineer", hostedUrl: "https://jobs.lever.co/p/x", categories: { location: "NYC" }, descriptionPlain: "About", lists: [{ text: "You have", content: "<li>Python</li>" }], additionalPlain: "More" }, { id: "y", text: "Accountant", hostedUrl: "https://jobs.lever.co/p/y" }], { ...board, source: "lever" }, at);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].description).toMatch(/About[\s\S]*You have[\s\S]*Python[\s\S]*More/);
  });

  it("reads Ashby, skipping unlisted jobs and keeping other locations", () => {
    const jobs = fromAshby({ jobs: [{ id: "a", title: "Forward Deployed Engineer", jobUrl: "https://jobs.ashbyhq.com/o/a", location: "SF", secondaryLocations: [{ location: "NYC" }], descriptionPlain: "Text", isListed: true, isRemote: true }, { id: "b", title: "Forward Deployed Engineer", jobUrl: "https://jobs.ashbyhq.com/o/b", isListed: false }] }, { ...board, source: "ashby" }, at);
    expect(jobs.map((job) => job.externalId)).toEqual(["acme:a"]);
    expect(jobs[0]).toMatchObject({ otherLocations: ["NYC"], remotePolicy: "Remote" });
  });

  it("skips anything that isn't a job with a secure link", () => {
    expect(fromGreenhouseJob({ id: 1, title: "x", absolute_url: "http://insecure.test" }, board, at)).toBeNull();
    expect(fromLever("nonsense", { ...board, source: "lever" }, at)).toEqual([]);
    expect(fromAshby(null, { ...board, source: "ashby" }, at)).toEqual([]);
  });
});

describe("checking what a model says about a posting", () => {
  const description = "Requirements:\n5+ years of Python in production.\nCustomer-facing work.\n\nNice to have:\nExperience with Kubernetes clusters.\n";
  const input = { roleId: "a", title: "FDE", employer: "A", description };
  const raw = (overrides = {}) => ({ text: "Python", excerpt: "5+ years of Python in production", level: "must" as const, category: "engineering" as const, key: "python", eligibility: null, ...overrides });

  it("drops a requirement whose quote isn't in this posting", () => {
    const { requirements, dropped } = checkedRequirements({ isCustomerFacingEngineering: true, requirements: [raw(), raw({ excerpt: "10 years of Rust at another employer" })] }, input);
    expect(requirements).toHaveLength(1);
    expect(requirements[0].roleId).toBe("a");
    expect(dropped).toBe(1);
  });

  it("trusts the posting's own structure about what's optional", () => {
    expect(isPreferredInPosting(description, "Experience with Kubernetes clusters")).toBe(true);
    expect(isPreferredInPosting(description, "Customer-facing work")).toBe(false);
    const { requirements } = checkedRequirements({ isCustomerFacingEngineering: true, requirements: [raw({ excerpt: "Experience with Kubernetes clusters", key: "containers_kubernetes" })] }, input);
    expect(requirements[0].level).toBe("preferred");
  });

  it("treats years as eligibility, works out the number and sends unknown keys to employer-specific", () => {
    const { requirements } = checkedRequirements({ isCustomerFacingEngineering: true, requirements: [raw({ key: "years_experience" }), raw({ excerpt: "Customer-facing work", key: "made_up" })] }, input);
    expect(requirements[0]).toMatchObject({ eligibility: "years", category: "eligibility", years: { min: 5 } });
    expect(requirements[1].key).toBe("other");
  });
});

describe("checking what a model says about a profile", () => {
  const sources = [{ id: "exp-0", label: "Engineer at Lumen", text: "Built Python services for three customers." }];
  const requirements = [requirement("r1", "a"), requirement("r2", "a")];
  const input = { roleId: "a", title: "FDE", employer: "A", requirements, sources };
  const answer = (status: "demonstrated" | "partial" | "not_shown" | "cannot_assess", quote: string, note = "fine", sourceId = "exp-0") => ({ requirementId: "r1", status, evidence: [{ sourceId, quote }], note, action: "" });

  it("keeps a quote that's really in the source", () => {
    const { assessments } = checkedAssessments({ assessments: [answer("demonstrated", "Built Python services")] }, input);
    expect(assessments[0]).toMatchObject({ status: "demonstrated", evidence: [{ sourceId: "exp-0", label: "Engineer at Lumen", quote: "Built Python services" }] });
  });

  it("turns a claim with an invented quote, or one from a source that doesn't hold it, into Not shown", () => {
    for (const bad of [answer("demonstrated", "Ran Kubernetes at Google"), answer("partial", "Built Python services", "fine", "other-source")]) {
      const { assessments, downgraded } = checkedAssessments({ assessments: [bad] }, input);
      expect(assessments[0].status).toBe("not_shown");
      expect(assessments[0].evidence).toEqual([]);
      expect(downgraded).toBe(1);
    }
  });

  it("marks anything the model skipped as Cannot assess, not as a gap", () => {
    const { assessments } = checkedAssessments({ assessments: [] }, input);
    expect(assessments.map((entry) => entry.status)).toEqual(["cannot_assess", "cannot_assess"]);
  });

  it("drops a note that adds a fact from nowhere", () => {
    const { assessments } = checkedAssessments({ assessments: [answer("demonstrated", "Built Python services", "They ran 40 teams at Google.")] }, input);
    expect(assessments[0].note).not.toContain("Google");
  });

  it("settles years from dates and never infers work authorization or travel", () => {
    const today = new Date(2026, 10, 5);
    const context = { profile: toProfileData(sampleProfile), monthsOfExperience: 40, languages: ["English"], today };
    expect(eligibilityAssessment(requirement("y", "a", { eligibility: "years", years: { min: 5, max: null } }), context)?.status).toBe("not_shown");
    expect(eligibilityAssessment(requirement("y", "a", { eligibility: "years", years: { min: 3, max: null } }), context)?.status).toBe("demonstrated");
    expect(eligibilityAssessment(requirement("w", "a", { eligibility: "work_authorization" }), context)?.status).toBe("cannot_assess");
    expect(eligibilityAssessment(requirement("t", "a", { eligibility: "travel" }), context)?.status).toBe("cannot_assess");
    expect(eligibilityAssessment(requirement("l", "a", { eligibility: "language", excerpt: "Fluent German required" }), context)?.status).toBe("cannot_assess");
    expect(eligibilityAssessment(requirement("r", "a"), context)).toBeNull();
  });
});

describe("the sample profile", () => {
  it("loads, and maps without any of the owner's data", () => {
    expect(sampleProfile.provider).toMatch(/Fixture/);
    const subject = toProfileData(sampleProfile);
    expect(subject.basics.email).toBe("");
    expect(subject.photo).toBeNull();
    expect(subject.languages[1].level).toBe(LanguageLevel.NATIVE);
    expect(profileSources(sampleProfile).map((source) => source.id)).toEqual(expect.arrayContaining(["about", "exp-0", "skills"]));
  });
});

describe("suggested wording", () => {
  const input = { name: "Sam", sources: [{ id: "about", label: "About", text: "Built Python services for customers in Pune." }], gaps: [], strengths: [], recurring: [], score: 60, provisional: false, writtenWith: "model" };
  const answer = (suggested: string, original = "Built Python services") => ({ summary: "A summary.", rewrites: [{ target: "About", original, suggested, why: "It speaks to the sample." }], questions: [], portfolio: [] });

  it("keeps a rewrite of what's there, with placeholders for unknown numbers", () => {
    const { rewrites, rewritesWithheld } = checkedInsights(answer("Built Python services for [number] customers in Pune."), input);
    expect(rewrites).toHaveLength(1);
    expect(rewritesWithheld).toBe(0);
  });

  it("withholds one that invents a number or a name, or rewrites words that aren't there", () => {
    for (const bad of [answer("Built Python services for 500 customers."), answer("Built Python services at Google."), answer("Built things.", "Words nobody wrote here")]) {
      const { rewrites, rewritesWithheld } = checkedInsights(bad, input);
      expect(rewrites).toEqual([]);
      expect(rewritesWithheld).toBe(1);
    }
  });
});

describe("the pilot's estimate", () => {
  it("costs 125 profiles at the published prices, and less with a reused benchmark", () => {
    const fresh = estimatePilot(125, { detailLimit: 10, usdPerMillionTokens: null });
    expect(fresh.profileMicro).toBe(800_000);
    expect(fresh.paidTotalMicro).toBe(813_000);
    expect(fresh.modelMicro).toBeNull();
    expect(estimatePilot(125, { detailLimit: 10, usdPerMillionTokens: 3, benchmarkReused: true }).paidTotalMicro).toBe(800_000);
  });
});

describe("freelance listings", () => {
  it("keeps contract work and drops salaried jobs", () => {
    expect(isFreelanceWork("contract", parsePay("$80/hour"))).toBe(true);
    expect(isFreelanceWork("freelance", parsePay(""))).toBe(true);
    expect(isFreelanceWork("part-time", parsePay("$1000 per task"))).toBe(true);
    expect(isFreelanceWork("full-time", parsePay(""))).toBe(false);
    expect(isFreelanceWork("", parsePay("$3.5k-$5k/month"))).toBe(false);
    expect(isFreelanceWork("contract", parsePay("USD 268000-365100 per yearly"))).toBe(false);
  });
});

describe("telling copies of a posting from different jobs", () => {
  const base = { source: "greenhouse", employer: "Acme", status: "open", otherLocations: [] as string[], requisitionId: null };
  const text = "Forward deployed engineers work with customers on production deployments. ".repeat(30);
  const role = (externalId: string, title: string, location: string) => ({ ...base, externalId, title, location, description: text }) as unknown as Candidate;

  it("merges the same title in different places", () => {
    const { roles, merged } = dedupe([role("1", "Forward Deployed Engineer (Korea)", "Seoul"), role("2", "Forward Deployed Engineer - London", "London")]);
    expect(merged).toBe(1);
    expect(roles).toHaveLength(1);
    expect(roles[0].otherLocations).toHaveLength(1);
  });

  it("keeps different specialisms apart, however similar their text", () => {
    const { roles } = dedupe([role("1", "Forward Deployed Security Engineer", "Washington"), role("2", "Forward Deployed Software Engineer", "Washington")]);
    expect(roles).toHaveLength(2);
  });
});
