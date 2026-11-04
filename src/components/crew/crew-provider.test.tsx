import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { restingCrew, type CrewSnapshot } from "@/lib/crew/crew";

import { CrewProvider, pokeCrew, useCrew } from "./crew-provider";

const snapshot = (edit?: (members: ReturnType<typeof restingCrew>) => void): CrewSnapshot => {
  const members = restingCrew();
  edit?.(members);
  return { members, finished: [] };
};
const appraiserBusy = () => snapshot((members) => void (members.appraiser = { ...members.appraiser, status: "working", step: "Weighing", jobs: 1 }));
const serving = (get: () => CrewSnapshot) => vi.fn(async () => ({ ok: true, json: async () => structuredClone(get()) }));
const pass = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
function Status() {
  return <p data-testid="status">{useCrew().members.appraiser.status}</p>;
}
const shell = (initial: CrewSnapshot) => (
  <CrewProvider initial={initial}>
    <Status />
  </CrewProvider>
);
const status = () => screen.getByTestId("status").textContent;

describe("the crew, following real jobs", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks for news soon on a page opened mid-job", async () => {
    const running = appraiserBusy();
    const fetcher = serving(() => running);
    vi.stubGlobal("fetch", fetcher);
    render(shell(running));
    await pass(3000);
    expect(fetcher).toHaveBeenCalled();
  });

  // Every Server Action renders the shell again, with a new `initial`.
  it("shows the job a new render of the shell tells it about", async () => {
    vi.stubGlobal("fetch", serving(appraiserBusy));
    const { rerender } = render(shell(snapshot()));
    rerender(shell(appraiserBusy()));
    await pass(10);
    expect(status()).toBe("working");
  });

  it("doesn't lose an update that was on its way when the shell rendered again", async () => {
    let release: (value: unknown) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => (release = resolve))));
    const { rerender } = render(shell(snapshot()));
    await act(async () => {
      pokeCrew();
      await vi.advanceTimersByTimeAsync(1);
    });
    rerender(shell(snapshot()));
    await act(async () => {
      release({ ok: true, json: async () => appraiserBusy() });
      await vi.advanceTimersByTimeAsync(5);
    });
    expect(status()).toBe("working");
  });

  it("keeps asking quickly while someone's working, however often the shell renders", async () => {
    const fetcher = serving(appraiserBusy);
    vi.stubGlobal("fetch", fetcher);
    const { rerender } = render(shell(appraiserBusy()));
    await pass(10);
    fetcher.mockClear();
    for (let second = 0; second < 6; second++) {
      rerender(shell(appraiserBusy()));
      await pass(1000);
    }
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
