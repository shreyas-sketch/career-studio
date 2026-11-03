import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { SignInWall } from "@/components/staff/sign-in-wall";
import { getSession } from "@/lib/auth/session";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/** Sign-in, outside the app shell. */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect("/");
  const { next } = await searchParams;

  return (
    // The form on the panel's colour, the petrol wall beside it.
    <main className="grid min-h-screen bg-surface min-[960px]:grid-cols-2">
      <div className="flex items-center justify-center px-8 py-12">
      <div className="flex w-full max-w-[400px] flex-col gap-8">
        <div className="flex flex-col items-start gap-2">
          <BrandMark className="size-10" />
          <div className="flex flex-col">
            <div className="font-display text-[26px] font-semibold tracking-[-0.02em]">Career Studio</div>
            <div className="text-sm text-muted">Jobs, interviews, freelancing and skills, in one place</div>
          </div>
        </div>
        <LoginForm next={typeof next === "string" ? next : undefined} />
      </div>
      </div>
      <SignInWall />
    </main>
  );
}
