import { load, makeBag, fits, unload } from "./bag.js";
import { BIKE_MIN_PER_KM, START_NODE_ID, distance, node, travelMinutes } from "./city.js";
import {
  DEFAULT_ECONOMY,
  demandAt,
  hourAt,
  milestoneBonus,
  paidFee,
  trafficAt,
  type EconomyConfig,
} from "./economy.js";
import { generateOrder, nextOfferGap } from "./orders.js";
import { makeRng, type Rng } from "./rng.js";
import type { Carried, Order, Slot } from "./types.js";

export interface Completed {
  order: Order;
  deliveredAt: number;
  late: boolean;
  /** Minutes past the deadline. Zero when on time. */
  lateBy: number;
  paid: number;
  /** Actual wait at the pickup, in game-minutes. */
  waited: number;
  /** What the app said the wait would be, for comparison. */
  waitShown: number;
}

export interface ShiftState {
  cfg: EconomyConfig;
  rng: Rng;
  /** Game-minutes elapsed in the shift. */
  clock: number;
  locationId: string;
  bag: Slot[];
  carried: Carried[];
  offers: Order[];
  completed: Completed[];
  /** Orders accepted and then failed to deliver before the shift ended. */
  dropped: Order[];
  seq: number;
  nextOfferAt: number;
  /** Kilometres ridden this shift. Expenses are charged against this. */
  unitsRidden: number;
  log: string[];
}

export interface ShiftSummary {
  ordersDelivered: number;
  /** Only these count toward milestones. */
  ordersOnTime: number;
  ordersLate: number;
  fees: number;
  milestones: number;
  expenses: number;
  net: number;
  /** Total minutes spent standing at pickups waiting for orders to be ready. */
  minutesWaiting: number;
  /** How much of that waiting the app never showed. */
  minutesWaitingHidden: number;
  undelivered: number;
  /** Kilometres ridden. */
  unitsRidden: number;
}

export function createShift(seed: number, cfg: EconomyConfig = DEFAULT_ECONOMY): ShiftState {
  const rng = makeRng(seed);
  const state: ShiftState = {
    cfg,
    rng,
    clock: 0,
    locationId: START_NODE_ID,
    bag: makeBag(),
    carried: [],
    offers: [],
    completed: [],
    dropped: [],
    seq: 0,
    nextOfferAt: 0,
    unitsRidden: 0,
    log: [],
  };
  refreshOffers(state);
  return state;
}

export function isOver(state: ShiftState): boolean {
  return state.clock >= state.cfg.shiftMinutes;
}

/** Spawns any offers due by the current clock and drops expired ones. */
function refreshOffers(state: ShiftState): void {
  while (state.nextOfferAt <= state.clock && state.nextOfferAt < state.cfg.shiftMinutes) {
    state.seq += 1;
    state.offers.push(
      generateOrder(state.rng, state.nextOfferAt, state.seq, state.cfg, state.locationId),
    );
    state.nextOfferAt += nextOfferGap(
      state.rng,
      state.cfg,
      demandAt(state.nextOfferAt, state.cfg),
    );
  }
  state.offers = state.offers.filter((o) => o.expiresAt > state.clock);
}

function advance(state: ShiftState, minutes: number): void {
  state.clock += minutes;
  refreshOffers(state);
}

/** When an order is physically ready. Prep starts when the customer orders. */
function readyAt(order: Order): number {
  return order.offeredAt + order.truePrep;
}

export function offerById(state: ShiftState, id: string): Order | null {
  return state.offers.find((o) => o.id === id) ?? null;
}

/** Whether this offer can be taken right now — bag space is the usual blocker. */
export function canAccept(state: ShiftState, id: string): boolean {
  const order = offerById(state, id);
  if (!order) return false;
  return fits(state.bag, order.temp);
}

export function accept(state: ShiftState, id: string): boolean {
  const order = offerById(state, id);
  if (!order) return false;
  if (!load(state.bag, order.temp, order.id)) return false;

  // The clock on a delivery starts when the rider takes it, not when it appeared.
  order.dueAt = state.clock + state.cfg.tiers[order.tier].window;

  state.offers = state.offers.filter((o) => o.id !== id);
  state.carried.push({ order, leg: "TO_PICKUP", pickedUpAt: null, waited: 0 });
  state.log.push(`Took a ${order.tier.toLowerCase()} order to ${node(order.dropId).name}, ₹${order.fee}.`);
  return true;
}

export function reject(state: ShiftState, id: string): boolean {
  const before = state.offers.length;
  state.offers = state.offers.filter((o) => o.id !== id);
  return state.offers.length < before;
}

/**
 * Travel to a node, then resolve everything that happens on arrival: collect any
 * orders waiting there (standing around until they are actually ready) and hand
 * over any orders destined for it.
 */
export function travelTo(state: ShiftState, destId: string): void {
  if (destId === state.locationId) {
    collectAndDeliver(state);
    return;
  }

  const minutes = rideMinutes(state, state.locationId, destId);
  state.unitsRidden += distance(state.locationId, destId);
  advance(state, minutes);
  state.locationId = destId;
  state.log.push(`Rode to ${node(destId).name}, ${minutes.toFixed(0)} min.`);
  collectAndDeliver(state);
}

