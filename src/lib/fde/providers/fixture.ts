import { normalizedProfileSchema, type NormalizedProfile } from "../types";

import { ProviderError, type RetrievalProvider } from "./types";

// Sample people, for trying the whole report without a token. They're invented,
// their provider is "Fixture", and the page shows a banner on every report built
// from them. A fixture is never presented as a live LinkedIn read. Each special
// address below acts out one way a real read can go wrong.

const LABEL = "Fixture (sample data)";

const date = (year: number, month: number | null = null) => ({ year, month, text: month ? `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]} ${year}` : String(year) });

const SAMPLE_ABOUT = `Software engineer who has spent the last six years building data products and shipping them inside customers' own environments. I like the part of the work where a real system meets a real organisation: sitting with operations teams, working out what they actually need, and writing the code that gets it running in production.

At Lumen Freight I lead the integrations team and spend about half my time on customer sites. Before that I built backend services at Northwind Health, where I learned to take compliance seriously.

Outside work I mentor early-career engineers and write about reliable data pipelines.`;

const entry = (id: string, title: string, subtitle: string, when: string, description = "", link: string | null = null) => ({ id, title, subtitle, when, description, link });

function sample(slug: string, overrides: Partial<NormalizedProfile> = {}): NormalizedProfile {
  return normalizedProfileSchema.parse({
    provider: LABEL,
    providerProfileId: `fixture-${slug}`,
    publicIdentifier: slug,
    url: `https://www.linkedin.com/in/${slug}`,
    name: "Riya Menon (sample)",
    headline: "Senior Software Engineer, Integrations at Lumen Freight",
    location: "Bengaluru, Karnataka, India",
    photo: "photo",
    banner: "banner",
    images: { photo: "fixture:photo", banner: "fixture:banner", "co-0": "fixture:logo", "co-1": "fixture:logo", "ed-0": "fixture:logo" },
    about: SAMPLE_ABOUT,
    currentPosition: "Senior Software Engineer, Integrations at Lumen Freight",
    followers: 1840,
    connections: null,
    experience: [
      {
        id: "exp-0",
        title: "Senior Software Engineer, Integrations",
        company: "Lumen Freight",
        companyUrl: null,
        logo: "co-0",
        location: "Bengaluru, India",
        employmentType: "Full-time",
        workplaceType: "Hybrid",
        start: date(2022, 3),
        end: null,
        current: true,
        duration: "3 yrs 9 mos",
        description:
          "Lead a team of four building integrations between our logistics platform and customers' ERP systems.\nWorked on site with customers to scope and deploy Python and TypeScript services into their cloud environments.\nBuilt an LLM-based document extraction pipeline in Python that now handles customs paperwork for three customers.\nOwned production on-call for the integrations platform on AWS and Kubernetes.",
        skills: ["Python", "TypeScript", "AWS", "Kubernetes", "PostgreSQL"],
      },
      {
        id: "exp-1",
        title: "Software Engineer",
        company: "Northwind Health",
        companyUrl: null,
        logo: "co-1",
        location: "Pune, India",
        employmentType: "Full-time",
        workplaceType: "On-site",
        start: date(2019, 7),
        end: date(2022, 2),
        current: false,
        duration: "2 yrs 8 mos",
        description: "Built REST APIs in Java and Python for a claims product.\nWrote SQL reporting used by the compliance team during audits.",
        skills: ["Java", "Python", "SQL"],
      },
    ],
    education: [{ id: "edu-0", school: "College of Engineering, Pune", degree: "B.Tech", field: "Computer Engineering", period: "2015 - 2019", start: date(2015), end: date(2019), logo: "ed-0", skills: [] }],
    skills: ["Python", "TypeScript", "Java", "SQL", "AWS", "Kubernetes", "REST APIs", "Technical writing"].map((name) => ({ name, endorsements: "" })),
    certifications: [entry("cert-0", "AWS Certified Solutions Architect, Associate", "Amazon Web Services", "2023")],
    projects: [entry("proj-0", "Open customs parser", "", "2024", "An open-source parser for customs forms, with an evaluation set of 400 labelled documents.")],
    publications: [],
    languages: [
      { name: "English", proficiency: "Full professional proficiency" },
      { name: "Hindi", proficiency: "Native or bilingual proficiency" },
    ],
    awards: [],
    volunteering: [entry("vol-0", "Mentor", "Women Who Code", "2021 - now")],
    recommendations: [],
    courses: [],
    sections: { about: "present", experience: "present", education: "present", skills: "present", certifications: "present", projects: "present", publications: "empty", languages: "present", awards: "empty", volunteering: "present", recommendations: "empty", courses: "not_retrieved" },
    quality: "full",
    sourceAge: null,
    ...overrides,
  });
}

