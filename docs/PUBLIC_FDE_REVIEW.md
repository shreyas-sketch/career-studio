# Public FDE Review

A shareable page, `/fde-review`, where anyone can paste their own LinkedIn URL
and get an FDE Review without an account, a key or the owner's sign-in. It runs
the same pipeline as the private review (`docs/FDE_REVIEW.md`), on the server's
own Anthropic key and model, through a durable queue sized for a burst of about
50 people submitting at once.

## What is public, and what isn't

| Public | Stays behind sign-in |
| --- | --- |
| `/fde-review`, `/fde-review/r/<id>` | Everything else: `/`, `/fde` (private reports), `/fde/live`, settings, resumes, every other agent |
| `/api/public/fde/session`, `/reports`, `/reports/<id>`, `/reports/<id>/retry`, `/reports/<id>/media/<key>` | `/api/fde/*` and every other API route |

`src/proxy.ts` opens exactly those two prefixes. Each public route checks the
same origin and the visitor's own guest cookie itself.

## Visitors and their data

- A visitor is a **guest**: a random id in a signed, HttpOnly, SameSite=Lax
  cookie (`cs_fde_guest`). It's never an account and never the owner's session.
- Guest reports live in a **service tenant** (`u_f0de00000000000000000001`), a
  schema like an account's that no one signs in as. Code reaches it only through
  `asPublicTenant()`, set explicitly, so a signed-in owner visiting the page
  can't mix their data with guests'.
