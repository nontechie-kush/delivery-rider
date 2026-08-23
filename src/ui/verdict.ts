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
 * Deliberately uses `shownPrep` — the number the app displays — rather than the
 * real prep time. The estimate is therefore optimistic in exactly the way the
 * platform is optimistic, and orders from the places that under-report will
 * quietly read better here than they deserve to.
 */
export function estimate(state: ShiftState, order: Order, cfg: GameConfig): Estimate {
  const toPickup = rideMinutes(state, state.locationId, order.pickupId);
  // Prep runs while the rider is on the way, so only the remainder is lost time.
  const waitClaimed = Math.max(0, order.shownPrep - toPickup);
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
