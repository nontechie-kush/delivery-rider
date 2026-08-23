import { describe, expect, it } from "vitest";
import { distance } from "../src/sim/city.js";
import { DEFAULT_ECONOMY as E } from "../src/sim/economy.js";
import { generateOrder } from "../src/sim/orders.js";
import { makeRng } from "../src/sim/rng.js";

function sample(count: number, seed = 42) {
  const rng = makeRng(seed);
  return Array.from({ length: count }, (_, i) => generateOrder(rng, i * 5, i, E, "qk"));
}

describe("generateOrder", () => {
  it("is deterministic for a seed", () => {
    expect(sample(30, 7)).toEqual(sample(30, 7));
  });

  it("only ever offers EXPRESS from the dark store", () => {
    for (const o of sample(400)) {
      if (o.tier === "EXPRESS") expect(o.pickupId).toBe("qk");
    }
  });

  it("keeps EXPRESS orders inside a distance the window can survive", () => {
    for (const o of sample(400)) {
      if (o.tier === "EXPRESS") {
        expect(o.distance).toBeLessThanOrEqual(E.tiers.EXPRESS.maxDistance);
      }
    }
  });

  it("never sends an order to its own pickup", () => {
    for (const o of sample(300)) {
      expect(o.dropId).not.toBe(o.pickupId);
      expect(o.distance).toBeGreaterThan(0);
    }
  });

  it("prices every order consistently with its distance", () => {
    for (const o of sample(200)) {
      expect(o.distance).toBeCloseTo(distance(o.pickupId, o.dropId), 6);
      expect(o.fee).toBeGreaterThan(0);
    }
  });

  /**
   * The central deception in the design: the app never over-reports a wait.
   * If this inverts, the restaurant-wait mechanic silently stops existing.
   */
  it("never shows a prep time longer than the real one", () => {
    for (const o of sample(500)) {
      expect(o.shownPrep).toBeLessThanOrEqual(o.truePrep);
      expect(o.truePrep).toBeGreaterThan(0);
    }
  });

  it("makes Biryani Junction the worst liar", () => {
    const orders = sample(600).filter((o) => o.pickupId === "bj" || o.pickupId === "qk");
    const gap = (id: string) => {
      const set = orders.filter((o) => o.pickupId === id);
      return set.reduce((s, o) => s + (o.truePrep - o.shownPrep), 0) / set.length;
    };
    expect(gap("bj")).toBeGreaterThan(gap("qk") * 3);
  });

  it("produces all three tiers over a large sample", () => {
    const tiers = new Set(sample(300).map((o) => o.tier));
    expect(tiers).toEqual(new Set(["EXPRESS", "STANDARD", "SCHEDULED"]));
  });
});
