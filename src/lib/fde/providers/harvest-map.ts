import { z } from "zod";

import type { JobRecord, ListingSummary } from "./types";
import { ProviderError } from "./types";
import { normalizedProfileSchema, type NamedEntry, type NormalizedProfile, type ProfileDate, type ProfileSection, type SectionState } from "../types";

// HarvestAPI's LinkedIn records in our own shape. Fields are copied by name from
// a closed list, so an email address or anything else not listed can't come
// along. Nothing is filled in: a field the provider didn't send stays absent,
// and an empty list stays different from a list that never arrived.

const looseObject = z.record(z.string(), z.unknown());
const envelope = z.object({ element: z.unknown().optional(), elements: z.unknown().optional(), status: z.unknown().optional(), error: z.unknown().optional() });

type Raw = Record<string, unknown>;

const str = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const record = (value: unknown): Raw | null => (looseObject.safeParse(value).success && !Array.isArray(value) ? (value as Raw) : null);
const list = (value: unknown): Raw[] | null => (Array.isArray(value) ? value.map(record).filter((entry): entry is Raw => entry !== null) : null);
const httpsUrl = (value: unknown): string | null => {
  const url = str(value);
  return /^https:\/\//i.test(url) ? url : null;
};
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function dateOf(value: unknown): ProfileDate | null {
  const date = record(value);
  if (!date) return typeof value === "string" && value.trim() ? { year: Number(/\b(\d{4})\b/.exec(value)?.[1]) || null, month: null, text: value.trim() } : null;
  const year = typeof date.year === "number" ? date.year : Number(str(date.year)) || null;
  const raw = str(date.month).toLowerCase();
  const index = MONTHS.indexOf(raw.slice(0, 3));
  const month = index >= 0 ? index + 1 : Number(raw) >= 1 && Number(raw) <= 12 ? Number(raw) : null;
  const text = str(date.text) || [raw && MONTHS[(month ?? 0) - 1], year].filter(Boolean).join(" ");
  return year === null && !text ? null : { year, month, text };
}

const isCurrent = (end: unknown) => /present/i.test(str(record(end)?.text) || str(end));

function imageOf(value: unknown): string | null {
  const direct = httpsUrl(value);
  if (direct) return direct;
  const image = record(value);
  if (!image) return null;
  return httpsUrl(image.url) ?? httpsUrl(list(image.sizes)?.at(-1)?.url);
}

const sectionState = (value: unknown): SectionState => (Array.isArray(value) ? (value.length > 0 ? "present" : "empty") : "not_retrieved");

const entries = (raw: unknown, prefix: string, map: (entry: Raw) => Omit<NamedEntry, "id">): NamedEntry[] =>
  (list(raw) ?? []).map((entry, index) => ({ id: `${prefix}-${index}`, ...map(entry) })).filter((entry) => entry.title || entry.description);

/** The record inside a provider answer, or why there isn't one. HTTP 200 alone doesn't prove a hit. */
export function elementOf(body: unknown): Raw {
  const parsed = envelope.safeParse(body);
  const element = parsed.success ? record(parsed.data.element) : null;
  if (element && Object.keys(element).length > 0) return element;
  const reason = parsed.success ? str(parsed.data.error) : "";
  if (!parsed.success) throw new ProviderError("invalid_response", "The provider's answer wasn't in the expected shape.");
  throw new ProviderError("inaccessible", reason ? `The provider couldn't return this record: ${reason.slice(0, 160)}` : "The provider returned no record for this address.");
}

