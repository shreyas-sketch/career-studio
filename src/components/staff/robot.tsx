"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { STAFF_IDS, type StaffId, type StaffMood } from "@/lib/staff/staff";

import styles from "./robot.module.css";

/** A tile of fine grain, drawn once by the browser and repeated across the shells. */
const GRAIN =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.16 0 0 0 0 0.2 0 0 0 0 0.34 0 0 0 0.75 -0.34"/></filter><rect width="96" height="96" filter="url(#n)"/></svg>`,
  );

const stops = (...values: [number, string, number?][]) =>
  values.map(([offset, color, opacity]) => <stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />);

/**
 * Everything the robots are made of, once per page: ceramic, gunmetal, brass,
 * glass and light. Render it once, somewhere above any robot. It takes no room,
 * and it can't be display:none, or browsers stop painting what refers to it.
 */
export function RobotMaterials() {
  return (
    <svg aria-hidden="true" width="0" height="0" className="absolute">
      <defs>
        {/* Ceramic */}
        <linearGradient id="rb-shell" x1="0.22" y1="0" x2="0.78" y2="1">{stops([0, "#ffffff"], [0.42, "#f5f7fc"], [0.74, "#dfe5f3"], [1, "#a9b8da"])}</linearGradient>
        <linearGradient id="rb-torso" x1="0.1" y1="0" x2="0.9" y2="1">{stops([0, "#ffffff"], [0.38, "#f4f6fb"], [0.72, "#d6deef"], [1, "#8fa1c9"])}</linearGradient>
        <linearGradient id="rb-limb" x1="0" y1="0" x2="1" y2="1">{stops([0, "#ffffff"], [0.5, "#e6ebf6"], [1, "#9fafd2"])}</linearGradient>
        <linearGradient id="rb-edge" x1="0" y1="0" x2="0" y2="1">{stops([0, "#ffffff"], [0.55, "#c6d1e8"], [1, "#7c8fb9"])}</linearGradient>
        <linearGradient id="rb-core" x1="0" y1="0" x2="1" y2="0">{stops([0, "#6b80ad", 0.22], [0.2, "#6b80ad", 0], [0.72, "#4f648f", 0], [1, "#4f648f", 0.42])}</linearGradient>
        <radialGradient id="rb-key">{stops([0, "#ffffff", 0.95], [1, "#ffffff", 0])}</radialGradient>
        <radialGradient id="rb-bounce">{stops([0, "#86a8ff", 0.5], [1, "#86a8ff", 0])}</radialGradient>
        <radialGradient id="rb-occlusion">{stops([0, "#253559", 0.55], [1, "#253559", 0])}</radialGradient>
        <pattern id="rb-grain" width="96" height="96" patternUnits="userSpaceOnUse" patternTransform="scale(0.62)">
          <image href={GRAIN} width="96" height="96" />
        </pattern>

        {/* Metal */}
        <linearGradient id="rb-gunmetal" x1="0" y1="0" x2="0" y2="1">{stops([0, "#5a667e"], [0.3, "#232b3e"], [0.62, "#3c475e"], [1, "#10162a"])}</linearGradient>
        <linearGradient id="rb-bezel" x1="0" y1="0" x2="0" y2="1">{stops([0, "#080e1e"], [0.55, "#1b2640"], [1, "#55637f"])}</linearGradient>
        <linearGradient id="rb-steel" x1="0" y1="0" x2="1" y2="1">{stops([0, "#f0f3f9"], [0.4, "#a3afc6"], [0.62, "#dbe1ec"], [1, "#77839c"])}</linearGradient>
        <radialGradient id="rb-knob" cx="0.36" cy="0.3" r="0.8">{stops([0, "#f8faff"], [0.45, "#aab6cd"], [1, "#4f5b74"])}</radialGradient>
        <radialGradient id="rb-joint" cx="0.38" cy="0.32" r="0.8">{stops([0, "#7b879f"], [0.5, "#2c3548"], [1, "#0f1526"])}</radialGradient>
        <pattern id="rb-mesh" width="2.6" height="2.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="1" height="2.6" fill="#2a3448" fillOpacity="0.5" />
          <rect width="2.6" height="1" fill="#2a3448" fillOpacity="0.5" />
        </pattern>
        <pattern id="rb-brush" width="160" height="1.5" patternUnits="userSpaceOnUse">
          <rect width="160" height="0.5" fill="#fff" fillOpacity="0.09" />
        </pattern>
        <pattern id="rb-weave" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" fill="#141b2e" />
          <rect width="2" height="2" fill="#2a344c" />
          <rect x="2" y="2" width="2" height="2" fill="#2a344c" />
        </pattern>

        {/* Brass, leather, paper */}
        <linearGradient id="rb-brass" x1="0" y1="0" x2="1" y2="1">{stops([0, "#fbe7ad"], [0.34, "#d3a23a"], [0.6, "#8c6417"], [0.82, "#e6c26e"], [1, "#a97f28"])}</linearGradient>
        <linearGradient id="rb-leather" x1="0" y1="0" x2="1" y2="1">{stops([0, "#6a4630"], [1, "#2a1810"])}</linearGradient>
        <linearGradient id="rb-paper" x1="0" y1="0" x2="1" y2="1">{stops([0, "#ffffff"], [1, "#dfe5f1"])}</linearGradient>
        <linearGradient id="rb-tablet" x1="0" y1="0" x2="1" y2="1">{stops([0, "#2a3656"], [1, "#0a1020"])}</linearGradient>
        <radialGradient id="rb-lens" cx="0.4" cy="0.36" r="0.72">{stops([0, "#f4f9ff", 0.75], [0.6, "#a9c8f4", 0.5], [1, "#2f4f8f", 0.8])}</radialGradient>

        {/* Glass and light */}
        <linearGradient id="rb-visor" x1="0.1" y1="0" x2="0.9" y2="1">{stops([0, "#3566e6"], [0.5, "#1a3596"], [1, "#0a1650"])}</linearGradient>
        <linearGradient id="rb-inset" x1="0" y1="0" x2="0" y2="1">{stops([0, "#030818", 0.75], [0.3, "#030818", 0])}</linearGradient>
        <linearGradient id="rb-glare" x1="0" y1="0" x2="0.6" y2="1">{stops([0, "#ffffff", 0.42], [1, "#ffffff", 0])}</linearGradient>
        <radialGradient id="rb-screen">{stops([0, "#6f9dff", 0.6], [1, "#6f9dff", 0])}</radialGradient>
        <linearGradient id="rb-eye" x1="0" y1="0" x2="0" y2="1">{stops([0, "#ffffff"], [1, "#c5d9ff"])}</linearGradient>
        <radialGradient id="rb-halo">{stops([0, "#a8c6ff", 0.6], [1, "#a8c6ff", 0])}</radialGradient>
        <linearGradient id="rb-scan" x1="0" y1="0" x2="1" y2="0">{stops([0, "#bcd2ff", 0], [0.5, "#d5e3ff", 0.55], [1, "#bcd2ff", 0])}</linearGradient>
        <pattern id="rb-dots" width="3.2" height="3.2" patternUnits="userSpaceOnUse">
          <circle cx="1.6" cy="1.6" r="0.62" fill="#c8dbff" fillOpacity="0.2" />
        </pattern>
        <radialGradient id="rb-glow-work">{stops([0, "#f5c765", 0.85], [1, "#f5c765", 0])}</radialGradient>
        <radialGradient id="rb-glow-stop">{stops([0, "#ff8a70", 0.85], [1, "#ff8a70", 0])}</radialGradient>
        <radialGradient id="rb-glow-done">{stops([0, "#7fe0ae", 0.85], [1, "#7fe0ae", 0])}</radialGradient>
        <radialGradient id="rb-lift">{stops([0, "#8fb6ff", 0.7], [1, "#8fb6ff", 0])}</radialGradient>
        <radialGradient id="rb-floor">{stops([0, "#02060f", 0.6], [0.6, "#02060f", 0.22], [1, "#02060f", 0])}</radialGradient>
        <linearGradient id="rb-gloss" x1="0" y1="0" x2="0" y2="1">{stops([0, "#ffffff", 0.75], [0.6, "#ffffff", 0])}</linearGradient>

        <clipPath id="rb-clip-shell"><rect x="49" y="15" width="102" height="90" rx="45" /></clipPath>
        <clipPath id="rb-clip-visor"><rect x="61" y="29" width="78" height="60" rx="27" /></clipPath>
        <clipPath id="rb-clip-torso"><path d={TORSO} /></clipPath>
      </defs>
    </svg>
  );
}

