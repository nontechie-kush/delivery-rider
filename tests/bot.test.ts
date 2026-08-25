import { describe, expect, it } from "vitest";
import { runMany, runShift } from "../src/sim/bot.js";
import { DEFAULT_CONFIG as E } from "../src/sim/config.js";

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
    // Threshold relaxed from 0.4 when the map tightened from all of Gurgaon to
    // one rider's zone: shorter hops mean an over-full bag blows fewer deadlines
    // outright. A third of deliveries still landing late is the mechanism doing
    // its job — and the net comparison above is the assertion that really matters.
    const lateRate = (a: typeof greedy) => a.late / a.delivered;
    expect(lateRate(greedy)).toBeGreaterThan(0.3);
    expect(lateRate(selective)).toBeLessThan(0.2);
  });

  it("makes milestone money a serious share of income, not a garnish", () => {
    expect(selective.milestones / selective.net).toBeGreaterThan(0.25);
  });

  it("keeps the top milestone out of reach of routine play", () => {
    const top = selective.hits[selective.hits.length - 1] ?? 0;
    expect(top / SHIFTS).toBeLessThan(0.5);
  });

  /**
   * The inverse of what this once asserted. Waiting is still a real cost of the
   * day — it just is not a hidden one any more, because the card quotes the
   * range the wait comes from. What is left unadvertised should be almost
   * nothing.
   */
  it("no longer hides restaurant waiting from the player", () => {
    expect(selective.waiting).toBeGreaterThan(0);
    expect(selective.waitingHidden / selective.waiting).toBeLessThan(0.02);
  });
});
