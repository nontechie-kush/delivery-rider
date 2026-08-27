// Geography is static data with no dependency back on config, so this is a
// one-way import rather than a cycle.
import { DROPS, PICKUPS } from "./city.js";
import type { AddressKind, SlotKind, Temp, Tier, VenueKind } from "./types.js";

/**
 * Every tunable number in the game, in one place.
 *
 * Nothing outside this file may hardcode a rupee value, a minute count, a
 * probability or a threshold. If a number decides how the game behaves, it
 * belongs here — geography (which places exist and where) lives in city.ts,
 * but how those places behave lives here.
 *
 * This is the object Supabase remote-config overrides in Phase 4, so the economy
 * can be retuned during soft launch without shipping an app update. That only
 * works if it stays the single source of truth.
 */

/* ------------------------------------------------------------------ types */

export interface TierConfig {
  base: number;
  /** Rupees per kilometre beyond `freeKm`. */
  perKm: number;
  freeKm: number;
  /** Game-minutes from acceptance until the order is late. */
  window: number;
  /** Relative frequency in the offer queue. */
  weight: number;
  /** Orders longer than this many km are never generated at this tier. */
  maxDistance: number;
}

/** A bookable window with a payout floor attached. */
export interface SlotConfig {
  id: string;
  label: string;
  /** Clock hours, inclusive start, exclusive end. */
  fromHour: number;
  toHour: number;
  /** Paid as a floor if the terms are met and normal earnings fall short. */
  guarantee: number;
  /**
   * Rejections tolerated before the guarantee is void. Real platforms allow
   * roughly one — Swiggy voids the minimum guarantee on the second.
   */
  rejectionsAllowed: number;
  /**
   * Deliveries that must actually be completed inside the window.
   *
   * This is the main term and the cruellest one. Swiggy requires 23 completed
   * orders to unlock ₹845; finish 22 and you take home ₹350. Without it a rider
   * could book a window, stand still for four hours and collect the guarantee
   * for doing nothing — which is precisely what happened before this existed.
   */
  minDeliveries: number;
}

/**
 * What the rider is riding, and what it costs to move it.
 *
 * Range is tracked in kilometres for both petrol and electric so one gauge
 * covers everything, but the two refill in genuinely different ways and that
 * difference is the point of the ladder:
 *
 *   - Petrol is expensive to run and forgiving to refill: pumps are everywhere,
 *     you can put in as little as you like, and it takes a few minutes.
 *   - Electric is roughly a tenth of the cost per kilometre and unforgiving:
 *     swap stations are few, the swap is all-or-nothing, and running out
 *     somewhere without one is a long walk.
 *   - A cycle costs nothing to move and never needs either.
 *
 * Numbers are real. Petrol is ₹102.97/L in Gurgaon; an Activa returns about
 * 47 km/l in traffic off a 5.3 litre tank; a Splendor does better on both. A
 * swappable delivery e-scooter runs about ₹0.15–0.25/km against ₹2.00–2.50 for
 * petrol, and a swap takes under two minutes.
 */
export type EnergyKind = "petrol" | "battery" | "none";

export interface VehicleConfig {
  id: string;
  name: string;
  energy: EnergyKind;
  /** Kilometres of range on a full tank or a fresh battery. */
  rangeKm: number;
  /** Rupees to restore one kilometre of range. */
  costPerKm: number;
  /**
   * Battery swaps are all-or-nothing: you pay for the whole pack whatever was
   * left in the old one. Petrol is metered, so you pay for what you put in.
   */
  refillIsWholeUnit: boolean;
  /** Minutes lost refilling. */
  refillMinutes: number;
  /** Minutes per kilometre before congestion. Lower is faster. */
  minPerKm: number;
  /** Wear and servicing per kilometre, on top of energy. */
  upkeepPerKm: number;
  bagSlots: readonly SlotKind[];
}

export interface PlaceBehaviour {
  /** Mean true prep time in game-minutes. */
  prepMean: number;
  prepSpread: number;
  /** Minutes lost at the door: the guard, the lift, the floor, the phone call. */
  handover: number;
  /** What this place actually sends out. */
  temps: readonly Temp[];
}