export function mapProfile(body: unknown, requestedUrl: string, provider: string): NormalizedProfile {
  const raw = elementOf(body);
  const images: Record<string, string> = {};
  const addImage = (key: string, value: unknown): string | null => {
    const url = imageOf(value);
    if (!url) return null;
    images[key] = url;
    return key;
  };

  const location = record(raw.location);
  const name = [str(raw.firstName), str(raw.lastName)].filter(Boolean).join(" ") || str(raw.fullName);
  const experience = (list(raw.experience) ?? []).map((job, index) => ({
    id: `exp-${index}`,
    title: str(job.position),
    company: str(job.companyName),
    companyUrl: httpsUrl(job.companyLinkedinUrl),
    logo: addImage(`co-${index}`, job.companyLogo),
    location: str(job.location),
    employmentType: str(job.employmentType),
    workplaceType: str(job.workplaceType),
    start: dateOf(job.startDate),
    end: isCurrent(job.endDate) ? null : dateOf(job.endDate),
    current: isCurrent(job.endDate),
    duration: str(job.duration),
    description: str(job.description),
    skills: Array.isArray(job.skills) ? job.skills.map(str).filter(Boolean) : [],
  }));
  const education = (list(raw.education) ?? []).map((school, index) => ({
    id: `edu-${index}`,
    school: str(school.schoolName),
    degree: str(school.degree),
    field: str(school.fieldOfStudy),
    period: str(school.period),
    start: dateOf(school.startDate),
    end: dateOf(school.endDate),
    logo: addImage(`ed-${index}`, school.schoolLogo),
    skills: Array.isArray(school.skills) ? school.skills.map(str).filter(Boolean) : [],
  }));

  const skills = (list(raw.skills) ?? []).map((skill) => ({ name: str(skill.name), endorsements: str(skill.endorsements) })).filter((skill) => skill.name);
  const topSkills = Array.isArray(raw.topSkills) ? raw.topSkills.map(str).filter(Boolean) : [];
  for (const name of topSkills) if (!skills.some((skill) => skill.name.toLowerCase() === name.toLowerCase())) skills.push({ name, endorsements: "" });

  const received = entries(raw.receivedRecommendations, "rec", (entry) => ({
    title: str(entry.givenBy) || str(entry.authorFullName) || str(entry.name) || "Recommendation",
    subtitle: str(entry.givenByHeadline) || str(entry.headline),
    when: str(entry.givenAt),
    description: str(entry.description) || str(entry.text),
    link: httpsUrl(entry.givenByLink),
  })).filter((entry) => entry.description);

  const sections: Record<ProfileSection, SectionState> = {
    about: raw.about === undefined || raw.about === null ? "not_retrieved" : str(raw.about) ? "present" : "empty",
    experience: sectionState(raw.experience),
    education: sectionState(raw.education),
    skills: Array.isArray(raw.skills) || Array.isArray(raw.topSkills) ? (skills.length > 0 ? "present" : "empty") : "not_retrieved",
    certifications: sectionState(raw.certifications),
    projects: sectionState(raw.projects),
    publications: sectionState(raw.publications),
    languages: sectionState(raw.languages),
    awards: sectionState(raw.honorsAndAwards),
    volunteering: sectionState(raw.volunteering),
    recommendations: sectionState(raw.receivedRecommendations),
    courses: sectionState(raw.courses),
  };

  const core = ["about", "experience", "education", "skills"] as const;
  const hasSubstance = core.some((section) => sections[section] === "present");
  const missingCore = core.some((section) => sections[section] === "not_retrieved");

  return normalizedProfileSchema.parse({
    provider,
    providerProfileId: str(raw.id) || null,
    publicIdentifier: str(raw.publicIdentifier) || null,
    url: httpsUrl(raw.linkedinUrl) ?? requestedUrl,
    name,
    headline: str(raw.headline),
    location: str(location?.linkedinText) || str(raw.location),
    photo: addImage("photo", raw.profilePicture) ?? addImage("photo", raw.photo),
    banner: addImage("banner", raw.coverPicture),
    images,
    about: str(raw.about),
    currentPosition: experience.find((job) => job.current)?.title ? `${experience.find((job) => job.current)?.title} at ${experience.find((job) => job.current)?.company}` : "",
    followers: count(raw.followerCount),
    connections: count(raw.connectionsCount),
    experience,
    education,
    skills,
    certifications: entries(raw.certifications, "cert", (entry) => ({ title: str(entry.title), subtitle: str(entry.issuedBy), when: str(entry.issuedAt), description: "", link: httpsUrl(entry.link) })),
    projects: entries(raw.projects, "proj", (entry) => ({ title: str(entry.title), subtitle: str(entry.associatedWith), when: str(entry.duration), description: str(entry.description), link: httpsUrl(entry.associatedWithLink) })),
    publications: entries(raw.publications, "pub", (entry) => ({ title: str(entry.title), subtitle: "", when: str(entry.publishedAt), description: str(entry.description), link: httpsUrl(entry.link) })),
    languages: (list(raw.languages) ?? []).map((language) => ({ name: str(language.name), proficiency: str(language.proficiency) })).filter((language) => language.name),
    awards: entries(raw.honorsAndAwards, "award", (entry) => ({ title: str(entry.title), subtitle: str(entry.issuedBy), when: str(entry.issuedAt), description: str(entry.description), link: null })),
    volunteering: entries(raw.volunteering, "vol", (entry) => ({ title: str(entry.role), subtitle: str(entry.organizationName), when: str(entry.duration), description: str(entry.description), link: null })),
    recommendations: received,
    courses: entries(raw.courses, "course", (entry) => ({ title: str(entry.title), subtitle: str(entry.associatedWith), when: "", description: "", link: null })),
    sections,
    quality: !hasSubstance ? "identity" : missingCore ? "partial" : "full",
    sourceAge: str(raw.updatedAt) || str(raw.scrapedAt) || null,
  });
}

