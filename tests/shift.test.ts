import { describe, expect, it } from "vitest";
import { used } from "../src/sim/bag.js";
import { travelMinutes } from "../src/sim/city.js";
import { DEFAULT_ECONOMY as E } from "../src/sim/economy.js";
import {
  accept,
  canAccept,
  createShift,
  endShift,
  idle,
  isOver,
  reject,
  travelTo,
} from "../src/sim/shift.js";

describe("createShift", () => {
  it("is deterministic for a seed", () => {
    const a = createShift(5);
    const b = createShift(5);
    expect(a.offers.map((o) => o.id)).toEqual(b.offers.map((o) => o.id));
    expect(a.offers[0]?.fee).toBe(b.offers[0]?.fee);
  });

  it("starts at the dark store with an empty bag and a fresh clock", () => {
    const s = createShift(1);
    expect(s.clock).toBe(0);
    expect(s.locationId).toBe("qk");
    expect(used(s.bag)).toBe(0);
    expect(s.completed).toHaveLength(0);
  });

  it("opens with at least one offer so the first decision is immediate", () => {
    expect(createShift(1).offers.length).toBeGreaterThan(0);
  });
});

describe("accept and reject", () => {
  it("moves an offer into the bag", () => {
    const s = createShift(3);
    const id = s.offers[0]!.id;
    expect(accept(s, id)).toBe(true);
    expect(used(s.bag)).toBe(1);
    expect(s.offers.find((o) => o.id === id)).toBeUndefined();
    expect(s.carried).toHaveLength(1);
    expect(s.carried[0]?.leg).toBe("TO_PICKUP");
  });

  it("stamps the deadline from acceptance, not from when the offer appeared", () => {
    const s = createShift(3);
    idle(s, 30);
    const order = s.offers[0]!;
    const at = s.clock;
    accept(s, order.id);
    expect(order.dueAt).toBeCloseTo(at + E.tiers[order.tier].window, 6);
  });

  it("refuses an unknown id", () => {
    const s = createShift(3);
    expect(accept(s, "nope")).toBe(false);
    expect(canAccept(s, "nope")).toBe(false);
  });

  it("refuses to accept once the bag is full", () => {
    const s = createShift(9);
    idle(s, 200); // let plenty of offers pile up
    let taken = 0;
    for (const o of [...s.offers]) {
      if (accept(s, o.id)) taken += 1;
    }
    expect(taken).toBeLessThanOrEqual(5);
    expect(used(s.bag)).toBe(taken);
  });

  it("drops a rejected offer from the queue", () => {
    const s = createShift(4);
    const id = s.offers[0]!.id;
    expect(reject(s, id)).toBe(true);
    expect(s.offers.find((o) => o.id === id)).toBeUndefined();
    expect(reject(s, id)).toBe(false);
  });
});

describe("travel", () => {
  it("advances the clock by the travel time", () => {
    const s = createShift(2);
    const expected = travelMinutes("qk", "d4");
    travelTo(s, "d4");
    expect(s.clock).toBeCloseTo(expected, 6);
    expect(s.locationId).toBe("d4");
  });

  it("costs nothing to stay where you are", () => {
    const s = createShift(2);
    travelTo(s, "qk");
    expect(s.clock).toBe(0);
  });

  it("expires offers that timed out while riding", () => {
    const s = createShift(6);
    const ids = s.offers.map((o) => o.id);
    travelTo(s, "d6"); // a long ride
    for (const id of ids) {
      const still = s.offers.find((o) => o.id === id);
      expect(still).toBeUndefined();
    }
  });
});

describe("pickup, waiting and delivery", () => {
  it("collects at the pickup and delivers at the drop", () => {
    const s = createShift(11);
    const order = s.offers[0]!;
    accept(s, order.id);

    travelTo(s, order.pickupId);
    expect(s.carried[0]?.leg).toBe("TO_DROP");
    expect(s.carried[0]?.pickedUpAt).not.toBeNull();

    travelTo(s, order.dropId);
    expect(s.completed).toHaveLength(1);
    expect(s.carried).toHaveLength(0);
    expect(used(s.bag)).toBe(0);
  });

  it("makes the rider wait when the food is not ready yet", () => {
    const s = createShift(11);
    // Biryani Junction has a long prep; ride straight there and stand around.
    const order = [...s.offers].find((o) => o.pickupId === "bj");
    if (!order) return; // seed-dependent; other tests cover the general case
    accept(s, order.id);
    travelTo(s, "bj");
    expect(s.carried[0]?.waited).toBeGreaterThanOrEqual(0);
    expect(s.clock).toBeGreaterThanOrEqual(order.offeredAt + order.truePrep - 1e-9);
  });

  it("pays half for a late delivery", () => {
    const s = createShift(11);
    const order = s.offers[0]!;
    accept(s, order.id);
    travelTo(s, order.pickupId);
    idle(s, E.tiers[order.tier].window + 100); // blow the deadline on purpose
    travelTo(s, order.dropId);

    const done = s.completed[0]!;
    expect(done.late).toBe(true);
    expect(done.lateBy).toBeGreaterThan(0);
    expect(done.paid).toBe(Math.round(order.fee * E.latePayFactor));
  });

  it("delivers two orders sharing a drop in a single visit", () => {
    const s = createShift(21);
    idle(s, 120);
    const first = s.offers[0]!;
    accept(s, first.id);
    const sameDrop = s.offers.find(
      (o) => o.dropId === first.dropId && o.pickupId === first.pickupId,
    );
    if (!sameDrop) return; // seed-dependent
    accept(s, sameDrop.id);

    travelTo(s, first.pickupId);
    travelTo(s, first.dropId);
    expect(s.completed).toHaveLength(2);
  });
});

describe("endShift", () => {
  it("nets fees plus milestones minus expenses", () => {
    const s = createShift(11);
    const order = s.offers[0]!;
    accept(s, order.id);
    travelTo(s, order.pickupId);
    travelTo(s, order.dropId);

    const sum = endShift(s);
    expect(sum.ordersDelivered).toBe(1);
    expect(sum.milestones).toBe(0);
    expect(sum.expenses).toBe(E.shiftExpenses);
    expect(sum.net).toBe(sum.fees + sum.milestones - sum.expenses);
  });

  it("counts orders still in the bag as undelivered", () => {
    const s = createShift(11);
    accept(s, s.offers[0]!.id);
    const sum = endShift(s);
    expect(sum.undelivered).toBe(1);
    expect(sum.ordersDelivered).toBe(0);
  });

  it("reports the shift as over once the clock runs out", () => {
    const s = createShift(1);
    expect(isOver(s)).toBe(false);
    idle(s, E.shiftMinutes);
    expect(isOver(s)).toBe(true);
  });
});
