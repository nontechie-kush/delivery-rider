import { describe, expect, it } from "vitest";
import { NODES } from "../src/sim/city.js";
import { DEFAULT_CONFIG as E } from "../src/sim/config.js";
import { accept, createShift, idle, startDuty, travelTo } from "../src/sim/shift.js";
import { esc, mins, rupees, urgency } from "../src/ui/format.js";
import { renderMap } from "../src/ui/map.js";
import { routeStack } from "../src/ui/route.js";
import { estimate, VERDICT_LABEL } from "../src/ui/verdict.js";

/** On duty at the lunch peak with work already in the queue. */
function onDutyAt(seed: number) {
  const s = createShift(seed);
  idle(s, (13 - E.dayStartHour) * 60);
  startDuty(s);
  for (let i = 0; i < 40 && s.offers.length === 0; i++) idle(s, 3);
  return s;
}

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
    const s = onDutyAt(3);
    for (const offer of s.offers) {
      const e = estimate(s, offer, E);
      expect(Object.keys(VERDICT_LABEL)).toContain(e.verdict);
      expect(e.total).toBeGreaterThan(0);
      expect(e.window).toBe(E.tiers[offer.tier].window);
    }
  });

  it("gets less optimistic as the bag fills", () => {
    // Offers expire after 12 minutes, so idle in short steps until two coexist
    // rather than skipping ahead and finding an almost-empty queue.
    const s = onDutyAt(3);
    for (let i = 0; i < 40 && s.offers.length < 2; i++) idle(s, 3);
    expect(s.offers.length).toBeGreaterThanOrEqual(2);

    const offer = s.offers[0]!;
    const before = estimate(s, offer, E).total;

    const loaded = accept(s, s.offers[1]!.id);
    expect(loaded).toBe(true);
    expect(s.carried.length).toBe(1);

    expect(estimate(s, offer, E).total).toBeGreaterThan(before);
  });

  /**
   * This test used to assert the opposite: that the forecast inherited the
   * platform's optimism and read better than the order deserved. That mechanic
   * was removed deliberately — the card now shows the kitchen's real range, and
   * the uncertainty comes from not knowing today's draw within it rather than
   * from being lied to about the middle.
   *
   * What has to hold now is that the quoted range is honest and that the advice
   * is conservative inside it.
   */
  it("quotes a range the real prep time actually falls inside", () => {
    const s = onDutyAt(3);
    for (let i = 0; i < 60 && !s.offers.some((o) => o.pickupId === "bj"); i++) idle(s, 3);
    const slow = s.offers.find((o) => o.pickupId === "bj");
    if (!slow) return;

    expect(slow.truePrep).toBeGreaterThanOrEqual(slow.prepLow);
    expect(slow.truePrep).toBeLessThanOrEqual(slow.prepHigh);
    // The shown figure is the middle of the range, not a number worked back
    // from today's draw — so it cannot leak what today holds.
    expect(slow.shownPrep).toBeCloseTo((slow.prepLow + slow.prepHigh) / 2, 6);
  });

  it("judges the fit against the slow end of the range, not the middle", () => {
    const s = onDutyAt(3);
    for (let i = 0; i < 60 && !s.offers.some((o) => o.pickupId === "bj"); i++) idle(s, 3);
    const slow = s.offers.find((o) => o.pickupId === "bj");
    if (!slow) return;

    // "Comfortable" has to mean comfortable even when the kitchen is slow,
    // otherwise the verdict is just the old lie wearing a different word.
    const e = estimate(s, slow, E);
    const toPickup = e.total - e.waitClaimed - e.toDrop - e.queue;
    expect(e.waitClaimed).toBeCloseTo(Math.max(0, slow.prepHigh - toPickup), 4);
  });

  it("quotes the same range twice for the same kitchen", () => {
    const s = onDutyAt(3);
    const seen: number[][] = [];
    for (let i = 0; i < 200 && seen.length < 2; i++) {
      idle(s, 3);
      for (const o of s.offers) {
        if (o.pickupId === "bj" && !seen.some((r) => r[2] === o.truePrep)) {
          seen.push([o.prepLow, o.prepHigh, o.truePrep]);
        }
      }
    }
    if (seen.length < 2) return;
    // Two orders from one kitchen advertise identical ranges despite different
    // real waits. The range describes the place, not the order.
    expect(seen[0]![0]).toBeCloseTo(seen[1]![0]!, 6);
    expect(seen[0]![1]).toBeCloseTo(seen[1]![1]!, 6);
  });
});

describe("renderMap", () => {
  it("renders every node as a ride target", () => {
    const svg = renderMap(createShift(1), null);
    expect(svg).toContain("<svg");
    // Counted from the map rather than hardcoded, so adding a venue does not
    // fail a test that has no opinion about how many there should be.
    expect((svg.match(/data-go=/g) ?? []).length).toBe(NODES.length);
  });

  it("marks where the rider is standing", () => {
    expect(renderMap(createShift(1), null)).toContain("here");
  });

  it("draws a route for each pending stop", () => {
    const s = onDutyAt(7);
    accept(s, s.offers[0]!.id);
    expect(renderMap(s, null)).toContain('class="leg ');
  });

  it("draws the preview line only when an offer is being considered", () => {
    const s = onDutyAt(7);
    const id = s.offers[0]!.id;
    expect(renderMap(s, null)).not.toContain('class="preview"');
    expect(renderMap(s, id)).toContain('class="preview"');
  });

  it("survives a mid-shift state without throwing", () => {
    const s = onDutyAt(12);
    accept(s, s.offers[0]!.id);
    travelTo(s, s.carried[0]!.order.pickupId);
    expect(() => renderMap(s, null)).not.toThrow();
  });

  it("escapes node names into the markup", () => {
    expect(renderMap(createShift(1), null)).not.toContain("<script");
  });
});

describe("routeStack", () => {
  it("renders both stops with a pickup and a drop pin", () => {
    const html = routeStack("qk", "d1");
    expect(html).toContain("stop pickup");
    expect(html).toContain("stop drop");
    expect(html).toContain("QuickKart");
    expect(html).toContain("Huda City Centre");
  });

  it("strikes the pickup once it has been collected", () => {
    expect(routeStack("qk", "d1", { done: "pickup" })).toContain("stop pickup done");
    expect(routeStack("qk", "d1")).not.toContain("done");
  });

  it("escapes notes into the markup", () => {
    expect(routeStack("qk", "d1", { pickupNote: "<script>" })).not.toContain("<script>");
  });
});
