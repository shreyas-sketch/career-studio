import type { CrewId } from "./crew";

// The mobile's mechanics: arms that balance and wires that swing. The motion
// is physical on purpose. A job makes its member heavier, so the arm above
// dips and everything below it answers; nothing here plays a canned loop.

type ShapeHang = { shape: CrewId; wire: number };
type BeamHang = { wire: number; left: number; right: number; a: Hang; b: Hang };
export type Hang = ShapeHang | BeamHang;

/** The mobile, in a 1180-wide space. It steps down from left to right, leaving room for the greeting. */
export const RIG: Hang = {
  wire: 40,
  left: 312,
  right: 318,
  a: {
    wire: 20,
    left: 170,
    right: 150,
    a: { shape: "scout", wire: 22 },
    b: {
      wire: 24,
      left: 72,
      right: 88,
      a: { shape: "tailor", wire: 18 },
      b: { shape: "interviewer", wire: 58 },
    },
  },
  b: {
    wire: 36,
    left: 168,
    right: 152,
    a: {
      wire: 34,
      left: 84,
      right: 74,
      a: { shape: "usher", wire: 112 },
      b: { shape: "prospector", wire: 40 },
    },
    b: {
      wire: 52,
      left: 96,
      right: 52,
      a: { shape: "appraiser", wire: 34 },
      b: { shape: "coach", wire: 96 },
    },
  },
};

export const RIG_ANCHOR = { x: 592, y: 0 };

const GRAVITY = 900;
const BEAM_STIFFNESS = 1.6;
const BEAM_DAMPING = 0.6;
const BEAM_GAIN = 0.55;
const SWING_DAMPING = 0.42;
const MAX_ACCEL = 3000;
/** How far arm ends droop, so a wire reads as bent and not ruled. */
const DROOP = 0.055;
/** Extra weight a job gives its member, then each further job. */
const WORK_LOAD = 0.55;
const EXTRA_JOB_LOAD = 0.15;
const CROOKED = 0.34;

export type Gesture = { rot: number; bob: number; yaw: number; scale: number; push: number; look: { x: number; y: number } };

/**
 * How each member moves at their trade, so you can tell who's working from
 * across the room. `t` is seconds since they started.
 */
export function gesture(id: CrewId, t: number): Gesture {
  const idle: Gesture = { rot: 0, bob: 0, yaw: 0, scale: 1, push: 0, look: { x: 0, y: 1 } };
  switch (id) {
    case "scout": // Looks left and right, turning right round.
      return { ...idle, yaw: 1.05 * Math.sin(t * 1.15), rot: 0.07 * Math.sin(t * 1.15), look: { x: Math.sin(t * 1.15), y: 0.2 } };
    case "tailor": // Stitches: quick, short and even.
      return { ...idle, bob: 8 * Math.abs(Math.sin(t * 3.4)), rot: 0.05 * Math.sin(t * 6.8) };
    case "interviewer": { // Nods along, then waits.
      const nod = Math.sin(t * 2.1);
      return { ...idle, rot: 0.2 * nod * nod * nod, look: { x: 0.4, y: 0.5 } };
    }
    case "usher": // Paces.
      return { ...idle, push: 0.5 * Math.sign(Math.sin(t * 1.3)), rot: 0.1 * Math.sin(t * 1.3), look: { x: Math.sign(Math.sin(t * 1.3)), y: 0.3 } };
    case "prospector": { // Digs: down hard, up slowly.
      const phase = (t * 0.62) % 1;
      const dig = phase < 0.18 ? phase / 0.18 : 1 - (phase - 0.18) / 0.82;
      return { ...idle, bob: 20 * dig, rot: 0.14 * dig };
    }
    case "appraiser": // Weighs one side against the other.
      return { ...idle, rot: 0.3 * Math.sin(t * 0.95), look: { x: Math.sin(t * 0.95), y: 0.6 } };
    case "coach": // Grows.
      return { ...idle, scale: 1 + 0.09 * (0.5 + 0.5 * Math.sin(t * 1.5)), rot: 0.04 * Math.sin(t * 0.75), look: { x: 0, y: -1 } };
  }
}

export type ShapePose = { id: CrewId; x: number; y: number; rot: number; sx: number; sy: number; work: number; look: { x: number; y: number } };
export type WirePose = { x1: number; y1: number; x2: number; y2: number };
export type BeamPose = { d: string; px: number; py: number };
export type RigPose = { wires: WirePose[]; beams: BeamPose[]; shapes: ShapePose[] };

