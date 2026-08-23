import { describe, expect, it } from "vitest";
import { DEFAULT_ECONOMY as E } from "../src/sim/economy.js";
import { accept, createShift, idle, travelTo } from "../src/sim/shift.js";
import { esc, mins, rupees, urgency } from "../src/ui/format.js";
import { renderMap } from "../src/ui/map.js";
import { estimate, VERDICT_LABEL } from "../src/ui/verdict.js";

describe("format", () => {
  it("writes rupees in the Indian grouping", () => {
    expect(rupees(1234)).toBe("₹1,234");
    expect(rupees(100000)).toBe("₹1,00,000");
  });

  it("escapes anything that could break out of markup", () => {
    expect(esc(`<b>&"`)).toBe("&lt;b&gt;&amp;&quot;");
  });

  it("bands urgency by minutes left", () => {
    expect(urgency(-1)).toBe("late");
    expect(urgency(5)).toBe("soon");
    expect(urgency(40)).toBe("ok");
  });

  it("rounds minutes for display", () => {
    expect(mins(12.4)).toBe("12 min");
  });
});

describe("estimate", () => {
  it("returns a known verdict for every offer in a fresh shift", () => {
    const s = createShift(3);
    idle(s, 60);
    for (const offer of s.offers) {
      const e = estimate(s, offer, E);
      expect(Object.keys(VERDICT_LABEL)).toContain(e.verdict);
      expect(e.forecast).toBeGreaterThan(0);
      expect(e.window).toBe(E.tiers[offer.tier].window);
    }
  });

  it("gets less optimistic as the bag fills", () => {
    const s = createShift(3);
    // Offers expire after 12 minutes, so idle in short steps until two coexist
    // rather than skipping ahead and finding an almost-empty queue.
    for (let i = 0; i < 20 && s.offers.length < 2; i++) idle(s, 3);
    expect(s.offers.length).toBeGreaterThanOrEqual(2);

    const offer = s.offers[0]!;
    const before = estimate(s, offer, E).forecast;

    const loaded = accept(s, s.offers[1]!.id);
    expect(loaded).toBe(true);
    expect(s.carried.length).toBe(1);

    expect(estimate(s, offer, E).forecast).toBeGreaterThan(before);
  });

  /**
   * The advice inherits the platform's optimism on purpose: it forecasts with the
   * prep time the app shows, not the real one. If this ever starts using truePrep,
   * the UI becomes honest and the restaurant-wait mechanic loses its bite.
   */
  it("forecasts using the shown prep time, not the real one", () => {
    const s = createShift(3);
    idle(s, 60);
    const liar = s.offers.find((o) => o.pickupId === "bj");
    if (!liar) return;
    const honest = estimate(s, liar, E).forecast;
    const truthful = honest - liar.shownPrep + liar.truePrep;
    expect(truthful).toBeGreaterThan(honest);
  });
});

describe("renderMap", () => {
  it("renders every node as a ride target", () => {
    const svg = renderMap(createShift(1), null);
    expect(svg).toContain("<svg");
    expect((svg.match(/data-go=/g) ?? []).length).toBe(12);
  });

  it("marks where the rider is standing", () => {
    expect(renderMap(createShift(1), null)).toContain("here");
  });

  it("draws a route for each pending stop", () => {
    const s = createShift(7);
    idle(s, 40);
    accept(s, s.offers[0]!.id);
    expect(renderMap(s, null)).toContain('class="route');
  });

  it("draws the preview line only when an offer is being considered", () => {
    const s = createShift(7);
    idle(s, 40);
    const id = s.offers[0]!.id;
    expect(renderMap(s, null)).not.toContain('class="preview"');
    expect(renderMap(s, id)).toContain('class="preview"');
  });

  it("survives a mid-shift state without throwing", () => {
    const s = createShift(12);
    idle(s, 100);
    accept(s, s.offers[0]!.id);
    travelTo(s, s.carried[0]!.order.pickupId);
    expect(() => renderMap(s, null)).not.toThrow();
  });

  it("escapes node names into the markup", () => {
    expect(renderMap(createShift(1), null)).not.toContain("<script");
  });
});
