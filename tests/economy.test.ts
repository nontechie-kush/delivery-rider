import { describe, expect, it } from "vitest";
import {
  DEFAULT_ECONOMY as E,
  milestoneBonus,
  nextMilestone,
  orderFee,
  paidFee,
} from "../src/sim/economy.js";

describe("orderFee", () => {
  it("pays only the base inside the free distance", () => {
    expect(orderFee("STANDARD", 1.5, E)).toBe(E.tiers.STANDARD.base);
    expect(orderFee("STANDARD", 2, E)).toBe(E.tiers.STANDARD.base);
  });

  it("charges per kilometre beyond the free distance", () => {
    // 5 km, 2 free, 3 billable at ₹7/km = 22 + 21
    expect(orderFee("STANDARD", 5, E)).toBe(43);
  });

  it("never goes negative on a zero-distance order", () => {
    expect(orderFee("EXPRESS", 0, E)).toBe(E.tiers.EXPRESS.base);
  });
});

describe("tier balance", () => {
  /**
   * The central trade in the game: EXPRESS must pay meaningfully more per minute
   * of its window than STANDARD, or there is no reason to take the risk. If this
   * test fails after a tuning pass, the tiers have collapsed into each other.
   */
  it("EXPRESS pays more per minute of window than STANDARD, which beats SCHEDULED", () => {
    const perMinute = (tier: "EXPRESS" | "STANDARD" | "SCHEDULED", dist: number) =>
      orderFee(tier, dist, E) / E.tiers[tier].window;

    expect(perMinute("EXPRESS", 3)).toBeGreaterThan(perMinute("STANDARD", 3) * 1.5);
    expect(perMinute("STANDARD", 5)).toBeGreaterThan(perMinute("SCHEDULED", 5));
  });

  it("gives EXPRESS the tightest window", () => {
    expect(E.tiers.EXPRESS.window).toBeLessThan(E.tiers.STANDARD.window);
    expect(E.tiers.STANDARD.window).toBeLessThan(E.tiers.SCHEDULED.window);
  });
});

describe("paidFee", () => {
  it("pays in full when on time", () => {
    expect(paidFee(40, false, E)).toBe(40);
  });

  it("halves a late delivery", () => {
    expect(paidFee(40, true, E)).toBe(20);
  });
});

describe("milestoneBonus", () => {
  it("pays nothing below the first threshold", () => {
    expect(milestoneBonus(0, E)).toBe(0);
    expect(milestoneBonus(11, E)).toBe(0);
  });

  it("is a step function, not a slope", () => {
    // The whole design rests on this: order 12 is worth 150 more than order 11.
    expect(milestoneBonus(12, E) - milestoneBonus(11, E)).toBe(150);
    expect(milestoneBonus(20, E) - milestoneBonus(19, E)).toBe(350);
    expect(milestoneBonus(28, E) - milestoneBonus(27, E)).toBe(600);
  });

  it("accumulates across thresholds", () => {
    expect(milestoneBonus(20, E)).toBe(500);
    expect(milestoneBonus(28, E)).toBe(1100);
    expect(milestoneBonus(40, E)).toBe(1100);
  });
});

describe("nextMilestone", () => {
  it("reports how many orders short the player is", () => {
    expect(nextMilestone(0, E)).toEqual({ orders: 12, bonus: 150, short: 12 });
    expect(nextMilestone(19, E)).toEqual({ orders: 20, bonus: 350, short: 1 });
  });

  it("returns null once every milestone is cleared", () => {
    expect(nextMilestone(28, E)).toBeNull();
  });
});
