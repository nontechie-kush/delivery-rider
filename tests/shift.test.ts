import { describe, expect, it } from "vitest";
import { used } from "../src/sim/bag.js";
import { distance } from "../src/sim/city.js";
import { DEFAULT_CONFIG as E } from "../src/sim/config.js";
import { startDuty, stopDuty } from "../src/sim/shift.js";
import {
  accept,
  canAccept,
  createShift,
  endShift,
  idle,
  isOver,
  reject,
  rideMinutes,
  travelTo,
} from "../src/sim/shift.js";

/**
 * A shift with the rider on duty at the lunch peak and a few offers already in
 * the queue. Going on duty does not conjure work — it has to arrive.
 */
function onDuty(seed: number) {
  const s = createShift(seed);
  idle(s, (13 - E.dayStartHour) * 60);
  startDuty(s);
  for (let i = 0; i < 30 && s.offers.length === 0; i++) idle(s, 3);
  return s;
}

describe("createShift", () => {
  it("is deterministic for a seed", () => {
    const a = onDuty(5);
    const b = onDuty(5);
    expect(a.offers.map((o) => o.id)).toEqual(b.offers.map((o) => o.id));
    expect(a.offers[0]?.fee).toBe(b.offers[0]?.fee);
  });

  it("offers nothing until the rider goes on duty", () => {
    const s = createShift(1);
    expect(s.duty.online).toBe(false);
    idle(s, 400);
    expect(s.offers).toHaveLength(0);

    startDuty(s);
    for (let i = 0; i < 40 && s.offers.length === 0; i++) idle(s, 3);
    expect(s.offers.length).toBeGreaterThan(0);
  });

  it("stops offering the moment the rider goes off duty", () => {
    const s = onDuty(1);
    expect(s.offers.length).toBeGreaterThan(0);
    stopDuty(s);
    expect(s.offers).toHaveLength(0);
    expect(s.duty.online).toBe(false);
  });

  it("starts at the dark store with an empty bag and a fresh clock", () => {
    const s = createShift(1);
    expect(s.clock).toBe(0);
    expect(s.locationId).toBe("qk");
    expect(used(s.bag)).toBe(0);
    expect(s.completed).toHaveLength(0);
  });

});

describe("accept and reject", () => {
  it("moves an offer into the bag", () => {
    const s = onDuty(3);
    const id = s.offers[0]!.id;
    expect(accept(s, id)).toBe(true);
    expect(used(s.bag)).toBe(1);
    expect(s.offers.find((o) => o.id === id)).toBeUndefined();
    expect(s.carried).toHaveLength(1);
    expect(s.carried[0]?.leg).toBe("TO_PICKUP");
  });

  /**
   * The customer was promised a time when they ordered, not when a rider
   * happened to accept. So the window runs from placement, and an offer that
   * sat in the queue arrives with less of it left — which is what makes a fresh
   * order worth more than a stale one.
   */
  it("runs the deadline from when the order was placed", () => {
    const s = onDuty(3);
    const order = s.offers[0]!;
    const window = E.tiers[order.tier].window;
    idle(s, 6);
    accept(s, order.id);

    expect(order.dueAt).toBeCloseTo(order.offeredAt + window, 6);
    // The six minutes it sat in the queue came out of the rider's window.
    expect(order.dueAt - s.clock).toBeLessThan(window);
  });

  it("never hands over an order already out of time", () => {
    const s = onDuty(4);
    for (let i = 0; i < 6 && s.offers.length > 0; i++) idle(s, 2);
    const order = s.offers[0];
    if (!order) return;
    accept(s, order.id);

    const left = order.dueAt - s.clock;
    expect(left).toBeGreaterThan(0);
    expect(left).toBeGreaterThanOrEqual(
      E.tiers[order.tier].window * E.staleOrderFloor - 1e-6,
    );
  });

  it("refuses an unknown id", () => {
    const s = onDuty(3);
    expect(accept(s, "nope")).toBe(false);
    expect(canAccept(s, "nope")).toBe(false);
  });

  it("refuses to accept once the bag is full", () => {
    const s = onDuty(9);
    idle(s, 200); // let plenty of offers pile up
    let taken = 0;
    for (const o of [...s.offers]) {
      if (accept(s, o.id)) taken += 1;
    }
    expect(taken).toBeLessThanOrEqual(5);
    expect(used(s.bag)).toBe(taken);
  });

  it("drops a rejected offer from the queue", () => {
    const s = onDuty(4);
    const id = s.offers[0]!.id;
    expect(reject(s, id)).toBe(true);
    expect(s.offers.find((o) => o.id === id)).toBeUndefined();
    expect(reject(s, id)).toBe(false);
  });
});

describe("travel", () => {
  it("advances the clock by the travel time", () => {
    const s = createShift(2);
    // Rides are quoted through rideMinutes now, which scales the base travel
    // time by the current hour's congestion.
    const expected = rideMinutes(s, "qk", "d4");
    travelTo(s, "d4");
    expect(s.clock).toBeCloseTo(expected, 6);
    expect(s.locationId).toBe("d4");
  });

  it("charges expenses against the distance actually ridden", () => {
    const s = createShift(2);
    expect(s.unitsRidden).toBe(0);
    travelTo(s, "d4");
    expect(s.unitsRidden).toBeCloseTo(distance("qk", "d4"), 6);
  });

  it("costs nothing to stay where you are", () => {
    const s = createShift(2);
    travelTo(s, "qk");
    expect(s.clock).toBe(0);
  });

  it("expires offers that timed out while riding", () => {
    const s = onDuty(6);
    idle(s, 30);
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
    const s = onDuty(11);
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
    const s = onDuty(11);
    // Biryani Junction has a long prep; ride straight there and stand around.
    const order = [...s.offers].find((o) => o.pickupId === "bj");
    if (!order) return; // seed-dependent; other tests cover the general case
    accept(s, order.id);
    travelTo(s, "bj");
    expect(s.carried[0]?.waited).toBeGreaterThanOrEqual(0);
    expect(s.clock).toBeGreaterThanOrEqual(order.offeredAt + order.truePrep - 1e-9);
  });

  it("pays half for a late delivery", () => {
    const s = onDuty(11);
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
    const s = onDuty(21);
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
    const s = onDuty(11);
    const order = s.offers[0]!;
    accept(s, order.id);
    travelTo(s, order.pickupId);
    travelTo(s, order.dropId);

    const sum = endShift(s);
    expect(sum.ordersDelivered).toBe(1);
    expect(sum.milestones).toBe(0);
    // Fixed daily cost, plus energy billed as it burnt, plus wear on the vehicle.
    const vehicle = E.vehicles.find((v) => v.id === E.startVehicleId)!;
    expect(sum.expenses).toBe(
      Math.round(E.dailyExpenses + sum.unitsRidden * vehicle.upkeepPerKm + sum.energySpent),
    );
    expect(sum.expenses).toBeGreaterThan(E.dailyExpenses);
    expect(sum.net).toBe(sum.fees + sum.milestones - sum.expenses);
  });

  it("counts orders still in the bag as undelivered", () => {
    const s = onDuty(11);
    accept(s, s.offers[0]!.id);
    const sum = endShift(s);
    expect(sum.undelivered).toBe(1);
    expect(sum.ordersDelivered).toBe(0);
  });

  it("reports the day as over once the clock runs out", () => {
    const s = createShift(1);
    expect(isOver(s)).toBe(false);
    idle(s, E.dayMinutes);
    expect(isOver(s)).toBe(true);
  });
});