const TORSO = "M58 122C56 168 74 217 96 227q4 2 8 0c22-10 40-59 38-105-14 10-70 10-84 0z";
const url = (id: string) => `url(#rb-${id})`;
const PAPER_LINE = "#c3cde2";

/** What each one always holds, and how it uses it. Each moves only while its robot is working. */
const TOOLS: Record<StaffId, ReactNode> = {
  // A brass-rimmed glass, for the search analyst.
  search: (
    <g className={styles.sweep}>
      <path d="M2 13L-9 26" stroke={url("leather")} strokeWidth="7" strokeLinecap="round" />
      <path d="M5 9.5L1.5 13.5" stroke={url("brass")} strokeWidth="7.5" />
      <circle cx="16" cy="-4" r="15" fill={url("lens")} />
      <circle cx="16" cy="-4" r="15" fill="none" stroke={url("brass")} strokeWidth="4.4" />
      <circle cx="16" cy="-4" r="12.6" fill="none" stroke="#5e4310" strokeOpacity="0.5" strokeWidth="0.7" />
      <path d="M7-9a10.5 10.5 0 0 1 9-5.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeOpacity="0.95" />
      <circle cx="23" cy="3.5" r="1.3" fill="#fff" fillOpacity="0.8" />
    </g>
  ),
  // A sheet and a fountain pen, for the resume editor.
  editor: (
    <g>
      <rect x="-4" y="-19" width="36" height="46" rx="2.5" fill="#0a1226" fillOpacity="0.25" />
      <rect x="-6" y="-22" width="36" height="46" rx="2.5" fill={url("paper")} stroke={PAPER_LINE} strokeWidth="0.8" />
      <rect x="-6" y="-22" width="36" height="46" rx="2.5" fill={url("grain")} />
      <rect x="0" y="-17" width="13" height="3" rx="1" fill="#1b3a6b" />
      <line className={styles.writeA} x1="0" y1="-8" x2="24" y2="-8" stroke="#3d5688" strokeWidth="1.7" strokeLinecap="round" />
      <line className={styles.writeB} x1="0" y1="-1.5" x2="24" y2="-1.5" stroke="#7f93bb" strokeWidth="1.7" strokeLinecap="round" />
      <line className={styles.writeC} x1="0" y1="5" x2="24" y2="5" stroke="#7f93bb" strokeWidth="1.7" strokeLinecap="round" />
      <line className={styles.writeD} x1="0" y1="11.5" x2="15" y2="11.5" stroke="#7f93bb" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M33-2l5 3.6L25 19l-6.4 3.2.8-7z" fill={url("gunmetal")} />
      <path d="M25 19l-6.4 3.2.8-7 2.3 1.7z" fill={url("brass")} />
    </g>
  ),
  // A handheld microphone, for the interview coach.
  coach: (
    <g>
      <path d="M-4.5-9h9l-1.5 36a3 3 0 0 1-6 0z" fill={url("steel")} stroke="#5d6a85" strokeWidth="0.6" />
      <rect x="-4.2" y="4" width="8.4" height="5" fill={url("gunmetal")} />
      <rect x="-5" y="-11" width="10" height="4.5" rx="1" fill={url("brass")} />
      <circle cy="-20" r="12" fill={url("knob")} />
      <circle cy="-20" r="12" fill={url("mesh")} />
      <path d="M-11.5-17.5q11.5 5 23 0" fill="none" stroke="#3a465f" strokeWidth="1.4" />
      <path d="M-7-27a9 9 0 0 1 8-3" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.9" />
      <path className={styles.soundA} d="M16-27a11 11 0 0 1 0 14" fill="none" stroke={url("brass")} strokeWidth="2.4" strokeLinecap="round" />
      <path className={styles.soundB} d="M22-32a18 18 0 0 1 0 24" fill="none" stroke={url("brass")} strokeWidth="2.4" strokeLinecap="round" />
    </g>
  ),
  // A leather board with a brass clip, for the interview coordinator.
  coordinator: (
    <g>
      <rect x="-8" y="-22" width="42" height="50" rx="4" fill={url("leather")} />
      <rect x="-8" y="-22" width="42" height="50" rx="4" fill={url("grain")} />
      <rect x="-4.5" y="-16" width="35" height="41" rx="1.5" fill={url("paper")} />
      <rect x="4" y="-26" width="18" height="9" rx="2.5" fill={url("brass")} />
      <circle cx="13" cy="-23" r="1.4" fill="#5e4310" />
      <path className={styles.tickA} d="M-1-6l3 3 5-6" fill="none" stroke="#1b3a6b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="11" y1="-5.5" x2="26" y2="-5.5" stroke="#7f93bb" strokeWidth="1.8" strokeLinecap="round" />
      <path className={styles.tickB} d="M-1 5l3 3 5-6" fill="none" stroke="#1b3a6b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="11" y1="5.5" x2="26" y2="5.5" stroke="#7f93bb" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="-1" y="13" width="7" height="7" rx="1.2" fill="none" stroke="#7f93bb" strokeWidth="1.4" />
      <line x1="11" y1="16.5" x2="22" y2="16.5" stroke="#b6c2d8" strokeWidth="1.8" strokeLinecap="round" />
    </g>
  ),
  // A brass compass under glass, for the freelance researcher.
  researcher: (
    <g>
      <rect x="9.5" y="-27" width="7" height="6" rx="1.5" fill={url("brass")} />
      <circle cx="13" cy="1" r="23" fill={url("brass")} />
      <circle cx="13" cy="1" r="18.5" fill={url("paper")} stroke="#5e4310" strokeOpacity="0.55" strokeWidth="0.8" />
      <g stroke="#3d5688" strokeWidth="1.3" strokeLinecap="round">
        <path d="M13-16v3.4M13 18v-3.4M-4 1h3.4M30 1h-3.4" />
      </g>
      <g stroke="#a7b3cb" strokeWidth="0.8" strokeLinecap="round">
        <path d="M1-11l2 2M25-11l-2 2M1 13l2-2M25 13l-2-2" />
      </g>
      <g className={styles.needle}>
        <path d="M13-11.5l3.6 12.5h-7.2z" fill="#c9462e" />
        <path d="M13 13.5l3.6-12.5h-7.2z" fill="#1b3a6b" />
      </g>
      <circle cx="13" cy="1" r="2.2" fill={url("knob")} />
      <path d="M0-9a16 16 0 0 1 13-7" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeOpacity="0.85" />
    </g>
  ),
  // A brass balance, for the bid analyst.
  analyst: (
    <g>
      <rect x="10.5" y="-17" width="5" height="39" rx="1.5" fill={url("brass")} />
      <path d="M0 27q0-6 13-6t13 6z" fill={url("brass")} />
      <circle cx="13" cy="-18.5" r="4" fill={url("brass")} />
      <g className={styles.beam}>
        <rect x="-15" y="-19.5" width="56" height="3.2" rx="1.6" fill={url("brass")} />
        <path d="M-13-17L-21-3M-13-17L-5-3M39-17L31-3M39-17L47-3" stroke="#e2e8f4" strokeWidth="0.8" />
        <path d="M-23-3h20a10 10 0 0 1-20 0zM29-3h20a10 10 0 0 1-20 0z" fill={url("brass")} />
      </g>
    </g>
  ),
  // A glass tablet with a rising chart, for the skills advisor.
  advisor: (
    <g>
      <rect x="-9" y="-24" width="46" height="52" rx="6" fill={url("steel")} />
      <rect x="-6.5" y="-21" width="41" height="46" rx="3.5" fill={url("tablet")} />
      <rect x="-6.5" y="-21" width="41" height="46" rx="3.5" fill={url("dots")} />
      <path d="M-2 20h33" stroke="#51608a" strokeWidth="0.8" />
      <rect className={styles.barA} x="0" y="4" width="7" height="15.5" rx="1" fill="#7fa0e6" />
      <rect className={styles.barB} x="11" y="-4" width="7" height="23.5" rx="1" fill="#bcd2ff" />
      <rect className={styles.barC} x="22" y="-13" width="7" height="32.5" rx="1" fill={url("brass")} />
      <path d="M-6.5-17.5a3.5 3.5 0 0 1 3.5-3.5H26L4 25h-7a3.5 3.5 0 0 1-3.5-3.5z" fill={url("glare")} fillOpacity="0.4" />
    </g>
  ),
};

