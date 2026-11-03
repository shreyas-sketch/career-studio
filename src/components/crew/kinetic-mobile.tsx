"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { CREW, CREW_IDS, describeWork, type CrewId, type CrewMemberState } from "@/lib/crew/crew";
import { Mobile, type RigPose } from "@/lib/crew/physics";

import { useCrew } from "./crew-provider";
import { BODIES, crewFill, CrewEye, CrewGlyph } from "./shapes";

const WIDTH = 1180;
const HEIGHT = 560;
/** The drawing's scale in the space it's given: a tag's place is a share of the container's width. */
const cqw = (value: number) => `${((value / WIDTH) * 100).toFixed(3)}cqw`;
const TAG_DROP = 96;
const TAG_HALF = 75;
/** The shapes' size on the wall; with no tags to make room for, they can be larger. */
const SHAPE_SCALE = 0.74;
const BARE_SHAPE_SCALE = 1;

const ago = (iso: string, now: number) => {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
};

/** What the tag under a member says: only what's true of them now. */
function TagLine({ member }: { member: CrewMemberState }) {
  // The clock only runs in the browser, so the server's page and the first render agree.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  if (member.status === "working") return <>{member.step ?? "Getting started"}{member.about ? ` for ${member.about}` : ""}</>;
  if (member.status === "queued") return <>About to start{member.about ? ` for ${member.about}` : ""}</>;
  if (member.status === "stuck") return <span className="text-error">Stuck: {member.error ?? "this needs another try"}</span>;
  if (member.last && now !== null) return <>{member.last.what}{member.last.about ? ` for ${member.last.about}` : ""}, {ago(member.last.at, now)}</>;
  return <>{CREW[member.id].trade}</>;
}

/**
 * The crew as one balanced sculpture. It's real mechanics over real work: each
 * member's weight comes from the jobs they have in hand, so a job starting
 * tips an arm and sets the rest moving; each step the job names plucks their
 * wire; when it ends they lift again. Between jobs only the air moves them.
 * They watch the pointer, and look down at their work while they're on it.
 */