export interface GameConfig {
  /* -------------------------------------------------------------- the day */
  /** Clock hour the working day opens. */
  dayStartHour: number;
  /** How long the day stays open, in game-minutes. */
  dayMinutes: number;

  /* ------------------------------------------------------------ rhythm */
  /** Multiplier on order arrival rate, indexed by hour of day (0–23). */
  demandByHour: readonly number[];
  /** Multiplier on travel time, indexed by hour of day (0–23). */
  trafficByHour: readonly number[];

  /* -------------------------------------------------------------- orders */
  tiers: Record<Tier, TierConfig>;
  /** Mean game-minutes between offers at demand 1.0. The curve divides this. */
  offerIntervalMean: number;
  /** How long an unaccepted offer stays in the queue. */
  offerLifetime: number;
  /**
   * Least fraction of its window an order arrives with, however long it sat.
   * Without a floor, an offer taken in its last minute would be late before
   * the rider moved, which is a trap rather than a decision.
   */
  staleOrderFloor: number;
  /** Higher values concentrate offers on nearby pickups. */
  pickupProximityBias: number;
  /** Higher values concentrate drops near their pickup. */
  dropProximityBias: number;

  /* ------------------------------------------------------------ payment */
  milestones: readonly { orders: number; bonus: number }[];
  /** Fraction of the fee paid when a delivery lands late. */
  latePayFactor: number;
  /**
   * Fixed daily cost, whatever the rider does: data, the bag, and the rent on
   * the scooter. Renting is common in Delhi NCR at ₹200-350 a day, so ₹180 is
   * conservative — and it is the difference between expenses landing at 25% of
   * gross and the 32% riders actually report.
   */
  dailyExpenses: number;

  /* -------------------------------------------------------------- duty */
  slots: readonly SlotConfig[];
  /**
   * Acceptance rate below this voids the day's milestone incentives. Platforms
   * publish 80–90%; the number is real and so is the pressure it creates.
   */
  minAcceptanceRate: number;
  /** Offers seen before acceptance rate starts being judged. */
  acceptanceGracePeriod: number;
  /** Consecutive days without logging in before the account goes inactive. */
  inactivityDaysBeforeBlock: number;

  /* ----------------------------------------------------------- vehicles */
  vehicles: readonly VehicleConfig[];
  /** Which vehicle the rider starts on. */
  startVehicleId: string;
  /** Node ids with a petrol pump. */
  fuelStops: readonly string[];
  /** Node ids with a battery swap station. Deliberately fewer than pumps. */
  swapStops: readonly string[];
  /** Range fraction below which the gauge warns. */
  lowRangeWarning: number;
  /** Minutes per kilometre pushed when the rider runs dry away from a stop. */
  pushMinPerKm: number;

