import { cn } from "@/lib/cn";
import type { CrewId, CrewStatus } from "@/lib/crew/crew";

// The crew's bodies: cut-out shapes, each hung from (0, 0), the top of the
// shape. Colours are tokens, so they turn over with the colour scheme, and
// --shape-fill overrides them all where a shape is drawn as its own shadow.

type Body = { path: string; eye: { x: number; y: number; r: number } };

export const BODIES: Record<CrewId, Body> = {
  // A dart: all forward motion.
  scout: { path: "M0 0C30 8 68 34 80 74C42 90-10 88-48 62C-46 34-26 10 0 0Z", eye: { x: 14, y: 46, r: 11 } },
  // A crescent, the curve of a pair of shears.
  tailor: { path: "M0 0C50 6 80 48 64 92C56 112 34 124 8 122C36 102 30 72 12 50C4 36 0 18 0 0Z", eye: { x: 44, y: 76, r: 9 } },
  // A round head with a word on its way out.
  interviewer: { path: "M0 2A46 46 0 1 1-28 86L-54 106-42 70A46 46 0 0 1 0 2Z", eye: { x: 6, y: 46, r: 13 } },
  // A bean, soft and steady.
  usher: { path: "M-10 0C32-6 66 20 58 54C50 76 22 70 14 84C4 100-34 104-52 78C-72 46-48 6-10 0Z", eye: { x: -6, y: 38, r: 12 } },
  // A spade.
  prospector: { path: "M0 0L54 54C62 74 32 104 0 110C-32 104-62 74-54 54Z", eye: { x: 0, y: 62, r: 12 } },
  // A lozenge: two equal sides.
  appraiser: { path: "M0 0C20 20 50 38 68 50C50 62 20 82 0 104C-20 82-50 62-68 50C-50 38-20 20 0 0Z", eye: { x: 0, y: 50, r: 12 } },
  // A sprout.
  coach: { path: "M0 0C44-2 72 28 62 66C48 68 26 62 9 48C11 72 7 92 0 110C-7 92-11 72-9 48C-26 62-48 68-62 66C-72 28-44-2 0 0Z", eye: { x: 0, y: 28, r: 11 } },
};

const FILLS: Record<CrewId, string> = {
  scout: "var(--color-crew-scout)",
  tailor: "var(--color-crew-tailor)",
  interviewer: "var(--color-crew-interviewer)",
  usher: "var(--color-crew-usher)",
  prospector: "var(--color-crew-prospector)",
  appraiser: "var(--color-crew-appraiser)",
  coach: "var(--color-crew-coach)",
};

export const crewFill = (id: CrewId) => `var(--shape-fill, ${FILLS[id]})`;

/** The eye: a hole cut in the shape, and a pupil in it that looks at things. */
export function CrewEye({ id, eyeRef, pupilRef }: { id: CrewId; eyeRef?: (element: SVGGElement | null) => void; pupilRef?: (element: SVGCircleElement | null) => void }) {
  const { x, y, r } = BODIES[id].eye;
  return (
    <g transform={`translate(${x} ${y})`}>
      <g ref={eyeRef}>
        <circle r={r} style={{ fill: "var(--eye-fill, var(--color-surface))" }} />
        <circle ref={pupilRef} r={r * 0.46} style={{ fill: "var(--pupil-fill, var(--color-crew-pupil))" }} />
      </g>
    </g>
  );
}

/**
 * A member at small sizes: the sidebar, a slip, a progress line. It swings
 * from the top of its shape while they work. Decorative: put the words next to it.
 */
export function CrewGlyph({ id, size = 16, status, eye = false, className }: { id: CrewId; size?: number; status?: CrewStatus; eye?: boolean; className?: string }) {
  return (
    <svg
      viewBox="-76 -6 160 134"
      width={size}
      height={size}
      aria-hidden="true"
      data-crew-status={status}
      className={cn("shrink-0 overflow-visible", className)}
    >
      <g
        className={cn(
          status === "working" && "motion-safe:animate-crew-swing",
          status === "queued" && "motion-safe:animate-crew-wait",
          status === "stuck" && "rotate-[14deg]",
        )}
        style={{ transformOrigin: "0 0", transformBox: "view-box" }}
      >
        <path d={BODIES[id].path} style={{ fill: crewFill(id) }} />
        {eye && <CrewEye id={id} />}
      </g>
    </svg>
  );
}