type Node = {
  hang: Hang;
  phi: number;
  phiV: number;
  theta: number;
  thetaV: number;
  lastX: number;
  lastVX: number;
  seed: number;
  kids: Node[];
};

const isShape = (hang: Hang): hang is ShapeHang => "shape" in hang;

/** A number that wanders smoothly and never quite repeats. */
const drift = (t: number, seed: number) => Math.sin(0.31 * t + seed) + 0.6 * Math.sin(0.73 * t + seed * 2.3) + 0.3 * Math.sin(1.71 * t + seed * 3.7);

export class Mobile {
  private root: Node;
  private nodes: Node[] = [];
  private shapeNodes = new Map<CrewId, Node>();
  /** Target and eased weight of work per member, 0 to 1 and up. */
  private load = new Map<CrewId, number>();
  private target = new Map<CrewId, number>();
  private busyFor = new Map<CrewId, number>();
  /** Hanging crooked, for a member whose work failed: wanted and eased. */
  private stuck = new Map<CrewId, boolean>();
  private crooked = new Map<CrewId, number>();
  private time = 0;
  /** Scales how much air moves: none for a mobile that has to hold still. */
  private wind = 1;

  constructor(rig: Hang = RIG, private anchor = RIG_ANCHOR) {
    let seed = 1.3;
    const build = (hang: Hang): Node => {
      seed += 1.618;
      const node: Node = { hang, phi: 0, phiV: 0, theta: 0, thetaV: 0, lastX: 0, lastVX: 0, seed, kids: [] };
      this.nodes.push(node);
      if (isShape(hang)) this.shapeNodes.set(hang.shape, node);
      else node.kids = [build(hang.a), build(hang.b)];
      return node;
    };
    this.root = build(rig);
    this.settle();
  }

  setWind(wind: number): void {
    this.wind = wind;
  }

  /** How much work a member has in hand: 0 resting, 1 one job, more for more. */
  setWork(id: CrewId, jobs: number): void {
    this.target.set(id, jobs <= 0 ? 0 : WORK_LOAD + EXTRA_JOB_LOAD * (jobs - 1));
  }

  setStuck(id: CrewId, stuck: boolean): void {
    this.stuck.set(id, stuck);
  }

  /** Plucks a member's wire, as when a step changes or someone reaches for them. */
  pluck(id: CrewId, strength = 1): void {
    const node = this.shapeNodes.get(id);
    if (node) node.phiV += strength * 0.9 * (node.seed % 2 > 1 ? 1 : -1);
  }

  /** Moving air from the pointer: it pushes what's near it, and fades with distance. */
  breeze(pose: RigPose, x: number, y: number, vx: number, vy: number): void {
    for (const shape of pose.shapes) {
      const distance = Math.hypot(shape.x - x, shape.y - y);
      if (distance > 260) continue;
      const near = 1 - distance / 260;
      const node = this.shapeNodes.get(shape.id)!;
      node.phiV += near * near * vx * 0.0011;
    }
    this.root.thetaV += vy * 0.00002;
  }

  private loadOf(node: Node): number {
    if (isShape(node.hang)) return this.load.get(node.hang.shape) ?? 0;
    return node.kids.reduce((sum, kid) => sum + this.loadOf(kid), 0);
  }

  private beamPull(node: Node): number {
    const hang = node.hang as BeamHang;
    const [a, b] = node.kids as [Node, Node];
    return (BEAM_GAIN * (this.loadOf(b) * hang.right - this.loadOf(a) * hang.left)) / (hang.left + hang.right);
  }

  /** Goes straight to where the weights put it, at rest, for a mobile that holds still. */
  settle(): RigPose {
    for (const [id, value] of this.target) this.load.set(id, value);
    for (const [id, value] of this.stuck) this.crooked.set(id, value ? 1 : 0);
    for (const node of this.nodes) {
      node.phi = node.phiV = node.thetaV = 0;
      node.theta = isShape(node.hang) ? 0 : this.beamPull(node) / BEAM_STIFFNESS;
    }
    return this.pose(0);
  }