export function KineticMobile({ bare = false, className, children }: { bare?: boolean; className?: string; children?: ReactNode }) {
  const { members } = useCrew();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef<SVGSVGElement>(null);
  const shadowRef = useRef<SVGUseElement>(null);
  const wireRefs = useRef<(SVGLineElement | null)[]>([]);
  const beamRefs = useRef<(SVGPathElement | null)[]>([]);
  const knotRefs = useRef<(SVGCircleElement | null)[]>([]);
  const shapeRefs = useRef(new Map<CrewId, SVGGElement | null>());
  const eyeRefs = useRef(new Map<CrewId, SVGGElement | null>());
  const pupilRefs = useRef(new Map<CrewId, SVGCircleElement | null>());
  const tagRefs = useRef(new Map<CrewId, HTMLElement | null>());
  const threadRefs = useRef(new Map<CrewId, SVGLineElement | null>());
  const attention = useRef(new Map<CrewId, number>());

  const mobile = useMemo(() => new Mobile(), []);
  // Hung at rest for the first paint; the server and the browser draw the same.
  const [rest] = useState<RigPose>(() => new Mobile().settle());
  const membersRef = useRef(members);
  const lastSteps = useRef(new Map<CrewId, string | null>());
  const uid = bare ? "mobile-bare" : "mobile";
  const size = bare ? BARE_SHAPE_SCALE : SHAPE_SCALE;

  useEffect(() => {
    membersRef.current = members;
    for (const id of CREW_IDS) {
      const member = members[id];
      mobile.setWork(id, member.status === "working" ? Math.max(1, member.jobs) : member.status === "queued" ? 0.5 : 0);
      mobile.setStuck(id, member.status === "stuck");
      // A new step is an event: you see it land on the wire.
      const previous = lastSteps.current.get(id);
      if (previous !== undefined && previous !== member.step) mobile.pluck(id, member.step ? 1.2 : 2);
      lastSteps.current.set(id, member.step);
    }
  }, [members, mobile]);

  // The room's light follows the user's clock: shadows lean with the time of day.
  useEffect(() => {
    const hour = new Date().getHours() + new Date().getMinutes() / 60;
    const lean = Math.max(-1, Math.min(1, (hour - 13) / 7));
    shadowRef.current?.setAttribute("transform", `translate(${(lean * 46).toFixed(1)} 30)`);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const pointer = { x: -1, y: -1, vx: 0, vy: 0, lastX: 0, lastY: 0, at: 0, seen: 0 };
    const look = new Map<CrewId, { x: number; y: number; open: number; nextBlink: number; blink: number }>();
    for (const id of CREW_IDS) look.set(id, { x: 0, y: 0, open: 1, nextBlink: 2 + Math.random() * 6, blink: 0 });

    const draw = (pose: RigPose, dt: number, time: number) => {
      pose.wires.forEach((wire, index) => {
        const line = wireRefs.current[index];
        line?.setAttribute("x1", wire.x1.toFixed(2));
        line?.setAttribute("y1", wire.y1.toFixed(2));
        line?.setAttribute("x2", wire.x2.toFixed(2));
        line?.setAttribute("y2", wire.y2.toFixed(2));
      });
      pose.beams.forEach((beam, index) => {
        beamRefs.current[index]?.setAttribute("d", beam.d);
        knotRefs.current[index]?.setAttribute("cx", beam.px.toFixed(2));
        knotRefs.current[index]?.setAttribute("cy", beam.py.toFixed(2));
      });
      for (const shape of pose.shapes) {
        shapeRefs.current
          .get(shape.id)
          ?.setAttribute("transform", `translate(${shape.x.toFixed(2)} ${shape.y.toFixed(2)}) rotate(${((-shape.rot * 180) / Math.PI).toFixed(2)}) scale(${(shape.sx * size).toFixed(3)} ${(shape.sy * size).toFixed(3)})`);

        const tag = tagRefs.current.get(shape.id);
        const tagX = Math.max(TAG_HALF, Math.min(WIDTH - TAG_HALF, shape.x));
        const tagY = shape.y + TAG_DROP;
        if (tag) {
          tag.style.setProperty("--tx", cqw(tagX - TAG_HALF));
          tag.style.setProperty("--ty", cqw(tagY));
        }
        const thread = threadRefs.current.get(shape.id);
        thread?.setAttribute("x1", shape.x.toFixed(2));
        thread?.setAttribute("y1", (shape.y + 40).toFixed(2));
        thread?.setAttribute("x2", tagX.toFixed(2));
        thread?.setAttribute("y2", tagY.toFixed(2));

        // Where they're looking: at their work while they're on it, else at
        // whoever reached for them, else at the pointer, else nowhere much.
        const state = look.get(shape.id)!;
        const { eye } = BODIES[shape.id];
        const held = attention.current.get(shape.id) ?? 0;
        const pointerNear = time - pointer.seen < 4 && pointer.x >= 0;
        let wantX = 0.5 * Math.sin(time * 0.17 + shape.x);
        let wantY = 0.5 * Math.cos(time * 0.13 + shape.x);
        if (shape.work > 0.5 && !held) {
          wantX = shape.look.x;
          wantY = shape.look.y;
        } else if (pointerNear) {
          const dx = pointer.x - shape.x;
          const dy = pointer.y - (shape.y + eye.y * size);
          const distance = Math.max(1, Math.hypot(dx, dy));
          const pull = Math.min(1, distance / 60);
          wantX = (dx / distance) * pull;
          wantY = (dy / distance) * pull;
        }
        const ease = Math.min(1, dt * (held ? 12 : 5));
        state.x += (wantX - state.x) * ease;
        state.y += (wantY - state.y) * ease;
        pupilRefs.current.get(shape.id)?.setAttribute("cx", (state.x * eye.r * 0.42).toFixed(2));
        pupilRefs.current.get(shape.id)?.setAttribute("cy", (state.y * eye.r * 0.42).toFixed(2));

        state.nextBlink -= dt;
        if (state.nextBlink <= 0) {
          state.blink = 0.14;
          // They blink less when they're concentrating.
          state.nextBlink = (shape.work > 0.5 ? 5 : 2.5) + Math.random() * 5;
        }
        state.blink = Math.max(0, state.blink - dt);
        const wide = held ? 1.14 : 1;
        const lid = state.blink > 0 ? 0.08 : 1;
        state.open += (lid * wide - state.open) * Math.min(1, dt * 30);
        eyeRefs.current.get(shape.id)?.setAttribute("transform", `scale(${wide.toFixed(3)} ${state.open.toFixed(3)})`);
      }
    };

    let frame = 0;
    let last = 0;
    let time = 0;
    let latest = rest;
    let visible = true;

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (!visible) {
        last = now;
        return;
      }
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60;
      last = now;
      time += dt;
      // Two steps a frame keep the fast swings steady.
      mobile.step(dt / 2);
      latest = mobile.step(dt / 2);
      if (pointer.vx || pointer.vy) {
        mobile.breeze(latest, pointer.x, pointer.y, pointer.vx, pointer.vy);
        pointer.vx *= 0.8;
        pointer.vy *= 0.8;
        if (Math.abs(pointer.vx) + Math.abs(pointer.vy) < 2) pointer.vx = pointer.vy = 0;
      }
      draw(latest, dt, time);
    };

    const onMove = (event: PointerEvent) => {
      const box = (drawingRef.current ?? root).getBoundingClientRect();
      const scale = WIDTH / box.width;
      const x = (event.clientX - box.left) * scale;
      const y = (event.clientY - box.top) * scale;
      const elapsed = Math.max(8, event.timeStamp - pointer.at);
      if (pointer.at) {
        pointer.vx = Math.max(-1600, Math.min(1600, ((x - pointer.x) / elapsed) * 1000));
        pointer.vy = Math.max(-1600, Math.min(1600, ((y - pointer.y) / elapsed) * 1000));
      }
      pointer.x = x;
      pointer.y = y;
      pointer.at = event.timeStamp;
      pointer.seen = time;
    };

    const start = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      if (still?.matches) {
        // No motion: hang where the weights put them, and stay there.
        mobile.setWind(0);
        draw(mobile.settle(), 1, 0);
        return;
      }
      mobile.setWind(1);
      last = 0;
      window.addEventListener("pointermove", onMove, { passive: true });
      frame = requestAnimationFrame(loop);
    };

    // Off screen it doesn't need to move.
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => (visible = entry?.isIntersecting ?? true));
    observer?.observe(root);
    still?.addEventListener?.("change", start);
    start();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      still?.removeEventListener?.("change", start);
      observer?.disconnect();
    };
  }, [mobile, rest, size]);

  const reach = (id: CrewId) => {
    attention.current.set(id, 1);
    mobile.pluck(id, 0.5);
  };
  const leave = (id: CrewId) => attention.current.set(id, 0);

  const speaking = CREW_IDS.map((id) => members[id]).filter(({ status }) => status === "working");

  return (
    <div ref={rootRef} className={cn("@container/mobile relative", bare ? className : "w-full")}>
      <svg
        ref={drawingRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        aria-hidden="true"
        // Too narrow for all of it: a closer look at the middle, which the wall crops. The list below names everyone.
        className={cn("block h-auto overflow-visible", bare ? "w-full" : "w-full @max-[979px]/mobile:-mb-[34cqw] @max-[979px]/mobile:-ml-[48cqw] @max-[979px]/mobile:w-[196cqw]")}
      >
        {/* Cast on the wall by the room's light, as flat as cut paper. */}
        <use
          ref={shadowRef}
          href={`#${uid}-body`}
          transform="translate(0 30)"
          style={{ "--shape-fill": "var(--color-wall-shadow)", "--eye-fill": "transparent", "--pupil-fill": "transparent", pointerEvents: "none" } as React.CSSProperties}
        />
        {!bare &&
          rest.shapes.map((shape) => (
            <line
              key={shape.id}
              ref={(element) => {
                threadRefs.current.set(shape.id, element);
              }}
              x1={shape.x.toFixed(2)}
              y1={(shape.y + 40).toFixed(2)}
              x2={Math.max(TAG_HALF, Math.min(WIDTH - TAG_HALF, shape.x)).toFixed(2)}
              y2={(shape.y + TAG_DROP).toFixed(2)}
              className="hidden @min-[980px]/mobile:inline"
              style={{ stroke: "var(--color-wire)", strokeWidth: 0.8, opacity: 0.55 }}
            />
          ))}
        <g id={`${uid}-body`}>
          {rest.wires.map((wire, index) => (
            <line
              key={index}
              ref={(element) => {
                wireRefs.current[index] = element;
              }}
              x1={wire.x1.toFixed(2)}
              y1={wire.y1.toFixed(2)}
              x2={wire.x2.toFixed(2)}
              y2={wire.y2.toFixed(2)}
              style={{ stroke: "var(--shape-fill, var(--color-wire))", strokeWidth: 1.2 }}
            />
          ))}
          {rest.beams.map((beam, index) => (
            <path
              key={index}
              ref={(element) => {
                beamRefs.current[index] = element;
              }}
              d={beam.d}
              fill="none"
              strokeLinecap="round"
              style={{ stroke: "var(--shape-fill, var(--color-wire))", strokeWidth: 2 }}
            />
          ))}
          {rest.beams.map((beam, index) => (
            <circle
              key={index}
              ref={(element) => {
                knotRefs.current[index] = element;
              }}
              cx={beam.px.toFixed(2)}
              cy={beam.py.toFixed(2)}
              r={3}
              style={{ fill: "var(--shape-fill, var(--color-wire))" }}
            />
          ))}
          {rest.shapes.map((shape) => (
            <g
              key={shape.id}
              ref={(element) => {
                shapeRefs.current.set(shape.id, element);
              }}
              transform={`translate(${shape.x.toFixed(2)} ${shape.y.toFixed(2)}) scale(${size})`}
              className={bare ? undefined : "cursor-pointer"}
              onPointerEnter={bare ? undefined : () => reach(shape.id)}
              onPointerLeave={bare ? undefined : () => leave(shape.id)}
              onClick={bare ? undefined : () => router.push(CREW[shape.id].href)}
            >
              <path d={BODIES[shape.id].path} style={{ fill: crewFill(shape.id) }} />
              <CrewEye
                id={shape.id}
                eyeRef={(element) => {
                  eyeRefs.current.set(shape.id, element);
                }}
                pupilRef={(element) => {
                  pupilRefs.current.set(shape.id, element);
                }}
              />
            </g>
          ))}
        </g>
      </svg>

      {children}

      {!bare && (
        <>
          {/* In a wide space each tag hangs from its member; in a narrow one they make a plain list. */}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,230px),1fr))] gap-2 px-4 pb-6 @min-[980px]/mobile:contents">
            {rest.shapes.map((shape) => {
              const member = members[shape.id];
              const working = member.status === "working";
              return (
                <li key={shape.id} className="@min-[980px]/mobile:contents">
                  <Link
                    href={CREW[shape.id].href}
                    ref={(element) => {
                      tagRefs.current.set(shape.id, element);
                    }}
                    onPointerEnter={() => reach(shape.id)}
                    onPointerLeave={() => leave(shape.id)}
                    onFocus={() => reach(shape.id)}
                    onBlur={() => leave(shape.id)}
                    data-status={member.status}
                    style={
                      {
                        "--tx": cqw(Math.max(TAG_HALF, Math.min(WIDTH - TAG_HALF, shape.x)) - TAG_HALF),
                        "--ty": cqw(shape.y + TAG_DROP),
                        "--tag-ink": `var(--color-crew-${shape.id})`,
                      } as React.CSSProperties
                    }
                    className={cn(
                      "flex flex-col gap-0.5 rounded-toast border border-line-card bg-card px-2.5 py-2 text-ink shadow-control hover:text-ink",
                      "@min-[980px]/mobile:absolute @min-[980px]/mobile:top-0 @min-[980px]/mobile:left-0 @min-[980px]/mobile:w-[12.7cqw] @min-[980px]/mobile:[transform:translate(var(--tx),var(--ty))] @min-[980px]/mobile:will-change-transform",
                      working && "border-[color:var(--tag-ink)]",
                    )}
                  >
                    <span className="flex items-center gap-1.5 font-serif text-[15px] leading-tight font-medium">
                      <CrewGlyph id={shape.id} status={member.status} size={18} className="@min-[980px]/mobile:hidden" />
                      {CREW[shape.id].name}
                    </span>
                    <span className="line-clamp-3 text-xs leading-snug text-pretty text-muted">
                      <TagLine member={member} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {/* Said once for people who can't see it move. */}
          <p role="status" aria-live="polite" className="sr-only">
            {speaking.map(describeWork).join(" ")}
          </p>
        </>
      )}
    </div>
  );
}
