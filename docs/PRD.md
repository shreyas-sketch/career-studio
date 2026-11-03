# Career Studio: product requirements

Career Studio is a hosted, multi-user workspace for finding work, building career documents, preparing for interviews, freelancing and closing skill gaps. It is built on [Dossier](https://github.com/AienTech/dossier) (AGPL-3.0) and keeps Dossier's job-search product intact while adding six agents around one shared career profile.

Status of each requirement is tracked in [PARITY.md](PARITY.md) (Dossier features) and in the "Status" column below (new agents). This document is kept current as the build moves.

## Users and principles

- **Who:** job seekers, career changers and freelancers, each with their own account. An operator (for example an agency) hosts one instance for many people.
- **Real work, real data.** Every agent works on the user's own profile and documents, calls the user's own AI provider, and uses live sources where they exist. Nothing is simulated; anything that needs access the platform doesn't have says so.
- **Never invent the person.** Agents use facts from the profile. Missing achievements, numbers, employers or qualifications are asked for, never made up (Dossier's fact guard applies to every writing task).
- **The user stays in control.** Nothing is sent, applied for or submitted by the platform. Drafts are drafts.
- **One profile, connected work.** A job, its tailored resume, its interview practice, its interview loop and the learning plan for its gaps link to each other; nothing is entered twice.

## Accounts, keys and isolation

| Requirement | Status |
|---|---|
| Email + password accounts; sign-up can be open, invite-code only, or closed (`CAREER_STUDIO_SIGNUPS`, `CAREER_STUDIO_INVITE_CODE`) | Done |
| Each account's data in its own Postgres schema; queries without an account fail closed | Done, tested |
| Each user chooses their own AI provider, model, endpoint and key in Settings → AI provider, with connection testing | Done (Dossier's flow) |
| Keys encrypted at rest (AES-256-GCM, per-purpose HKDF keys), never returned to the browser or logged | Done (Dossier's) |
| Hosted-safe providers only: Anthropic, OpenAI and OpenAI-compatible services (OpenRouter, DeepSeek, …), Mistral. On-device providers (Ollama, LM Studio) are refused with an explanation; user endpoints must be public https (SSRF guard) | Done |
| The operator's own AI env variables never stand in for a user's key | Done |
| Sessions: signed cookie + server-side session row; sign out ends it everywhere it's listed | Done |
| Sign-in throttling per IP and per address | Done |
| Account deletion removes the schema, files and sessions | Done |

## Agent 1: Job search and applications (Dossier)

All of Dossier's workflow, per account: profile, job discovery (JSearch for LinkedIn/Indeed and others, Adzuna, FreeHire, Arbeitsagentur), matching and scores, saved searches and postings, startup discovery (YC, HN "Who is hiring?"), fetching a posting from a URL or pasting it, tailored resume and cover letter, application email, refinement chat, version history, tracking board and table, dashboard and calendar, Gmail and Calendar, the background job agent and its review screen, export/import and backups. LinkedIn listings come through JSearch, the existing source integration; Career Studio has no access to private LinkedIn data. See [PARITY.md](PARITY.md).

## Agent 2: Resume builder

- Start from scratch with guided questions, or import an existing resume (PDF, DOCX, text) into the profile with Dossier's importer.
- Several named resume versions (for example "Product design", "Frontend"), each with its own content, theme and history, built from the profile.
- A coach that reviews a version against a target role and **asks for missing facts** (metrics, scope, results) instead of inventing them; answers go back into the profile so every later document benefits.
- Tailor a version to a job description or to an application.
- Live preview with Dossier's 12 themes and theme builder; export to PDF, DOCX, Markdown and plain text.

## Agent 3: Mock interview

- Start from a job description, or from a saved application or posting.
- Choose focus (behavioral, technical, role-specific, mixed), difficulty, and length.
- The interviewer asks one question at a time, grounded in the role and the user's actual profile, and asks a follow-up when an answer is thin.
- Each answer gets a score (1–5) against a rubric, what worked, what was missing, and a stronger answer that only uses the user's real experience.
- A session report: scores by competency, recurring weaknesses, what to practice next, with progress across sessions.

## Agent 4: Interview loops (multiple interviews)

Distinct from single practice sessions: this manages **a hiring process with several rounds, across several companies at once**.

- A loop per company and role (linked to its application when there is one) with its rounds: recruiter screen, hiring manager, technical, system design, case, behavioral/panel, final, or custom.
- Each round has a date, the interviewer's perspective (who they are and what they screen for), a prep plan generated for that round from the job and the user's profile, and notes and feedback afterwards.
- Practice a round: starts a mock interview from that interviewer's perspective, and the result attaches to the round.
- An upcoming-interviews view across all loops, and what changed since the last round (feedback carried forward into the next round's prep).

## Agent 5: Freelance finder

- Freelance preferences: skills to sell, hourly/fixed rate floor, availability (hours/week), remote/time-zone constraints, contract types.
- Live opportunities from legitimate sources: Remotive, Jobicy, Remote OK and Himalayas public APIs (contract and freelance roles), and Hacker News' monthly "Freelancer? Seeking freelancer?" thread. Each keeps its attribution and link back, and is cached server-side to respect the sources' polling limits.
- Each opportunity scored for fit with reasons, gaps and concerns (rate, scope, red flags), so the user can decide what to pursue. Save, dismiss, mark as pursuing, open in Upwork analysis or start a proposal.
- Sources that need approval or credentials (Upwork's API, Freelancer.com's API) are listed as such, not faked.

## Agent 6: Upwork analyst

Works from a **pasted job description**; no Upwork account access needed.

- Suitability for the user, with evidence from the profile and the gaps.
- Suggested hourly rate or fixed-price bid range, with the assumptions behind it, scope, effort estimate and possible milestones.
- **Connects** (Upwork's proposal currency) kept separate from **AI tokens**: the Connects the job requires and the user's optional boost are entered by the user (Upwork shows them on the job), priced at Upwork's published $0.15 per Connect (sourced, dated, editable).
- Platform fee and take-home: Upwork's freelancer service fee varies per contract (0–15% per Upwork's pricing page); the user enters the rate Upwork shows them, with the source shown for the default.
- Proposal draft and screening-question answers from the user's real profile; missing information, risks and questions to ask the client.
- No invented account data, competition levels or winning bids.

## Agent 7: Skill arbitrage

- From a target job description and a skill to develop: current strengths, transferable experience, missing skills and an honest readiness estimate.
- A plan sized to the user's available hours per week and timeline: what to learn, practice, build, and how to demonstrate it (portfolio piece, write-up, certification where it matters), and how to use existing strengths now.
- Tracks progress through the plan's steps. States its assumptions; no income or job guarantees.

## How the agents connect

- One profile feeds everything. Facts learnt by the resume coach, interviews and Upwork analyses can be saved back to it.
- From an application: tailor resume → practice interview → set up its interview loop → close its gaps with a skill plan. Each of these shows on the application, and links back to it.
- From a freelance opportunity: analyse it in the Upwork analyst (or as a generic proposal) → skill plan for its gaps.
- The dashboard shows what's next across all agents: upcoming interviews, plans in progress, opportunities waiting.

## Non-goals

- Sending applications, proposals or emails automatically.
- Scraping sites that forbid it, or access to private LinkedIn or Upwork account data.
- Guaranteeing outcomes (jobs, income, wins).
