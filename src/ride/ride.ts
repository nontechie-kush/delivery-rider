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

/**
 * A signal on the road ahead.
 *
 * The one mechanic worth borrowing from city driving games rather than racers:
 * a red light is a genuine decision under time pressure. Stop and you lose four
 * seconds you may not have. Run it and you probably get away with it — until
 * you do not. That is exactly the trade the research describes riders making,
 * and unlike traffic it cannot be dodged by steering.
 */
export interface Signal {
  z: number;
  /** Seconds into its own cycle when the ride began. */
  offset: number;
  /** Total cycle length; red occupies the last third of it. */
  cycle: number;
  /** Set once the rider has passed, so one signal cannot judge them twice. */
  resolved: boolean;
  ranIt: boolean;
}

export type Weapon = "none" | "chain" | "bat";

/** Something lying in the road worth swerving for rather than away from. */
export interface Pickup {
  z: number;
  x: number;
  kind: Weapon;
  taken: boolean;
}

/** How the rider is dealing with whatever is in the way. */
export interface Combat {
  /** Seconds until the next strike is available. */
  cooldown: number;
  /** Seconds of swing left, for the animation and the hit window. */
  swing: number;
  /** Which way the last swing went, so it draws on the right side. */
  swingSide: -1 | 1;
  weapon: Weapon;
  landed: number;
  taken: number;
  /** Vehicles shoved clean off the road. */
  downed: number;
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
  /** Whether the rider is tucked in this frame — the renderer draws it. */
  squeezing: boolean;
  /** Tired hands at the end of a shift: below 1 steers slower. */
  steerScale: number;
  /** Above 1 means the brakes take longer to haul the speed off. */
  brakeScale: number;
  /** Game-minutes lost to crashes. */
  minutesLost: number;
  crashes: number;
  /** Frames of stagger left after a hit. */
  stagger: number;
  done: boolean;
  /** How loaded the bag is, 0 to 1. Heavier handles worse. */
  load: number;
  signals: Signal[];
  /** Seconds left standing at a red. */
  waiting: number;
  /** Reds run without stopping. Shown at the end, because it is a choice.  */
  redsRun: number;
  /** Seconds lost sitting at lights. */
  waitedSeconds: number;
  /** Chance a run red goes wrong, and how long a red holds you. */
  signalWaitSeconds: number;
  signalRunCrashChance: number;
  signalRunStopChance: number;
  /** Rupees handed over to be waved on. */
  bribesPaid: number;
  /** A police stop in progress, waiting on the player to decide. */
  heldBy: PoliceStop | null;
  bribe: { min: number; max: number; seconds: number; argueSeconds: number; argueChance: number };
  pickups: Pickup[];
  combat: Combat;
  /** Tuning handed down from config so the ride stays self-contained. */
  rules: {
    hornYield: Record<string, number>;
    strikeCooldown: number;
    strikeReach: number;
    strikeShove: Record<string, number>;
    counterChance: Record<string, number>;
    counterStagger: number;
    squeezeWidth: number;
    squeezeSpeedCap: number;
  };
  rand: () => number;
}

/**
 * Being pulled over for jumping a red.
 *
 * Most jumped reds cost nothing, which is exactly why riders keep jumping them.
 * When one does not, the outcome is rarely a ticket — it is a negotiation, and
 * the choice between paying to move and arguing to save the money is the choice
 * a real rider makes at the side of the road with a delivery clock running.
 */
export interface PoliceStop {
  demanded: number;
  /** Set once the player picks, so the ride knows to resume. */
  settled: boolean;
}

export interface RideResult {
  crashes: number;
  minutesLost: number;
  /**
   * Average fraction of top speed actually held. Feeds straight back into how
   * long the journey took, so riding hard genuinely arrives sooner.
   */
  pace: number;
  redsRun: number;
  /** Rupees handed over at the roadside. */
  bribesPaid: number;
  /** Strikes landed, taken, and vehicles put off the road. */
  landed: number;
  taken: number;
  downed: number;
  weapon: Weapon;
}

