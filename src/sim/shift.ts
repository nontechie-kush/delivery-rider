import { load, makeBag, fits, unload } from "./bag.js";
import { START_NODE_ID, node, travelMinutes } from "./city.js";
import {
  DEFAULT_ECONOMY,
  milestoneBonus,
  paidFee,
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
    state.offers.push(generateOrder(state.rng, state.nextOfferAt, state.seq, state.cfg));
    state.nextOfferAt += nextOfferGap(state.rng, state.cfg);
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
  state.log.push(`[${fmt(state.clock)}] took ${order.id} ${order.tier} → ${node(order.dropId).name}`);
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

  const minutes = travelMinutes(state.locationId, destId);
  advance(state, minutes);
  state.locationId = destId;
  state.log.push(`[${fmt(state.clock)}] rode to ${node(destId).name} (${minutes.toFixed(0)}m)`);
  collectAndDeliver(state);
}

function collectAndDeliver(state: ShiftState): void {
  // Collect first — an order picked up here may also be deliverable here later.
  const toCollect = state.carried.filter(
    (c) => c.leg === "TO_PICKUP" && c.order.pickupId === state.locationId,
  );

  if (toCollect.length > 0) {
    const arrivedAt = state.clock;
    // Wait for the slowest one. This is where the app's optimism gets paid for.
    const latest = Math.max(...toCollect.map((c) => readyAt(c.order)));
    if (latest > arrivedAt) {
      advance(state, latest - arrivedAt);
      state.log.push(
        `[${fmt(state.clock)}] waited ${(latest - arrivedAt).toFixed(0)}m at ${node(state.locationId).name}`,
      );
    }
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
      `[${fmt(state.clock)}] delivered ${c.order.id} ₹${paid}${late ? ` LATE by ${lateBy.toFixed(0)}m` : ""}`,
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
    expenses: state.cfg.shiftExpenses,
    net: fees + milestones - state.cfg.shiftExpenses,
    minutesWaiting,
    minutesWaitingHidden,
    undelivered: state.dropped.length,
  };
}

/** Game-minutes as a shift clock starting at 10:00. */
export function fmt(minutes: number): string {
  const total = 600 + Math.floor(minutes);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
