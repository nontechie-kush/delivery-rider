import { SEGMENT_LENGTH, buildRoad, curveAhead, type Segment } from "./road.js";

/**
 * The ride itself.
 *
 * Every study on algorithmic control found the same thing: time pressure makes
 * riders ride dangerously, because lateness is fined and caution is not paid
 * for. So speed here is a dial the player holds down, and holding it down is
 * how you make the delivery and also how you end up on the tarmac.
 *
 * Deliberately short. A hop is eight seconds, a cross-town run forty. The ride
 * exists to make the decision cost something, not to become the game.
 */

export interface Hazard {
  /** World depth. */
  z: number;
  /** Lateral position, -1 (far left) to 1 (far right). */
  x: number;
  /** Fraction of the rider's top speed this thing is doing. */
  speed: number;
  kind: "car" | "auto" | "truck" | "bike" | "pothole";
  width: number;
}

export interface RideState {
  road: Segment[];
  hazards: Hazard[];
  /** Camera depth along the road. */
  z: number;
  /** Rider lateral position, -1 to 1. */
  x: number;
  /** Current speed as a fraction of top speed. */
  speed: number;
  /** Depth at which the ride finishes. */
  finishZ: number;
  /** Real seconds the ride has run. */
  elapsed: number;
  /** Game-minutes lost to crashes. */
  minutesLost: number;
  crashes: number;
  /** Frames of stagger left after a hit. */
  stagger: number;
  done: boolean;
  /** How loaded the bag is, 0 to 1. Heavier handles worse. */
  load: number;
}

export interface RideResult {
  crashes: number;
  minutesLost: number;
  /** Average fraction of top speed held, for flavour in the log. */
  pace: number;
}

export interface RideOptions {
  /** Real seconds the ride should take at a good pace. */
  seconds: number;
  /** 0 to 1. Rush hour puts more between you and the drop. */
  density: number;
  /** 0 to 1. A full bag is slower to move and worse to stop. */
  load: number;
  seed: number;
}

const TOP_SPEED = 5200; // world units per second
const ACCEL = 2.4;
const BRAKE = 4.2;
const DRAG = 1.1;
/** Game-minutes added per crash, before the bag makes it worse. */
const CRASH_MINUTES = 2.5;

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRide(opts: RideOptions): RideState {
  const rand = mulberry(opts.seed);
  const finishZ = TOP_SPEED * opts.seconds * 0.82;
  const segmentCount = Math.ceil(finishZ / SEGMENT_LENGTH) + 120;
  const road = buildRoad(segmentCount, rand);

  // Traffic thins toward the start so the first second is never a wall.
  const hazards: Hazard[] = [];
  const count = Math.floor((finishZ / SEGMENT_LENGTH) * (0.12 + opts.density * 0.3));
  for (let i = 0; i < count; i++) {
    const z = 2600 + rand() * (finishZ - 3200);
    const roll = rand();
    const kind: Hazard["kind"] =
      roll < 0.34 ? "car" : roll < 0.55 ? "auto" : roll < 0.68 ? "truck" : roll < 0.88 ? "bike" : "pothole";

    hazards.push({
      z,
      x: (rand() - 0.5) * 1.55,
      speed: kind === "pothole" ? 0 : kind === "truck" ? 0.32 : kind === "bike" ? 0.55 : 0.42,
      kind,
      width: kind === "truck" ? 0.34 : kind === "pothole" ? 0.12 : kind === "bike" ? 0.13 : 0.24,
    });
  }

  return {
    road,
    hazards,
    z: 0,
    x: 0,
    speed: 0.34,
    finishZ,
    elapsed: 0,
    minutesLost: 0,
    crashes: 0,
    stagger: 0,
    done: false,
    load: opts.load,
  };
}

export interface RideInput {
  /** -1 steering left, 1 right, 0 straight. */
  steer: number;
  /** Held to accelerate. Letting go coasts; braking is the other direction. */
  throttle: boolean;
  brake: boolean;
}

/**
 * Advances the ride by `dt` real seconds.
 *
 * Load makes the bike heavier in exactly the way an over-full bag should: it
 * steers slower and it costs more when you hit something. That is the coupling
 * back to the decision layer — over-accepting is felt here, not just in a
 * ledger at the end of the day.
 */
export function stepRide(ride: RideState, input: RideInput, dt: number): void {
  if (ride.done) return;

  ride.elapsed += dt;

  // Speed.
  const staggered = ride.stagger > 0;
  if (staggered) {
    ride.stagger -= dt;
    ride.speed = Math.max(0.16, ride.speed - BRAKE * dt);
  } else if (input.brake) {
    ride.speed = Math.max(0.12, ride.speed - BRAKE * dt);
  } else if (input.throttle) {
    ride.speed = Math.min(1, ride.speed + ACCEL * dt * (1 - ride.load * 0.28));
  } else {
    ride.speed = Math.max(0.22, ride.speed - DRAG * dt * 0.4);
  }

  // Steering. A loaded bag turns like a loaded bag.
  const agility = 1.55 * (1 - ride.load * 0.35);
  ride.x += input.steer * agility * dt;

  // A bend throws you outward the faster you take it.
  const bend = curveAhead(ride.road, ride.z);
  ride.x -= bend * ride.speed * dt * 0.42;
  ride.x = Math.max(-1.45, Math.min(1.45, ride.x));

  // Off the tarmac is slow and rough, not fatal.
  const offRoad = Math.abs(ride.x) > 1;
  if (offRoad) ride.speed = Math.max(0.18, ride.speed - dt * 1.5);

  ride.z += TOP_SPEED * ride.speed * dt;

  // Traffic moves too, which is why the gaps close.
  for (const h of ride.hazards) {
    if (h.speed > 0) h.z += TOP_SPEED * h.speed * dt;
  }

  if (!staggered) checkCollisions(ride);

  if (ride.z >= ride.finishZ) ride.done = true;
}

function checkCollisions(ride: RideState): void {
  for (const h of ride.hazards) {
    const gap = h.z - ride.z;
    if (gap > 0 || gap < -420) continue;

    if (Math.abs(h.x - ride.x) < h.width + 0.1) {
      ride.crashes += 1;
      // A heavier bag hits harder and takes longer to get going again.
      ride.minutesLost += CRASH_MINUTES * (1 + ride.load * 0.6);
      ride.stagger = 0.75;
      // Shunt it aside so a single obstacle cannot hit twice.
      h.x += h.x > ride.x ? 1.4 : -1.4;
      h.z -= 900;
    }
  }
}

export function rideResult(ride: RideState): RideResult {
  return {
    crashes: ride.crashes,
    minutesLost: Math.round(ride.minutesLost * 10) / 10,
    pace: ride.elapsed > 0 ? Math.min(1, ride.z / ride.finishZ) : 0,
  };
}
