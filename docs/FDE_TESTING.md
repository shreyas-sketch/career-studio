# Testing the FDE review

Setup, prices and limits are in [FDE_REVIEW.md](FDE_REVIEW.md). This page is what to
click and what you should see.

Replace `APP` with the address you're testing:

- Railway: `https://career-studio-production-be8d.up.railway.app`, once this work is on
  the branch that service deploys.
- Local: `http://localhost:3000`, from `corepack yarn dev`.

## Before you start

1. Sign in, then open `APP/settings?section=ai` and confirm your model answers
   **Test connection**. The review uses this connection.
2. Open `APP/settings?section=fde`. **TREG_API_TOKEN** should read "Set on the server".
3. Press **Check the connection**. It uses Treg's free location search, so it costs
   nothing. You should see "Connected. Treg accepted the token and returned a valid
   answer at no charge."

| What you see | What it means | What to do |
| --- | --- | --- |
| "Not set" | The server has no token | Add `TREG_API_TOKEN` to the service's variables on Railway, wait for the redeploy |
| "Treg didn't accept the token" | Wrong or revoked token | Create a new token at https://treg.to/app and replace the variable |
| The nav has no **FDE review** | This branch isn't deployed | Merge it into the branch that service deploys |

## The main test, on a desktop browser

1. Open `APP/fde`.
2. In **Public LinkedIn profile**, paste a real public profile that isn't yours. Don't
   choose a job. Leave **Location**, **Seniority** and **Remote roles only** alone.
3. Press **Review this profile**. You land on the report's own page straight away.
4. Watch the stages in order: Reading the profile, Discovering FDE roles, Verifying
   openings, Building the benchmark, Matching evidence, Writing insights. Role cards
   appear as soon as the roles are known.
5. Left panel, the profile. Check against the real LinkedIn page:
   - the photo, or a neutral picture if there's none, and never a broken image
   - the full About, once its section is opened, with nothing cut
   - every job, with dates and descriptions
   - which sections were retrieved and which weren't
   - the time, the provider and **Open on LinkedIn**
6. Right panel, **Current FDE openings**. Open **How this sample was chosen** and check
   the scope reads Global, the sources, and what was left out and why.
7. Click a role card. It opens that posting's full text with the reasons it's in the
   sample. Open the employer's link and confirm the job is real and still open.
8. Scroll to **Market readiness**. Check the score, how many roles it covers, the range
   and the breakdown by level. Senior roles should sit in their own group.
9. In the comparison matrix, click a cell or a row. The inspector opens with the passage
   highlighted in that employer's posting. Press Escape. Focus returns to what you clicked.
10. Pick a role and open its table of **Role requirement, Profile evidence, Assessment,
    Suggested action**. For three rows, confirm the quoted evidence is in the profile and
    the quoted requirement is in that employer's posting.
11. **Improve**: check that rewrites keep real dates and numbers, and use a question or
    placeholder where a figure is unknown. Press a copy button and paste it somewhere.
    Learning plan hours should be at most 40 for 5 hours a week over 8 weeks, with no
    step over 5 hours.
12. **Paid work**: open two listings. The amount, currency and basis should match the
    listing, or the card says "Pay not stated". Fees and Connects stay unknown. Nothing
    should mention your own rate or location.
13. Open `APP/profile`. Your own profile must be unchanged.
14. Note the spend on `APP/settings?section=fde`, then compare it with the Treg balance.

## On a phone

Use a real phone or a 375 px wide window.

1. Open the same report. Nothing should scroll sideways.
2. The bar at the bottom shows **Profile, Roles, Compare, Improve, Paid work**, all visible.
   Each one jumps to its section.
3. **Compare** shows grouped cards instead of the wide matrix. Tap a requirement. The
   sheet stays inside the screen and closes with its close button.
4. Tap a role card. It scrolls to that role's detail.
5. Export is at the foot of the report.

## Without spending anything