/**
 * Travel time between two nodes at the current hour's congestion.
 *
 * Everything that quotes a ride — the UI, the bot, the offer forecast — must go
 * through this rather than calling travelMinutes directly, or the estimate stops
 * matching what the ride actually costs during the evening block.
 */
export function rideMinutes(state: ShiftState, fromId: string, toId: string): number {
  return travelMinutes(fromId, toId, BIKE_MIN_PER_KM * trafficAt(state.clock, state.cfg));
}

/** Current clock hour, for anything that needs to show the player the time of day. */
export function hourNow(state: ShiftState): number {
  return hourAt(state.clock, state.cfg);
}

/** How busy the platform is right now, for the UI's "it's quiet / it's slammed" read. */
export function demandNow(state: ShiftState): number {
  return demandAt(state.clock, state.cfg);
}

function collectAndDeliver(state: ShiftState): void {
  // Collect first — an order picked up here may also be deliverable here later.
  const toCollect = state.carried.filter(
    (c) => c.leg === "TO_PICKUP" && c.order.pickupId === state.locationId,
  );

  if (toCollect.length > 0) {
    const arrivedAt = state.clock;
    // Wait for the slowest one. This is where the app's optimism gets paid for.
    const slowest = toCollect.reduce((a, b) => (readyAt(a.order) > readyAt(b.order) ? a : b));
    const latest = readyAt(slowest.order);
    if (latest > arrivedAt) {
      const waited = latest - arrivedAt;
      advance(state, waited);
      // Name the gap explicitly. A lie the player cannot detect reads as a bug,
      // not as a mechanic — this is the line that teaches them who to distrust.
      const claimed = Math.max(0, slowest.order.shownPrep - (arrivedAt - slowest.order.offeredAt));
      const gap = waited - claimed;
      state.log.push(
        `Waited ${waited.toFixed(0)} min at ${node(state.locationId).name}` +
          (gap > 1.5 ? ` — the app said ${claimed.toFixed(0)}.` : "."),
      );
    }
    // Bagging it up, even when it was ready and waiting.
    advance(state, node(state.locationId).handover);
    for (const c of toCollect) {
      c.leg = "TO_DROP";
      c.pickedUpAt = state.clock;
      // Each order's own wait, not the batch's — an order already ready on
      // arrival cost nothing even if a slower one held the rider there.
      c.waited = Math.max(0, Math.min(state.clock, readyAt(c.order)) - arrivedAt);
    }
  }

  const toDeliver = state.carried.filter(
    (c) => c.leg === "TO_DROP" && c.order.dropId === state.locationId,
  );

  // The door itself: the guard, the lift, the floor, the phone call. Charged
  // once per visit rather than per parcel, which is part of why batching to a
  // shared drop pays.
  if (toDeliver.length > 0) advance(state, node(state.locationId).handover);

  for (const c of toDeliver) {
    const late = state.clock > c.order.dueAt;
    const lateBy = late ? state.clock - c.order.dueAt : 0;
    const paid = paidFee(c.order.fee, late, state.cfg);

    state.completed.push({
      order: c.order,
      deliveredAt: state.clock,
      late,
      lateBy,
      paid,
      waited: c.waited,
      waitShown: c.order.shownPrep,
    });

    unload(state.bag, c.order.id);
    state.log.push(
      late
        ? `Delivered to ${node(c.order.dropId).name} ${lateBy.toFixed(0)} min late — half pay, ₹${paid}, and no bonus credit.`
        : `Delivered to ${node(c.order.dropId).name} on time. ₹${paid}.`,
    );
  }

  const deliveredIds = new Set(toDeliver.map((c) => c.order.id));
  state.carried = state.carried.filter((c) => !deliveredIds.has(c.order.id));
}

/** Stand still for a while — usually to let offers accumulate. */
export function idle(state: ShiftState, minutes: number): void {
  advance(state, minutes);
}

export function endShift(state: ShiftState): ShiftSummary {
  for (const c of state.carried) state.dropped.push(c.order);
  state.carried = [];

  const fees = state.completed.reduce((sum, c) => sum + c.paid, 0);
  const onTime = state.completed.filter((c) => !c.late).length;
  const milestones = milestoneBonus(onTime, state.cfg);
  // Measured at 32% of gross, and nearly all of it is distance. Charging it per
  // unit ridden is what will make the cycle-versus-petrol choice mean something.
  const expenses = Math.round(
    state.cfg.shiftExpenses + state.unitsRidden * state.cfg.expensePerKm,
  );
  const minutesWaiting = state.completed.reduce((sum, c) => sum + c.waited, 0);
  const minutesWaitingHidden = state.completed.reduce(
    (sum, c) => sum + Math.max(0, c.waited - c.waitShown),
    0,
  );

  return {
    ordersDelivered: state.completed.length,
    ordersOnTime: onTime,
    ordersLate: state.completed.length - onTime,
    fees,
    milestones,
    expenses,
    net: fees + milestones - expenses,
    minutesWaiting,
    minutesWaitingHidden,
    undelivered: state.dropped.length,
    unitsRidden: state.unitsRidden,
  };
}

/** Game-minutes as a wall clock, offset from the shift's start hour. */
export function fmt(minutes: number, cfg: EconomyConfig = DEFAULT_ECONOMY): string {
  const total = cfg.startHour * 60 + Math.floor(minutes);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
