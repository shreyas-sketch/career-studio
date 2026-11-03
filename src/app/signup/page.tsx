import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { getSession } from "@/lib/auth/session";
import { env } from "@/lib/env";

import { LoginForm } from "../login/login-form";

export const metadata: Metadata = { title: "Create an account" };

/** Creating an account, outside the app shell. */
export default async function SignupPage() {
  if (await getSession()) redirect("/");

  return (
    // The form on the panel's colour, a warm wash on the right.
    <main className="grid min-h-screen bg-surface min-[960px]:grid-cols-2">
      <div className="flex items-center justify-center px-8 py-12">
      <div className="flex w-full max-w-[400px] flex-col gap-8">
        <div className="flex flex-col items-start gap-2">
          <BrandMark className="size-10" />
          <div className="flex flex-col">
            <div className="font-serif text-[30px] font-medium tracking-[-0.01em]">Career Studio</div>
            <div className="text-sm text-muted">Jobs, interviews, freelancing and skills, in one place</div>
          </div>
        </div>
        <LoginForm mode="signup" inviteRequired={Boolean(env.CAREER_STUDIO_INVITE_CODE)} />
      </div>
      </div>
      <div
        aria-hidden="true"
        className="hidden bg-[linear-gradient(to_left,color-mix(in_srgb,var(--color-ink)_9%,transparent)_0%,transparent_65%)] min-[960px]:grid min-[960px]:place-items-center"
      >
        <BrandMark className="size-40 opacity-90 shadow-dialog rounded-[36px]" />
      </div>
    </main>
  );
}
