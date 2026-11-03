# Career Studio's design: a staff of seven robots

Career Studio's agents are **a staff of seven**, each a robot with a job title and a tool of its trade. They share one design: a satin ceramic shell, a floating head, a blue glass visor. The audience is experienced professionals, so they carry themselves like colleagues rather than cartoons: one body, restrained movement, no bouncing, no rainbow of colours. What separates them is what they hold and what they're doing: every robot always has its item in hand, at rest while it waits and raised while it works.

## The rule that keeps it honest: a robot only does what its job is doing

The PRD says nothing is simulated, and that applies to these too. A robot never looks busy unless a job is running.

| You see | What causes it |
|---|---|
| The robot brightens, and its title and what it's doing appear | One of its jobs is running, queued, just finished or stopped |
| Tool raised and in use, eyes narrowed on it, a light sweeping the visor, brass chest lamp pulsing | A job of theirs is running (`status` in the `Job` table) |
| A nod | The job named a new step (`step`) |
| Tool half raised, looking up | The job is queued |
| Closed-eye smile, a wave, green lamp, a short note linking to the result | The job just finished; it settles a few seconds later |
| Worried face, coral lamp, "Stopped: ..." with the reason | Their latest job failed, in the last 30 minutes |
| Dimmed, its item at rest in its hand, a slow hover and an occasional blink, lamp off | Nothing is running: they're waiting |
| Eyes following the pointer, and a wave when reached for | The user, while the robot isn't busy |

`src/lib/staff/live.ts` reads all of this from the account's `Job` rows. The browser asks `/api/staff` every 1.8s while something's running, every 12s otherwise, and not at all from a hidden tab.

## Layout: a strict grid that doesn't move

Seven equal columns, with every robot the same size on the same ground line and the words beneath them on shared baselines. A robot never changes size or place, so a glance at the same spot always answers the same question. An earlier version had working robots step forward at a larger size; mixed sizes in one row looked scattered, so emphasis comes from light instead: a working robot is at full brightness, the rest are dimmed.

The panel only says what's different right now. What a waiting robot did last is a hover away. Each thing is said once: the header says where the search stands, and the robots say what's happening.

## The staff

Job types map to them in `src/lib/staff/staff.ts`; the drawings and their tools are in `src/components/staff/robot.tsx`, and every mood is in `robot.module.css`. `/dev/robots` shows them all, in development only.

| Title | Holds | At work | Handles |
|---|---|---|---|
| Search analyst | Magnifying glass | Sweeps it | Job search, startups, the job agent |
| Resume editor | Page and pen | Lines write themselves | Resumes, letters, emails, replies |
| Interview coach | Microphone | Sound rises from it | Practice interviews |
| Interview coordinator | Clipboard | Ticks items off | Interview loops and round preparation |
| Freelance researcher | Compass | Needle searches | Freelance sources and fit checks |
| Bid analyst | Balance | Weighs | Upwork jobs and proposals |
| Skills advisor | Rising chart | Bars grow | Skill plans |

Their sentences use each job's own step: "Your resume editor is tailoring the resume for Stripe."

## Materials

The robots are drawn as made objects, so they hold up close to a professional's eye. `RobotMaterials` in `src/components/staff/robot.tsx` defines everything once per page.

- **Ceramic:** shaded as a form, lit from above left with blue thrown back from below and shadow where parts meet. A very fine grain keeps it from looking like flat vector. Panel lines are cut in: a dark line with a lit one beside it.
- **Glass:** the visor is a dot-matrix screen under curved glass, in a dark bezel, with an inset shadow and a glare across the top.
- **Metal:** gunmetal joints, a steel collar around a woven neck well, a dark chest plate with a lens over the status lamp, and vents low on the torso.
- **Tools:** brass, leather, paper and glass, each with its own highlights.
- **Light:** the lamp and a pool under the robot glow brass while it works. The status light in each ear keeps the state readable at head-only sizes. The wall behind is plain, with only a soft light from above: texture belongs to the robots, and grain on the wall reads as noise.

Grain comes from one small tile the browser draws once. Keep textures in that tile or in `<pattern>`s: an SVG filter on anything that animates would redraw every frame.

## Tokens

- **Colour:** cool stone by day (`#f3f5f3`), deep petrol at night (`#122c32`). Petrol for actions by day, brass at night. Today's wall is petrol (`#0f2f35`) in both schemes; `.signal-wall` resets the tokens inside it, and all its text meets 7:1. The robots' white and blue stand out against it. Their lamp is the only status colour: brass working, coral stopped, green done.
- **Type:** Switzer for titles, a neutral Swiss-style sans at medium and semibold weights with tight spacing. IBM Plex Sans for everything people read closely: its more distinct letterforms hold up at small sizes, set it apart from Switzer, and it has matching Arabic, Devanagari, Japanese and Korean cuts. The `font-display` utility sets titles. Switzer's licence allows self-hosting but not redistribution or offering it as a choice, so its files aren't committed and it stays out of the resume themes (see `src/fonts/README.md`).
- **Radius:** controls 6px, cards and notes 8px, panels 12px, dialogs 14px.

## Where they show up

- **Today:** the seven on the wall, then "For your review": real things waiting on the user. The funnel and calendar follow.
- **An agent's screen:** its robot's head beside the title, in its current mood.
- **Sidebar:** "At work now" shows who's working on every screen but Today, which shows it already, and disappears when no one is. Their section carries a small brass mark.
- **Job progress:** the robot's head, its title and the job's own step, in place of a spinner.
- **Notes:** a short note from whoever finished, linked to the result.
- **Sign-in:** the seven, waiting, with one sentence on what the product is.

## Floor

Robots are decorative to assistive technology: each one is a real link with its status in words, and a live region says who's working. Moods read without motion (eyes, mouth, lamp and arm pose all change), so reduced motion keeps the state and drops the movement. On a phone they become a list, with each robot beside its words.

## What to keep out

No extra characters, speech, jokes or sound. No bouncing, confetti or celebration beyond the brief wave. No colour per robot. No movement that suggests work when none is running. Nothing on the panel that isn't about right now: no boxes around robots, no histories, no captions. No changes of size or position: alignment is what makes it read as professional.