  /* --------------------------------------------------------- the ride */
  /**
   * Real seconds of riding per kilometre, and the floor and ceiling around it.
   * Rides have to stay short: the ride exists to make the decision cost
   * something, not to become the game. A hop is a few seconds, a cross-town run
   * under a minute.
   */
  rideSecondsPerKm: number;
  rideSecondsMin: number;
  rideSecondsMax: number;
  /**
   * What full throttle represents. An Activa will do far more than this on an
   * open road, but 48 km/h is about the ceiling on a Gurgaon arterial with
   * traffic in it, and it makes the speedometer mean something.
   */
  rideTopSpeedKmh: number;
  /**
   * How much the ride itself moves the clock. A journey ridden flat out takes
   * `ridePaceFloor` of the estimate; one ridden gently takes `ridePaceCeiling`.
   *
   * Without this the throttle costs risk and buys nothing, so coasting every
   * ride is strictly optimal — which is the opposite of the pressure the whole
   * mechanic exists to model.
   */
  ridePaceFloor: number;
  ridePaceCeiling: number;
  /** Seconds a red light holds you. */
  signalWaitSeconds: number;
  /**
   * What happens when a red gets jumped. Most of the time nothing does, which
   * is exactly why riders keep doing it — and why the times it goes wrong land
   * as bad luck rather than as a rule.
   */
  signalRunCrashChance: number;
  signalRunStopChance: number;
  /* ------------------------------------------------------- fighting back */
  /**
   * Leaning on the horn. Indian traffic genuinely runs on it: hold it and the
   * scooter ahead usually gives way, an auto sometimes does, a truck never.
   */
  hornYieldChance: Record<string, number>;
  /** Seconds between strikes, and how far to the side one reaches. */
  strikeCooldown: number;
  strikeReach: number;
  /** How hard a bare kick and each weapon shove a vehicle aside. */
  strikeShove: Record<string, number>;
  /** Odds the target hits back, by what they are. */
  counterChance: Record<string, number>;
  /** Seconds a counter staggers the rider. */
  counterStagger: number;
  /** How much narrower the rider is while squeezing, and what it costs in speed. */
  squeezeWidth: number;
  squeezeSpeedCap: number;
  /**
   * Odds a chhabeel is standing at the roadside on a given leg. A stall handing
   * out cold rose milk for free is a real Delhi-summer fixture, and it is the
   * only thing on the road that is on the rider's side.
   */
  langarChance: number;
  /**
   * What a fork is worth, in game-minutes, either way.
   *
   * The first thing in the ride that pays back into the simulation: until now
   * the map chose the route and the riding could not change the outcome. Big
   * enough that reading the road matters, small enough that a bad call is not
   * the shift.
   */
  forkMinutesMin: number;
  forkMinutesMax: number;
  /**
   * Width in pixels the ride is actually drawn at, before being scaled up with
   * smoothing switched off.
   *
   * Detail is decisions per pixel, not pixels. At device resolution the ride
   * fills over a million pixels a frame with about fifty authored decisions in
   * them; the NES ran Legend of Kage in 61,440 and a person placed every one.
   * Dropping to a small buffer costs nothing that was carrying information, and
   * it makes hand authoring affordable — at this width a car is thirty pixels
   * across, so its pixels can be placed by hand rather than by an artist we
   * would have to hire. It also cuts fill cost by roughly six, which is what
   * pays for bloom and particles later.
   */
  rideRenderWidth: number;

  /* ------------------------------------------------------ traffic rhythm */
  /**
   * Traffic is placed as packs separated by deliberately clear road, not by a
   * uniform random draw. A flat distribution has no troughs in it, and the
   * troughs are what make the peaks readable — scattering vehicles evenly is
   * what made the road feel like hail rather than like traffic.
   *
   * Every distance here is quoted in *seconds of closing time* at full
   * throttle, because that is the thing the player actually experiences. The
   * generator converts to world units using the reference closing speed.
   */
  traffic: {
    /** Clear road between packs on an empty afternoon. */
    breatherSecondsCalm: number;
    /** Clear road between packs at the worst of the lunch rush. */
    breatherSecondsPeak: number;
    /**
     * Gap between rows inside one pack — the slalom. Deliberately below the
     * breather: a pack is meant to be taken as one move, not three.
     */
    rowGapSeconds: number;
    /**
     * The floor nothing may go below, whatever the pressure. Simple human
     * reaction is around 250ms; this leaves time to see the gap and act on it,
     * so full throttle stays possible at peak but stops being comfortable.
     */
    reactionFloorSeconds: number;
    /** Rows per pack, interpolated across pressure. */
    rowsCalm: number;
    rowsPeak: number;
    /** How far a vehicle may sit off its lane centre, in x units. */
    laneJitter: number;
    /**
     * Clear x the rider's centre needs through a row. Above zero because a gap
     * that exists only in the arithmetic is not a gap the player can use.
     */
    minCentreGap: number;
  };

  /**
   * The end of a shift, when the rider is tired and the roads have emptied.
   *
   * Thinner traffic moving faster, and a rider who steers slower and brakes
   * longer: more time to see what is coming, less ability to do anything about
   * it. The window is expressed as deliveries because that is how the day is
   * counted, and converted to minutes at the typical order length.
   */
  endgame: {
    orders: number;
    orderMinutes: number;
    trafficCountScale: number;
    trafficSpeedScale: number;
    steerScale: number;
    brakeScale: number;
  };

  /** What it takes to be waved on, and what arguing costs instead. */
  bribeMin: number;
  bribeMax: number;
  bribeSeconds: number;
  argueSeconds: number;
  /** Odds that arguing works and costs nothing but the time. */
  argueSuccessChance: number;

