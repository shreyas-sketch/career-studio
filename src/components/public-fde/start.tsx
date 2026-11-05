"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

type Intake = { open: boolean; reason: "ok" | "disabled" | "paused" };

type Session = { formToken: string; intake: Intake };

/** A guest cookie (made by the server if there's none) and a fresh form token. */
async function openSession(): Promise<Session | null> {
  try {
    const response = await fetch("/api/public/fde/session", { method: "POST", cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as Session;
  } catch {
    return null;
  }
}

/** A key for this one click, so a double click, a retry or a slow network never starts two reports. */
const newClientKey = () => (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);

export function StartForm({ initialIntake }: { initialIntake: Intake }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [own, setOwn] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [intake, setIntake] = useState(initialIntake);
  const [error, setError] = useState<{ text: string; field?: "url" | "own" } | null>(null);
  const [sending, setSending] = useState(false);
  const clientKey = useRef(newClientKey());
  const honeypot = useRef<HTMLInputElement>(null);

  const apply = (session: Session | null) => {
    if (!session) return setError({ text: "Couldn't reach the server. Check your connection and reload the page." });
    setToken(session.formToken);
    setIntake(session.intake);
  };
  const startSession = async () => apply(await openSession());

  useEffect(() => {
    let live = true;
    void openSession().then((session) => {
      if (live) apply(session);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the page opens
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending) return;
    if (!url.trim()) return setError({ text: "Paste your LinkedIn profile URL.", field: "url" });
    if (!own) return setError({ text: "Confirm that this is your own profile.", field: "own" });
    if (!token) return setError({ text: "One moment: the page is still getting ready." });
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/public/fde/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, clientKey: clientKey.current, formToken: token, confirmOwn: true, website: honeypot.current?.value ?? "" }),
      });
      const data = (await response.json().catch(() => ({}))) as { location?: string; error?: string; field?: "url"; ref?: string };
      if (response.ok && data.location) {
        router.push(data.location);
        return;
      }
      if (response.status === 400 && /reload/i.test(data.error ?? "")) await startSession();
      setError({ text: `${data.error ?? "That didn't go through. Try again."}${data.ref ? ` Reference: ${data.ref}.` : ""}`, field: data.field });
      // A refused click can be tried again; an accepted one keeps its key (and its report).
      clientKey.current = newClientKey();
    } catch {
      setError({ text: "Couldn't reach the server. Your report wasn't started; try again." });
    } finally {
      setSending(false);
    }
  };

  if (!intake.open) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-panel border border-line-card bg-card p-6">
        <p className="font-medium">{intake.reason === "paused" ? "New reviews are paused for a moment" : "The FDE review isn't open right now"}</p>
        <p className="text-sm text-pretty text-muted">
          {intake.reason === "paused" ? "Reports already started carry on. Try again in a minute." : "Check back with whoever shared this link."}
        </p>
        {intake.reason === "paused" && (
          <Button variant="secondary" size="sm" className="mt-2 w-fit" onClick={() => void startSession()}>
            Check again
          </Button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5 rounded-panel border border-line-card bg-card p-6 shadow-[0_1px_0_var(--color-line)] max-sm:p-5">
      <Input
        label="Your LinkedIn profile URL"
        name="url"
        type="url"
        inputMode="url"
        autoComplete="url"
        placeholder="https://www.linkedin.com/in/your-name"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        error={error?.field === "url" ? error.text : undefined}
        hint="The public address of your profile, with /in/ in it."
      />
      <Checkbox
        label="This is my own profile"
        checked={own}
        onChange={(event) => setOwn(event.target.checked)}
        error={error?.field === "own" ? error.text : undefined}
      />
      {/* Hidden from people and screen readers; scripts that fill every field fill this one too. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <Button type="submit" disabled={sending} className="w-full">
        {sending ? "Starting your review" : "Review my profile"}
      </Button>
      {error && !error.field && (
        <p role="alert" className="text-sm text-pretty text-error">
          {error.text}
        </p>
      )}
      <p className="text-meta text-pretty text-muted">Free, no sign-up. Takes a few minutes; you&apos;ll see each step as it happens.</p>
    </form>
  );
}
