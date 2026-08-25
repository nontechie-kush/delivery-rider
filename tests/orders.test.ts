import { describe, expect, it } from "vitest";
import { distance } from "../src/sim/city.js";
import { DEFAULT_CONFIG as E } from "../src/sim/config.js";
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
   * These two used to assert the opposite — that the app never over-reported a
   * wait, and that Biryani Junction was the worst liar. That deception was
   * removed deliberately: the card now quotes each kitchen's real range, and
   * the risk is not knowing today's draw inside it.
   *
   * The quote must therefore be unbiased, and the real time must always land
   * inside what was advertised.
   */
  it("never quotes a range the real prep time falls outside", () => {
    for (const o of sample(500)) {
      expect(o.truePrep).toBeGreaterThanOrEqual(o.prepLow);
      expect(o.truePrep).toBeLessThanOrEqual(o.prepHigh);
      expect(o.truePrep).toBeGreaterThan(0);
    }
  });

  it("quotes without bias — as often over the real wait as under", () => {
    const orders = sample(800);
    const over = orders.filter((o) => o.shownPrep > o.truePrep).length;
    // An unbiased midpoint lands either side about half the time. The old
    // generator was under 100% of the time by construction.
    expect(over / orders.length).toBeGreaterThan(0.35);
    expect(over / orders.length).toBeLessThan(0.65);
  });

  /**
   * Biryani Junction is still the hard one — not because it lies, but because
   * it is genuinely slow and genuinely unpredictable. That is what the player
   * now reads off the card and weighs for themselves.
   */
  it("makes Biryani Junction the slowest and least predictable kitchen", () => {
    const orders = sample(600);
    const spread = (id: string) => {
      const o = orders.find((x) => x.pickupId === id);
      return o ? { width: o.prepHigh - o.prepLow, mid: o.shownPrep } : null;
    };
    const bj = spread("bj");
    const qk = spread("qk");
    if (!bj || !qk) return;

    expect(bj.mid).toBeGreaterThan(qk.mid * 3);
    expect(bj.width).toBeGreaterThan(qk.width * 3);
  });

  it("produces all three tiers over a large sample", () => {
    const tiers = new Set(sample(300).map((o) => o.tier));
    expect(tiers).toEqual(new Set(["EXPRESS", "STANDARD", "SCHEDULED"]));
  });
});
