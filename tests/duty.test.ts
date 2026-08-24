import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG as C } from "../src/sim/config.js";
import {
  acceptanceRate,
  bookableSlots,
  commit,
  createDuty,
  goOffline,
  goOnline,
  incentivesVoid,
  recordAccept,
  recordDelivery,
  recordIgnored,
  recordReject,
  settleSlot,
} from "../src/sim/duty.js";

const at = (hour: number) => (hour - C.dayStartHour) * 60;
const evening = C.slots.find((s) => s.id === "evening")!;

/** Deliveries completed inside the window. */
function deliver(duty: ReturnType<typeof createDuty>, count: number) {
  for (let i = 0; i < count; i++) recordDelivery(duty, at(evening.fromHour) + 30, C);
}

/** A rider who booked the evening slot, showed up for all of it, and worked. */
function goodDay() {
  const duty = createDuty();
  commit(duty, evening.id, at(9), C);
  goOnline(duty, at(evening.fromHour));
  deliver(duty, evening.minDeliveries);
  goOffline(duty, at(evening.toHour), C);
  return duty;
}

describe("booking a slot", () => {
  it("only offers slots that have not started", () => {
    const morning = bookableSlots(at(6), C).map((s) => s.id);
    expect(morning).toContain("evening");

    const late = bookableSlots(at(20), C).map((s) => s.id);
    expect(late).not.toContain("evening");
  });

  it("refuses a second booking", () => {
    const duty = createDuty();
    expect(commit(duty, "evening", at(9), C)).toBe(true);
    expect(commit(duty, "lunch", at(9), C)).toBe(false);
  });

  it("refuses a slot already under way", () => {
    expect(commit(createDuty(), "evening", at(20), C)).toBe(false);
  });
});

describe("settling the guarantee", () => {
  it("pays out when the rider works the whole window", () => {
    const outcome = settleSlot(goodDay(), at(23), C)!;
    expect(outcome.met).toBe(true);
    expect(outcome.present).toBeCloseTo(outcome.required, 6);
  });

  /**
   * The One Order Trap, in miniature. Real riders describe finishing 22 of a
   * required 23 and taking home ₹350 instead of ₹845 — the guarantee is all or
   * nothing, and being one short is worth exactly the same as not trying.
   */
  it("pays nothing when the rider is even slightly short", () => {
    const duty = createDuty();
    commit(duty, evening.id, at(9), C);
    goOnline(duty, at(evening.fromHour));
    deliver(duty, evening.minDeliveries);
    goOffline(duty, at(evening.toHour) - 20, C);

    const outcome = settleSlot(duty, at(23), C)!;
    expect(outcome.met).toBe(false);
    expect(outcome.reason).toBeTruthy();
  });

  it("voids the guarantee when the rider steps away mid-window", () => {
    const duty = createDuty();
    commit(duty, evening.id, at(9), C);
    goOnline(duty, at(evening.fromHour));
    goOffline(duty, at(evening.fromHour) + 60, C);
    // Coming back does not undo it.
    goOnline(duty, at(evening.fromHour) + 90);
    goOffline(duty, at(evening.toHour), C);

    const outcome = settleSlot(duty, at(23), C)!;
    expect(outcome.met).toBe(false);
    expect(outcome.reason).toMatch(/off duty/);
  });

  it("voids the guarantee on one rejection past the allowance", () => {
    const duty = createDuty();
    commit(duty, evening.id, at(9), C);
    goOnline(duty, at(evening.fromHour));

    for (let i = 0; i <= evening.rejectionsAllowed; i++) {
      recordReject(duty, at(evening.fromHour) + 10, C);
    }
    goOffline(duty, at(evening.toHour), C);

    const outcome = settleSlot(duty, at(23), C)!;
    expect(outcome.met).toBe(false);
    expect(outcome.reason).toMatch(/rejected/);
  });

  it("ignores rejections made outside the booked window", () => {
    const duty = createDuty();
    commit(duty, evening.id, at(9), C);
    goOnline(duty, at(14));
    for (let i = 0; i < 5; i++) recordReject(duty, at(14), C);
    goOffline(duty, at(15), C);

    goOnline(duty, at(evening.fromHour));
    deliver(duty, evening.minDeliveries);
    goOffline(duty, at(evening.toHour), C);

    expect(settleSlot(duty, at(23), C)!.met).toBe(true);
  });

  it("returns nothing when no slot was booked", () => {
    expect(settleSlot(createDuty(), at(23), C)).toBeNull();
  });
});

