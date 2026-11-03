// Where Dossier's releases are published, for the update check and its
// notice (update-check.ts, the sidebar). Safe to use in the browser.

export const RELEASES_REPOSITORY = "AienTech/dossier";
/** The repository's page, for credits and support (the sidebar). */
export const REPOSITORY_URL = `https://github.com/${RELEASES_REPOSITORY}`;
/** Career Studio's own source, offered to every user (AGPL-3.0 §13). Set CAREER_STUDIO_SOURCE_URL for a fork of it. */
export const SOURCE_URL = process.env.NEXT_PUBLIC_CAREER_STUDIO_SOURCE_URL || "https://github.com/shreyas-sketch/career-studio";
/** How to update, in the wiki. */
export const UPGRADE_GUIDE_URL = `${REPOSITORY_URL}/wiki/Upgrading`;

/** A published release: its version, without the "v", and its page on GitHub. */
export type Release = { version: string; url: string };