  /* ------------------------------------------------------- how it reads */
  /** Minutes the fit estimate assumes each order already in the bag costs. */
  queueCostPerOrder: number;
  /** Forecast-to-window ratios at which the verdict changes. */
  verdictBands: { easy: number; tight: number; risky: number };

  /* -------------------------------------------------- behaviour by place */
  venues: Record<VenueKind, PlaceBehaviour>;
  addresses: Record<AddressKind, { handover: number }>;
  places: Record<string, PlaceBehaviour>;
  /** Applied to any place not listed above. */
  defaultPlace: PlaceBehaviour;
}

/* ---------------------------------------------------------------- values */

/**
 * Real order volume is nothing like flat. Platform data puts the lunch peak at
 * about 4.4x the daily average and the evening peak at 2.33x — lower, but longer,
 * and the block carrying the highest incentives. Indian windows sit later than
 * Western ones: lunch 12–3, dinner 7–11.
 */
const DEMAND_BY_HOUR: readonly number[] = [
  //  0    1     2     3     4     5    6    7    8    9   10   11
  0.15, 0.1, 0.08, 0.06, 0.06, 0.1, 0.3, 0.5, 0.8, 1.0, 1.4, 2.6,
  // 12   13   14   15   16   17   18   19   20   21   22   23
  3.6, 4.4, 3.1, 1.6, 0.9, 0.7, 1.0, 2.0, 2.4, 2.3, 1.5, 0.7,
];

/**
 * Congestion tracks demand, which is the cruel part: the hours worth working are
 * the hours you cannot move through. Bengaluru measures 15 minutes to cover
 * 4.2 km at peak — roughly 3.6 min/km against a 3.1 all-day average.
 */
const TRAFFIC_BY_HOUR: readonly number[] = [
  0.8, 0.8, 0.8, 0.8, 0.8, 0.85, 0.95, 1.15, 1.3, 1.15, 1.0, 1.1,
  1.25, 1.3, 1.15, 1.0, 1.05, 1.2, 1.35, 1.35, 1.25, 1.1, 0.9, 0.85,
];

