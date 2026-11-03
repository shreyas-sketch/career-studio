# Career Studio architecture

## Shape

One Next.js 16 application (App Router, Server Components, Server Actions) with PostgreSQL, run as a single Docker container. This is Dossier's architecture, kept deliberately: its background jobs, schedulers and PDF renderer run inside the app process, which works well on a single long-running container and badly on serverless platforms.

```
Browser ──► Next.js (pages, Server Actions, route handlers)
              │
              ├─ tenancy: who is this? (signed session cookie / runAsUser)
              │     └─ prisma → the account's own Postgres schema  u_<id>
              ├─ accounts (pg): cs_accounts.users / sessions / login_throttle
              ├─ in-process job queue (AI tasks, per-account fairness)
              ├─ schedulers (job agent, startups, inbox, backups, sweeps) → forEachUser
              ├─ AI providers (the account's own key) ──► Anthropic / OpenAI-compatible / Mistral
              ├─ job & freelance sources ──► JSearch, Adzuna, FreeHire, BA, HN, Remotive, Jobicy, Remote OK, Himalayas
              └─ PDF renderer (Playwright Chromium, server-side)
```

## Tenancy

Dossier was single-user: every query reads "the" profile, "the" settings. Rather than threading a user id through ~60 data modules, each account gets a **Postgres schema of its own** (`u_<24 hex>`) holding Dossier's tables unchanged. This gives:

- Isolation by construction: a query can only see the schema its client is bound to. There is no `WHERE user_id = …` to forget.
- Dossier's code, migrations and tests keep working as they are.

How a database call finds its account (`src/lib/tenancy`):

1. `runAsUser(id, fn)` puts the account in `AsyncLocalStorage`. Server Actions (`action()`), route handlers (`route()`), the job queue (each job remembers its owner), the MCP endpoint (the token names its account) and the schedulers (`forEachUser`) all use it.
2. Server Components can't be wrapped, so when nothing was set explicitly, the request's **signed session cookie** decides. It is read synchronously from Next.js' request store (`request-user.ts`; Next's internal API, pinned by the exact `next` version and covered by tests).
3. Otherwise `NoTenantError`: the call fails closed.

`prisma` (`src/lib/prisma.ts`) is a proxy that resolves to the current account's `PrismaClient` on every access. Each client has its own small pool whose connections start with `search_path=u_<id>,public` (so raw SQL and triggers stay in the schema), and Prisma also qualifies its queries with the schema. Clients for idle accounts are closed (LRU of 50).

Schemas are created and migrated by `migrateSchema()` from the same `prisma/migrations` SQL Prisma uses, under an advisory lock, on sign-up, on every sign-in and at startup. The `citext` extension lives in `public`.

Files on disk (backups, download zips) live under `DATA_DIR/accounts/<id>/`.

## Accounts and sessions

`cs_accounts.users` (argon2id hashes, citext email), `cs_accounts.sessions`, `cs_accounts.login_throttle`, reached only through `src/lib/accounts/db.ts` (plain `pg`), never through the per-account Prisma client. The session cookie is `userId.sessionId.expiry.persistent.HMAC` (HKDF key from `DOSSIER_SECRET`): verifiable without the database for routing, and checked against the sessions row before anything is served.

## AI

Dossier's provider layer is kept: structured output validated with zod, prompt versions recorded on everything written, a fact guard that rejects invented employers, dates and credentials, and long tasks run as background jobs with named steps and live progress (SSE). Career Studio's agents are written as more Dossier tasks (`src/lib/ai/tasks/*`) and jobs (`src/lib/jobs/*`).

Hosted constraints: each account's own key only; on-device providers refused; user endpoints must resolve to public addresses over https; the job queue caps concurrent jobs per account so one account can't starve others.

## External data

| Source | Use | Access |
|---|---|---|
| JSearch | Job search incl. LinkedIn, Indeed | User's (or operator's) RapidAPI/OpenWebNinja key |
| Adzuna | Job search | User's (or operator's) app id + key |
| FreeHire, Bundesagentur für Arbeit | Job search | No key |
| Hacker News (Algolia + Firebase) | Startups; monthly freelancer thread | No key |
| Remotive, Jobicy, Remote OK, Himalayas | Freelance/contract roles | No key; attribution and link back; cached server-side within each source's polling limits |
| Upwork, Freelancer.com | Job search APIs | Need approved API access: not integrated; Upwork works from pasted job posts |
| Any posting URL | Fetch a posting | Private-network guard, size/time limits, paste fallback |

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md).
