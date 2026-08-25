import { describe, expect, it } from "vitest";
import { BOUNDS, DROPS, NODES, PICKUPS, distance, insideZone } from "../src/sim/city.js";
import { DEFAULT_CONFIG, DEFAULT_CONFIG as E, placeOf } from "../src/sim/config.js";
import { venueGlyphs } from "../src/ui/icons.js";
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

/**
 * The city, once it stopped being four kitchens.
 *
 * Twenty-two venues are only an improvement if they stay learnable, and that
 * rests entirely on the archetype predicting behaviour. If a venue's prep time
 * stops being readable from its type, the extra places are noise.
 */
describe("the venue archetypes", () => {
  it("gives every pickup a type and every drop an address", () => {
    for (const p of PICKUPS) expect(DEFAULT_CONFIG.venues[p.venue]).toBeDefined();
    for (const d of DROPS) expect(DEFAULT_CONFIG.addresses[d.address]).toBeDefined();
  });

  it("uses every archetype at least once", () => {
    // An archetype nobody uses is a tuning knob with nothing on the end of it.
    const used = new Set(PICKUPS.map((p) => p.venue));
    for (const kind of Object.keys(DEFAULT_CONFIG.venues)) {
      expect(used).toContain(kind);
    }
  });

  it("resolves a venue's behaviour from its type", () => {
    const cafe = PICKUPS.find((p) => p.venue === "cafe" && p.id !== "hp");
    expect(cafe).toBeDefined();
    expect(placeOf(cafe!.id, DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG.venues.cafe);
  });

  it("lets a specific address override its type", () => {
    // Cyber Hub kitchens queue in a way no other dhaba has to.
    const dhaba = DEFAULT_CONFIG.venues.dhaba;
    expect(placeOf("hp", DEFAULT_CONFIG).prepMean).toBeGreaterThan(dhaba.prepMean);
  });

  it("keeps a dark store quick and a biryani house slow", () => {
    // The spine of the whole knowledge mechanic. If this inverts, the player
    // has nothing to learn.
    expect(DEFAULT_CONFIG.venues.darkstore.prepMean).toBeLessThan(5);
    expect(DEFAULT_CONFIG.venues.biryani.prepMean).toBeGreaterThan(18);
    expect(DEFAULT_CONFIG.venues.biryani.prepSpread).toBeGreaterThan(
      DEFAULT_CONFIG.venues.darkstore.prepSpread,
    );
  });

  it("charges more to hand over at a gated tower than at a metro gate", () => {
    expect(DEFAULT_CONFIG.addresses.gated.handover).toBeGreaterThan(
      DEFAULT_CONFIG.addresses.metro.handover,
    );
  });

  it("gives every node a unique id", () => {
    const ids = NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * One rider's patch, not all of Gurgaon. Real riders work a radius they can
   * cross in twenty minutes; a zone that sprawls turns every batch into a
   * cross-town haul and the routing decision stops being interesting.
   */
  it("stays the size of a sector a rider could actually work", () => {
    const width = BOUNDS.maxX - BOUNDS.minX;
    const height = BOUNDS.maxY - BOUNDS.minY;
    expect(width).toBeLessThan(10);
    expect(height).toBeLessThan(11);
  });

  it("puts the venues where the zone actually is", () => {
    // insideZone takes real coordinates, so this checks the projection and the
    // bounds agree rather than checking bounds against themselves.
    expect(insideZone(28.467, 77.068)).toBe(true);
    expect(insideZone(28.6139, 77.209)).toBe(false);
  });

  it("gives a glyph to every archetype", () => {
    for (const kind of Object.keys(DEFAULT_CONFIG.venues)) {
      expect(venueGlyphs[kind as keyof typeof venueGlyphs]).toBeTruthy();
    }
  });
});
