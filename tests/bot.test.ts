import { describe, expect, it } from "vitest";
import { runMany, runShift } from "../src/sim/bot.js";
import { DEFAULT_ECONOMY as E } from "../src/sim/economy.js";

const SHIFTS = 200;

describe("policies", () => {
  it("is deterministic", () => {
    expect(runShift(9, E, "selective")).toEqual(runShift(9, E, "selective"));
  });

  it("always terminates within the shift", () => {
    for (const policy of ["solo", "selective", "greedy"] as const) {
      const s = runShift(3, E, policy);
      expect(s.ordersDelivered).toBeGreaterThan(0);
    }
  });
});

/**
 * The design thesis, as an assertion.
 *
 * The whole game rests on selective batching being the best policy — taking
 * everything should over-commit and blow deadlines, taking one at a time should
 * leave money on the table. If a tuning pass ever collapses that ordering, there
 * is no decision left to make and the game is broken regardless of what the
 * revenue numbers say.
 */
describe("the design bet", () => {
  const selective = runMany(SHIFTS, E, "selective");
  const greedy = runMany(SHIFTS, E, "greedy");
  const solo = runMany(SHIFTS, E, "solo");

  it("selective batching beats taking everything", () => {
    expect(selective.net).toBeGreaterThan(greedy.net * 1.15);
  });

  it("selective batching beats one-at-a-time", () => {
    expect(selective.net).toBeGreaterThan(solo.net * 1.1);
  });

  it("punishes over-committing with lateness", () => {
    const lateRate = (a: typeof greedy) => a.late / a.delivered;
    expect(lateRate(greedy)).toBeGreaterThan(0.4);
    expect(lateRate(selective)).toBeLessThan(0.2);
  });

  it("makes milestone money a serious share of income, not a garnish", () => {
    expect(selective.milestones / selective.net).toBeGreaterThan(0.25);
  });

  it("keeps the top milestone out of reach of routine play", () => {
    const top = selective.hits[selective.hits.length - 1] ?? 0;
    expect(top / SHIFTS).toBeLessThan(0.5);
  });

  it("hides a meaningful share of restaurant waiting from the player", () => {
    expect(selective.waitingHidden / selective.waiting).toBeGreaterThan(0.05);
  });
});
