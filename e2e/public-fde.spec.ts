import { mkdirSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { PUBLIC_SCHEMA, seedStatement } from "./public-fde-market";
import { sql } from "./support";

// The public FDE review at /fde-review, signed out, as a visitor sees it: the
// landing page, a report waiting in line, a finished report, and what stays
// private. Profiles are invented (FDE_FIXTURE_MODE), the market sample is test
// data seeded below, and the model is the fake AI server: nothing here is a
// live read or spends anything. Screenshots go to e2e-screenshots/.

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

const SHOTS = "e2e-screenshots";
mkdirSync(SHOTS, { recursive: true });
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function controls(value: Record<string, unknown>) {
  await sql(
    `INSERT INTO cs_public_fde.controls (key, value) VALUES ('main', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ intakePaused: false, profilePaused: false, analysisPaused: false, pauseReason: "", lanes: { profile: 8, analysis: 6 }, ...value })],
  );
  await sql(`UPDATE cs_public_fde.jobs SET not_before = now() WHERE stage LIKE '%_queued'`);
}

async function noSeriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
}

async function submit(page: Page, slug: string) {
  await page.goto("/fde-review");
  await page.getByLabel("Your LinkedIn profile URL").fill(`https://www.linkedin.com/in/${slug}`);
  await page.getByLabel("This is my own profile").check();
  // The form token needs a moment, like a person would take.
  await page.waitForTimeout(1_800);
  await page.getByRole("button", { name: "Review my profile" }).click();
  await page.waitForURL(/\/fde-review\/r\/pf[a-f0-9]{24}$/);
  return page.url().split("/").at(-1)!;
}

test.beforeAll(async () => {
  await sql(`DELETE FROM "${PUBLIC_SCHEMA}"."FdeReport"`);
  await sql(`DELETE FROM "${PUBLIC_SCHEMA}"."FdeBenchmark"`);
  await sql(`TRUNCATE cs_public_fde.jobs, cs_public_fde.incidents, cs_public_fde.cooldowns, cs_public_fde.spend`);
  const seed = seedStatement();
  await sql(seed.text, seed.values);
  await controls({});
});

test("the landing page explains the outcome with one input, on desktop and phone", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const response = await page.goto("/fde-review");
  expect(response?.headers()["x-robots-tag"]).toContain("noindex");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("forward deployed engineers");
  await expect(page.getByText("Today's sample: 9 verified openings")).toBeVisible();
  await expect(page.getByRole("link", { name: /dashboard|settings|applications/i })).toHaveCount(0);
  await noSeriousViolations(page);
  await page.screenshot({ path: `${SHOTS}/01-landing-desktop.png`, fullPage: true });
  await page.setViewportSize(PHONE);
  await page.screenshot({ path: `${SHOTS}/02-landing-phone.png`, fullPage: true });
});

test("a report waits in line honestly, showing the profile and the market while it does", async ({ page }) => {
  await controls({ analysisPaused: true });
  await page.setViewportSize(DESKTOP);
  const id = await submit(page, "fixture-full");
  await expect(page.getByText("The analysis keeps your place in line")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Your FDE career and earning potential" })).toBeVisible();
  await expect(page.getByText("Test data, not a live LinkedIn read")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-queued-desktop.png`, fullPage: true });
  await page.setViewportSize(PHONE);
  await page.screenshot({ path: `${SHOTS}/04-queued-phone.png` });
  await controls({});
  await expect(page.getByText("Your FDE review is ready")).toBeVisible({ timeout: 90_000 });
  expect((await sql<{ stage: string }>(`SELECT stage FROM cs_public_fde.jobs WHERE id = $1`, [id]))[0]?.stage).toBe("finished");
});

test("a finished report shows the score, earning potential, roles, evidence and plan", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const id = await submit(page, "fixture-long");
  await expect(page.getByText("Your FDE review is ready")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Market readiness" })).toBeVisible();
  const earnings = page.getByRole("heading", { name: "Your FDE career and earning potential" });
  await expect(earnings).toBeVisible();
  // The pay section comes before the roles, right after the score.
  const order = await page.evaluate(() => {
    const top = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().top ?? 0;
    return { earnings: top("#earnings"), roles: top("#roles") };
  });
  expect(order.earnings).toBeLessThan(order.roles);
  await expect(page.getByText(/average of 4 range midpoints/)).toBeVisible();
  await noSeriousViolations(page);
  await page.screenshot({ path: `${SHOTS}/05-report-desktop.png`, fullPage: true });

  // Side by side with one role, then the evidence for one requirement.
  await page.getByRole("button", { name: "Forward Deployed Software Engineer", exact: true }).click();
  await page.screenshot({ path: `${SHOTS}/06-role-side-by-side.png`, fullPage: false });
  await page.getByRole("button", { name: /^Python at Lumen Systems \(test\)/ }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/07-evidence-inspector.png` });
  await page.keyboard.press("Escape");

  await page.setViewportSize(PHONE);
  await page.screenshot({ path: `${SHOTS}/08-report-phone.png`, fullPage: true });

  // What the visitor's browser received names no provider, key or price.
  const body = await (await page.request.get(`/api/public/fde/reports/${id}`)).text();
  expect(body).not.toMatch(/treg|harvestapi|TREG_API_TOKEN|ANTHROPIC_API_KEY|sk-ant|costMicro/i);
});

test("one visitor can't open another's report, and the private app stays signed in only", async ({ browser, page }) => {
  const id = await submit(page, "fixture-partial");
  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const other = await stranger.newPage();
  await other.goto(`/fde-review/r/${id}`);
  await expect(other.getByRole("heading", { name: "This report isn't available" })).toBeVisible();
  expect((await other.request.get(`/api/public/fde/reports/${id}`)).status()).toBe(404);
  expect((await other.request.delete(`/api/public/fde/reports/${id}`, { headers: { origin: new URL(other.url()).origin } })).status()).toBe(404);

  for (const path of ["/", "/fde", "/fde/live", "/settings", "/resume", "/freelance"]) {
    await other.goto(path);
    await expect(other).toHaveURL(/\/login/);
  }
  expect((await other.request.get("/api/fde/reports/anything")).status()).toBe(401);
  await stranger.close();
});

test("a private profile ends with a plain explanation, not a spinner", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await submit(page, "fixture-private");
  await expect(page.getByText("This profile couldn't be read")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/09-restricted-phone.png` });
});

test("paused intake says so on the landing page", async ({ page }) => {
  await controls({ intakePaused: true });
  // Every process reads the controls at most a second old.
  await page.waitForTimeout(1_500);
  await page.setViewportSize(PHONE);
  await page.goto("/fde-review");
  await expect(page.getByText("New reviews are paused for a moment")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/10-paused-phone.png` });
  await controls({});
});
