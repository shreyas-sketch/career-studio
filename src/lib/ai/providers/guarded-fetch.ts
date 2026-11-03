import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { isPublicAddress } from "@/lib/posting-fetch";

import { AiError } from "../errors";

export const PRIVATE_ADDRESS_REFUSED =
  "Career Studio runs on a hosted server, so it can't reach AI servers on your own computer or private network. Use a provider's public https address instead.";

/**
 * Career Studio is hosted: an AI server address that a user enters must not
 * point the server at its own network (SSRF). Refuses non-https addresses
 * and hostnames that resolve to private, loopback or link-local addresses.
 * CAREER_STUDIO_ALLOW_PRIVATE_AI_URLS=1 turns this off for tests and
 * self-hosted single-user installs.
 */
export async function assertPublicAiUrl(url: URL): Promise<void> {
  if (process.env.CAREER_STUDIO_ALLOW_PRIVATE_AI_URLS === "1") return;
  if (url.protocol !== "https:") throw AiError.config(PRIVATE_ADDRESS_REFUSED);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw AiError.config(`Couldn't find the AI server ${url.hostname}. Check the address in Settings → AI provider.`);
  if (addresses.some(({ address }) => !isPublicAddress(address))) throw AiError.config(PRIVATE_ADDRESS_REFUSED);
}

/** Enough for a server that moves /v1 around; more is a loop. */
const MAX_REDIRECTS = 3;

export const REDIRECT_REFUSED =
  "The AI server sent the request to another address. Dossier won't send your API key there: put that address in Settings → AI provider instead.";

/**
 * A fetch for requests that carry an API key (E11-5): the AI server's address
 * is set by the user, so a redirect to another host is refused instead of
 * followed with the key attached. Same-origin redirects that keep the method
 * and body (307, 308) are still followed.
 */
export function keyGuardedFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    let url = new URL(input instanceof Request ? input.url : String(input));
    for (let hops = 0; ; hops++) {
      await assertPublicAiUrl(url);
      const response = await fetchImpl(url, { ...init, redirect: "manual" });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) return response;

      const next = new URL(location, url);
      const keepsRequest = response.status === 307 || response.status === 308;
      if (next.origin !== url.origin || !keepsRequest || hops >= MAX_REDIRECTS) {
        throw AiError.config(REDIRECT_REFUSED);
      }
      url = next;
    }
  };
}
