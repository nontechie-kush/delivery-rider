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

/** Rough cost of servicing one order already in the bag before getting to this one. */
const QUEUE_COST = 13;

export interface Estimate {
  verdict: Verdict;
  /** Forecast minutes to deliver, versus the window allowed. */
  forecast: number;
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
  const ride = travelMinutes(state.locationId, order.pickupId);
  // Prep runs while you ride, so only the remainder is time you actually lose.
  const waitAfterArriving = Math.max(0, order.shownPrep - ride);
  const drop = travelMinutes(order.pickupId, order.dropId);
  const queue = state.carried.length * QUEUE_COST;

  const forecast = queue + ride + waitAfterArriving + drop;
  const window = cfg.tiers[order.tier].window;
  const ratio = forecast / window;

  const verdict: Verdict =
    ratio < 0.6 ? "easy" : ratio < 0.85 ? "tight" : ratio < 1.05 ? "risky" : "no";

  return { verdict, forecast, window };
}