- Every read checks that the report's owner is `guest:<the visitor's id>`.
  Anyone else's id, however obtained, answers 404 / "isn't available".
  Profile reads are reused only by the same guest.
- Only the market sample (public job postings) is shared between visitors.
- Pages and API answers carry `noindex`, `private, no-store` and `no-referrer`.
  Report URLs aren't listed anywhere; there's no gallery.
- Reports, profile reads and queue rows are deleted after
  `PUBLIC_FDE_RETENTION_HOURS` (72), or at once with "Delete my report".
- Visitors never see provider names, prices, keys, internal codes or stack
  traces: failures show a plain message and a reference like `FDE-1A2B3C4D`,
  whose sanitized details are on the live page.

## The queue

Postgres, in schema `cs_public_fde` (`src/lib/public-fde/db.ts`):

1. **Admission** (one transaction under an advisory lock): same click key or
   same address from the same guest → the existing report (no double billing).
   Then the guest's daily quota, a generous per-network hourly ceiling (shared
   Wi-Fi is fine), the open-report cap, and the **day's budget**: spent today +
   what's still set aside for open reports + this report's set-aside must fit.
   Answer: 202 with the report id, in milliseconds.
2. **Profile lane** (default 8 at once): reads the profile, so visitors see it
   within a minute or so even when the analysis queue is long.
3. **Analysis lane** (default 6 at once, each up to 3 model requests at a time,
   so at most 18 concurrent model requests): market sample, comparison,
   scoring, insights, plan, freelance matches.

Claims use `FOR UPDATE SKIP LOCKED` under a per-lane lock that counts what's
running, so lane sizes hold across processes and replicas. A claim is a 90 s
lease renewed every 20 s; a job whose worker stops is taken back by the next
reaper pass and continues from what was saved (its profile isn't read or paid
for again). On SIGTERM (a redeploy) running jobs are handed back immediately.

Failures:

| What | What happens |
| --- | --- |
| Rate limit or overload (model or data) | Shared cool-down honoring Retry-After; backoff with jitter; the job goes back in line **keeping its place**. Doesn't use up an attempt. |
| Bad key, unknown model, empty balance, data-service spend cap | The lane **pauses itself**, the job waits in line, an incident is recorded. Fix it, then resume on the live page. |
| Private/restricted profile | Report ends as "couldn't be read". No retry. |
| A report's set-aside used up | Report ends; nothing more is spent on it. |
| Anything else | Retried up to 3 times, then ends with a reference. |

The **market sample** is built once under a database lock: the first worker to
need it builds it, everyone else waits and reuses it (24 h by default). Use
**Prepare market now** before the call so nobody waits for it.

## Model

Claude Haiku 5.5, `claude-haiku-5-5` (`PUBLIC_FDE_MODEL`), with
`ANTHROPIC_API_KEY`. It never uses an account's AI settings, and never falls
back to another model or provider. Token use is taken from each API answer and
priced with `PUBLIC_FDE_INPUT_USD_PER_MTOK` / `OUTPUT` ($0.10 / $0.50 per
million, Haiku 5.5's price for prompts up to 100K tokens; above 100K every token
costs 5×, so prompts over ~90K tokens are refused for that one comparison).

## Variables

Set on the Railway service (Variables), server only, never `NEXT_PUBLIC_`:

| Variable | Default | |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | none | **Required** for analysis. Without it, reports are accepted and profiles read, then wait. |
| `TREG_API_TOKEN` | none | Required for profile reads and LinkedIn job search (already used by the private review). |
| `PUBLIC_FDE_MODEL` | `claude-haiku-5-5` | |
| `PUBLIC_FDE_ENABLED` | `1` | `0` closes the page and its API. |
| `PUBLIC_FDE_DAILY_BUDGET_USD` | `10` | Model + data spend per day, all visitors together. |
| `PUBLIC_FDE_RESERVE_PER_REPORT_USD` | `0.20` | Set aside per accepted report; also its hard ceiling. |
| `PUBLIC_FDE_ADMIN_EMAILS` | `becomefde@gmail.com` | Accounts that may open `/fde/live`. |
| `PUBLIC_FDE_RETENTION_HOURS` | `72` | |
| `PUBLIC_FDE_GUEST_DAILY_REPORTS` | `2` | Per browser per day. |
| `PUBLIC_FDE_MAX_OPEN_REPORTS` | `80` | Queued + running at once. |
| `PUBLIC_FDE_IP_HOURLY` | `60` | Per network per hour. |
| `PUBLIC_FDE_WORKER` | `1` | `0` on a replica that should only serve pages. |
| `FDE_DAILY_SPEND_LIMIT_USD` | `1` | Existing: paid data calls for the whole server per day, private and public together. 50 profile reads use about $0.35 of it. |

## Costs (estimates, not measured live)

| Item | Each | 50 reports |
| --- | --- | --- |
| Profile read (Treg, `harvestapi.linkedin.user.profile`) | $0.0064 | $0.32 |
| Market sample, once (3 searches + up to 10 job details at $0.001, plus ~10 requirement reads by the model) | about $0.03 | $0.03 |
| Model per report (about 10 comparisons, insights, plan, 5 freelance fits) | typically $0.03–0.05, at most about $0.16 | $1.50–2.50, at most about $8 |
| **Total** | | **about $2–3 typical, about $9 worst case** |

Recommended balances before the call: **Treg ≥ $2, Anthropic ≥ $15**, and keep
`PUBLIC_FDE_DAILY_BUDGET_USD` at 10 or more. Prices were checked on 5 November
2026; check again before the call.

## Capacity (estimates)

Each report takes roughly 2.5–4 minutes of analysis. With 6 at once, 50 reports
finish in about **25–40 minutes**, the first within about 4. Profiles appear in
a minute or two for everyone. Real speed depends on the Anthropic account's
rate limits and Treg's, which weren't measured. If the live page shows model
cool-downs, lower "Reports analysed at once"; if it stays clear, raising it to
8–10 shortens the queue. The page shows each visitor their place in line, and
an estimate only once at least 3 reports have finished.

## Call-day steps

1. Sign in as the owner and open `/fde/live`.
2. **Check both services (free)**: both lines should say they're working.
3. **Prepare market now**: wait for "The shared market sample is ready." The
   landing page then shows today's sample.
4. Submit your own profile at `/fde-review` and check the report.
5. Paste the `/fde-review` link in the call chat.
6. Watch the live page: queue, spend, cool-downs, incidents.

**Pause:** "Pause new reports" stops intake (already-accepted reports carry on).
"Stop everything" also pauses both lanes; nothing queued is lost, and resuming
continues in order. **Kill switch:** set `PUBLIC_FDE_ENABLED=0` on Railway
(redeploys and closes the page).

**After a credential fix** (a paused lane): fix the variable on Railway, wait
for the redeploy, then **Resume** the lane. Waiting reports carry on in order.

## Testing without spending

- `src/lib/public-fde/queue.db.test.ts`: 50 guests submitting at once (each
  double-clicking), all drained with the lane limits held, isolation, quotas,
  budget refusal, lease recovery, a bad token pausing a lane, model busy and
  unavailable, the market sample built once for 10 simultaneous waiters,
  retention. Profiles are fixtures and the analysis is stubbed.
- `e2e/public-fde.spec.ts`: the signed-out flow on a production build with
  fixture profiles, a labelled test market sample and the fake AI server
  speaking Anthropic's API. Screenshots are in CI's `public-fde-screenshots`
  artifact.

These check the application's queuing and isolation. They say nothing about the
live providers' throughput, which only a live run shows.

## Open questions before release

- **Third-party profiles:** visitors confirm the profile is their own, but this
  can't be verified; anyone can paste any public URL.
- **Terms:** whether this public use fits LinkedIn's User Agreement, Treg's and
  HarvestAPI's terms, and privacy law (GDPR for EU visitors) hasn't been
  confirmed. The data notice on the page describes what's read, where it goes
  and how long it's kept.
