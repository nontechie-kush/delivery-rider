import { load, makeBag, fits, unload } from "./bag.js";
import { START_NODE_ID, distance, node, travelMinutes } from "./city.js";
import {
  DEFAULT_CONFIG,
  demandAt,
  energyCost,
  refillStopsFor,
  vehicleOf,
  hourAt,
  milestoneBonus,
  paidFee,
  placeOf,
  trafficAt,
  type GameConfig,
} from "./config.js";
import {
  accrue,
  createDuty,
  goOffline,
  goOnline,
  incentivesVoid,
  recordAccept,
  recordDelivery,
  recordIgnored,
  acceptanceRate,
  recordReject,
  settleSlot,
  type DutyState,
  type SlotOutcome,
} from "./duty.js";
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
  cfg: GameConfig;
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
  /** Kilometres ridden today. Expenses are charged against this. */
  unitsRidden: number;
  /** What the rider is on today. */
  vehicleId: string;
  /** Kilometres of range left in the tank or the battery. */
  rangeLeft: number;
  /** Rupees spent on petrol or swaps so far, paid as you go. */
  energySpent: number;
  duty: DutyState;
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
  /** Minutes actually spent on duty. */
  minutesOnline: number;
  /** Rupees paid for petrol or battery swaps during the day. */
  energySpent: number;
  /** Kilometres of range still in the tank at close. */
  rangeLeft: number;
  /** Accepted over offered, or null if too few offers to judge. */
  acceptance: number | null;
  /** True when acceptance fell below the platform's floor and voided incentives. */
  incentivesVoided: boolean;
  /** How the booked slot settled, if one was booked. */
  slot: SlotOutcome | null;
  /** Top-up paid because a met guarantee exceeded what was earned. */
  guaranteeTopUp: number;
  /** Kilometres ridden. */
  unitsRidden: number;
}

export function createShift(
  seed: number,
  cfg: GameConfig = DEFAULT_CONFIG,
  startNodeId: string = START_NODE_ID,
): ShiftState {
  const rng = makeRng(seed);
  const vehicle = vehicleOf(cfg.startVehicleId, cfg);
  const state: ShiftState = {
    cfg,
    rng,
    clock: 0,
    locationId: node(startNodeId).id,
    bag: makeBag(vehicle.bagSlots),
    carried: [],
    offers: [],
    completed: [],
    dropped: [],
    seq: 0,
    nextOfferAt: 0,
    unitsRidden: 0,
    vehicleId: vehicle.id,
    // Riders start the day with a full tank; topping up mid-shift is the decision.
    rangeLeft: vehicle.rangeKm,
    energySpent: 0,
    duty: createDuty(),
    log: [],
  };
  return state;
}

export function isOver(state: ShiftState): boolean {
  return state.clock >= state.cfg.dayMinutes;
}

/**
 * Spawns any offers due by the current clock and drops expired ones.
 *
 * Nothing is offered while off duty — that is the entire cost of stepping away,
 * and the reason riders stay logged in through weather, meals and worse.
 */
function refreshOffers(state: ShiftState): void {
  while (state.nextOfferAt <= state.clock && state.nextOfferAt < state.cfg.dayMinutes) {
    if (state.duty.online) {
      state.seq += 1;
      state.offers.push(
        generateOrder(state.rng, state.nextOfferAt, state.seq, state.cfg, state.locationId),
      );
    }
    state.nextOfferAt += nextOfferGap(
      state.rng,
      state.cfg,
      demandAt(state.nextOfferAt, state.cfg),
    );
  }
  // An offer that timed out while the rider was standing idle with room in the
  // bag is a refusal, not bad luck. Being too busy to catch one is not.
  const expired = state.offers.filter((o) => o.expiresAt <= state.clock);
  if (expired.length > 0 && state.duty.online && state.carried.length === 0) {
    for (const o of expired) {
      if (fits(state.bag, o.temp)) recordIgnored(state.duty, state.clock, state.cfg);
    }
  }
  state.offers = state.offers.filter((o) => o.expiresAt > state.clock);
}