/** Ear, shell, bezel, glass and face: everything above the neck. */
function Head() {
  return (
    <>
      {/* The ears: ceramic pods, each with a status light. */}
      {[38, 140].map((x) => (
        <g key={x}>
          <rect x={x} y="43" width="22" height="40" rx="11" fill={url("limb")} stroke={url("edge")} strokeWidth="0.9" />
          <rect x={x} y="43" width="22" height="40" rx="11" fill={url("grain")} />
          <rect x={x === 38 ? x + 4 : x + 12} y="52" width="6" height="22" rx="3" fill={url("gunmetal")} />
          <circle className={styles.lamp} cx={x === 38 ? x + 7 : x + 15} cy="63" r="1.9" />
        </g>
      ))}

      {/* The shell, lit from above left, with blue thrown back from below. */}
      <rect x="49" y="15" width="102" height="90" rx="45" fill={url("shell")} />
      <g clipPath={url("clip-shell")}>
        <ellipse cx="128" cy="108" rx="52" ry="30" fill={url("bounce")} />
        <ellipse cx="72" cy="20" rx="44" ry="24" fill={url("key")} />
        <rect x="49" y="15" width="102" height="90" fill={url("grain")} />
        {/* A panel line across the crown, cut in and catching the light. */}
        <path d="M54 37q46-22 92 0" fill="none" stroke="#7e90b6" strokeOpacity="0.65" strokeWidth="0.8" />
        <path d="M54 38q46-22 92 0" fill="none" stroke="#fff" strokeOpacity="0.9" strokeWidth="0.7" />
      </g>
      <rect x="49.5" y="15.5" width="101" height="89" rx="44.5" fill="none" stroke={url("edge")} strokeWidth="1" />

      {/* The bezel, set into the shell. */}
      <rect x="56.5" y="24.5" width="87" height="69" rx="31" fill={url("bezel")} />
      <rect x="56.5" y="24.5" width="87" height="69" rx="31" fill="none" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="0.6" />

      {/* The visor: a screen behind curved glass. */}
      <rect x="61" y="29" width="78" height="60" rx="27" fill={url("visor")} />
      <g clipPath={url("clip-visor")}>
        <ellipse cx="100" cy="62" rx="46" ry="34" fill={url("screen")} />
        <rect x="61" y="29" width="78" height="60" fill={url("dots")} />
        <rect className={styles.scan} x="86" y="29" width="28" height="60" fill={url("scan")} />
        <rect x="61" y="29" width="78" height="60" fill={url("inset")} />
      </g>
      <g className={styles.gaze}>
        <circle className={styles.halo} cx="85" cy="54" r="16" fill={url("halo")} />
        <circle className={styles.halo} cx="115" cy="54" r="16" fill={url("halo")} />
        <g className={styles.eyesOpen}>
          <ellipse className={styles.eye} cx="85" cy="54" rx="6" ry="9" fill={url("eye")} />
          <ellipse className={styles.eye} cx="115" cy="54" rx="6" ry="9" fill={url("eye")} />
        </g>
        <g className={styles.eyesGlad} fill="none" stroke="#f4f8ff" strokeWidth="3.6" strokeLinecap="round">
          <path d="M78 57q7-9 14 0" />
          <path d="M108 57q7-9 14 0" />
        </g>
        <path className={styles.mouthCalm} d="M90 70q10 9 20 0z" fill={url("eye")} />
        <line className={styles.mouthFocus} x1="93" y1="74" x2="107" y2="74" stroke="#f4f8ff" strokeWidth="3" strokeLinecap="round" />
        <path className={styles.mouthWorry} d="M92 77q8-7 16 0" fill="none" stroke="#f6b9a8" strokeWidth="3" strokeLinecap="round" />
        <path className={styles.mouthGlad} d="M86 68q14 15 28 0z" fill={url("eye")} />
      </g>
      {/* The glass itself, over everything on the screen. */}
      <g clipPath={url("clip-visor")}>
        <path d="M61 29h60q-34 6-44 26T61 76z" fill={url("glare")} />
        <path d="M124 88q12-6 15-21" fill="none" stroke="#9cc0ff" strokeOpacity="0.5" strokeWidth="1.4" strokeLinecap="round" />
      </g>
    </>
  );
}