export function mapListings(body: unknown): ListingSummary[] {
  const parsed = envelope.safeParse(body);
  if (!parsed.success) throw new ProviderError("invalid_response", "The provider's answer wasn't in the expected shape.");
  if (!Array.isArray(parsed.data.elements)) {
    const reason = str(parsed.data.error);
    if (reason) throw new ProviderError("provider_down", `The job search failed: ${reason.slice(0, 160)}`);
    return [];
  }
  return (list(parsed.data.elements) ?? []).flatMap((job) => {
    const id = str(job.id);
    const url = httpsUrl(job.url) ?? httpsUrl(job.linkedinUrl);
    const title = str(job.title);
    if (!id || !url || !title) return [];
    const company = record(job.company);
    return [{ id, title, employer: str(company?.name) || str(job.companyName), location: str(record(job.location)?.linkedinText), url, postedAt: str(job.postedDate) || null }];
  });
}

const CLOSED = /closed|expired|removed|suspended|deleted/i;
const OPEN = /listed|open|active|published/i;

export function mapJob(body: unknown): JobRecord {
  const raw = elementOf(body);
  const url = httpsUrl(raw.linkedinUrl) ?? httpsUrl(raw.url);
  const id = str(raw.id);
  if (!id || !url || !str(raw.title)) throw new ProviderError("invalid_response", "The job record was missing its title or address.");
  const stateText = str(raw.jobState);
  const expiresAt = str(raw.expireAt) || null;
  const expired = expiresAt !== null && Date.parse(expiresAt) < Date.now();
  return {
    id,
    title: str(raw.title),
    employer: str(raw.companyName) || str(record(raw.company)?.name),
    location: str(record(raw.location)?.linkedinText),
    remotePolicy: str(raw.workplaceType) || (raw.workRemoteAllowed === true ? "Remote" : ""),
    url,
    applyUrl: httpsUrl(raw.easyApplyUrl),
    description: str(raw.descriptionText),
    postedAt: str(raw.postedDate) || null,
    expiresAt,
    status: CLOSED.test(stateText) || expired ? "closed" : OPEN.test(stateText) ? "open" : "unknown",
    stateText,
  };
}