export interface RideOptions {
  /** Real seconds the ride should take at a good pace. */
  seconds: number;
  /** 0 to 1. Rush hour puts more between you and the drop. */
  /** 0 to 1. A full bag is slower to move and worse to stop. */
  load: number;
  seed: number;
  signalWaitSeconds: number;
  signalRunCrashChance: number;
  signalRunStopChance: number;
  bribeMin: number;
  bribeMax: number;
  bribeSeconds: number;
  argueSeconds: number;
  argueSuccessChance: number;
  hornYieldChance: Record<string, number>;
  strikeCooldown: number;
  strikeReach: number;
  strikeShove: Record<string, number>;
  counterChance: Record<string, number>;
  counterStagger: number;
  squeezeWidth: number;
  squeezeSpeedCap: number;

  /** How hard the road should push, 0 calm to 1 the worst of the rush. */
  pressure: number;
  traffic: {
    breatherSecondsCalm: number;
    breatherSecondsPeak: number;
    rowGapSeconds: number;
    reactionFloorSeconds: number;
    rowsCalm: number;
    rowsPeak: number;
    laneJitter: number;
    minCentreGap: number;
  };
  /** End-of-shift modifiers. All 1 during the body of the day. */
  trafficCountScale: number;
  trafficSpeedScale: number;
  steerScale: number;
  brakeScale: number;
}

/** World units per second at full throttle. */
export const TOP_SPEED = 5200;
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

/** Lane centres across a road that runs from -1 to 1. */
const LANE_X = [-2 / 3, 0, 2 / 3];

/** Half the x a hazard denies the rider's centre. Mirrors checkCollisions. */
function blockedHalfWidth(h: Pick<Hazard, "width">): number {
  return h.width + 0.1;
}

/**
 * Whether a row of traffic leaves a line through it.
 *
 * Shared by the generator and by the test that guards it, so there is exactly
 * one definition of "passable" in the codebase. The rider's own width is
 * already inside blockedHalfWidth, so what this measures is the freedom left to
 * the rider's centre — and it insists on a real margin, because a gap that only
 * exists in the arithmetic is not one anybody can ride through.
 */
export function rowIsThreadable(row: readonly Hazard[], minCentreGap: number): boolean {
  if (row.length === 0) return true;

  const spans = row
    .map((h) => [h.x - blockedHalfWidth(h), h.x + blockedHalfWidth(h)] as const)
    .sort((a, b) => a[0] - b[0]);

  let cursor = -1;
  let widest = 0;
  for (const [from, to] of spans) {
    widest = Math.max(widest, from - cursor);
    cursor = Math.max(cursor, to);
  }
  widest = Math.max(widest, 1 - cursor);

  return widest >= minCentreGap;
}

const KIND_WIDTH: Record<Hazard["kind"], number> = {
  car: 0.24,
  auto: 0.24,
  truck: 0.34,
  bike: 0.13,
  pothole: 0.12,
};
const KIND_SPEED: Record<Hazard["kind"], number> = {
  car: 0.42,
  auto: 0.42,
  truck: 0.32,
  bike: 0.55,
  pothole: 0,
};

/** The closing speed a full-throttle rider makes on ordinary traffic. */
const REFERENCE_CLOSING = TOP_SPEED * 0.58;

/**
 * Lays out traffic as packs of rows with clear road between them.
 *
 * The old generator drew z and x uniformly at random, which produced 6.3
 * encounters a second at peak with a median of 0.10s to react to each — below
 * human reaction time, so the road was unplayable by construction rather than
 * by bad luck. A flat distribution also cannot produce a lull, and the lulls
 * are what let a player read the next pack.
 *
 * So: a pack is one to three rows, each row occupying at most two of the three
 * lanes, which is what guarantees a line through it. Rows within a pack sit
 * close enough to be taken as one movement; packs are separated by road that is
 * deliberately empty. Pressure tightens the breathers and adds rows, never
 * below the reaction floor.
 */
