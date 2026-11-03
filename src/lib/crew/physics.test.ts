import { describe, expect, it } from "vitest";

import { Mobile } from "./physics";

const heights = (mobile: Mobile) => Object.fromEntries(mobile.settle().shapes.map((shape) => [shape.id, shape.y]));

describe("the mobile", () => {
  it("hangs every member, at rest, the same way each time", () => {
    const one = new Mobile().settle();
    const two = new Mobile().settle();
    expect(one.shapes).toHaveLength(7);
    expect(one.beams).toHaveLength(6);
    expect(one).toEqual(two);
  });

  it("lets a member with work sink, and raises the far side of the mobile", () => {
    const rest = heights(new Mobile());
    const mobile = new Mobile();
    mobile.setWork("coach", 1);
    const busy = heights(mobile);
    expect(busy.coach).toBeGreaterThan(rest.coach!);
    expect(busy.scout).toBeLessThan(rest.scout!);
  });

  it("sinks further with more jobs in hand", () => {
    const one = new Mobile();
    one.setWork("tailor", 1);
    const three = new Mobile();
    three.setWork("tailor", 3);
    expect(heights(three).tailor).toBeGreaterThan(heights(one).tailor!);
  });

  it("comes back to rest when the work is done", () => {
    const mobile = new Mobile();
    const start = mobile.settle().shapes.find((shape) => shape.id === "tailor")!.y;
    mobile.setWind(0);
    mobile.setWork("tailor", 1);
    for (let i = 0; i < 600; i++) mobile.step(1 / 60);
    mobile.setWork("tailor", 0);
    let end = 0;
    for (let i = 0; i < 3000; i++) end = mobile.step(1 / 60).shapes.find((shape) => shape.id === "tailor")!.y;
    expect(Math.abs(end - start)).toBeLessThan(2);
  });

  it("hangs a stuck member crooked, and straightens them again", () => {
    const mobile = new Mobile();
    const tilt = () => mobile.settle().shapes.find((shape) => shape.id === "usher")!.rot;
    expect(tilt()).toBe(0);
    mobile.setStuck("usher", true);
    expect(tilt()).toBeGreaterThan(0.1);
    mobile.setStuck("usher", false);
    expect(tilt()).toBe(0);
  });

  it("keeps a working member's movement small", () => {
    const mobile = new Mobile();
    mobile.setWork("prospector", 1);
    for (let i = 0; i < 600; i++) mobile.step(1 / 60);
    const heights: number[] = [];
    for (let i = 0; i < 1200; i++) heights.push(mobile.step(1 / 60).shapes.find((shape) => shape.id === "prospector")!.y);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(14);
  });

  it("is stirred, not thrown, by a fast sweep of the pointer", () => {
    const mobile = new Mobile();
    mobile.setWind(0);
    let pose = mobile.settle();
    let widest = 0;
    for (let i = 0; i < 180; i++) {
      pose = mobile.step(1 / 60);
      mobile.breeze(pose, 300, 150, i % 40 < 20 ? 1600 : -1600, 0);
      for (const shape of pose.shapes) widest = Math.max(widest, Math.abs(shape.rot));
    }
    expect(widest).toBeLessThan(0.1);
  });

  it("stays in one piece through a long, busy run", () => {
    const mobile = new Mobile();
    mobile.setWork("scout", 2);
    mobile.setWork("prospector", 1);
    for (let i = 0; i < 5000; i++) {
      const pose = mobile.step(1 / 60);
      if (i % 200 === 0) mobile.pluck("scout", 3);
      for (const shape of pose.shapes) {
        expect(Number.isFinite(shape.x)).toBe(true);
        expect(shape.y).toBeGreaterThan(0);
        expect(shape.y).toBeLessThan(620);
      }
    }
  });
});
