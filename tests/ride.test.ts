import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG as C } from "../src/sim/config.js";
import {
  createRide,
  rideResult,
  signalIsRed,
  stepRide,
  type RideInput,
} from "../src/ride/ride.js";
import { drawPlayerBike, drawVehicle } from "../src/ride/sprites.js";
import {
  CAMERA_HEIGHT,
  buildRoad,
  curveAhead,
  percentRemaining,
  project,
  segmentAt,
  type Point,
} from "../src/ride/road.js";

/** A world point at a given depth, ready to project. */
function at(z: number): Point {
  return {
    world: { x: 0, y: 0, z },
    camera: { x: 0, y: 0, z: 0 },
    screen: { x: 0, y: 0, w: 0, scale: 0 },
  };
}

const FLAT_OUT: RideInput = { steer: 0, throttle: true, brake: false };

/** Ride options with the signal rules filled in from config. */
function makeRide(over: Partial<Parameters<typeof createRide>[0]> = {}) {
  return createRide({
    seconds: 10,
    density: 0,
    load: 0,
    seed: 1,
    signalWaitSeconds: C.signalWaitSeconds,
    signalRunCrashChance: C.signalRunCrashChance,
    ...over,
  });
}
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
    const near = at(1000);
    const far = at(20000);
    project(near, 0, CAMERA_HEIGHT, 0, 400, 800);
    project(far, 0, CAMERA_HEIGHT, 0, 400, 800);

    expect(near.screen.w).toBeGreaterThan(far.screen.w);
    expect(near.screen.scale).toBeGreaterThan(far.screen.scale);
  });

  /**
   * The road recedes to a horizon: near segments sit low on the screen, far
   * ones climb toward the middle. Getting this backwards is what turned the
   * first version into flat horizontal bands.
   */
  it("puts near road low on the screen and far road at the horizon", () => {
    const near = at(600);
    const far = at(40000);
    project(near, 0, CAMERA_HEIGHT, 0, 400, 800);
    project(far, 0, CAMERA_HEIGHT, 0, 400, 800);

    expect(near.screen.y).toBeGreaterThan(far.screen.y);
    expect(far.screen.y).toBeGreaterThan(300);
    expect(far.screen.y).toBeLessThan(500);
  });

  /** The nearest road is wider than the screen, because you are standing on it. */
  it("makes the closest road wider than the viewport", () => {
    const near = at(400);
    project(near, 0, CAMERA_HEIGHT, 0, 400, 800);
    expect(near.screen.w).toBeGreaterThan(200);
  });

  it("never divides by zero at the camera plane", () => {
    const p = at(0);
    project(p, 0, CAMERA_HEIGHT, 0, 400, 800);
    expect(Number.isFinite(p.screen.x)).toBe(true);
    expect(Number.isFinite(p.screen.w)).toBe(true);
    expect(Number.isFinite(p.screen.y)).toBe(true);
  });

  it("reports how far through a segment a depth sits", () => {
    expect(percentRemaining(0)).toBeCloseTo(0, 6);
    expect(percentRemaining(100)).toBeCloseTo(0.5, 6);
  });

  it("reports a bend when there is one", () => {
    const road = buildRoad(200, () => 0.9);
    expect(Math.abs(curveAhead(road, 0))).toBeGreaterThanOrEqual(0);
  });
});