function advance(state: ShiftState, minutes: number): void {
  state.clock += minutes;
  accrue(state.duty, state.clock, state.cfg);
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
  recordAccept(state.duty);
  state.carried.push({ order, leg: "TO_PICKUP", pickedUpAt: null, waited: 0 });
  state.log.push(`Took a ${order.tier.toLowerCase()} order to ${node(order.dropId).name}, ₹${order.fee}.`);
  return true;
}

export function reject(state: ShiftState, id: string): boolean {
  const before = state.offers.length;
  state.offers = state.offers.filter((o) => o.id !== id);
  if (state.offers.length === before) return false;
  recordReject(state.duty, state.clock, state.cfg);
  return true;
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

  const km = distance(state.locationId, destId);
  const vehicle = vehicleOf(state.vehicleId, state.cfg);
  let minutes = rideMinutes(state, state.locationId, destId);

  // Running dry is not a soft lock. You push it, at walking pace, and everyone
  // waiting on you keeps waiting.
  if (vehicle.energy !== "none" && km > state.rangeLeft) {
    const pushed = km - state.rangeLeft;
    minutes += pushed * state.cfg.pushMinPerKm;
    state.log.push(
      `Ran dry ${pushed.toFixed(1)} km short. Pushed it the rest of the way.`,
    );
  }

  state.unitsRidden += km;
  state.rangeLeft = Math.max(0, state.rangeLeft - km);
  // Charged as it is burnt rather than when it is bought. Over a day the money
  // is identical, but this way every ride is priced at the moment you decide to
  // take it — a tank bought yesterday still cost you something today.
  state.energySpent += energyCost(km, vehicle);
  advance(state, minutes);
  state.locationId = destId;
  state.log.push(`Rode to ${node(destId).name}, ${minutes.toFixed(0)} min.`);
  collectAndDeliver(state);
}

/** Whether the rider can restore range where they are standing. */
export function canRefill(state: ShiftState): boolean {
  const vehicle = vehicleOf(state.vehicleId, state.cfg);
  if (vehicle.energy === "none") return false;
  if (state.rangeLeft >= vehicle.rangeKm - 0.01) return false;
  return refillStopsFor(vehicle, state.cfg).includes(state.locationId);
}

/**
 * Fill up, or swap the battery.
 *
 * Petrol is metered, so the rider pays for the kilometres they put back. A
 * battery swap is all-or-nothing — you hand over whatever is left in the old
 * pack and pay for a whole fresh one, which is why timing a swap matters.
 */
export function refill(state: ShiftState): boolean {
  if (!canRefill(state)) return false;

  const vehicle = vehicleOf(state.vehicleId, state.cfg);
  const restored = vehicle.rangeKm - state.rangeLeft;

  // The fuel itself is billed per kilometre as it burns, so stopping costs only
  // time. What the stop really buys is range, and for an electric rider with
  // seventy kilometres and two stations in the zone, that is the whole game.
  state.rangeLeft = vehicle.rangeKm;
  advance(state, vehicle.refillMinutes);

  state.log.push(
    vehicle.refillIsWholeUnit
      ? `Swapped the battery at ${node(state.locationId).name}. ${vehicle.refillMinutes} min.`
      : `Filled up at ${node(state.locationId).name}, ${restored.toFixed(0)} km of range.`,
  );
  return true;
}

/** Nearest place this vehicle can refill, and how far it is. */
export function nearestRefill(state: ShiftState): { nodeId: string; km: number } | null {
  const vehicle = vehicleOf(state.vehicleId, state.cfg);
  const stops = refillStopsFor(vehicle, state.cfg);
  if (stops.length === 0) return null;

  let best: { nodeId: string; km: number } | null = null;
  for (const id of stops) {
    const km = distance(state.locationId, id);
    if (!best || km < best.km) best = { nodeId: id, km };
  }
  return best;
}

/**
 * Travel time between two nodes at the current hour's congestion.
 *
 * Everything that quotes a ride — the UI, the bot, the offer forecast — must go
 * through this rather than calling travelMinutes directly, or the estimate stops
 * matching what the ride actually costs during the evening block.
 */