/** An arm: a gunmetal joint and a ceramic limb, with a seam at the wrist. */
function Limb({ d, seam, joint }: { d: string; seam: string; joint: [number, number] }) {
  return (
    <>
      <path d={d} fill={url("limb")} stroke={url("edge")} strokeWidth="0.8" />
      <path d={d} fill={url("grain")} />
      <path d={seam} fill="none" stroke="#7e90b6" strokeOpacity="0.8" strokeWidth="0.8" />
      <circle cx={joint[0]} cy={joint[1]} r="7.5" fill={url("joint")} />
      <circle cx={joint[0] - 2} cy={joint[1] - 2.4} r="1.6" fill="#fff" fillOpacity="0.4" />
    </>
  );
}

function Body({ id }: { id: StaffId }) {
  return (
    <>
      {/* Light where it hovers, then the shadow on the floor. */}
      <ellipse cx="100" cy="239" rx="52" ry="7" fill={url("floor")} />
      <ellipse className={styles.pool} cx="100" cy="238" rx="46" ry="6" fill={url("glow-work")} />

      <g className={styles.body}>
        <g className={styles.armOther}>
          <Limb d="M58 128C46 142 30 170 27 194c-1 8 9 10 13 2 8-18 18-44 24-60z" seam="M30.5 180q5 3 12 5" joint={[56, 131]} />
        </g>

        {/* The emitter it hovers on. */}
        <ellipse className={styles.lift} cx="100" cy="229" rx="18" ry="6" fill={url("lift")} />
        <path d="M91 224q9 7 18 0l-2 4q-7 4-14 0z" fill={url("gunmetal")} />

        {/* The torso, shaded as a form: lit left, turning away right. */}
        <path d={TORSO} fill={url("torso")} />
        <g clipPath={url("clip-torso")}>
          <rect x="54" y="118" width="92" height="112" fill={url("core")} />
          <ellipse cx="74" cy="150" rx="17" ry="34" fill={url("key")} />
          <ellipse cx="116" cy="222" rx="34" ry="18" fill={url("bounce")} />
          <ellipse cx="100" cy="134" rx="46" ry="12" fill={url("occlusion")} />
          <rect x="54" y="118" width="92" height="112" fill={url("grain")} />
          {/* Panel lines. */}
          <path d="M60 144q40 15 80 0" fill="none" stroke="#7e90b6" strokeOpacity="0.7" strokeWidth="0.8" />
          <path d="M60 145q40 15 80 0" fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="0.7" />
          <path d="M100 178v42" stroke="#7e90b6" strokeOpacity="0.45" strokeWidth="0.8" />
          {/* Vents. */}
          {[189, 195, 201].map((y, index) => (
            <g key={y}>
              <rect x={80 + index * 3} y={y} width={40 - index * 6} height="2.3" rx="1.150" fill="#2a3656" fillOpacity="0.75" />
              <rect x={80 + index * 3} y={y + 2.3} width={40 - index * 6} height="0.6" fill="#fff" fillOpacity="0.75" />
            </g>
          ))}
        </g>
        <path d={TORSO} fill="none" stroke={url("edge")} strokeWidth="0.8" />

        {/* The collar: ceramic, steel and a woven neck well. */}
        <ellipse cx="100" cy="121" rx="42.5" ry="11" fill={url("shell")} stroke={url("edge")} strokeWidth="0.8" />
        <ellipse cx="100" cy="120" rx="35.5" ry="7.8" fill={url("steel")} />
        <ellipse cx="100" cy="120" rx="33" ry="6.6" fill={url("weave")} />
        <ellipse cx="100" cy="118" rx="33" ry="4.8" fill="#050a18" fillOpacity="0.55" />

        {/* The chest plate, with the status lamp under its lens. */}
        <rect x="68" y="149" width="64" height="23" rx="11.5" fill={url("bezel")} />
        <rect x="68" y="149" width="64" height="23" rx="11.5" fill={url("brush")} />
        <rect x="68" y="149" width="64" height="23" rx="11.5" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="0.6" />
        <circle cx="80" cy="160.5" r="4.6" fill={url("knob")} />
        <circle cx="120" cy="160.5" r="4.6" fill={url("knob")} />
        <ellipse className={styles.glowWork} cx="100" cy="160.5" rx="30" ry="20" fill={url("glow-work")} />
        <ellipse className={styles.glowStop} cx="100" cy="160.5" rx="30" ry="20" fill={url("glow-stop")} />
        <ellipse className={styles.glowDone} cx="100" cy="160.5" rx="30" ry="20" fill={url("glow-done")} />
        <rect className={styles.lamp} x="89" y="154.5" width="22" height="12" rx="6" />
        <rect x="90" y="155.2" width="20" height="5.2" rx="2.6" fill={url("gloss")} />

        <g className={styles.arm}>
          <g className={styles.armMotion}>
            <Limb d="M142 126c11 6 25 34 32 60 2 9-9 13-13 5-10-20-22-42-26-55z" seam="M157.5 177q6-1 12-5" joint={[144, 131]} />
            <g className={styles.tool}>
              <g transform="translate(166 194) scale(1.14)">{TOOLS[id]}</g>
            </g>
          </g>
        </g>
      </g>
    </>
  );
}