describe("acceptance rate", () => {
  it("withholds judgement until enough decisions have been made", () => {
    const duty = createDuty();
    recordAccept(duty);
    expect(acceptanceRate(duty, C)).toBeNull();
    expect(incentivesVoid(duty, C)).toBe(false);
  });

  it("counts explicit rejections, not offers that simply expired", () => {
    const duty = createDuty();
    for (let i = 0; i < 8; i++) recordAccept(duty);
    for (let i = 0; i < 2; i++) recordReject(duty, at(14), C);
    expect(acceptanceRate(duty, C)).toBeCloseTo(0.8, 6);
  });

  /**
   * Cherry-picking is what earns more per order and what destroys your standing.
   * Platforms void the day's incentives below 80-90% and do not accept distance,
   * traffic or an unsafe area as a reason — which is why riders take orders they
   * know are bad for them.
   */
  it("voids the day's incentives once the rider drops below the floor", () => {
    const duty = createDuty();
    for (let i = 0; i < 7; i++) recordAccept(duty);
    for (let i = 0; i < 3; i++) recordReject(duty, at(14), C);
    expect(acceptanceRate(duty, C)!).toBeLessThan(C.minAcceptanceRate);
    expect(incentivesVoid(duty, C)).toBe(true);
  });
});

describe("time on duty", () => {
  it("accrues only while online", () => {
    const duty = createDuty();
    goOnline(duty, at(12));
    goOffline(duty, at(14), C);
    expect(duty.minutesOnline).toBe(120);

    // Two hours off the clock add nothing.
    goOnline(duty, at(16));
    goOffline(duty, at(17), C);
    expect(duty.minutesOnline).toBe(180);
  });

  it("refuses to go online twice or offline while already off", () => {
    const duty = createDuty();
    expect(goOnline(duty, 0)).toBe(true);
    expect(goOnline(duty, 10)).toBe(false);
    expect(goOffline(duty, 20, C)).toBe(true);
    expect(goOffline(duty, 30, C)).toBe(false);
  });
});


describe("the minimum delivery count", () => {
  /**
   * Before this term existed you could book the dinner guarantee, go online,
   * stand still for four hours and collect ₹880 for doing nothing — which was
   * strictly better than working. This is the term that makes booking a bet.
   */
  it("pays nothing to a rider who books, shows up and does no work", () => {
    const duty = createDuty();
    commit(duty, evening.id, at(9), C);
    goOnline(duty, at(evening.fromHour));
    goOffline(duty, at(evening.toHour), C);

    const outcome = settleSlot(duty, at(23), C)!;
    expect(outcome.delivered).toBe(0);
    expect(outcome.met).toBe(false);
    expect(outcome.reason).toMatch(/delivered 0/);
  });

  /** One short pays exactly the same as never showing up. */
  it("pays nothing for one delivery short", () => {
    const duty = createDuty();
    commit(duty, evening.id, at(9), C);
    goOnline(duty, at(evening.fromHour));
    deliver(duty, evening.minDeliveries - 1);
    goOffline(duty, at(evening.toHour), C);

    expect(settleSlot(duty, at(23), C)!.met).toBe(false);
  });

  it("pays out on exactly the required number", () => {
    expect(settleSlot(goodDay(), at(23), C)!.met).toBe(true);
  });

  it("ignores deliveries made outside the window", () => {
    const duty = createDuty();
    commit(duty, evening.id, at(9), C);
    goOnline(duty, at(13));
    for (let i = 0; i < 30; i++) recordDelivery(duty, at(13), C);
    goOffline(duty, at(18), C);
    goOnline(duty, at(evening.fromHour));
    goOffline(duty, at(evening.toHour), C);

    expect(settleSlot(duty, at(23), C)!.delivered).toBe(0);
  });
});

describe("letting work go past", () => {
  /**
   * Real dispatch pushes one order at a time and ignoring it is declining it.
   * Standing idle while offers expire has to count, or doing nothing is free.
   */
  it("counts an ignored offer against acceptance", () => {
    const duty = createDuty();
    for (let i = 0; i < 6; i++) recordAccept(duty);
    for (let i = 0; i < 4; i++) recordIgnored(duty, at(14), C);
    expect(acceptanceRate(duty, C)!).toBeCloseTo(0.6, 6);
  });

  it("breaks a booked window once too many go past inside it", () => {
    const duty = createDuty();
    commit(duty, evening.id, at(9), C);
    goOnline(duty, at(evening.fromHour));
    for (let i = 0; i <= evening.rejectionsAllowed; i++) {
      recordIgnored(duty, at(evening.fromHour) + 5, C);
    }
    deliver(duty, evening.minDeliveries);
    goOffline(duty, at(evening.toHour), C);

    const outcome = settleSlot(duty, at(23), C)!;
    expect(outcome.met).toBe(false);
    expect(outcome.reason).toMatch(/go past/);
  });
});
