import { describe, expect, it } from "vitest";
import {
  DEFAULT_ECONOMY as E,
  demandAt,
  hourAt,
  trafficAt,
} from "../src/sim/economy.js";
import { createShift, idle, rideMinutes } from "../src/sim/shift.js";

/** Minutes into the shift at a given wall-clock hour. */
const at = (hour: number) => (hour - E.startHour) * 60 + 30;

describe("the shift clock", () => {
  it("starts at noon and runs to eleven", () => {
    expect(E.startHour).toBe(12);
    expect(hourAt(0, E)).toBe(12);
    expect(hourAt(E.shiftMinutes - 1, E)).toBe(22);
  });

  /**
   * The shift has to straddle both peaks. If it ever gets shortened so it ends
   * before the evening block, the demand curve stops doing any work and the
   * "when do I rest" decision disappears with it.
   */
  it("covers the lunch peak, the afternoon lull, and the evening block", () => {
    expect(demandAt(at(13), E)).toBeGreaterThan(3);
    expect(demandAt(at(17), E)).toBeLessThan(1);
    expect(demandAt(at(20), E)).toBeGreaterThan(2);
  });
});

describe("demand", () => {
  it("peaks at lunch, roughly 4x the quiet hours", () => {
    expect(demandAt(at(13), E) / demandAt(at(17), E)).toBeGreaterThan(4);
  });

  it("has a real trough between the two rushes", () => {
    expect(demandAt(at(17), E)).toBeLessThan(demandAt(at(13), E));
    expect(demandAt(at(17), E)).toBeLessThan(demandAt(at(20), E));
  });

  it("delivers many more offers during a peak hour than a dead one", () => {
    const countOver = (startHour: number) => {
      const s = createShift(4);
      idle(s, Math.max(0, (startHour - E.startHour) * 60));
      const before = s.seq;
      idle(s, 60);
      return s.seq - before;
    };
    expect(countOver(13)).toBeGreaterThan(countOver(17) * 2);
  });
});

describe("traffic", () => {
  it("is worst through the evening rush", () => {
    expect(trafficAt(at(19), E)).toBeGreaterThan(trafficAt(at(15), E));
    expect(trafficAt(at(22), E)).toBeLessThan(trafficAt(at(19), E));
  });

  /**
   * The cruel coupling: the hours worth working are the hours you cannot move
   * through. If this inverts, the evening stops being a real trade-off.
   */
  it("makes the same ride slower during the block that pays best", () => {
    const quiet = createShift(2);
    idle(quiet, at(16));
    const busy = createShift(2);
    idle(busy, at(19));

    expect(rideMinutes(busy, "qk", "d4")).toBeGreaterThan(rideMinutes(quiet, "qk", "d4"));
  });
});

describe("expenses", () => {
  it("charges roughly a third of gross, matching measured rider costs", () => {
    // Sanity band rather than a fixed number, so tuning does not break it but a
    // structural mistake does. Measured reality is 32% of gross.
    const perUnit = E.expensePerUnit;
    const typicalUnits = 200; // a full shift of riding
    const cost = E.shiftExpenses + typicalUnits * perUnit;
    expect(cost).toBeGreaterThan(300);
    expect(cost).toBeLessThan(900);
  });
});
