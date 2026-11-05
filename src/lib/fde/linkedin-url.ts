// A personal LinkedIn profile address, and nothing else: this is all that's
// ever handed to the profile provider. The server never fetches the address
// itself, so a look-alike can't point a request at another host.

export type ParsedProfileUrl = { ok: true; url: string; slug: string } | { ok: false; error: string };

const HOST = /^(?:[a-z]{2,3}\.|www\.)?linkedin\.com$/i;
const SLUG = /^[\p{L}\p{N}][\p{L}\p{N}_%-]{1,99}$/u;

export function parseProfileUrl(input: string): ParsedProfileUrl {
  const notProfile = "Paste a personal LinkedIn profile address, like https://www.linkedin.com/in/their-name.";
  const text = input.trim();
  if (!text || text.length > 300) return { ok: false, error: notProfile };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, error: notProfile };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: notProfile };
  if (url.username || url.password || url.port) return { ok: false, error: notProfile };
  if (!HOST.test(url.hostname)) return { ok: false, error: "That isn't a linkedin.com address." };
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0]?.toLowerCase() !== "in" || !parts[1]) {
    return { ok: false, error: "That's a LinkedIn page, but not a person's profile. Use an address with /in/ in it." };
  }
  // A section of a profile (/details/experience) still names the same person.
  const raw = parts[1];
  if (!SLUG.test(raw) || raw.toLowerCase().startsWith("acoaa")) return { ok: false, error: notProfile };
  let slug: string;
  try {
    slug = decodeURIComponent(raw).toLowerCase();
  } catch {
    return { ok: false, error: notProfile };
  }
  return { ok: true, url: `https://www.linkedin.com/in/${encodeURIComponent(slug)}`, slug };
}

/** The distinct valid addresses in a manifest, and what's wrong with the rest. */
export function parseManifest(text: string): { urls: { url: string; slug: string }[]; rejected: { line: string; error: string }[]; duplicates: number } {
  const urls = new Map<string, string>();
  const rejected: { line: string; error: string }[] = [];
  let duplicates = 0;
  for (const line of text.split(/[\r\n,]+/).map((part) => part.trim()).filter(Boolean)) {
    const parsed = parseProfileUrl(line);
    if (!parsed.ok) rejected.push({ line: line.slice(0, 120), error: parsed.error });
    else if (urls.has(parsed.slug)) duplicates++;
    else urls.set(parsed.slug, parsed.url);
  }
  return { urls: [...urls].map(([slug, url]) => ({ slug, url })), rejected, duplicates };
}