function buildTraffic(opts: RideOptions, finishZ: number, rand: () => number): Hazard[] {
  const t = opts.traffic;
  const pressure = Math.max(0, Math.min(1, opts.pressure));
  const lerp = (a: number, b: number): number => a + (b - a) * pressure;

  const breather =
    Math.max(t.reactionFloorSeconds, lerp(t.breatherSecondsCalm, t.breatherSecondsPeak)) /
    Math.max(0.2, opts.trafficCountScale);
  const rowGap = Math.max(t.reactionFloorSeconds, t.rowGapSeconds);
  const rows = lerp(t.rowsCalm, t.rowsPeak);

  const hazards: Hazard[] = [];
  // The first stretch is always clear: nobody should be met by a pack before
  // they have the bike moving.
  let z = 3400;

  while (z < finishZ - 3000) {
    // Fractional row counts resolve probabilistically, so a pressure of 1.6
    // rows means "sometimes one, usually two" rather than a hard step.
    const rowCount = Math.max(1, Math.floor(rows) + (rand() < rows % 1 ? 1 : 0));

    for (let r = 0; r < rowCount && z < finishZ - 3000; r++) {
      const row = buildRow(rand, z, opts, t.laneJitter, t.minCentreGap);
      hazards.push(...row);
      // Clear road is measured from the back of the row, so the gap the player
      // gets is the gap the config promised rather than that minus the stagger.
      z = Math.max(...row.map((h) => h.z)) + rowGap * REFERENCE_CLOSING;
    }

    z += breather * REFERENCE_CLOSING;
  }

  return hazards;
}

/**
 * One row: at most two of three lanes, so a lane is always open.
 *
 * The result is verified rather than assumed — jitter could in principle close
 * a gap the lane arithmetic promised, so a row that fails the check is placed
 * again without jitter, which always passes.
 */
function buildRow(
  rand: () => number,
  z: number,
  opts: RideOptions,
  jitter: number,
  minCentreGap: number,
): Hazard[] {
  // Which lane stays open. Everything else may be used.
  const openLane = Math.floor(rand() * LANE_X.length);
  const usable = LANE_X.filter((_, i) => i !== openLane);

  // One vehicle most of the time, two when the road is meant to bite.
  const take = rand() < 0.45 ? usable.length : 1;
  const lanes = usable.slice().sort(() => rand() - 0.5).slice(0, take);

  const build = (spread: number): Hazard[] =>
    lanes.map((lane, i) => {
      const roll = rand();
      const kind: Hazard["kind"] =
        roll < 0.34 ? "car" : roll < 0.55 ? "auto" : roll < 0.68 ? "truck" : roll < 0.88 ? "bike" : "pothole";
      return {
        // A row is not a perfectly straight line of cars; stagger it slightly
        // in z as well so it reads as traffic rather than as a fence. Forward
        // only: staggering backwards would eat the breather behind the row and
        // pull the reaction floor below what it promises.
        z: z + rand() * 380 + i * 60,
        x: lane + (rand() - 0.5) * spread,
        speed: KIND_SPEED[kind] * opts.trafficSpeedScale,
        kind,
        width: KIND_WIDTH[kind],
      };
    });

  const row = build(jitter * 2);
  return rowIsThreadable(row, minCentreGap) ? row : build(0);
}

