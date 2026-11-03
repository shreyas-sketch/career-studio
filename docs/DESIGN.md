# Career Studio's design: the crew on a mobile

This is one of two design directions. It presents the agents as **a crew of seven hanging on a kinetic mobile**, in the tradition of Calder's sculpture and Miró's creatures. The other, a staff of seven robots, is on the `design/living-mobile` branch.

## The rule that makes it work: motion is never pretend

The PRD says nothing is simulated, and that applies to movement too. A spinner or a looping "busy" animation would be a small lie, so there are none.

| What you see | What causes it |
|---|---|
| An arm dips and the rest of the mobile rebalances | A member has a job in hand, which makes them heavier (`Mobile.setWork`) |
| A member's wire is plucked | Their job named a new step (`step` in the `Job` table) |
| A member moves at their trade | They're running a job right now (`gesture`) |
| They look at their work | Same; otherwise they watch the pointer |
| A slip of paper falls to the corner | A job finished (`CrewHandovers`), and the page behind it refreshes |
| A member hangs crooked with a red tag | Their latest job failed, in the last 30 minutes |
| Gentle drift, nothing else | Nobody's working. Only the air moves them, and the sentence says so |

`src/lib/crew/live.ts` reads all of this from the account's `Job` rows. The browser asks `/api/crew` every 1.8s while something's running, every 12s otherwise, and not at all from a hidden tab.

## The crew

Each member has a name, a shape, a colour and a way of moving, so you can tell who's working from across the room. Job types map to them in `src/lib/crew/crew.ts`.

| Member | Does | Shape | Moves |
|---|---|---|---|
| Scout | Job search, startups, job agent | Red dart | Looks left and right, turning right round |
| Tailor | Resumes, letters, emails, replies | Blue crescent | Stitches: quick and even |
| Interviewer | Mock interviews | Yellow head with a word on its way out | Nods, then waits |
| Usher | Interview loops | Black bean (white after hours) | Paces |
| Prospector | Freelance finder | Brown spade | Digs: down hard, up slowly |
| Appraiser | Upwork analyst | Pink lozenge | Weighs one side against the other |
| Coach | Skill plans | Green sprout | Grows |

## Tokens

- **Colour:** a plaster wall by day (`#eff1ec`) and ultramarine after hours (`#131b49`). Cobalt actions by day, cadmium yellow after hours. Vermilion is the signal colour. The shapes hold the only other saturated colour.
- **Type:** Jost for titles, of the same years as the sculpture. IBM Plex Sans for everything people read closely.
- **Radius:** slips and tags 4px, like cut paper; controls 7px; cards 10px; the panel 18px; dialogs 20px.
- **Shadow:** the mobile's are flat and cast on the wall, and lean with the user's own clock, so the room's light moves through the day.

## Where it shows up

- **Today:** the full mobile, the greeting under its short end, one sentence on what's actually happening, then "On your desk": real things waiting on the user, each slip clipped by whoever handed it over.
- **Each agent's screen:** its member hangs from the top of the panel beside the title (`CrewPendant`).
- **Sidebar:** each section carries its member's shape, which swings while they work.
- **Job progress:** the member and the job's own step, in place of a spinner.
- **Sign-in:** the mobile, at rest.

## Floor

Reduced motion hangs the mobile where its weights put it and stops there; the state still shows, in words and in the balance. Everything in the drawing is decorative: tags are real links, a live region says what's happening, and phones get a plain list. The drawing pauses off screen.