Run locally with `FDE_FIXTURE_MODE=1` in `.env`. Paste
`https://www.linkedin.com/in/<slug>` using the slugs in
[FDE_REVIEW.md](FDE_REVIEW.md#testing-without-credentials). Every screen is labelled as
sample data. Job openings stay real.

## Checklist

Status when this was written: **Fixture** means passed locally with an invented person and
a stand-in AI model. **Automated** means covered by a test that ran. Fixture and automated
passes don't prove the live integration.

```text
Setup
[ ] Token set on the server, value never visible            Fixture: not-set and wrong-token states
[ ] Check the connection succeeds with a real token         NOT TESTED, needs your token
[ ] Wrong token: clear message, no spend, no value shown    Live endpoint, fake token: passed

Profiles
[ ] Your own profile as the subject                         NOT TESTED
[ ] A different person, same account                        NOT TESTED live; separation automated
[ ] Photo present                                           Fixture
[ ] Photo absent                                            Fixture
[ ] Photo broken                                            Fixture
[ ] Full About and long history, nothing cut                Fixture
[ ] Private or unavailable profile                          Fixture
[ ] Partial profile, score provisional                      Fixture
[ ] Name-level data only, score withheld                    Fixture and automated

Market discovery
[ ] Runs with no job chosen                                 Passed on real boards
[ ] Includes LinkedIn search and job details                NOT TESTED, needs your token
[ ] Repeat with location, remote and seniority filters      Passed on real boards
[ ] Open-role verification, closed and stale left out       Automated
[ ] Duplicate requisitions merged                           Passed on real boards, automated
[ ] Missing descriptions left out                           Automated
[ ] Too few roles: smaller sample, limits stated            Passed (Antarctica filter)
[ ] Total discovery failure: says so, no old sample         Automated

Comparison
[ ] Per-role drill-down                                     Fixture
[ ] Matrix and exact counts such as "6 of 10"               Fixture
[ ] Excerpts belong to the right employer                   Automated; real model NOT TESTED
[ ] Unsupported claims are downgraded                       Automated; real model NOT TESTED
[ ] Score arithmetic and market aggregation                 Automated
[ ] Seniority groups kept apart                             Fixture

Freshness
[ ] Saved benchmark reuse is disclosed                      Fixture
[ ] Deliberate refresh makes a new report, keeps the old    Fixture
[ ] Older report still reproducible                         Fixture
[ ] A failed refresh leaves the old report                  Automated

Failures
[ ] Invalid URL                                             Passed
[ ] Missing token                                           Passed
[ ] 401 and 403                                             Fixture; 401 also live with a fake token
[ ] 429                                                     Fixture
[ ] Balance run out                                         Fixture
[ ] Timeout                                                 Fixture
[ ] Double click makes one report                           Passed, automated
[ ] Reload during a run                                     Passed
[ ] Reload a finished report                                Passed

Paid work
[ ] Real links, from real sources                           Passed on real listings
[ ] Pay, currency and basis match the listing               Passed on the listings checked
[ ] Unknown fees stay unknown                               Passed
[ ] Salaried jobs left out                                  Passed on real listings

Access
[ ] Phone layout                                            Passed at 375 px
[ ] Keyboard, focus and Escape                              Passed for the field and inspector
[ ] Reduced motion                                          Code reviewed only, NOT TESTED in a browser
[ ] Two accounts, each sees only its own                    Automated; by hand NOT TESTED
```

## The pilot

Only after the main test looks right, and after you've decided the use is allowed.

1. Open `APP/fde/pilot`.
2. Paste the public addresses, one per line, and set **Spending limit in dollars**.
3. Read the estimate. Duplicates are merged and bad lines are listed.
4. Press **Run the first 5**. Check complete, partial, inaccessible and failed by opening
   the reports.
5. Only if coverage looks right, press **Run the next** batch. It stops by itself at a
   token or balance error, or at the limit.

The server-wide daily limit defaults to $1. For 125 profiles at $0.80 plus the market
search, raise `FDE_DAILY_SPEND_LIMIT_USD` deliberately first.
