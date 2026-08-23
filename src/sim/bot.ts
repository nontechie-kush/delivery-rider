import type { EconomyConfig } from "./economy.js";
import {
  accept,
  createShift,
  endShift,
  isOver,
  rideMinutes,
  travelTo,
  idle,
  type ShiftSummary,
} from "./shift.js";
import type { ShiftState } from "./shift.js";
import type { Order } from "./types.js";

/**
 * Automated players. These exist for the balance harness and the golden run, not
 * for the game itself — but the gap between them is the design's central claim
 * under test: batching should pay meaningfully more than one-at-a-time.
 */
export type Policy = "greedy" | "solo" | "selective";

/** Rough cost of one pickup-then-drop leg, used only for the bot's forecasting. */
const AVG_LEG_MINUTES = 13;

/** Carrying more than this is where the selective bot stops trusting itself. */
const SELECTIVE_CAP = 3;

/** Where the bot could usefully go next, and how urgent it is. */
interface Stop {
  nodeId: string;
  /** Earliest deadline among the orders served by visiting this node. */
  due: number;
  serves: number;
}

function stops(state: ShiftState): Stop[] {
  const byNode = new Map<string, Stop>();

  for (const c of state.carried) {
    const nodeId = c.leg === "TO_PICKUP" ? c.order.pickupId : c.order.dropId;
    const existing = byNode.get(nodeId);
    if (existing) {
      existing.serves += 1;
      existing.due = Math.min(existing.due, c.order.dueAt);
    } else {
      byNode.set(nodeId, { nodeId, due: c.order.dueAt, serves: 1 });
    }
  }

  return [...byNode.values()];
}

/**
 * Nearest useful stop, with a nudge toward whatever is closest to going late.
 * Deliberately simple — a smarter bot would flatter the economy and hide problems
 * the real player would hit.
 */
function chooseStop(state: ShiftState): Stop | null {
  const options = stops(state);
  if (options.length === 0) return null;

  let best: Stop | null = null;
  let bestCost = Infinity;

  for (const stop of options) {
    const travel = rideMinutes(state, state.locationId, stop.nodeId);
    const slack = stop.due - state.clock;
    // Urgency discount: a stop about to go late is worth riding further for.
    const cost = travel - Math.max(0, 60 - slack) * 0.5 - stop.serves * 2;
    if (cost < bestCost) {
      bestCost = cost;
      best = stop;
    }
  }

  return best;
}

/**
 * Whether a selective rider would take this on. Forecasts how long the order will
 * actually take to serve given what is already in the bag, and refuses anything it
 * cannot see itself finishing inside the window.
 *
 * It forecasts using `shownPrep` — the number the app displays — so the bot is
 * fooled by exactly the same under-reporting the player is.
 */
function worthTaking(state: ShiftState, offer: Order, cfg: EconomyConfig): boolean {
  const queueAhead = state.carried.length * AVG_LEG_MINUTES;
  const toPickup = rideMinutes(state, state.locationId, offer.pickupId);
  const toDrop = rideMinutes(state, offer.pickupId, offer.dropId);
  const forecast = queueAhead + toPickup + offer.shownPrep + toDrop;

  return forecast < cfg.tiers[offer.tier].window * 0.85;
}

export function runShift(
  seed: number,
  cfg: EconomyConfig,
  policy: Policy,
): ShiftSummary {
  const state = createShift(seed, cfg);
  const capacity =
    policy === "solo" ? 1 : policy === "selective" ? SELECTIVE_CAP : Infinity;

  // Bounded so a policy bug surfaces as a failed assertion, not a hung process.
  for (let step = 0; step < 5000 && !isOver(state); step++) {
    if (state.carried.length < capacity) {
      for (const offer of [...state.offers]) {
        if (state.carried.length >= capacity) break;
        if (policy === "selective" && !worthTaking(state, offer, cfg)) continue;
        accept(state, offer.id);
      }
    }

    const stop = chooseStop(state);
    if (stop) {
      travelTo(state, stop.nodeId);
    } else {
      // Nothing to carry and nothing worth taking — stand at the hotspot and wait.
      idle(state, 5);
    }
  }

  return endShift(state);
}

export interface Aggregate {
  shifts: number;
  delivered: number;
  onTime: number;
  late: number;
  fees: number;
  milestones: number;
  net: number;
  waiting: number;
  waitingHidden: number;
  undelivered: number;
  /** How many shifts reached each milestone threshold. */
  hits: number[];
}

export function runMany(
  shifts: number,
  cfg: EconomyConfig,
  policy: Policy,
  baseSeed = 1,
): Aggregate {
  const agg: Aggregate = {
    shifts,
    delivered: 0,
    onTime: 0,
    late: 0,
    fees: 0,
    milestones: 0,
    net: 0,
    waiting: 0,
    waitingHidden: 0,
    undelivered: 0,
    hits: cfg.milestones.map(() => 0),
  };

  for (let i = 0; i < shifts; i++) {
    const s = runShift(baseSeed + i, cfg, policy);
    agg.delivered += s.ordersDelivered;
    agg.onTime += s.ordersOnTime;
    agg.late += s.ordersLate;
    agg.fees += s.fees;
    agg.milestones += s.milestones;
    agg.net += s.net;
    agg.waiting += s.minutesWaiting;
    agg.waitingHidden += s.minutesWaitingHidden;
    agg.undelivered += s.undelivered;

    // Milestones track on-time deliveries only.
    cfg.milestones.forEach((m, idx) => {
      if (s.ordersOnTime >= m.orders) agg.hits[idx] = (agg.hits[idx] ?? 0) + 1;
    });
  }

  return agg;
}

/** FNV-1a over the aggregate, so any behavioural drift moves one visible number. */
export function checksum(agg: Aggregate): string {
  const canonical = [
    agg.shifts,
    agg.delivered,
    agg.onTime,
    agg.late,
    Math.round(agg.fees),
    Math.round(agg.milestones),
    Math.round(agg.net),
    Math.round(agg.waiting),
    Math.round(agg.waitingHidden),
    agg.undelivered,
    ...agg.hits,
  ].join("|");

  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
