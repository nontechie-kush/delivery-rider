import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG as C,
  energyCost,
  refillStopsFor,
  runningCost,
  vehicleOf,
} from "../src/sim/config.js";
import { canRefill, createShift, nearestRefill, refill, travelTo } from "../src/sim/shift.js";

const activa = vehicleOf("activa", C);
const eswap = vehicleOf("eswap", C);

describe("real running costs", () => {
  /**
   * Petrol is ₹102.97/L in Gurgaon and an Activa returns about 47 km/l in
   * traffic, which is ₹2.19 a kilometre. A swap scooter is about a tenth of
   * that. If these ever drift far from reality the vehicle ladder stops meaning
   * anything, because the whole ladder is that one gap.
   */
  it("prices petrol near ₹2.19/km, matching pump price over real mileage", () => {
    expect(activa.costPerKm).toBeCloseTo(102.97 / 47, 1);
    expect(energyCost(10, activa)).toBeCloseTo(21.9, 1);
  });

  it("prices electric around a tenth of petrol", () => {
    expect(eswap.costPerKm).toBeLessThan(activa.costPerKm / 8);
    expect(eswap.costPerKm).toBeGreaterThan(0.1);
  });

  it("still charges wear on top of energy", () => {
    expect(runningCost(10, activa)).toBeGreaterThan(energyCost(10, activa));
  });

  it("gives the Activa about a 250 km tank and the swap scooter about 70", () => {
    expect(activa.rangeKm).toBeGreaterThan(200);
    expect(eswap.rangeKm).toBeLessThan(100);
  });
});

describe("burning range", () => {
  it("spends range on every kilometre ridden", () => {
    const s = createShift(1, C);
    const before = s.rangeLeft;
    travelTo(s, "d5");
    expect(s.rangeLeft).toBeLessThan(before);
    expect(s.rangeLeft).toBeCloseTo(before - s.unitsRidden, 6);
  });

  /**
   * Running dry must never soft-lock the day. You push it at walking pace,
   * which costs far more than the fuel would have.
   */
  it("lets the rider push it home rather than stranding them", () => {
    const s = createShift(1, C);
    s.rangeLeft = 0.2;
    const before = s.clock;
    travelTo(s, "d5");
    expect(s.locationId).toBe("d5");
    expect(s.clock - before).toBeGreaterThan(30);
    expect(s.log.some((l) => l.includes("Pushed it"))).toBe(true);
  });
});

describe("refilling", () => {
  it("is only possible at a stop that serves this vehicle", () => {
    const s = createShift(1, C);
    s.rangeLeft = 10;

    s.locationId = "qk";
    expect(canRefill(s)).toBe(false);

    s.locationId = refillStopsFor(activa, C)[0]!;
    expect(canRefill(s)).toBe(true);
  });

  it("refuses when the tank is already full", () => {
    const s = createShift(1, C);
    s.locationId = refillStopsFor(activa, C)[0]!;
    expect(canRefill(s)).toBe(false);
  });

  /**
   * Energy is billed kilometre by kilometre as it burns, not at the pump, so
   * that every ride is priced at the moment the player decides to take it — a
   * tank bought yesterday still costs you something today. Over a day the money
   * is identical either way; only one of them prices the decision.
   *
   * What the stop buys is therefore range and nothing else, and it costs time.
   */
  it("restores range and costs time, but bills nothing extra", () => {
    const s = createShift(1, C);
    s.locationId = refillStopsFor(activa, C)[0]!;
    s.rangeLeft = activa.rangeKm - 100;
    const at = s.clock;
    const spentBefore = s.energySpent;

    expect(refill(s)).toBe(true);
    expect(s.rangeLeft).toBeCloseTo(activa.rangeKm, 6);
    expect(s.clock).toBeGreaterThan(at);
    expect(s.energySpent).toBe(spentBefore);
  });

  it("charges for the fuel as it is burnt, at the real per-km rate", () => {
    const s = createShift(1, C);
    travelTo(s, "d5");
    expect(s.energySpent).toBeCloseTo(energyCost(s.unitsRidden, activa), 4);
  });

  it("swaps a battery faster than a petrol fill takes", () => {
    expect(eswap.refillMinutes).toBeLessThan(activa.refillMinutes);
  });

  it("points at the nearest stop this vehicle can actually use", () => {
    const s = createShift(1, C);
    const stop = nearestRefill(s);
    expect(stop).not.toBeNull();
    expect(refillStopsFor(activa, C)).toContain(stop!.nodeId);
  });

  it("sends electric riders to swap stations, not pumps", () => {
    const cfg = { ...C, startVehicleId: "eswap" };
    const s = createShift(1, cfg);
    expect(cfg.swapStops).toContain(nearestRefill(s)!.nodeId);
    expect(cfg.fuelStops).not.toContain(nearestRefill(s)!.nodeId);
  });
});
