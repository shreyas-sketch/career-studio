import "server-only";

import https from "node:https";

import { guardedLookup } from "@/lib/posting-fetch";

// Profile images, fetched by the server so that a browser never talks to
// LinkedIn's CDN or anywhere else. Only addresses that a snapshot holds get here,
// and even those must be on LinkedIn's image host at every redirect, resolve to a
// public address, be an image, and be small.

const ALLOWED = /(^|\.)licdn\.com$/i;
const MAX_BYTES = 6 * 1024 * 1024;
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const TYPES = /^image\/(?:jpeg|png|webp|gif|avif)$/i;

export type FetchedImage = { body: Buffer; contentType: string };

export const allowedImageUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && ALLOWED.test(url.hostname);
  } catch {
    return false;
  }
};

function get(url: string, signal: AbortSignal): Promise<{ status: number; location?: string; contentType: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { lookup: guardedLookup, headers: { accept: "image/*", "user-agent": "CareerStudio/1.0" }, signal, timeout: TIMEOUT_MS }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          response.destroy();
          reject(new Error("too big"));
        } else chunks.push(chunk);
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, location: response.headers.location, contentType: String(response.headers["content-type"] ?? "").split(";")[0].trim(), body: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
  });
}

/** The image, or null for anything else: the page then shows its neutral fallback. */
export async function fetchProfileImage(address: string): Promise<FetchedImage | null> {
  let current = address;
  const signal = AbortSignal.timeout(TIMEOUT_MS * 2);
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      if (!allowedImageUrl(current)) return null;
      const answer = await get(current, signal);
      if (answer.status >= 300 && answer.status < 400 && answer.location) {
        current = new URL(answer.location, current).toString();
        continue;
      }
      if (answer.status !== 200 || !TYPES.test(answer.contentType) || answer.body.length === 0) return null;
      return { body: answer.body, contentType: answer.contentType };
    }
  } catch {
    return null;
  }
  return null;
}

/** A plain shape for fixture profiles, so a sample never needs a real person's picture. */
export function fixtureImage(kind: string): { body: Buffer; contentType: string } {
  const banner = kind === "fixture:banner";
  const svg = banner
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 200"><rect width="800" height="200" fill="#8b98a8"/><path d="M0 150 C200 90 420 190 800 110 V200 H0Z" fill="#6f7d8e"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#aab3bf"/><circle cx="48" cy="38" r="17" fill="#eef0f3"/><path d="M16 88c3-20 16-28 32-28s29 8 32 28z" fill="#eef0f3"/></svg>`;
  return { body: Buffer.from(svg), contentType: "image/svg+xml" };
}