export const DEFAULT_CONFIG: GameConfig = {
  // The day is open from six in the morning to two the next night. When inside
  // it you actually work is the player's call — that is the whole point.
  dayStartHour: 6,
  dayMinutes: 20 * 60,

  demandByHour: DEMAND_BY_HOUR,
  trafficByHour: TRAFFIC_BY_HOUR,

  tiers: {
    // Pays roughly double per minute with a quarter of the slack. Dark store
    // only, short hops only — the "10 minute" promise made survivable.
    EXPRESS: { base: 30, perKm: 8, freeKm: 1, window: 24, weight: 3, maxDistance: 4 },
    STANDARD: { base: 22, perKm: 7, freeKm: 2, window: 52, weight: 5, maxDistance: 8 },
    // Boring, safe, and it occupies a slot for a very long time. That is the cost.
    SCHEDULED: { base: 16, perKm: 6, freeKm: 3, window: 95, weight: 2, maxDistance: 99 },
  },
  // Gap at demand 1.0. The curve divides this, so the lunch peak runs ~4x faster.
  //
  // Swept against the earnings data rather than guessed. At 30 a diligent rider
  // does ~30 orders a day for about ₹914 net — ₹23.8k a month over 26 days,
  // mid-way through the measured ₹18-27k and just inside the 20-30 orders riders
  // actually report. The top bonus lands on 41% of days: a stretch, not a
  // formality.
  //
  // Retuned from 33 when deadlines moved to run from order placement, which
  // took a chunk out of every window and pushed take-home to the bottom of the
  // real range.
  offerIntervalMean: 30,
  offerLifetime: 12,
  staleOrderFloor: 0.55,
  // Dispatch assigns from stores near the rider, which is why riders cluster at
  // hotspots. Uniform selection had them criss-crossing the whole zone.
  pickupProximityBias: 1.6,
  dropProximityBias: 1.4,

  // Straight from the platform rate cards. The step function is the whole game:
  // the order that clears a tier is worth a fortune and the one below it is a
  // trap. Only on-time deliveries count — without that, taking every offer
  // dominates.
  //
  // Retuned from 12/20/28 when the city went from four kitchens to twenty-two.
  // More venues spread the drops outward, which lengthened the mean leg by 19%
  // and cost about four on-time deliveries a shift; the old top tier then sat
  // above what a good day could reach at all.
  milestones: [
    { orders: 10, bonus: 150 },
    { orders: 17, bonus: 350 },
    { orders: 25, bonus: 600 },
  ],
  latePayFactor: 0.5,
  dailyExpenses: 180,

  /**
   * Bookable slots with payout floors, as Zepto and Blinkit run them. Committing
   * is a real bet: meet the terms and you cannot earn less than the guarantee,
   * break them and you get nothing but per-order pay.
   *
   * One rejection is tolerated. The second voids it — which is exactly how
   * Swiggy's minimum guarantee works, and why riders take orders they know are
   * bad for them.
   */
  slots: [
    { id: "morning", label: "Morning", fromHour: 7, toHour: 11, guarantee: 420, rejectionsAllowed: 1, minDeliveries: 6 },
    { id: "lunch", label: "Lunch rush", fromHour: 12, toHour: 16, guarantee: 640, rejectionsAllowed: 1, minDeliveries: 10 },
    { id: "evening", label: "Dinner rush", fromHour: 19, toHour: 23, guarantee: 880, rejectionsAllowed: 1, minDeliveries: 12 },
  ],
  minAcceptanceRate: 0.8,
  acceptanceGracePeriod: 5,
  // Zomato's published figure: fifteen continuous days without logging in and
  // the account goes inactive. Reactivation is "subject to the requirement of
  // Delivery Partners in the area" — which is to say, not guaranteed.
  inactivityDaysBeforeBlock: 15,

  vehicles: [
    // Where most riders actually are. Cheap to buy, expensive to feed.
    {
      id: "activa", name: "Honda Activa", energy: "petrol",
      rangeKm: 249, costPerKm: 2.19, refillIsWholeUnit: false, refillMinutes: 4,
      minPerKm: 2.08, upkeepPerKm: 0.9,
      bagSlots: ["HOT", "HOT", "COLD", "ANY", "ANY"],
    },
    // Better mileage, bigger tank, less comfortable over a long shift.
    {
      id: "splendor", name: "Hero Splendor", energy: "petrol",
      rangeKm: 617, costPerKm: 1.63, refillIsWholeUnit: false, refillMinutes: 4,
      minPerKm: 2.0, upkeepPerKm: 0.8,
      bagSlots: ["HOT", "HOT", "COLD", "ANY", "ANY"],
    },
    // A tenth of the running cost. The catch is where you can refill it.
    {
      id: "eswap", name: "Swap e-scooter", energy: "battery",
      rangeKm: 70, costPerKm: 0.21, refillIsWholeUnit: true, refillMinutes: 2,
      minPerKm: 2.2, upkeepPerKm: 0.35,
      bagSlots: ["HOT", "HOT", "COLD", "ANY", "ANY"],
    },
    // Free to move and slow. Genuinely viable in a dense zone at rush hour.
    {
      id: "ecycle", name: "E-cycle", energy: "battery",
      rangeKm: 45, costPerKm: 0.12, refillIsWholeUnit: true, refillMinutes: 2,
      minPerKm: 3.4, upkeepPerKm: 0.15,
      bagSlots: ["HOT", "COLD", "ANY"],
    },
  ],
  startVehicleId: "activa",
  // Pumps sit on the arterials, which is where they are in Gurgaon.
  fuelStops: ["d2", "d7", "d5"],
  // Swap stations are rarer, and that is the whole trade.
  swapStops: ["d1", "d4"],
  lowRangeWarning: 0.2,
  // Pushing a dead two-wheeler is about walking pace.
  pushMinPerKm: 13,


  rideSecondsPerKm: 4.2,
  rideSecondsMin: 6,
  rideSecondsMax: 40,
  rideTopSpeedKmh: 48,
  ridePaceFloor: 0.85,
  ridePaceCeiling: 1.18,
  signalWaitSeconds: 4,
  // Roughly a fifth of jumped reds end in something coming the other way, and
  // another quarter in being pulled over. Over half of them cost nothing.
  signalRunCrashChance: 0.18,
  signalRunStopChance: 0.26,
  // A scooter will move for a horn, an auto might, a truck will not, and a cow
  // has never moved for anything.
  hornYieldChance: {
    bike: 0.55,
    auto: 0.22,
    car: 0.3,
    truck: 0,
    pothole: 0,
    // Scatters at the first blast. The one thing a horn reliably works on.
    dog: 0.9,
    // Does not, and will not. It is the joke and it is also the truth.
    cow: 0,
  },
  strikeCooldown: 0.75,
  strikeReach: 0.5,
  // Bare-handed is a shove; a chain has reach; a bat has neither subtlety nor
  // a good reason to exist, which is rather the point.
  strikeShove: { none: 0.5, chain: 0.95, bat: 1.25 },
  // Other riders hit back hardest. Auto drivers are game for it. Cars are sealed.
  counterChance: { bike: 0.42, auto: 0.3, car: 0.08, truck: 0.05, pothole: 0 },
  counterStagger: 0.85,
  squeezeWidth: 0.55,
  squeezeSpeedCap: 0.62,
  langarChance: 0.18,
  forkMinutesMin: 0.8,
  forkMinutesMax: 2.2,
  rideRenderWidth: 320,

  traffic: {
    breatherSecondsCalm: 1.5,
    breatherSecondsPeak: 0.62,
    rowGapSeconds: 0.45,
    reactionFloorSeconds: 0.42,
    rowsCalm: 1,
    rowsPeak: 2.6,
    laneJitter: 0.07,
    minCentreGap: 0.26,
  },

  endgame: {
    orders: 3,
    orderMinutes: 30,
    trafficCountScale: 0.6,
    trafficSpeedScale: 1.4,
    steerScale: 0.8,
    brakeScale: 1.3,
  },

  bribeMin: 100,
  bribeMax: 300,
  bribeSeconds: 6,
  argueSeconds: 22,
  argueSuccessChance: 0.55,

  queueCostPerOrder: 17,
  verdictBands: { easy: 0.45, tight: 0.7, risky: 0.92 },

  /**
   * Behaviour by archetype, not by address.
   *
   * Listing thirty-eight places individually was fine at four kitchens and
   * would be unreadable at twenty-two. More to the point it would be
   * unlearnable: a player cannot memorise twenty-two prep times, but they can
   * learn that a dark store is quick and a cloud kitchen is a coin flip, and
   * then read any new venue off its type. `places` below still overrides a
   * specific address where one has genuine character of its own.
   */
  venues: {
    // Packaged goods off a shelf. Genuinely three minutes, and it barely needs
    // to lie — which is why EXPRESS can exist at all.
    darkstore: { prepMean: 3, prepSpread: 1.5, handover: 1.5, temps: ["COLD", "AMBIENT", "AMBIENT", "COLD"] },
    grocery: { prepMean: 13, prepSpread: 5, handover: 1.5, temps: ["AMBIENT", "AMBIENT", "COLD"] },
    // Cooked to order in a sealed handi. The slowest thing on the map and the
    // one that most rewards knowing before you accept.
    biryani: { prepMean: 22, prepSpread: 8, handover: 1.5, temps: ["HOT", "HOT", "HOT"] },
    dhaba: { prepMean: 18, prepSpread: 7, handover: 2, temps: ["HOT", "HOT", "AMBIENT"] },
    cafe: { prepMean: 8, prepSpread: 3, handover: 1.5, temps: ["HOT", "HOT", "COLD"] },
    // A counter transaction. Fast, and almost never surprising.
    sweets: { prepMean: 6, prepSpread: 2, handover: 1.5, temps: ["AMBIENT", "AMBIENT", "COLD"] },
    chinese: { prepMean: 11, prepSpread: 4, handover: 1.5, temps: ["HOT", "HOT"] },
    fastfood: { prepMean: 12, prepSpread: 4, handover: 2, temps: ["HOT", "HOT", "COLD"] },
  },

  /**
   * How long a building takes to let you in. The handover is the honest cost
   * nobody models, and the address type predicts it far better than the
   * neighbourhood does.
   */
  addresses: {
    metro: { handover: 2 },
    market: { handover: 2.5 },
    office: { handover: 4 },
    condo: { handover: 5 },
    gated: { handover: 7 },
  },

  /**
   * Per-address overrides, for the few places with character their type does
   * not capture. Empty is the normal state — reach for the archetype first.
   */
  places: {
    // Cyber Hub kitchens run a queue no dhaba elsewhere has to.
    hp: { prepMean: 21, prepSpread: 9, handover: 2.5, temps: ["HOT", "HOT", "AMBIENT"] },
  },
  defaultPlace: { prepMean: 8, prepSpread: 3, handover: 3, temps: ["AMBIENT"] },
};

