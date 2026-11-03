"use client";

import { useEffect, useRef } from "react";

import type { CrewId } from "@/lib/crew/crew";

import { useCrew } from "./crew-provider";
import { BODIES, CrewEye, crewFill } from "./shapes";

const WIRE = 34;
const SCALE = 0.36;

/**
 * The member whose screen this is, hanging from the top of the panel beside
 * the title. A pendulum: the pointer's movement pushes it, a step of their
 * work plucks it, and they look at the pointer unless they're busy.
 */
export function CrewPendant({ id }: { id: CrewId }) {
  const member = useCrew().members[id];
  const rootRef = useRef<SVGSVGElement>(null);
  const swingRef = useRef<SVGGElement>(null);
  const pupilRef = useRef<SVGCircleElement>(null);
  const statusRef = useRef(member.status);
  const velocity = useRef(0);

  useEffect(() => {
    if (statusRef.current !== member.status || member.step) velocity.current += 1.1;
    statusRef.current = member.status;
  }, [member.status, member.step]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let last = 0;
    let angle = 0;
    let pointerX = 0;
    let pointerY = 0;
    let seen = false;
    let lookX = 0;
    let lookY = 0;
    let time = 0;
    const { eye } = BODIES[id];

    const onMove = (event: PointerEvent) => {
      const box = root.getBoundingClientRect();
      const x = event.clientX - box.left - box.width / 2;
      if (seen) velocity.current += Math.max(-0.5, Math.min(0.5, (x - pointerX) * 0.004)) * Math.max(0, 1 - Math.abs(x) / 500);
      pointerX = x;
      pointerY = event.clientY - box.top - WIRE - 18;
      seen = true;
    };
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60;
      last = now;
      time += dt;
      const working = statusRef.current === "working";
      const air = 0.05 * Math.sin(time * 0.7) + 0.03 * Math.sin(time * 1.9 + 1) + (working ? 0.9 * Math.sin(time * 3.1) : 0);
      velocity.current += (-14 * Math.sin(angle) - 0.8 * velocity.current + air) * dt;
      angle += velocity.current * dt;
      swingRef.current?.setAttribute("transform", `translate(30 0) rotate(${((-angle * 180) / Math.PI).toFixed(2)})`);

      const distance = Math.max(1, Math.hypot(pointerX, pointerY));
      const wantX = working ? 0 : seen ? pointerX / distance : 0;
      const wantY = working ? 1 : seen ? pointerY / distance : 0;
      lookX += (wantX - lookX) * Math.min(1, dt * 6);
      lookY += (wantY - lookY) * Math.min(1, dt * 6);
      pupilRef.current?.setAttribute("cx", (lookX * eye.r * 0.42).toFixed(2));
      pupilRef.current?.setAttribute("cy", (lookY * eye.r * 0.42).toFixed(2));
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, [id]);

  return (
    // Centred on the title, this tall it reaches up to the top of the panel; the margins keep it from pushing the bar taller.
    <svg ref={rootRef} viewBox="0 0 60 104" aria-hidden="true" className="-my-[28px] -ml-2 -mr-1 h-[104px] w-[60px] shrink-0 overflow-visible">
      <g ref={swingRef} transform="translate(30 0)">
        <line x1="0" y1="0" x2="0" y2={WIRE} style={{ stroke: "var(--color-wire)", strokeWidth: 1.2 }} />
        <g transform={`translate(0 ${WIRE}) scale(${SCALE})`}>
          <path d={BODIES[id].path} style={{ fill: crewFill(id) }} />
          <CrewEye id={id} pupilRef={(element) => void (pupilRef.current = element)} />
        </g>
      </g>
    </svg>
  );
}
