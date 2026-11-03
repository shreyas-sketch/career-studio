import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { idleStaff, STAFF, STAFF_IDS } from "@/lib/staff/staff";

import { StaffFloor } from "./staff-floor";
import { StaffProvider } from "./staff-provider";

const snapshot = (members = idleStaff()) => ({ members, finished: [] });

describe("the staff floor", () => {
  it("keeps everyone back when no one's working, and links to each member's screen", () => {
    render(
      <StaffProvider initial={snapshot()}>
        <StaffFloor />
      </StaffProvider>,
    );
    for (const id of STAFF_IDS) {
      const link = screen.getByRole("link", { name: new RegExp(STAFF[id].title) });
      expect(link).toHaveAttribute("href", STAFF[id].href);
      expect(link).toHaveTextContent(STAFF[id].remit);
    }
  });

  it("shows a working member at work, in the job's own words, and says so aloud", () => {
    const members = idleStaff();
    members.editor = { ...members.editor, status: "working", step: "Tailoring the resume", about: "Stripe", jobs: 1 };
    render(
      <StaffProvider initial={snapshot(members)}>
        <StaffFloor />
      </StaffProvider>,
    );
    const link = screen.getByRole("link", { name: /Resume editor/ });
    expect(link).toHaveTextContent("Tailoring the resume for Stripe");
    expect(link.querySelector("svg")).toHaveAttribute("data-mood", "working");
    // Those at work have their status out in words; the rest keep it for a hover and for screen readers.
    expect(screen.getByText("Tailoring the resume for Stripe")).not.toHaveClass("sr-only");
    expect(screen.getByText(STAFF.coach.remit)).toHaveClass("sr-only");
    expect(screen.getByRole("link", { name: /Interview coach/ })).toHaveAttribute("title", STAFF.coach.remit);
    expect(screen.getByRole("link", { name: /Search analyst/ }).querySelector("svg")).toHaveAttribute("data-mood", "idle");
    expect(within(document.body).getByRole("status")).toHaveTextContent("Your resume editor is tailoring the resume for Stripe.");
  });

  it("says why a member stopped", () => {
    const members = idleStaff();
    members.analyst = { ...members.analyst, status: "stuck", error: "The key was refused." };
    render(
      <StaffProvider initial={snapshot(members)}>
        <StaffFloor />
      </StaffProvider>,
    );
    const link = screen.getByRole("link", { name: /Bid analyst/ });
    expect(link).toHaveTextContent("Stopped: The key was refused.");
    expect(link.querySelector("svg")).toHaveAttribute("data-mood", "stuck");
  });
});
