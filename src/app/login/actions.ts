"use server";

import { randomBytes } from "node:crypto";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { emailKey, ipKey, PER_EMAIL, clearThrottle, recordThrottleFailure, throttleWaitMs } from "@/lib/accounts/throttle";
import { AccountError, createAccount, findAccountByEmail, provisionAccount } from "@/lib/accounts/users";
import { ActionError, publicAction } from "@/lib/action";
import { clientIp } from "@/lib/auth/client-ip";
import { safeNextPath } from "@/lib/auth/next-path";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import { startSession } from "@/lib/auth/session";
import { PER_IP, tooManyAttemptsMessage } from "@/lib/auth/throttle";
import { env } from "@/lib/env";

import { loginMessages } from "./messages";

// A hash to check against when the address has no account, so a sign-in
// takes as long whether or not the account exists.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString("hex")));

/**
 * Signs in with an account's email and password. Failures are rate-limited
 * per IP and per address. Returns where to go next: the requested page if
 * it's on this site, or the dashboard.
 */
export const signIn = publicAction(
  z.object({
    email: z.string(),
    password: z.string(),
    remember: z.boolean(),
    next: z.string().optional(),
  }),
  async ({ email, password, remember, next }, { toast }) => {
    const ip = clientIp(await headers());
    if (!email.trim()) throw new ActionError(loginMessages.noEmail);
    if (!password) throw new ActionError(loginMessages.empty);
    const keys = [ipKey(ip), emailKey(email)];
    const wait = await throttleWaitMs(keys);
    if (wait > 0) throw new ActionError(tooManyAttemptsMessage(wait));

    const account = await findAccountByEmail(email);
    const matches = await verifyPassword(password, account?.passwordHash ?? (await getDummyHash())).catch(() => false);
    if (!account || !matches) {
      await recordThrottleFailure([
        [ipKey(ip), PER_IP],
        [emailKey(email), PER_EMAIL],
      ]);
      throw new ActionError(loginMessages.wrong);
    }
    await clearThrottle(keys);
    // Brings the account's data up to date with any migration added since.
    await provisionAccount(account.id);
    await startSession({ userId: account.id, persistent: remember });
    const firstName = account.name.trim().split(/\s+/)[0] || "there";
    toast(`Welcome back, ${firstName}.`);
    return { redirectTo: safeNextPath(next) };
  },
);

/** Creates an account and signs in. Needs the invite code when CAREER_STUDIO_INVITE_CODE is set. */
export const signUp = publicAction(
  z.object({
    name: z.string().max(120),
    email: z.string().max(254),
    password: z.string().max(200),
    invite: z.string().max(200).optional(),
  }),
  async ({ name, email, password, invite }, { toast }) => {
    if (env.CAREER_STUDIO_SIGNUPS === "closed") throw new ActionError(loginMessages.signupsClosed);
    const ip = clientIp(await headers());
    const keys = [ipKey(ip)];
    const wait = await throttleWaitMs(keys);
    if (wait > 0) throw new ActionError(tooManyAttemptsMessage(wait));
    const expected = env.CAREER_STUDIO_INVITE_CODE;
    if (expected && (invite ?? "").trim() !== expected) {
      await recordThrottleFailure([[ipKey(ip), PER_IP]]);
      throw new ActionError(loginMessages.wrongInvite);
    }
    if (!name.trim()) throw new ActionError(loginMessages.noName);
    let account;
    try {
      account = await createAccount({ email, name, password });
    } catch (error) {
      if (error instanceof AccountError) throw new ActionError(error.message);
      throw error;
    }
    await startSession({ userId: account.id, persistent: true });
    toast(`Welcome to Career Studio, ${account.name.split(/\s+/)[0]}.`);
    return { redirectTo: "/" };
  },
);

/** What the forms show after a submit that the form fallbacks handled. */
export type SignInFormState = { error: string } | null;

/**
 * `signIn` for the form's own submit, which the browser makes before the
 * page's scripts have run or when they're off. It posts, so the password
 * never ends up in the URL.
 */
export async function signInWithForm(_previous: SignInFormState, form: FormData): Promise<SignInFormState> {
  const result = await signIn({
    email: text(form, "email"),
    password: text(form, "password"),
    remember: form.get("remember") === "on",
    next: text(form, "next") || undefined,
  });
  if (!result.ok) return { error: result.error };
  redirect(result.data.redirectTo);
}

export async function signUpWithForm(_previous: SignInFormState, form: FormData): Promise<SignInFormState> {
  const result = await signUp({
    name: text(form, "name"),
    email: text(form, "email"),
    password: text(form, "password"),
    invite: text(form, "invite") || undefined,
  });
  if (!result.ok) return { error: result.error };
  redirect(result.data.redirectTo);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