const LONG_ROLE = "Led delivery for a regional customer, working through scoping, integration and production rollout with their engineering team. ".repeat(14);

function profileFor(slug: string): NormalizedProfile {
  switch (slug) {
    case "fixture-no-photo":
      return sample(slug, { photo: null, banner: null, images: {} });
    case "fixture-broken-photo":
      return sample(slug, { images: { photo: "https://media.licdn.com/dms/image/fixture-missing/photo.jpg" }, banner: null });
    case "fixture-partial":
      return sample(slug, {
        about: "",
        education: [],
        sections: { about: "not_retrieved", experience: "present", education: "not_retrieved", skills: "present", certifications: "not_retrieved", projects: "not_retrieved", publications: "not_retrieved", languages: "not_retrieved", awards: "not_retrieved", volunteering: "not_retrieved", recommendations: "not_retrieved", courses: "not_retrieved" },
        quality: "partial",
      });
    case "fixture-identity":
      return sample(slug, {
        about: "",
        experience: [],
        education: [],
        skills: [],
        certifications: [],
        projects: [],
        languages: [],
        volunteering: [],
        currentPosition: "",
        photo: null,
        banner: null,
        images: {},
        sections: { about: "not_retrieved", experience: "not_retrieved", education: "not_retrieved", skills: "not_retrieved", certifications: "not_retrieved", projects: "not_retrieved", publications: "not_retrieved", languages: "not_retrieved", awards: "not_retrieved", volunteering: "not_retrieved", recommendations: "not_retrieved", courses: "not_retrieved" },
        quality: "identity",
      });
    case "fixture-long":
      return sample(slug, {
        about: `${SAMPLE_ABOUT}\n\n${"I also keep notes on what goes wrong in customer deployments and how teams recover from it. ".repeat(30)}`,
        experience: [
          ...sample(slug).experience,
          ...Array.from({ length: 12 }, (_, index) => ({
            id: `exp-${index + 2}`,
            title: `Engineer, regional team ${index + 1}`,
            company: `Sample Company ${index + 1}`,
            companyUrl: null,
            logo: null,
            location: "India",
            employmentType: "Contract",
            workplaceType: "",
            start: date(2018 - index, 1),
            end: date(2018 - index, 12),
            current: false,
            duration: "1 yr",
            description: LONG_ROLE,
            skills: [],
          })),
        ],
      });
    default:
      return sample(slug);
  }
}

export function createFixtureProvider(): RetrievalProvider {
  return {
    id: "fixture",
    label: LABEL,
    isFixture: true,
    isConfigured: () => true,
    async readProfile(url) {
      const slug = url.split("/in/")[1]?.split(/[/?#]/)[0]?.toLowerCase() ?? "fixture";
      if (slug === "fixture-private") throw new ProviderError("inaccessible", "The provider can't read this record: it's private or restricted.");
      if (slug === "fixture-401") throw new ProviderError("invalid_credentials", "Treg didn't accept the token. Check TREG_API_TOKEN in the server's variables.");
      if (slug === "fixture-403") throw new ProviderError("permission", "Treg says this token isn't allowed to use this tool.");
      if (slug === "fixture-429") throw new ProviderError("rate_limited", "Treg is limiting requests right now.");
      if (slug === "fixture-quota") throw new ProviderError("depleted", "The Treg balance has run out. Nothing was charged for this call.");
      if (slug === "fixture-timeout") throw new ProviderError("timeout", "The provider took too long to answer.");
      return { profile: profileFor(slug), charge: { provider: "fixture", tool: "fixture.profile", costMicro: 0, callId: null, cached: false } };
    },
    async searchJobs() {
      return { listings: [], charge: { provider: "fixture", tool: "fixture.search", costMicro: 0, callId: null, cached: false } };
    },
    async getJob() {
      throw new ProviderError("inaccessible", "Fixture mode has no job records.");
    },
    async checkConnection() {
      return { ok: true, code: null, message: "Fixture mode is on: no provider was contacted, and no report here is a live read.", balanceUsd: null, checkedAt: new Date().toISOString() };
    },
  };
}