/** Follows the pointer with the robot's eyes, unless it asks for stillness. */
function useGaze(enabled: boolean) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const onMove = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      const dx = event.clientX - (box.left + box.width / 2);
      const dy = event.clientY - (box.top + box.height * 0.25);
      const distance = Math.max(1, Math.hypot(dx, dy));
      const pull = Math.min(1, distance / 140);
      element.style.setProperty("--gx", ((dx / distance) * pull).toFixed(3));
      element.style.setProperty("--gy", ((dy / distance) * pull).toFixed(3));
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [enabled]);
  return ref;
}

const seedOf = (id: StaffId) => `${STAFF_IDS.indexOf(id) * -0.75}s`;

/**
 * A member of staff in full. Their mood is the state of their real work, so
 * what they're doing here is what they're actually doing. Decorative: put the
 * words next to it. `beat` changes when their job names a new step, and they
 * nod. `watching` has them follow the pointer while they aren't busy. Needs
 * RobotMaterials somewhere on the page.
 */
export function Robot({
  id,
  mood = "idle",
  attentive = false,
  watching = false,
  beat,
  className,
}: {
  id: StaffId;
  mood?: StaffMood;
  attentive?: boolean;
  watching?: boolean;
  beat?: string | null;
  className?: string;
}) {
  const free = mood === "idle" || attentive;
  const ref = useGaze(watching && free);
  const lastBeat = useRef(beat);

  useEffect(() => {
    if (ref.current && mood !== "idle" && mood !== "done" && !(watching && free)) {
      // Whatever the pointer last did no longer applies: the mood says where to look.
      ref.current.style.removeProperty("--gx");
      ref.current.style.removeProperty("--gy");
    }
  }, [mood, ref, watching, free]);

  useEffect(() => {
    const changed = lastBeat.current !== beat;
    lastBeat.current = beat;
    if (!changed || !beat || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    ref.current?.querySelector(`.${styles.gaze}`)?.animate?.([{ translate: "0 0" }, { translate: "0 4px" }, { translate: "0 0" }], { duration: 420, easing: "ease-in-out" });
  }, [beat, ref]);

  return (
    <svg
      ref={ref}
      viewBox="-22 4 244 244"
      aria-hidden="true"
      data-mood={mood}
      data-attentive={attentive || undefined}
      className={cn(styles.robot, className)}
      style={{ "--seed": seedOf(id) } as CSSProperties}
    >
      <Body id={id} />
      <g className={styles.head}>
        <Head />
      </g>
    </svg>
  );
}

/** Just the head, for small places: the sidebar, a page's title, a note, a progress line. */
export function RobotHead({ id, mood = "idle", className }: { id: StaffId; mood?: StaffMood; className?: string }) {
  return (
    <svg
      viewBox="34 10 132 100"
      aria-hidden="true"
      data-mood={mood}
      className={cn(styles.robot, "shrink-0", className)}
      style={{ "--seed": seedOf(id) } as CSSProperties}
    >
      <g className={styles.head}>
        <Head />
      </g>
    </svg>
  );
}
