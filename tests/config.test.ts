import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG as E,
  milestoneBonus,
  nextMilestone,
  orderFee,
  paidFee,
} from "../src/sim/config.js";

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

// Read off the config rather than written in. These tests are about the shape
// of the payout, not about where this month's thresholds happen to sit, and
// hardcoding them meant a deliberate rebalance broke tests that had no opinion
// about the numbers.
const TIERS = E.milestones;

describe("milestoneBonus", () => {
  it("pays nothing below the first threshold", () => {
    expect(milestoneBonus(0, E)).toBe(0);
    expect(milestoneBonus(TIERS[0]!.orders - 1, E)).toBe(0);
  });

  it("is a step function, not a slope", () => {
    // The whole design rests on this: the order that clears a tier is worth the
    // entire bonus, and the one below it is worth nothing.
    for (const tier of TIERS) {
      expect(milestoneBonus(tier.orders, E) - milestoneBonus(tier.orders - 1, E)).toBe(tier.bonus);
    }
  });

  it("accumulates across thresholds", () => {
    expect(milestoneBonus(20, E)).toBe(500);
    expect(milestoneBonus(28, E)).toBe(1100);
    expect(milestoneBonus(40, E)).toBe(1100);
  });
});

describe("nextMilestone", () => {
  it("reports how many orders short the player is", () => {
    const first = TIERS[0]!;
    expect(nextMilestone(0, E)).toEqual({ ...first, short: first.orders });

    const last = TIERS[TIERS.length - 1]!;
    expect(nextMilestone(last.orders - 1, E)).toEqual({ ...last, short: 1 });
  });

  it("returns null once every milestone is cleared", () => {
    expect(nextMilestone(TIERS[TIERS.length - 1]!.orders, E)).toBeNull();
  });
});