/* --------------------------------------------------------------- helpers */

export function vehicleOf(id: string, cfg: GameConfig): VehicleConfig {
  return cfg.vehicles.find((v) => v.id === id) ?? cfg.vehicles[0]!;
}

/** Where this vehicle can restore range, if anywhere. */
export function refillStopsFor(vehicle: VehicleConfig, cfg: GameConfig): readonly string[] {
  if (vehicle.energy === "petrol") return cfg.fuelStops;
  if (vehicle.energy === "battery") return cfg.swapStops;
  return [];
}

/** Rupees of energy burnt covering a distance on this vehicle. */
export function energyCost(km: number, vehicle: VehicleConfig): number {
  return km * vehicle.costPerKm;
}

/** Everything a kilometre costs: energy plus wear. */
export function runningCost(km: number, vehicle: VehicleConfig): number {
  return km * (vehicle.costPerKm + vehicle.upkeepPerKm);
}

/**
 * What a given address behaves like: an explicit override if it has one, then
 * its archetype, then the fallback. One resolution path, so a venue can never
 * disagree with itself depending on who asked.
 */
export function placeOf(id: string, cfg: GameConfig): PlaceBehaviour {
  const override = cfg.places[id];
  if (override) return override;

  const pickup = PICKUPS.find((p) => p.id === id);
  if (pickup) return cfg.venues[pickup.venue];

  const drop = DROPS.find((d) => d.id === id);
  if (drop) {
    // A drop has no kitchen; all it costs is the time the building takes.
    return { prepMean: 0, prepSpread: 0, handover: cfg.addresses[drop.address].handover, temps: [] };
  }

  return cfg.defaultPlace;
}

