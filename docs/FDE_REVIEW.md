# FDE review

Paste a public LinkedIn profile, anyone's. Two agents then work on it:

- **Power Deploy** reads the profile, finds current forward deployed engineering
  openings by itself, and compares the profile with each one.
- **Stop** looks for real, paid freelance work that fits the same profile.

No job has to be chosen, saved or pasted first. The person analysed doesn't have
to be the person signed in, and their data never touches the account owner's
profile, preferences, rate or location. Reports are private to the account that
asked for them.

## How a review runs

1. The report row is created before anything is fetched, so a reload or a
   notification always has one page to open.
2. **Reading the profile** through a retrieval provider, into a saved snapshot.
3. **Discovering FDE roles** on employers' own boards (Greenhouse, Lever, Ashby:
   free and public, cached for 12 hours) and LinkedIn job search (paid).
4. **Verifying openings**: full text only, customer-facing and deployment work
   confirmed in the text, duplicates merged, closed or unreadable roles left out.
   The shortlist is 8 to 12 roles across at least 5 employers when the market has
   them, at most 2 per employer. The profile plays no part in which are picked.
5. **Building the benchmark**: requirements are read from each posting, with an
   exact excerpt that must be found in that posting. It's saved as a versioned
   snapshot and reused for 24 hours, and a report always says whether it reused one.
6. **Matching evidence**: each requirement is assessed against the profile, and
   every quote must be found in the profile snapshot. An unbacked claim is
   downgraded.
7. **Writing insights**: scores come from the rubric, never from the model.

If discovery fails, the report says so and offers a retry. A generic rubric, an
old benchmark or a pasted job never takes its place.

## Scoring (`fde-fit@1`, `src/lib/fde/rubric.ts`)

- Each role's fit: must-haves weigh 2, preferred 1. Demonstrated earns all of the
  weight, Partial half, Not shown in this profile nothing.
- Cannot assess is left out of the denominator. The range beside a score is the
  result if every unknown went one way or the other.
- Stated eligibility (years, location, travel, work authorization, degree,
  clearance, spoken language) is listed separately and never scored as technical
  fit.
- Market readiness is the weighted mean of per-role fits over verified-open roles.
  Accessible and unstated levels weigh 1, senior roles 0.5.
- Copies of one requisition count once. Requirements are never combined across
  employers into one mandatory list.
- With name-level data only, the score is withheld. With a partial profile, it's
  marked provisional.
- A score describes evidence against this sourced sample. It isn't a hiring
  probability or a universal employability rating, and missing evidence isn't
  proof of missing ability. Ticking off a learning step never changes a score.

## Career and earning potential (`src/lib/fde/potential.ts`)

Worked out from the report's saved postings and assessments, with no model and no
paid call, so older reports show it too.

- **Next roles** are the sampled roles by the rubric's reach, each with the skills
  this profile doesn't show yet and the stated conditions it doesn't assume are met.
- **Advertised pay** reads only the ranges a posting states, as yearly figures. Groups
  are country, currency and level, and nothing is converted.
- **Base and total stay apart.** A range that says both, or neither, is labelled "Pay
  type not clear" and is never counted as either.
- **An average is the mean of range midpoints** and takes at least 3 postings. Below
  that, the group shows the stated range as insufficient data. A posting counts once
  in a country, however many zones it lists. One that lists a range per level, or `$`
  outside the US with no currency named, isn't counted.
- **Current pay is optional** and is compared only with the same currency and pay type.
  It stays on the page: it isn't saved, exported or sent to the server or a model.
  Without it, no increase is shown.

Nothing here predicts an offer, and completing the plan doesn't guarantee a job or pay.

## Setting it up

The only new credential is `TREG_API_TOKEN`. One token covers the profile and job
tools. The AI model is the account's existing AI provider connection, set up in
Settings → AI provider.

| What | Link |
| --- | --- |
| Sign in or sign up (GitHub, Google or an emailed code) | https://treg.to/app |
| Docs | https://treg.to/docs |
| HarvestAPI tools | https://treg.to/tools/harvestapi |
| Profile tool and its price | https://treg.to/catalog/linkedin/user.profile |
| Pricing | https://treg.to/pricing |

