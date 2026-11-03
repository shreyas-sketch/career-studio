"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState, useTransition, type FormEvent } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { controlClassName } from "@/components/ui/field";
import { cn } from "@/lib/cn";

import { signIn, signInWithForm, signUp, signUpWithForm } from "./actions";
import { loginMessages } from "./messages";

type Mode = "signin" | "signup";

/**
 * Sign in to an account, or create one. With scripts, submitting calls the
 * action directly; before they've run, the browser posts the form to the
 * *WithForm fallback instead, so it works either way.
 */
export function LoginForm({ next, mode = "signin", inviteRequired = false }: { next?: string; mode?: Mode; inviteRequired?: boolean }) {
  const router = useRouter();
  const first = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(true);
  const [posted, formAction] = useActionState(mode === "signup" ? signUpWithForm : signInWithForm, null);
  const [error, setError] = useState<string | null>(posted?.error ?? null);
  const [pending, startTransition] = useTransition();
  const signup = mode === "signup";

  function fail(message: string) {
    setError(message);
    first.current?.focus();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (signup && !name.trim()) return fail(loginMessages.noName);
    if (!email.trim()) return fail(loginMessages.noEmail);
    if (!password) return fail(loginMessages.empty);

    startTransition(async () => {
      const result = signup
        ? await signUp({ name, email, password, invite: invite || undefined })
        : await signIn({ email, password, remember, next });
      if (!result.ok) return fail(result.error);
      toastResult(result);
      router.replace(result.data.redirectTo);
    });
  }

  const clear = () => setError(null);

  return (
    <form action={formAction} onSubmit={submit} noValidate className="flex flex-col gap-5">
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[28px] leading-[1.15] tracking-[-0.01em]">
          {signup ? "Create your studio" : "Welcome back"}
        </h1>
        <p className="text-sm text-muted">
          {signup ? "One profile for every job, interview and gig." : "Sign in to pick up where you left off."}
        </p>
      </div>

      {signup && (
        <Field id="name" label="Your name">
          <input
            ref={first}
            id="name"
            name="name"
            autoComplete="name"
            autoFocus
            value={name}
            onChange={(event) => (setName(event.target.value), clear())}
            className={cn(controlClassName, "h-10 px-3")}
          />
        </Field>
      )}

      <Field id="email" label="Email">
        <input
          ref={signup ? undefined : first}
          id="email"
          name="email"
          type="email"
          autoComplete={signup ? "email" : "username"}
          autoFocus={!signup}
          value={email}
          onChange={(event) => (setEmail(event.target.value), clear())}
          className={cn(controlClassName, "h-10 px-3")}
        />
      </Field>

      <Field
        id="password"
        label="Password"
        action={
          <button
            type="button"
            aria-label={visible ? "Hide password" : "Show password"}
            aria-controls="password"
            onClick={() => setVisible((shown) => !shown)}
            className="underline underline-offset-3 hover:text-ink"
          >
            {visible ? "Hide" : "Show"}
          </button>
        }
        hint={signup ? "At least 10 characters." : undefined}
      >
        <input
          id="password"
          name="password"
          type={visible ? "text" : "password"}
          autoComplete={signup ? "new-password" : "current-password"}
          value={password}
          onChange={(event) => (setPassword(event.target.value), clear())}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "auth-error" : undefined}
          className={cn(controlClassName, "h-10 px-3")}
        />
      </Field>

      {signup && inviteRequired && (
        <Field id="invite" label="Invite code">
          <input
            id="invite"
            name="invite"
            autoComplete="off"
            value={invite}
            onChange={(event) => (setInvite(event.target.value), clear())}
            className={cn(controlClassName, "h-10 px-3")}
          />
        </Field>
      )}

      {error && (
        <p id="auth-error" role="alert" className="text-meta text-error">
          {error}
        </p>
      )}

      {!signup && (
        <Checkbox
          label="Keep me signed in for 30 days"
          name="remember"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
        />
      )}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? (signup ? "Creating your account…" : "Signing in…") : signup ? "Create account" : "Sign in"}
      </Button>

      <p className="text-sm text-muted">
        {signup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-ink underline underline-offset-3">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/signup" className="text-ink underline underline-offset-3">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

function Field({ id, label, action, hint, children }: { id: string; label: string; action?: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[7px]">
      <div className="flex justify-between text-label text-muted">
        <label htmlFor={id}>{label}</label>
        {action}
      </div>
      {children}
      {hint && <p className="text-meta text-muted">{hint}</p>}
    </div>
  );
}