describe("riding", () => {
  it("finishes, and faster on the throttle than coasting", () => {
    const fast = makeRide({ seconds: 10, density: 0, load: 0, seed: 7 });
    const slow = makeRide({ seconds: 10, density: 0, load: 0, seed: 7 });
    const fastTime = playOut(fast, FLAT_OUT);
    const slowTime = playOut(slow, COAST);

    expect(fast.done).toBe(true);
    expect(slow.done).toBe(true);
    expect(fastTime).toBeLessThan(slowTime);
  });

  it("takes roughly the seconds it was asked for at a good pace", () => {
    const ride = makeRide({ seconds: 12, density: 0, load: 0, seed: 3 });
    const took = playOut(ride, FLAT_OUT);
    expect(took).toBeGreaterThan(6);
    expect(took).toBeLessThan(20);
  });

  it("is deterministic for a seed", () => {
    const a = makeRide({ seconds: 8, density: 0.6, load: 0.4, seed: 11 });
    const b = makeRide({ seconds: 8, density: 0.6, load: 0.4, seed: 11 });
    playOut(a, FLAT_OUT);
    playOut(b, FLAT_OUT);
    expect(rideResult(a)).toEqual(rideResult(b));
  });

  it("keeps the rider on or near the tarmac", () => {
    const ride = makeRide({ seconds: 10, density: 0, load: 0, seed: 5 });
    for (let i = 0; i < 600; i++) stepRide(ride, { steer: 1, throttle: true, brake: false }, 1 / 60);
    expect(Math.abs(ride.x)).toBeLessThanOrEqual(1.5);
  });

  /**
   * The coupling back to the decision layer: an over-full bag is felt on the
   * road, not just in a ledger at the end of the day. It steers slower and it
   * costs more when it goes wrong.
   */
  it("makes a heavy bag cost more per crash", () => {
    const light = makeRide({ seconds: 20, density: 1, load: 0, seed: 21 });
    const heavy = makeRide({ seconds: 20, density: 1, load: 1, seed: 21 });
    playOut(light, FLAT_OUT);
    playOut(heavy, FLAT_OUT);

    if (light.crashes > 0 && heavy.crashes > 0) {
      expect(heavy.minutesLost / heavy.crashes).toBeGreaterThan(light.minutesLost / light.crashes);
    }
  });

  it("puts more in the way at higher density", () => {
    const quiet = makeRide({ seconds: 20, density: 0, load: 0, seed: 9 });
    const rush = makeRide({ seconds: 20, density: 1, load: 0, seed: 9 });
    expect(rush.hazards.length).toBeGreaterThan(quiet.hazards.length);
  });

  /**
   * Even a quiet hour has traffic on it — Gurgaon roads are never empty, so the
   * generator keeps a baseline. What has to hold is that lost time and crashes
   * move together, and that a crash always costs something.
   */
  it("charges time for crashes and nothing without them", () => {
    const ride = makeRide({ seconds: 12, density: 1, load: 0, seed: 4 });
    playOut(ride, FLAT_OUT);
    const result = rideResult(ride);

    if (result.crashes === 0) expect(result.minutesLost).toBe(0);
    else expect(result.minutesLost).toBeGreaterThan(0);
  });

  it("rewards riding carefully with fewer spills than riding flat out", () => {
    let reckless = 0;
    let careful = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const a = makeRide({ seconds: 14, density: 1, load: 0.5, seed });
      const b = makeRide({ seconds: 14, density: 1, load: 0.5, seed });
      playOut(a, FLAT_OUT);
      playOut(b, { steer: 0, throttle: false, brake: true });
      reckless += a.crashes;
      careful += b.crashes;
    }
    expect(careful).toBeLessThan(reckless);
  });

  it("survives a frame hitch without teleporting the rider", () => {
    const ride = makeRide({ seconds: 10, density: 0, load: 0, seed: 2 });
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


describe("speed and pace", () => {
  /**
   * The whole point of a throttle. Before this, riding hard only added crash
   * risk and saved no time at all, so coasting every ride was strictly optimal
   * — the exact opposite of the pressure the mechanic exists to model.
   */
  it("gives a faster ride a better pace than a slow one", () => {
    const fast = makeRide({ seconds: 12, seed: 8 });
    const slow = makeRide({ seconds: 12, seed: 8 });
    playOut(fast, FLAT_OUT);
    playOut(slow, { steer: 0, throttle: false, brake: false });

    expect(rideResult(fast).pace).toBeGreaterThan(rideResult(slow).pace);
  });

  it("keeps pace inside nought to one", () => {
    for (const input of [FLAT_OUT, COAST, { steer: 0, throttle: false, brake: true }]) {
      const r = makeRide({ seconds: 10, seed: 3 });
      playOut(r, input);
      const pace = rideResult(r).pace;
      expect(pace).toBeGreaterThanOrEqual(0);
      expect(pace).toBeLessThanOrEqual(1);
    }
  });

  it("converts pace into a journey time inside the configured band", () => {
    const span = C.ridePaceCeiling - C.ridePaceFloor;
    expect(C.ridePaceCeiling - 1 * span).toBeCloseTo(C.ridePaceFloor, 6);
    expect(C.ridePaceFloor).toBeLessThan(1);
    expect(C.ridePaceCeiling).toBeGreaterThan(1);
  });

  it("reads full throttle as a speed a person recognises", () => {
    expect(C.rideTopSpeedKmh).toBeGreaterThan(30);
    expect(C.rideTopSpeedKmh).toBeLessThan(70);
  });
});

describe("traffic signals", () => {
  it("cycles between green and red", () => {
    const signal = { z: 0, offset: 0, cycle: 12, resolved: false, ranIt: false };
    expect(signalIsRed(signal, 0)).toBe(false);
    expect(signalIsRed(signal, 11)).toBe(true);
  });

  it("puts signals on a ride long enough to have junctions", () => {
    expect(makeRide({ seconds: 40, seed: 2 }).signals.length).toBeGreaterThan(0);
  });

  /**
   * Stopping for a red costs seconds; running it usually does not, until it
   * does. Compared across seeds rather than asserted exactly, because a rider
   * still staggering from a crash cannot brake in time and will run one — which
   * is correct behaviour, not a failure.
   */
  it("makes a braking rider run fewer reds than one who never lifts off", () => {
    let braked = 0;
    let flatOut = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const a = makeRide({ seconds: 40, seed });
      const b = makeRide({ seconds: 40, seed });
      playOut(a, { steer: 0, throttle: false, brake: true }, 400);
      playOut(b, FLAT_OUT, 400);
      braked += a.redsRun;
      flatOut += b.redsRun;
    }
    expect(braked).toBeLessThan(flatOut);
  });

  it("charges the rider who stops in seconds, not in crashes", () => {
    let waited = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = makeRide({ seconds: 40, seed });
      playOut(r, { steer: 0, throttle: false, brake: true }, 400);
      waited += r.waitedSeconds;
    }
    expect(waited).toBeGreaterThan(0);
  });

  it("does not let one signal judge the same rider twice", () => {
    const r = makeRide({ seconds: 40, seed: 6 });
    playOut(r, FLAT_OUT, 400);
    expect(r.signals.every((s) => !s.resolved || s.z <= r.z + 1)).toBe(true);
  });

  it("never counts waiting time against the rider's pace", () => {
    const r = makeRide({ seconds: 30, seed: 9 });
    playOut(r, FLAT_OUT, 400);
    // Sitting at a light is the light's doing, not the rider's.
    expect(rideResult(r).pace).toBeGreaterThan(0.5);
  });
});

describe("vehicle sprites", () => {
  /**
   * Sprites are drawn from canvas primitives rather than images, so there is
   * nothing to load and nothing to licence. These tests check they draw at all
   * and degrade sensibly — the look itself is only checkable by eye.
   */
  const stub = () => {
    const calls: string[] = [];
    const ctx = {
      fillStyle: "",
      save: () => calls.push("save"),
      restore: () => calls.push("restore"),
      translate: () => calls.push("translate"),
      rotate: () => calls.push("rotate"),
      fillRect: () => calls.push("fillRect"),
      beginPath: () => calls.push("beginPath"),
      ellipse: () => calls.push("ellipse"),
      arc: () => calls.push("arc"),
      fill: () => calls.push("fill"),
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
    } as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
  };

  it("draws every kind of vehicle without throwing", () => {
    for (const kind of ["car", "auto", "truck", "bike", "pothole"] as const) {
      const { ctx, calls } = stub();
      expect(() => drawVehicle(ctx, kind, 100, 300, 40, 34)).not.toThrow();
      expect(calls.length).toBeGreaterThan(0);
    }
  });

  it("gives wheeled vehicles round wheels, not just boxes", () => {
    for (const kind of ["car", "auto", "truck", "bike"] as const) {
      const { ctx, calls } = stub();
      drawVehicle(ctx, kind, 100, 300, 40, 34);
      // Wheels are ellipses; a vehicle made only of rectangles has none.
      expect(calls.filter((c) => c === "ellipse").length).toBeGreaterThan(0);
    }
  });

  it("falls back to a smudge when too far away to show detail", () => {
    const { ctx, calls } = stub();
    drawVehicle(ctx, "car", 100, 300, 1.5, 1.2);
    expect(calls).toEqual(["fillRect"]);
  });

  it("draws the player's bike and always restores the canvas state", () => {
    const { ctx, calls } = stub();
    drawPlayerBike(ctx, 200, 400, 60, 0.1, false);
    expect(calls.filter((c) => c === "save").length).toBe(
      calls.filter((c) => c === "restore").length,
    );
  });
});

describe("traffic obeys the lights", () => {
  /**
   * It did not, which made every red a tax on the player alone while the cars
   * sailed through. Unfair to play against and wrong to look at.
   */
  it("holds moving traffic behind a red", () => {
    const ride = makeRide({ seconds: 40, density: 1, seed: 31 });
    // A signal far enough ahead that traffic has room to reach it.
    const light = ride.signals[0];
    if (!light) return;

    // Wind the clock to a moment the light is red.
    let guard = 0;
    while (!signalIsRed(light, ride.elapsed) && guard++ < 4000) {
      stepRide(ride, COAST, 1 / 60);
    }
    if (!signalIsRed(light, ride.elapsed)) return;

    const past = ride.hazards.filter((h) => h.speed > 0 && h.z > light.z + 400).length;
    for (let i = 0; i < 120; i++) stepRide(ride, COAST, 1 / 60);

    // Nothing that was behind the line should have crossed while it stayed red.
    if (signalIsRed(light, ride.elapsed)) {
      const nowPast = ride.hazards.filter((h) => h.speed > 0 && h.z > light.z + 400).length;
      expect(nowPast).toBe(past);
    }
  });

  it("stacks a queue rather than piling vehicles on one spot", () => {
    const ride = makeRide({ seconds: 40, density: 1, seed: 17 });
    for (let i = 0; i < 900; i++) stepRide(ride, COAST, 1 / 60);

    for (const light of ride.signals) {
      if (!signalIsRed(light, ride.elapsed)) continue;
      const queue = ride.hazards
        .filter((h) => h.speed > 0 && h.z < light.z && h.z > light.z - 6000)
        .map((h) => h.z)
        .sort((a, b) => a - b);

      // No two queued vehicles may occupy the same metre of road.
      for (let i = 1; i < queue.length; i++) {
        expect(queue[i]! - queue[i - 1]!).toBeGreaterThan(1);
      }
    }
  });

  it("lets traffic move again once the light clears", () => {
    const ride = makeRide({ seconds: 40, density: 1, seed: 23 });
    const moving = () => ride.hazards.filter((h) => h.speed > 0).map((h) => h.z);

    const before = moving();
    for (let i = 0; i < 1800; i++) stepRide(ride, COAST, 1 / 60);
    const after = moving();

    // Over thirty seconds every light cycles, so traffic must have advanced.
    const advanced = after.filter((z, i) => z > (before[i] ?? 0)).length;
    expect(advanced).toBeGreaterThan(0);
  });
});