A team token is either a dashboard API key, created in the dashboard at
https://treg.to/app, or an agent token from the CLI: `treg org agent-new
career-studio`. The balance is under Team → Billing in the dashboard. The dashboard
needs a sign-in and its pages aren't public, so the exact menu label for the key
hasn't been checked.

On Railway: open https://railway.com/dashboard, then the project, then the service
that runs the branch, then **Variables** → **New Variable**. Add `TREG_API_TOKEN`.
Don't change the other variables. Saving redeploys. Repeat for each service.

Locally: add `TREG_API_TOKEN=...` to `.env` and restart.

Then open **Settings → FDE review** and press **Check the connection**. It uses
Treg's free location search tool, so it costs nothing and shows only a sanitized
result. The token never reaches the browser, responses or logs.

### Prices, checked 5 November 2026

| Call | Price |
| --- | --- |
| Full profile, `harvestapi.linkedin.user.profile` | $0.0064 |
| Job search, `harvestapi.linkedin.search.jobs` | $0.001 |
| Job detail, `harvestapi.linkedin.job.get` | $0.001 |

New verified Treg accounts get $1.00 once. 125 profiles cost $0.80 before searches,
details, retries and AI. Check the prices again before a large run. The email
lookup tool is never called.

### Limits

| Variable | Default | |
| --- | --- | --- |
| `FDE_RUN_SPEND_LIMIT_USD` | 0.10 | Paid retrieval for one review |
| `FDE_DAILY_SPEND_LIMIT_USD` | 1 | Paid retrieval for the whole server per day |
| `FDE_ACCOUNT_DAILY_REPORTS` | 10 | Reviews per account per day |
| `FDE_SHORTLIST_SIZE` | 10 | Roles in a sample, 8 to 12 |
| `FDE_BENCHMARK_MAX_AGE_HOURS` | 24 | How long a sample is reused |
| `FDE_PROFILE_MAX_AGE_DAYS` | 7 | How long a profile read is reused |
| `FDE_RETENTION_DAYS` | 90 | How long reports are kept |
| `FDE_LINKEDIN_DETAIL_LIMIT` | 10 | Job details bought per search |

Sign-ups are open and the token belongs to the server, so these limits are what
stand between a stranger's account and your balance.

## The alternative provider: Apify

Not wired in, and never switched to automatically. It would need an adapter
implementing `RetrievalProvider` (`src/lib/fde/providers/types.ts`).

- Actor: `harvestapi/linkedin-profile-scraper`, with `APIFY_TOKEN` on the server and
  email enrichment off.
- Published: $5 a month free, $4 per 1,000 profile details, and a limit of 50 total
  runs on the free plan. Batching differs from Treg.
- Links: https://console.apify.com, https://console.apify.com/settings/integrations,
  https://docs.apify.com/integrations/api,
  https://apify.com/harvestapi/linkedin-profile-scraper,
  https://apify.com/harvestapi/linkedin-profile-scraper/pricing,
  https://apify.com/pricing

## The batch pilot

**FDE review → Batch pilot** takes a list of public addresses and a hard spending
limit, then shows an estimate before anything runs. The first batch is 5. Each later
batch is started by hand. Results are counted as complete, partial, inaccessible and
failed, and the pilot stops at a credentials or balance error. A pilot reuses one
benchmark, can be resumed, and doesn't count against the daily review limit. It does
count against the spending limits.

## Testing without credentials

`FDE_FIXTURE_MODE=1` replaces LinkedIn with invented people, labelled on every
screen. Job openings stay real. Addresses that trigger each case:

| `linkedin.com/in/...` | What it shows |
| --- | --- |
| `fixture-full` | A complete profile |
| `fixture-no-photo` | The neutral fallback picture |
| `fixture-broken-photo` | An image that fails to load |
| `fixture-partial` | No About or skills, a provisional score |
| `fixture-identity` | Name-level data only, score withheld |
| `fixture-long` | Long About and history, nothing cut |
| `fixture-private` | A restricted profile |
| `fixture-401`, `fixture-403` | Bad token, no permission |
| `fixture-429` | Rate limited |
| `fixture-quota` | Balance run out |
| `fixture-timeout` | The provider took too long |

Never set it on a real server. A fixture report proves nothing about live ingestion.

## Privacy

Reports hold another person's public data. They're private to the account, deleted
after `FDE_RETENTION_DAYS`, deleted with the account, and left out of the account's
data export. Whether analysing third parties in this way is allowed under LinkedIn's
terms, the providers' terms, and laws such as GDPR depends on how it's used, and
that's for the operator to decide before running a pilot on real people.
