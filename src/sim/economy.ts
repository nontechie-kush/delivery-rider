import type { Tier } from "./types.js";

/**
 * Every tunable number in the game lives here.
 *
 * This is the object that Supabase remote-config will override in Phase 4, so that
 * the economy can be retuned during soft launch without shipping an app update.
 * Nothing outside this file should hardcode a rupee value or a minute count.
 */

export interface TierConfig {
  /** Flat fee for accepting at all. */
  base: number;
  /** Rupees per grid unit beyond `freeUnits`. */
  perUnit: number;
  /** Distance covered by the base fee. */
  freeUnits: number;
  /** Game-minutes from acceptance until the order is late. */
  window: number;
  /** Relative frequency in the offer queue. */
  weight: number;
  /** Orders longer than this are never generated at this tier. */
  maxDistance: number;
}

export interface EconomyConfig {
  shiftMinutes: number;
  /** Clock hour the shift begins. Everything else is measured from here. */
  startHour: number;
  /** Multiplier on order arrival rate, indexed by hour of day (0–23). */
  demandByHour: readonly number[];
  /** Multiplier on travel time, indexed by hour of day (0–23). */
  trafficByHour: readonly number[];
  tiers: Record<Tier, TierConfig>;
  /** Cumulative: hitting 20 pays the 12-bonus and the 20-bonus. */
  milestones: readonly { orders: number; bonus: number }[];
  /** Fraction of the fee paid when a delivery lands late. */
  latePayFactor: number;
  /** How long an unaccepted offer stays in the queue, in game-minutes. */
  offerLifetime: number;
  /** Mean game-minutes between new offers appearing. */
  offerIntervalMean: number;
  /** Fixed cost deducted at end of shift — phone data, the daily bag rental. */
  shiftExpenses: number;
  /** Fuel, servicing and wear, charged per grid unit actually ridden. */
  expensePerUnit: number;
}

/**
 * Noon to eleven. The shift has to straddle both peaks or the demand curve does
 * no work: the lunch crush, the dead afternoon where the decision is whether to
 * rest or reposition, and the evening block that decides the milestone.
 */
const SHIFT_START_HOUR = 12;

/**
 * Real order volume is nothing like flat. Platform data puts the lunch peak at
 * about 4.4x the daily average and the evening peak at 2.33x — lower, but longer,
 * and the block that carries the highest incentives. Indian windows sit later
 * than Western ones: lunch 12–3, dinner 7–11.
 */
const DEMAND_BY_HOUR: readonly number[] = [
  //  0    1    2    3    4    5    6    7    8    9   10   11
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

export const DEFAULT_ECONOMY: EconomyConfig = {
  // Eleven hours, noon to 23:00. Long, but real full-timers average 62-hour weeks.
  shiftMinutes: 660,
  startHour: SHIFT_START_HOUR,
  demandByHour: DEMAND_BY_HOUR,
  trafficByHour: TRAFFIC_BY_HOUR,

  tiers: {
    // Pays roughly double per minute, with a quarter of the slack.
    // Dark store only, short hops only — the "10 minute" promise made survivable.
    EXPRESS: { base: 30, perUnit: 7, freeUnits: 1, window: 24, weight: 3, maxDistance: 4.5 },
    STANDARD: { base: 22, perUnit: 6, freeUnits: 2, window: 52, weight: 5, maxDistance: 99 },
    // Boring, safe, and it occupies a slot for a very long time. That is the cost.
    SCHEDULED: { base: 16, perUnit: 5, freeUnits: 3, window: 95, weight: 2, maxDistance: 99 },
  },

  // Straight from the platform rate cards. The step function is the whole game:
  // order 20 is worth a fortune and order 19 is a trap.
  //
  // Only on-time deliveries count toward these. Without that rule, over-accepting
  // dominates: the bot proved you can blow 81% of deadlines, eat half-pay, and
  // still come out ahead on milestone money alone — which removes the decision.
  milestones: [
    { orders: 12, bonus: 150 },
    { orders: 20, bonus: 350 },
    { orders: 28, bonus: 600 },
  ],

  latePayFactor: 0.5,
  offerLifetime: 12,
  // Gap at demand 1.0. The curve divides this, so the lunch peak runs ~4x faster.
  // Swept in tools/sweep.ts: 19 puts a good rider at ~27 orders and ~₹86/hour
  // against a measured ₹75, and leaves the 28-order bonus at roughly a third of
  // shifts — a stretch rather than a formality.
  offerIntervalMean: 19,
  // Measured expenses are 32% of gross, and almost all of it is distance. A flat
  // charge made the vehicle choice meaningless; per-unit is what gives the cycle
  // its zero-fuel advantage and the petrol bike its bleed.
  shiftExpenses: 60,
  expensePerUnit: 2.5,
};

/** Clock hour (0–23) at a given point in the shift. */
export function hourAt(minutes: number, cfg: EconomyConfig): number {
  return Math.floor(cfg.startHour + minutes / 60) % 24;
}

/** How busy the platform is right now, as a multiplier on the arrival rate. */
export function demandAt(minutes: number, cfg: EconomyConfig): number {
  return cfg.demandByHour[hourAt(minutes, cfg)] ?? 1;
}

/** How slow the roads are right now, as a multiplier on travel time. */
export function trafficAt(minutes: number, cfg: EconomyConfig): number {
  return cfg.trafficByHour[hourAt(minutes, cfg)] ?? 1;
}

/** Base + distance pay for one order, before lateness is applied. */
export function orderFee(tier: Tier, distance: number, cfg: EconomyConfig): number {
  const t = cfg.tiers[tier];
  const billable = Math.max(0, distance - t.freeUnits);
  return Math.round(t.base + billable * t.perUnit);
}

/** What the order actually pays given whether it landed on time. */
export function paidFee(fee: number, late: boolean, cfg: EconomyConfig): number {
  return late ? Math.round(fee * cfg.latePayFactor) : fee;
}

/** Total milestone money earned for completing `count` orders. Cumulative. */
export function milestoneBonus(count: number, cfg: EconomyConfig): number {
  return cfg.milestones
    .filter((m) => count >= m.orders)
    .reduce((sum, m) => sum + m.bonus, 0);
}

/**
 * The next milestone the player is chasing, and how far away it is.
 * Returns null once every milestone is cleared.
 */
export function nextMilestone(
  count: number,
  cfg: EconomyConfig,
): { orders: number; bonus: number; short: number } | null {
  const next = cfg.milestones.find((m) => count < m.orders);
  if (!next) return null;
  return { orders: next.orders, bonus: next.bonus, short: next.orders - count };
}
