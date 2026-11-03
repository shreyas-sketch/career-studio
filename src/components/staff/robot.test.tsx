import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { STAFF_IDS } from "@/lib/staff/staff";

import { Robot, RobotHead, RobotMaterials } from "./robot";

describe("the staff's robots", () => {
  it("draws each one, hidden from screen readers, in the mood it's given", () => {
    for (const id of STAFF_IDS) {
      const { container, unmount } = render(<Robot id={id} mood="working" />);
      const svg = container.querySelector("svg")!;
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("data-mood", "working");
      unmount();
    }
  });

  it("gives each one its own tool", () => {
    const tools = new Set(
      STAFF_IDS.map((id) => {
        const { container, unmount } = render(<Robot id={id} />);
        const drawing = container.querySelector("[transform='translate(166 194) scale(1.14)']")!.innerHTML;
        unmount();
        return drawing;
      }),
    );
    expect(tools.size).toBe(STAFF_IDS.length);
  });

  it("defines every material the drawings refer to", () => {
    const { container } = render(
      <>
        <RobotMaterials />
        {STAFF_IDS.map((id) => (
          <Robot key={id} id={id} />
        ))}
        <RobotHead id="search" />
      </>,
    );
    const defined = new Set([...container.querySelectorAll("[id]")].map((element) => element.id));
    const used = new Set([...container.innerHTML.matchAll(/url\(#(rb-[a-z-]+)\)/g)].map((match) => match[1]!));
    expect(used.size).toBeGreaterThan(20);
    for (const id of used) expect(defined).toContain(id);
  });

  it("is idle unless told otherwise, and doesn't wave at no one", () => {
    const { container } = render(<Robot id="coach" />);
    expect(container.querySelector("svg")).toHaveAttribute("data-mood", "idle");
    expect(container.querySelector("svg")).not.toHaveAttribute("data-attentive");
  });
});
