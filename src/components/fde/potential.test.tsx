import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { emptyResult, type Role } from "@/lib/fde/types";

import { CareerPotential } from "./potential";

const role = (id: string, description: string, over: Partial<Role> = {}): Role => ({
  id,
  source: "greenhouse",
  sourceLabel: "Greenhouse board",
  externalId: id,
  title: "Forward Deployed Engineer",
  employer: `Employer ${id}`,
  location: "San Francisco, CA",
  remotePolicy: "",
  seniority: "",
  seniorityGroup: "accessible",
  url: `https://example.com/${id}`,
  applyUrl: null,
  description,
  fullText: true,
  postedAt: null,
  updatedAt: null,
  checkedAt: "2026-11-05T00:00:00.000Z",
  status: "open",
  otherLocations: [],
  reasons: [],
  requirements: [],
  extractionError: null,
  ...over,
});

const threeBase = ["a", "b", "c"].map((id) => role(id, "Base salary range: $200,000 - $300,000 USD"));

describe("CareerPotential", () => {
  it("shows the market without inventing what anyone is missing", () => {
    render(<CareerPotential result={emptyResult()} roles={threeBase} />);
    expect(screen.getByText("About $250,000")).toBeTruthy();
    expect(screen.getByText(/3 of 3 open roles state pay/)).toBeTruthy();
    expect(screen.getByText(/can't say whether anyone would earn more/)).toBeTruthy();
    expect(screen.queryByText(/a year, about/)).toBeNull();
    expect(screen.getByText(/doesn't guarantee a job/)).toBeTruthy();
  });

  it("highlights an estimated increase only once a figure is given", () => {
    render(<CareerPotential result={emptyResult()} roles={threeBase} />);
    fireEvent.change(screen.getByLabelText("Current yearly pay"), { target: { value: "200,000" } });
    expect(screen.getByText("+$50,000 a year, about 25%")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Current yearly pay"), { target: { value: "300000" } });
    expect(screen.queryByText(/a year, about/)).toBeNull();
    expect(screen.getByText(/shows no increase/)).toBeTruthy();
  });

  it("labels a single posting as insufficient data", () => {
    render(<CareerPotential result={emptyResult()} roles={[threeBase[0]]} />);
    expect(screen.getByText(/Insufficient data for an average: 1 posting/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Current yearly pay"), { target: { value: "150000" } });
    expect(screen.getByText("+$50,000 to +$150,000 a year against the stated range")).toBeTruthy();
    expect(screen.getByText(/Insufficient data for an estimate: 1 posting/)).toBeTruthy();
  });

  it("says so when no posting states pay", () => {
    render(<CareerPotential result={emptyResult()} roles={[role("a", "Competitive pay.")]} />);
    expect(screen.getByText(/none of the sampled postings state pay/)).toBeTruthy();
    expect(screen.queryByLabelText("Current yearly pay")).toBeNull();
  });
});