export function rideMinutes(state: ShiftState, fromId: string, toId: string): number {
  const vehicle = vehicleOf(state.vehicleId, state.cfg);
  return travelMinutes(fromId, toId, vehicle.minPerKm * trafficAt(state.clock, state.cfg));
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
    advance(state, placeOf(state.locationId, state.cfg).handover);
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
  if (toDeliver.length > 0) advance(state, placeOf(state.locationId, state.cfg).handover);

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

    recordDelivery(state.duty, state.clock, state.cfg);
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

/** Go on duty. Nothing is offered until this happens. */
export function startDuty(state: ShiftState): boolean {
  const ok = goOnline(state.duty, state.clock);
  if (ok) {
    state.log.push(`Went on duty at ${fmt(state.clock, state.cfg)}.`);
    refreshOffers(state);
  }
  return ok;
}

/** Go off duty. Offers stop, and any slot commitment covering now is broken. */
export function stopDuty(state: ShiftState): boolean {
  const before = state.duty.commitment?.brokenReason ?? null;
  const ok = goOffline(state.duty, state.clock, state.cfg);
  if (ok) {
    state.offers = [];
    state.log.push(`Went off duty at ${fmt(state.clock, state.cfg)}.`);
    const after = state.duty.commitment?.brokenReason ?? null;
    if (after && after !== before) state.log.push(`Guarantee lost — ${after}`);
  }
  return ok;
}

/** Stand still for a while — usually to let offers accumulate. */
export function idle(state: ShiftState, minutes: number): void {
  advance(state, minutes);
}

export function endShift(state: ShiftState): ShiftSummary {
  for (const c of state.carried) state.dropped.push(c.order);
  state.carried = [];

  accrue(state.duty, state.clock, state.cfg);

  const fees = state.completed.reduce((sum, c) => sum + c.paid, 0);
  const onTime = state.completed.filter((c) => !c.late).length;

  // Acceptance below the platform's floor voids the day's incentives outright.
  // Riders take orders they know are bad for them precisely to avoid this.
  const voided = incentivesVoid(state.duty, state.cfg);
  const milestones = voided ? 0 : milestoneBonus(onTime, state.cfg);
  // Energy was already billed kilometre by kilometre as it burnt; what settles
  // here is the fixed daily cost plus wear, which nobody hands the rider a bill
  // for but which they pay all the same. Reading upkeep off the vehicle is what
  // makes the ladder mean anything: petrol runs ₹2.19 a kilometre against ₹0.21
  // on a swap scooter, and over a 120 km day that gap is the whole argument.
  const vehicle = vehicleOf(state.vehicleId, state.cfg);
  const upkeep = state.unitsRidden * vehicle.upkeepPerKm;
  const expenses = Math.round(state.cfg.dailyExpenses + upkeep + state.energySpent);

  // A met guarantee is a floor, not a bonus: it tops earnings up to the promised
  // number and pays nothing if you already cleared it. Break any term and it is
  // worth exactly zero — complete 22 of a required 23 and you keep the base pay.
  const slot = settleSlot(state.duty, state.clock, state.cfg);
  const earnedBeforeGuarantee = fees + milestones;
  const guaranteeTopUp =
    slot?.met && slot.slot.guarantee > earnedBeforeGuarantee
      ? slot.slot.guarantee - earnedBeforeGuarantee
      : 0;
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
    net: fees + milestones + guaranteeTopUp - expenses,
    minutesWaiting,
    minutesWaitingHidden,
    undelivered: state.dropped.length,
    unitsRidden: state.unitsRidden,
    minutesOnline: state.duty.minutesOnline,
    energySpent: state.energySpent,
    rangeLeft: state.rangeLeft,
    acceptance: acceptanceRate(state.duty, state.cfg),
    incentivesVoided: voided,
    slot,
    guaranteeTopUp,
  };
}

/** Game-minutes as a wall clock, offset from the shift's start hour. */
export function fmt(minutes: number, cfg: GameConfig = DEFAULT_CONFIG): string {
  const total = cfg.dayStartHour * 60 + Math.floor(minutes);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