export function createRide(opts: RideOptions): RideState {
  const rand = mulberry(opts.seed);
  const finishZ = TOP_SPEED * opts.seconds * 0.82;
  const segmentCount = Math.ceil(finishZ / SEGMENT_LENGTH) + 120;
  const road = buildRoad(segmentCount, rand);

  // Traffic as packs of vehicles separated by clear road, rather than a uniform
  // scatter. See buildTraffic for why the scatter had to go.
  const hazards = buildTraffic(opts, finishZ, rand);

  // Roughly one junction every few hundred metres, as a Gurgaon arterial has.
  const signals: Signal[] = [];
  const spacing = 16000;
  for (let z = spacing; z < finishZ - 3000; z += spacing * (0.7 + rand() * 0.7)) {
    signals.push({
      z,
      offset: rand() * 14,
      cycle: 12 + rand() * 8,
      resolved: false,
      ranIt: false,
    });
  }

  // A chain or a bat lying in the road, rarely. Finding one is the reward for
  // looking where you are going rather than only at what is in front.
  const pickups: Pickup[] = [];
  const weaponCount = Math.floor(finishZ / 90000);
  for (let i = 0; i < weaponCount; i++) {
    pickups.push({
      z: 6000 + rand() * (finishZ - 9000),
      x: (rand() - 0.5) * 1.3,
      kind: rand() < 0.6 ? "chain" : "bat",
      taken: false,
    });
  }

  return {
    road,
    hazards,
    signals,
    pickups,
    combat: {
      cooldown: 0,
      swing: 0,
      swingSide: 1,
      weapon: "none",
      landed: 0,
      taken: 0,
      downed: 0,
    },
    rules: {
      hornYield: opts.hornYieldChance,
      strikeCooldown: opts.strikeCooldown,
      strikeReach: opts.strikeReach,
      strikeShove: opts.strikeShove,
      counterChance: opts.counterChance,
      counterStagger: opts.counterStagger,
      squeezeWidth: opts.squeezeWidth,
      squeezeSpeedCap: opts.squeezeSpeedCap,
    },
    waiting: 0,
    redsRun: 0,
    waitedSeconds: 0,
    signalWaitSeconds: opts.signalWaitSeconds,
    signalRunCrashChance: opts.signalRunCrashChance,
    signalRunStopChance: opts.signalRunStopChance,
    bribesPaid: 0,
    heldBy: null,
    bribe: {
      min: opts.bribeMin,
      max: opts.bribeMax,
      seconds: opts.bribeSeconds,
      argueSeconds: opts.argueSeconds,
      argueChance: opts.argueSuccessChance,
    },
    rand,
    z: 0,
    x: 0,
    speed: 0.34,
    finishZ,
    elapsed: 0,
    minutesLost: 0,
    squeezing: false,
    steerScale: opts.steerScale,
    brakeScale: opts.brakeScale,
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
  /** Held. Traffic ahead may or may not care. */
  horn?: boolean;
  /** Held. Narrows the rider to thread a gap, at the cost of speed. */
  squeeze?: boolean;
  /** Tapped. Swings at whatever is alongside. */
  hit?: boolean;
}

/** Whether a signal is showing red at a given moment. Red is the last third. */
export function signalIsRed(signal: Signal, elapsed: number): boolean {
  const phase = (signal.offset + elapsed) % signal.cycle;
  return phase > signal.cycle * 0.66;
}

/** The next signal ahead of the rider, if there is one in sight. */
export function nextSignal(ride: RideState): Signal | null {
  let best: Signal | null = null;
  for (const s of ride.signals) {
    if (s.resolved || s.z < ride.z) continue;
    if (!best || s.z < best.z) best = s;
  }
  return best;
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

  // Held at the roadside until the player settles it.
  if (ride.heldBy && !ride.heldBy.settled) {
    ride.speed = 0;
    return;
  }

  ride.elapsed += dt;

  // Held at a red. Nothing else happens until it clears.
  if (ride.waiting > 0) {
    ride.waiting -= dt;
    ride.waitedSeconds += dt;
    ride.speed = 0;
    return;
  }

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

  // Squeezing: pull your elbows in and thread the gap. Narrower, but slower,
  // and there is nothing left in reserve if it turns out not to fit.
  const squeezing = input.squeeze === true;
  ride.squeezing = squeezing;
  if (squeezing) ride.speed = Math.min(ride.speed, ride.rules.squeezeSpeedCap);

  // Steering. A loaded bag turns like a loaded bag.
  const agility = 1.55 * (1 - ride.load * 0.35) * (squeezing ? 1.25 : 1) * ride.steerScale;
  ride.x += input.steer * agility * dt;

  if (input.horn === true) soundHorn(ride, dt);
  updateCombat(ride, input, dt);

  // A bend throws you outward the faster you take it.
  const bend = curveAhead(ride.road, ride.z);
  ride.x -= bend * ride.speed * dt * 0.42;
  ride.x = Math.max(-1.45, Math.min(1.45, ride.x));

  // Off the tarmac is slow and rough, not fatal.
  const offRoad = Math.abs(ride.x) > 1;
  if (offRoad) ride.speed = Math.max(0.18, ride.speed - dt * 1.5);

  ride.z += TOP_SPEED * ride.speed * dt;

  moveTraffic(ride, dt);

  if (!staggered) checkCollisions(ride, squeezing);
  collectPickups(ride);
  checkSignals(ride);

  if (ride.z >= ride.finishZ) ride.done = true;
}

/** Metres of road a queued vehicle occupies, nose to nose. */
const QUEUE_GAP = 620;
/** How far back a vehicle starts braking for a red. */
const BRAKING_ZONE = 9000;

/**
 * Traffic obeys the lights too.
 *
 * It did not, which made every red a tax on the player alone while the cars
 * sailed through — unfair to play against and wrong to look at. Now vehicles
 * queue at the stop line, nose to tail.
 *
 * The consequence is the thing worth having: a red light becomes a stationary
 * queue with gaps between the lanes, and filtering to the front of it is the
 * single most recognisable thing about riding a two-wheeler in an Indian city.
 * The light stops being a pure penalty and starts being a skill.
 */
function moveTraffic(ride: RideState, dt: number): void {
  // Where each red light is holding its queue, and how long that queue is.
  const queues = new Map<Signal, number>();

  for (const h of ride.hazards) {
    if (h.speed <= 0) continue;

    const light = redAhead(ride, h.z);
    if (!light) {
      h.z += TOP_SPEED * h.speed * dt;
      continue;
    }

    const queued = queues.get(light) ?? 0;
    const stopAt = light.z - 260 - queued * QUEUE_GAP;

    // Only vehicles close enough to see it are braking for it.
    if (h.z < stopAt - BRAKING_ZONE) {
      h.z += TOP_SPEED * h.speed * dt;
      continue;
    }

    h.z = Math.min(h.z + TOP_SPEED * h.speed * dt, stopAt);
    queues.set(light, queued + 1);
  }
}

/** The nearest signal ahead of a point that is showing red right now. */
function redAhead(ride: RideState, z: number): Signal | null {
  let best: Signal | null = null;
  for (const s of ride.signals) {
    if (s.z <= z) continue;
    if (!signalIsRed(s, ride.elapsed)) continue;
    if (!best || s.z < best.z) best = s;
  }
  return best;
}

/**
 * Leaning on the horn.
 *
 * Indian traffic runs on it, and what gives way tells you what you are behind:
 * a scooter usually moves, an auto might, a truck never does. It is the polite
 * half of the same instinct as the chain.
 */
function soundHorn(ride: RideState, dt: number): void {
  for (const h of ride.hazards) {
    const gap = h.z - ride.z;
    if (gap < 200 || gap > 5200) continue;
    if (Math.abs(h.x - ride.x) > 0.42) continue;

    const yields = ride.rules.hornYield[h.kind] ?? 0;
    if (yields <= 0) continue;
    // Per second, so a long hold works where a stab does not.
    if (ride.rand() > yields * dt * 2.2) continue;

    h.x += h.x >= ride.x ? 0.55 : -0.55;
    h.x = Math.max(-1.4, Math.min(1.4, h.x));
  }
}

/**
 * Swinging at whatever is alongside.
 *
 * A shove clears the lane instantly, which is faster than going round — and
 * that is the trade, because other riders and auto drivers hit back, and a
 * counter costs more than the detour would have. Bare-handed is a kick; a
 * chain has reach; a bat has neither subtlety nor a good reason to exist.
 */
function updateCombat(ride: RideState, input: RideInput, dt: number): void {
  const c = ride.combat;
  if (c.cooldown > 0) c.cooldown -= dt;
  if (c.swing > 0) c.swing -= dt;

  if (input.hit !== true || c.cooldown > 0) return;

  const reach = ride.rules.strikeReach + (c.weapon === "chain" ? 0.28 : c.weapon === "bat" ? 0.16 : 0);

  // Nearest thing alongside, either side.
  let target: Hazard | null = null;
  let best = Infinity;
  for (const h of ride.hazards) {
    const gap = h.z - ride.z;
    if (gap < -300 || gap > 900) continue;
    const side = Math.abs(h.x - ride.x);
    if (side > reach + h.width || side >= best) continue;
    best = side;
    target = h;
  }

  c.cooldown = ride.rules.strikeCooldown;
  c.swing = 0.28;
  c.swingSide = target && target.x < ride.x ? -1 : 1;
  if (!target) return;

  const shove = ride.rules.strikeShove[c.weapon] ?? 0.5;
  target.x += c.swingSide * shove;
  c.landed += 1;

  // Shoved clean off the tarmac and out of the way for good.
  if (Math.abs(target.x) > 1.5) {
    target.speed = 0;
    c.downed += 1;
  }

  if (ride.rand() < (ride.rules.counterChance[target.kind] ?? 0)) {
    c.taken += 1;
    ride.stagger = ride.rules.counterStagger;
    ride.speed = Math.max(0.16, ride.speed - 0.3);
    ride.minutesLost += 0.6;
  }
}

/** A weapon in the road is worth swerving toward rather than away from. */
function collectPickups(ride: RideState): void {
  for (const p of ride.pickups) {
    if (p.taken) continue;
    if (p.z > ride.z || p.z < ride.z - 500) continue;
    if (Math.abs(p.x - ride.x) > 0.42) continue;
    p.taken = true;
    ride.combat.weapon = p.kind;
  }
}

function checkCollisions(ride: RideState, squeezing: boolean): void {
  const shrink = squeezing ? ride.rules.squeezeWidth : 1;

  for (const h of ride.hazards) {
    const gap = h.z - ride.z;
    if (gap > 0 || gap < -420) continue;

    if (Math.abs(h.x - ride.x) < h.width + 0.1 * shrink) {
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

/**
 * Signals resolve as the rider crosses them.
 *
 * Come to a stop at a red and you wait it out. Cross it still moving and you
 * have run it: usually nothing happens, sometimes something comes the other way.
 */
function checkSignals(ride: RideState): void {
  for (const s of ride.signals) {
    if (s.resolved || ride.z < s.z) continue;
    s.resolved = true;

    if (!signalIsRed(s, ride.elapsed)) continue;

    if (ride.speed <= 0.14) {
      // Stopped for it, like you are supposed to.
      ride.waiting = ride.signalWaitSeconds;
      continue;
    }

    s.ranIt = true;
    ride.redsRun += 1;

    const roll = ride.rand();
    if (roll < ride.signalRunCrashChance) {
      // Something came the other way.
      ride.crashes += 1;
      ride.minutesLost += CRASH_MINUTES * 1.6 * (1 + ride.load * 0.6);
      ride.stagger = 0.9;
      ride.speed = 0.16;
    } else if (roll < ride.signalRunCrashChance + ride.signalRunStopChance) {
      const span = ride.bribe.max - ride.bribe.min;
      ride.heldBy = {
        demanded: Math.round((ride.bribe.min + ride.rand() * span) / 10) * 10,
        settled: false,
      };
      ride.speed = 0;
    }
  }
}

/** Hand it over and go. Costs money, costs barely any time. */
export function payBribe(ride: RideState): void {
  if (!ride.heldBy || ride.heldBy.settled) return;
  ride.bribesPaid += ride.heldBy.demanded;
  ride.minutesLost += ride.bribe.seconds / 6;
  ride.heldBy.settled = true;
  ride.heldBy = null;
}

/**
 * Stand your ground. Usually works and costs only the time, which is the whole
 * gamble: the time is worth more than the money when a deadline is close.
 */
export function argue(ride: RideState): boolean {
  if (!ride.heldBy || ride.heldBy.settled) return false;
  const won = ride.rand() < ride.bribe.argueChance;
  if (!won) ride.bribesPaid += ride.heldBy.demanded;
  ride.minutesLost += ride.bribe.argueSeconds / 6;
  ride.heldBy.settled = true;
  ride.heldBy = null;
  return won;
}

export function rideResult(ride: RideState): RideResult {
  // Pace is measured against the time the journey should have taken, so sitting
  // at a red does not count against the rider — the light did that, not them.
  const moving = Math.max(0.001, ride.elapsed - ride.waitedSeconds);
  const expected = ride.finishZ / TOP_SPEED;
  return {
    crashes: ride.crashes,
    minutesLost: Math.round(ride.minutesLost * 10) / 10,
    pace: Math.max(0, Math.min(1, expected / moving)),
    redsRun: ride.redsRun,
    bribesPaid: ride.bribesPaid,
    landed: ride.combat.landed,
    taken: ride.combat.taken,
    downed: ride.combat.downed,
    weapon: ride.combat.weapon,
  };
}
