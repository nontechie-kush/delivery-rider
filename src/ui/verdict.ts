import type { GameConfig } from "../sim/config.js";
import { rideMinutes, type ShiftState } from "../sim/shift.js";
import type { Order } from "../sim/types.js";

export type Verdict = "easy" | "tight" | "risky" | "no";

export const VERDICT_LABEL: Record<Verdict, string> = {
  easy: "Comfortable",
  tight: "Tight",
  risky: "Risky",
  no: "Won't make it",
};


export interface Estimate {
  verdict: Verdict;
  /** Ride from where the rider is standing to the pickup. */
  toPickup: number;
  /** Time still standing around after arriving, per the app's claim. */
  waitClaimed: number;
  /** Ride from pickup to the customer. */
  toDrop: number;
  /** Delay caused by orders already in the bag. */
  queue: number;
  /** Everything above, added up. */
  total: number;
  /** Minutes the tier allows, measured from acceptance. */
  window: number;
}

/**
 * How long this order looks like it will take, and whether that fits the window.
 *
 * Judged against the slow end of the kitchen's range rather than its middle.
 * A verdict that reads "Comfortable" and leaves the rider late half the time is
 * the same lie the optimistic prep times used to tell; this way the word means
 * what it says, and the range on the card shows where it came from.
 */
export function estimate(state: ShiftState, order: Order, cfg: GameConfig): Estimate {
  const toPickup = rideMinutes(state, state.locationId, order.pickupId);
  // Prep runs while the rider is on the way, so only the remainder is lost time.
  const waitClaimed = Math.max(0, order.prepHigh - toPickup);
  const toDrop = rideMinutes(state, order.pickupId, order.dropId);
  const queue = state.carried.length * cfg.queueCostPerOrder;

  const total = queue + toPickup + waitClaimed + toDrop;
  const window = cfg.tiers[order.tier].window;
  const ratio = total / window;

  const b = cfg.verdictBands;
  const verdict: Verdict =
    ratio < b.easy ? "easy" : ratio < b.tight ? "tight" : ratio < b.risky ? "risky" : "no";

  return { verdict, toPickup, waitClaimed, toDrop, queue, total, window };
}
