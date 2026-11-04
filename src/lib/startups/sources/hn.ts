import "server-only";

import { z } from "zod";

import { getJson, SourceError } from "../http";
import { namesOnlyAPlace, reach, workMode, type Place } from "../place";
import { companySite, emailLabel, findEmails, firstLine, firstLink, headerParts, htmlToText } from "../text";
import { UNNAMED_COMPANY, type FoundStartup } from "../types";
import { hnItemLink } from "./yc";

// Hacker News "Ask HN: Who is hiring?" (#222), the monthly thread where
// companies, mostly startups, post their open roles, often with an address
// to apply to. Read through HN's public Algolia API (hn.algolia.com/api).
// Only posts someone in the profile's city or country could take are kept:
// ones there, or remote and not only for other places.

const SEARCH_URL = "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10";
const itemUrl = (id: string) => `https://hn.algolia.com/api/v1/items/${id}`;

const searchSchema = z.object({
  hits: z.array(z.object({ objectID: z.string(), title: z.string().nullish(), created_at: z.string().nullish() })),
});
const postSchema = z.object({
  id: z.union([z.number(), z.string()]),
  text: z.string().nullish(),
  created_at: z.string().nullish(),
});
const threadSchema = z.object({ children: z.array(z.unknown()) });

const ROLE = /\b(engineer|developer|programmer|architect|designer|scientist|manager|lead|head of|founding|sre|devops|intern|analyst|researcher|marketer|writer|recruiter|specialist|consultant)\b/i;
const WORK_MODE = /\b(remote|on-?site|hybrid|in[-\s]office|relocation)\b/i;

const PAY = /[$€£₹]\s?\d|\b\d{2,3}\s?k\b/i;
const EMPLOYMENT = /^(?:full[-\s]?time|part[-\s]?time|contract(?:or)?s?|permanent|freelance(?:rs?)?|internships?|equity|visa\b.*)$/i;
const STAGE = /^(?:pre-seed|seed|series [a-e]|bootstrapped|profitable)\b/i;
const NOT_A_NAME = /^(?:seeking|hiring|now hiring|we['’]re hiring|we are hiring|looking for|job|jobs|careers?|multiple roles|various roles)\b/i;
const COMPANY_WORD = /(?:\b(?:inc|llc|ltd|gmbh|corp|labs?|technologies|software|systems|tools|studios?)\.?|\.(?:com|io|ai|app|dev|co))$/i;

const cleaned = (part: string) =>
  part
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s*\(.*\)\s*$/, "")
    .replace(/^\W+|\W+$/g, "")
    .trim();

/**
 * Who's hiring, from a heading in any order: "UMH | Product Engineer | Cologne"
 * and "Cologne, Germany | UMH | Product Engineer" name the same company. A
 * place, a role or a label is never a company; when nothing else is there, it's
 * the site's address, or said to be missing.
 */
export function companyInHeading(parts: string[], link: string | null): string {
  const named = parts
    .map(cleaned)
    .find((part) => {
      if (part.length < 2 || part.length > 60 || part.split(/\s+/).length > 6) return false;
      if (namesOnlyAPlace(part) || workMode(part) !== null || WORK_MODE.test(part)) return false;
      if (PAY.test(part) || EMPLOYMENT.test(part) || STAGE.test(part) || NOT_A_NAME.test(part)) return false;
      return !ROLE.test(part) || COMPANY_WORD.test(part);
    });
  if (named) return named.slice(0, 120);
  const host = link ? /^https?:\/\/(?:www\.)?([^/]+)/i.exec(link)?.[1] : null;
  return host && !/(?:^|\.)(?:ycombinator\.com|github\.com|linkedin\.com|lever\.co|greenhouse\.io)$/i.test(host) ? host : UNNAMED_COMPANY;
}

/** What a post's heading says: who, where and how, and whether someone in `place` could take it. */
export function readHeading(text: string, place: Place) {
  const parts = headerParts(text);
  if (parts.length === 0) return null;
  const company = companyInHeading(parts, firstLink(text));
  const header = parts.join(" | ");
  const where = reach(header, place);
  const anywhere = !place.country && place.cityNames.length === 0;
  return {
    parts,
    header,
    company,
    open: anywhere || where.here !== null || (where.remote && where.remoteOpen !== false),
    location: parts
      .filter((part) => part !== company && (WORK_MODE.test(part) || namesOnlyAPlace(part) || reach(part, place).here !== null || /^[A-Z][\p{L} .'-]+,\s*[A-Z]{2}\b/u.test(part)))
      .join(" · ")
      .slice(0, 300),
    remote: where.remote ? true : where.here || workMode(header) ? false : null,
  };
}

/** A "Who is hiring?" post as a startup, or null when it isn't one someone in `place` could take. */
export function startupFromHnPost(post: z.output<typeof postSchema>, place: Place): FoundStartup | null {
  if (!post.text) return null;
  const text = htmlToText(post.text);
  const heading = readHeading(text, place);
  if (!heading?.open) return null;
  const { parts, header, company, location, remote } = heading;

  const link = hnItemLink(post.id);
  const site = firstLink(text);
  const website = site ? companySite(site) : "";
  return {
    source: "HN",
    externalId: String(post.id),
    company,
    website,
    summary: firstLine(text.split("\n").slice(1).join("\n")) || header,
    details: text.slice(0, 20_000),
    location,
    remote,
    // A round named in the header, else the YC batch in the company's brackets: "Tiller (YC W24)".
    stage: parts.find((part) => STAGE.test(part)) ?? /\((yc [wsfpx]\d{2})\)/i.exec(header)?.[1]?.toUpperCase() ?? "",
    roles: parts.filter((part) => part !== company && ROLE.test(part) && part.length < 160).slice(0, 6),
    // Addresses the post gives for applying, as written; hidden ones ("jane at acme dot com") stay in the text for the reader.
    emails: findEmails(text).map((email) => ({ email, label: emailLabel(email), from: link, onRequest: false, foundAt: post.created_at ?? "" })),
    links: [{ label: "Hiring post", url: link }, ...(website ? [{ label: "Website", url: website }] : [])],
    postedAt: post.created_at ?? null,
  };
}

/** This month's "Who is hiring?" posts that suit someone in `place`. */
export async function fetchHnStartups(place: Place, signal?: AbortSignal): Promise<FoundStartup[]> {
  const search = searchSchema.safeParse(await getJson(SEARCH_URL, { signal }));
  if (!search.success) throw new SourceError("changed its format");
  const thread = search.data.hits.find((hit) => /^ask hn: who is hiring\?/i.test(hit.title ?? ""));
  if (!thread) throw new SourceError("has no hiring thread this month");
  const answer = threadSchema.safeParse(await getJson(itemUrl(thread.objectID), { signal }));
  if (!answer.success) throw new SourceError("changed its format");
  return answer.data.children.flatMap((child) => {
    const post = postSchema.safeParse(child);
    return post.success ? (startupFromHnPost(post.data, place) ?? []) : [];
  });
}
