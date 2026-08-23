import { travelMinutes } from "../sim/city.js";
import type { EconomyConfig } from "../sim/economy.js";
import type { ShiftState } from "../sim/shift.js";
import type { Order } from "../sim/types.js";

export type Verdict = "easy" | "tight" | "risky" | "no";

export const VERDICT_LABEL: Record<Verdict, string> = {
  easy: "Comfortable",
  tight: "Tight",
  risky: "Risky",
  no: "Won't make it",
};

/**
 * Minutes lost per order already in the bag before this one gets served. Covers
 * the detour to its stop and the handover, so it is deliberately more than a
 * straight-line ride — under-counting this is what made everything read as
 * "Comfortable" in the first pass.
 */
const QUEUE_COST = 17;

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
export function estimate(state: ShiftState, order: Order, cfg: EconomyConfig): Estimate {
  const toPickup = travelMinutes(state.locationId, order.pickupId);
  // Prep runs while the rider is on the way, so only the remainder is lost time.
  const waitClaimed = Math.max(0, order.shownPrep - toPickup);
  const toDrop = travelMinutes(order.pickupId, order.dropId);
  const queue = state.carried.length * QUEUE_COST;

  const total = queue + toPickup + waitClaimed + toDrop;
  const window = cfg.tiers[order.tier].window;
  const ratio = total / window;

  // Tightened from the first pass, where almost everything read "Comfortable"
  // and the safe play carried no risk at all.
  const verdict: Verdict =
    ratio < 0.45 ? "easy" : ratio < 0.7 ? "tight" : ratio < 0.92 ? "risky" : "no";

  return { verdict, toPickup, waitClaimed, toDrop, queue, total, window };
}