/** Clock hour (0–23) at a given point in the day. */
export function hourAt(minutes: number, cfg: GameConfig): number {
  return Math.floor(cfg.dayStartHour + minutes / 60) % 24;
}

/** Minutes from the day's start at which a given clock hour falls. */
export function minutesAtHour(hour: number, cfg: GameConfig): number {
  return ((hour - cfg.dayStartHour + 24) % 24) * 60;
}

/** How busy the platform is right now, as a multiplier on the arrival rate. */
export function demandAt(minutes: number, cfg: GameConfig): number {
  return cfg.demandByHour[hourAt(minutes, cfg)] ?? 1;
}

/** How slow the roads are right now, as a multiplier on travel time. */
export function trafficAt(minutes: number, cfg: GameConfig): number {
  return cfg.trafficByHour[hourAt(minutes, cfg)] ?? 1;
}

/** Base + distance pay for one order, before lateness is applied. */
export function orderFee(tier: Tier, distanceKm: number, cfg: GameConfig): number {
  const t = cfg.tiers[tier];
  return Math.round(t.base + Math.max(0, distanceKm - t.freeKm) * t.perKm);
}

export function paidFee(fee: number, late: boolean, cfg: GameConfig): number {
  return late ? Math.round(fee * cfg.latePayFactor) : fee;
}

/** Total milestone money for `count` on-time deliveries. Cumulative. */
export function milestoneBonus(count: number, cfg: GameConfig): number {
  return cfg.milestones.filter((m) => count >= m.orders).reduce((sum, m) => sum + m.bonus, 0);
}

export function nextMilestone(
  count: number,
  cfg: GameConfig,
): { orders: number; bonus: number; short: number } | null {
  const next = cfg.milestones.find((m) => count < m.orders);
  return next ? { orders: next.orders, bonus: next.bonus, short: next.orders - count } : null;
}

/** The slot covering a given clock hour, if any. */
export function slotAtHour(hour: number, cfg: GameConfig): SlotConfig | null {
  return cfg.slots.find((s) => hour >= s.fromHour && hour < s.toHour) ?? null;
}