  /** Moves everything on by `dt` seconds. */
  step(dt: number): RigPose {
    const h = Math.min(dt, 1 / 30);
    this.time += h;
    for (const [id, value] of this.target) {
      const eased = (this.load.get(id) ?? 0) + (value - (this.load.get(id) ?? 0)) * Math.min(1, h * 1.8);
      this.load.set(id, eased);
      this.busyFor.set(id, value > 0 ? (this.busyFor.get(id) ?? 0) + h : 0);
    }
    for (const [id, value] of this.stuck) {
      const eased = this.crooked.get(id) ?? 0;
      this.crooked.set(id, eased + ((value ? 1 : 0) - eased) * Math.min(1, h * 2.5));
    }
    for (const node of this.nodes) {
      if (isShape(node.hang)) continue;
      const accel = this.beamPull(node) - BEAM_STIFFNESS * node.theta - BEAM_DAMPING * node.thetaV + 0.012 * this.wind * drift(this.time, node.seed);
      node.thetaV += accel * h;
      node.theta += node.thetaV * h;
    }
    return this.pose(h);
  }

  private pose(h: number): RigPose {
    const out: RigPose = { wires: [], beams: [], shapes: [] };
    const walk = (node: Node, ax: number, ay: number) => {
      const { hang } = node;
      const length = hang.wire + (isShape(hang) ? 42 : 18);
      if (h > 0) {
        const vx = (ax - node.lastX) / h;
        const carried = Math.max(-MAX_ACCEL, Math.min(MAX_ACCEL, (vx - node.lastVX) / h));
        node.lastX = ax;
        node.lastVX = vx;
        const work = isShape(hang) ? Math.min(1, (this.load.get(hang.shape) ?? 0) / WORK_LOAD) : 0;
        const push = isShape(hang) && work > 0 ? work * gesture(hang.shape, this.busyFor.get(hang.shape) ?? 0).push : 0;
        const air = 0.09 * this.wind * drift(this.time * 1.1, node.seed * 1.7);
        const accel = (-GRAVITY / length) * Math.sin(node.phi) - SWING_DAMPING * node.phiV - (carried / length) * Math.cos(node.phi) + air + push;
        node.phiV += accel * h;
        node.phi += node.phiV * h;
      } else {
        node.lastX = ax;
        node.lastVX = 0;
      }
      const ex = ax + hang.wire * Math.sin(node.phi);
      const ey = ay + hang.wire * Math.cos(node.phi);
      out.wires.push({ x1: ax, y1: ay, x2: ex, y2: ey });

      if (isShape(hang)) {
        const load = this.load.get(hang.shape) ?? 0;
        const work = Math.min(1, load / WORK_LOAD);
        const move = gesture(hang.shape, this.busyFor.get(hang.shape) ?? 0);
        const turning = this.wind * (0.5 * Math.sin(0.37 * this.time + node.seed) + 0.22 * Math.sin(0.83 * this.time + node.seed * 2)) + work * move.yaw;
        out.shapes.push({
          id: hang.shape,
          x: ex,
          y: ey + work * move.bob,
          rot: node.phi + work * move.rot + CROOKED * (this.crooked.get(hang.shape) ?? 0),
          sx: Math.max(0.3, Math.abs(Math.cos(turning))) * (1 + work * (move.scale - 1)),
          sy: 1 + work * (move.scale - 1),
          work,
          look: move.look,
        });
        return;
      }

      const turn = Math.cos(this.wind * 0.26 * Math.sin(0.23 * this.time + node.seed));
      const cos = Math.cos(node.theta) * turn;
      const sin = Math.sin(node.theta);
      const lx = ex - hang.left * cos;
      const ly = ey - hang.left * sin + hang.left * DROOP;
      const rx = ex + hang.right * cos;
      const ry = ey + hang.right * sin + hang.right * DROOP;
      // The curve passes through the pivot: an arm's own weight bows it.
      const cx = 2 * ex - (lx + rx) / 2;
      const cy = 2 * ey - (ly + ry) / 2;
      out.beams.push({ d: `M${lx.toFixed(2)} ${ly.toFixed(2)}Q${cx.toFixed(2)} ${cy.toFixed(2)} ${rx.toFixed(2)} ${ry.toFixed(2)}`, px: ex, py: ey });
      walk(node.kids[0]!, lx, ly);
      walk(node.kids[1]!, rx, ry);
    };
    walk(this.root, this.anchor.x, this.anchor.y);
    return out;
  }
}
