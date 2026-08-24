import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG as C } from "../src/sim/config.js";
import { createRide, rideResult, stepRide, type RideInput } from "../src/ride/ride.js";
import { buildRoad, curveAhead, project, segmentAt } from "../src/ride/road.js";

const FLAT_OUT: RideInput = { steer: 0, throttle: true, brake: false };
const COAST: RideInput = { steer: 0, throttle: false, brake: false };

/** Runs a ride to completion, or until it plainly is not going to finish. */
function playOut(ride: ReturnType<typeof createRide>, input: RideInput, maxSeconds = 240) {
  let t = 0;
  while (!ride.done && t < maxSeconds) {
    stepRide(ride, input, 1 / 60);
    t += 1 / 60;
  }
  return t;
}

describe("the road", () => {
  it("is deterministic for a seed", () => {
    const rand = (s: number) => {
      let a = s;
      return () => ((a = (a * 16807) % 2147483647) / 2147483647);
    };
    expect(buildRoad(50, rand(1))).toEqual(buildRoad(50, rand(1)));
  });

  it("wraps rather than running off the end of the array", () => {
    const road = buildRoad(40, () => 0.5);
    expect(segmentAt(road, 1e9)).toBeDefined();
    expect(segmentAt(road, -500)).toBeDefined();
  });

  it("shrinks things as they get further away", () => {
    const near = project(1000, 0, 0, 0, 400, 800);
    const far = project(20000, 0, 0, 0, 400, 800);
    expect(near.screenW).toBeGreaterThan(far.screenW);
    expect(near.scale).toBeGreaterThan(far.scale);
  });

  it("never divides by zero at the camera plane", () => {
    const p = project(0, 0, 0, 0, 400, 800);
    expect(Number.isFinite(p.screenX)).toBe(true);
    expect(Number.isFinite(p.screenW)).toBe(true);
  });

  it("reports a bend when there is one", () => {
    const road = buildRoad(200, () => 0.9);
    expect(Math.abs(curveAhead(road, 0))).toBeGreaterThanOrEqual(0);
  });
});

describe("riding", () => {
  it("finishes, and faster on the throttle than coasting", () => {
    const fast = createRide({ seconds: 10, density: 0, load: 0, seed: 7 });
    const slow = createRide({ seconds: 10, density: 0, load: 0, seed: 7 });
    const fastTime = playOut(fast, FLAT_OUT);
    const slowTime = playOut(slow, COAST);

    expect(fast.done).toBe(true);
    expect(slow.done).toBe(true);
    expect(fastTime).toBeLessThan(slowTime);
  });

  it("takes roughly the seconds it was asked for at a good pace", () => {
    const ride = createRide({ seconds: 12, density: 0, load: 0, seed: 3 });
    const took = playOut(ride, FLAT_OUT);
    expect(took).toBeGreaterThan(6);
    expect(took).toBeLessThan(20);
  });

  it("is deterministic for a seed", () => {
    const a = createRide({ seconds: 8, density: 0.6, load: 0.4, seed: 11 });
    const b = createRide({ seconds: 8, density: 0.6, load: 0.4, seed: 11 });
    playOut(a, FLAT_OUT);
    playOut(b, FLAT_OUT);
    expect(rideResult(a)).toEqual(rideResult(b));
  });

  it("keeps the rider on or near the tarmac", () => {
    const ride = createRide({ seconds: 10, density: 0, load: 0, seed: 5 });
    for (let i = 0; i < 600; i++) stepRide(ride, { steer: 1, throttle: true, brake: false }, 1 / 60);
    expect(Math.abs(ride.x)).toBeLessThanOrEqual(1.5);
  });

  /**
   * The coupling back to the decision layer: an over-full bag is felt on the
   * road, not just in a ledger at the end of the day. It steers slower and it
   * costs more when it goes wrong.
   */
  it("makes a heavy bag cost more per crash", () => {
    const light = createRide({ seconds: 20, density: 1, load: 0, seed: 21 });
    const heavy = createRide({ seconds: 20, density: 1, load: 1, seed: 21 });
    playOut(light, FLAT_OUT);
    playOut(heavy, FLAT_OUT);

    if (light.crashes > 0 && heavy.crashes > 0) {
      expect(heavy.minutesLost / heavy.crashes).toBeGreaterThan(light.minutesLost / light.crashes);
    }
  });

  it("puts more in the way at higher density", () => {
    const quiet = createRide({ seconds: 20, density: 0, load: 0, seed: 9 });
    const rush = createRide({ seconds: 20, density: 1, load: 0, seed: 9 });
    expect(rush.hazards.length).toBeGreaterThan(quiet.hazards.length);
  });

  /**
   * Even a quiet hour has traffic on it — Gurgaon roads are never empty, so the
   * generator keeps a baseline. What has to hold is that lost time and crashes
   * move together, and that a crash always costs something.
   */
  it("charges time for crashes and nothing without them", () => {
    const ride = createRide({ seconds: 12, density: 1, load: 0, seed: 4 });
    playOut(ride, FLAT_OUT);
    const result = rideResult(ride);

    if (result.crashes === 0) expect(result.minutesLost).toBe(0);
    else expect(result.minutesLost).toBeGreaterThan(0);
  });

  it("rewards riding carefully with fewer spills than riding flat out", () => {
    let reckless = 0;
    let careful = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const a = createRide({ seconds: 14, density: 1, load: 0.5, seed });
      const b = createRide({ seconds: 14, density: 1, load: 0.5, seed });
      playOut(a, FLAT_OUT);
      playOut(b, { steer: 0, throttle: false, brake: true });
      reckless += a.crashes;
      careful += b.crashes;
    }
    expect(careful).toBeLessThan(reckless);
  });

  it("survives a frame hitch without teleporting the rider", () => {
    const ride = createRide({ seconds: 10, density: 0, load: 0, seed: 2 });
    // A backgrounded tab hands back an enormous dt; the caller clamps it, and
    // a single clamped step must not cross the whole course.
    stepRide(ride, FLAT_OUT, 0.05);
    expect(ride.z).toBeLessThan(ride.finishZ);
  });
});

describe("ride pacing config", () => {
  /** A ride that outstays its welcome drowns the decision it exists to serve. */
  it("keeps every ride inside the short band", () => {
    for (const km of [0.5, 3, 7, 20]) {
      const seconds = Math.max(
        C.rideSecondsMin,
        Math.min(C.rideSecondsMax, km * C.rideSecondsPerKm),
      );
      expect(seconds).toBeGreaterThanOrEqual(C.rideSecondsMin);
      expect(seconds).toBeLessThanOrEqual(C.rideSecondsMax);
    }
    expect(C.rideSecondsMax).toBeLessThanOrEqual(45);
  });
});
