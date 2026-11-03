# Dossier parity checklist

Career Studio started from Dossier v1.11.0 (upstream commit `3578f9a`). This tracks every Dossier capability through the multi-user conversion and redesign, so nothing is dropped silently. Status: **Kept** (works per account, unchanged), **Adapted** (changed for hosting or multi-user; how is noted), **Removed** (with the reason), **Pending** (not yet verified on the hosted instance).

| Area | Dossier capability | Status | Notes |
|---|---|---|---|
| Profile | Basics, skills and languages, experience, projects, education, publications, references, ordering, strength meter, photo | Kept | Per-account schema |
| Profile | Facts about me (given to the AI, never printed) | Kept | |
| Profile | Import from a resume (PDF, DOCX, text) with review before applying | Kept | Also the Resume builder's import |
| Base resume | 12 themes, theme builder, live preview, duplicate and share themes as files | Kept | Built-in themes seeded into each account |
| Base resume | Server-side PDF (Playwright Chromium) | Kept | Container image includes Chromium |
| Find jobs | JSearch (LinkedIn, Indeed, Glassdoor…), Adzuna, FreeHire, Arbeitsagentur | Adapted | Each account adds its own JSearch/Adzuna key in Settings → Job search. Operator env keys still work as a shared fallback (the operator pays). |
| Find jobs | Save, dismiss, past searches kept without spending searches, score a posting | Kept | |
| Startups | YC startups' job posts and HN "Who is hiring?", fit scores, published addresses only | Kept | Refresh runs per account |
| Job agent | Daily run, dedupe, scoring, drafts for review on the Agent screen, approve/dismiss | Adapted | The schedule runs for every account that turned it on |
| New application | Paste a posting or fetch it from a URL; extraction; requirement matching; gap display | Kept | URL fetcher keeps its private-network guard and paste fallback |
| Documents | Tailored resume and cover letter in a chosen tone and language; never invents experience (fact guard) | Kept | |
| Documents | Refine chat, regenerate any part, undo AI changes, version history and restore, trim to one page | Kept | |
| Documents | Application email, PDFs zipped for download | Adapted | Zips kept per account |
| Tracking | Board and table, statuses, furthest stage, notes, archive | Kept | |
| Dashboard | Funnel (30/90 days/all), week-by-week chart, what's next, calendar with interviews | Kept | Extended with Career Studio's agents (see PRD) |
| Gmail & Calendar | Send from own address with PDFs, read replies, classify, draft answers, sync interviews | Adapted | Needs the operator's Google OAuth client (`DOSSIER_GOOGLE_CLIENT_ID/SECRET`) and Google's verification for the Gmail scopes before other people can connect. Inbox check runs per account every 10 minutes. |
| MCP connector | Use from Claude via a remote MCP server with OAuth | Adapted | Tokens are bound to the account that connected; every account turns it on for itself |
| Your data | Export/import everything as one file, nightly backups, delete everything | Adapted | Backups stored per account; "Delete everything" empties the account's data |
| AI | Local (Ollama/llama.cpp), LM Studio, OpenAI-compatible, Anthropic, Mistral | Adapted | On-device providers removed for hosted use (a hosted server can't reach a user's computer); OpenAI-compatible endpoints must be public https |
| AI | `DOSSIER_AI_*` environment defaults | Removed | Would bill every account's AI use to the operator; each user brings a key |
| Scoring | Jev (TypeSafe) scorer as an alternative to the AI model | Kept | Per-account key |
| Sign-in | Single password from `DOSSIER_PASSWORD`, global throttle | Replaced | Accounts, sessions table, per-IP and per-address throttling |
| Updates | Update check against Dossier's releases, usage ping | Removed | Not meaningful for a hosted fork; no telemetry is sent |
| Deployment | Docker image, Compose, CapRover | Adapted | See [DEPLOYMENT.md](DEPLOYMENT.md) |

## Verification log

| Date | What | Result |
|---|---|---|
| 2026-11-03 | Dossier's full test suite after the multi-user conversion | 1799 passed, 31 skipped (live tests needing keys) |
| 2026-11-03 | Two accounts signed up in a real browser; separate schemas; dashboard renders per account | Pass |
| 2026-11-03 | Isolation tests: ORM and raw SQL per account, interleaved concurrent requests, no-account calls refused, account deletion | Pass |
