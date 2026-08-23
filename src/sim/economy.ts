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
  tiers: Record<Tier, TierConfig>;
  /** Cumulative: hitting 20 pays the 12-bonus and the 20-bonus. */
  milestones: readonly { orders: number; bonus: number }[];
  /** Fraction of the fee paid when a delivery lands late. */
  latePayFactor: number;
  /** How long an unaccepted offer stays in the queue, in game-minutes. */
  offerLifetime: number;
  /** Mean game-minutes between new offers appearing. */
  offerIntervalMean: number;
  /** Fixed cost deducted at end of shift — fuel, data, wear. */
  shiftExpenses: number;
}

export const DEFAULT_ECONOMY: EconomyConfig = {
  shiftMinutes: 420,

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
  offerIntervalMean: 7,
  shiftExpenses: 120,
};

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
