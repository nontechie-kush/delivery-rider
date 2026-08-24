import { node } from "../sim/city.js";
import { energyCost, vehicleOf, type GameConfig } from "../sim/config.js";
import { distance } from "../sim/city.js";
import { canAccept, canRefill, rideMinutes, type ShiftState } from "../sim/shift.js";
import { esc, mins, rupees, urgency } from "./format.js";
import { routeStack } from "./route.js";
import { estimate, VERDICT_LABEL } from "./verdict.js";

/**
 * The contents of the sheet: what the player acts on.
 *
 * Status moved out to status.ts and the bookend screens to screens.ts, leaving
 * this file with offers, the bag, and the primary action — the three things a
 * rider actually touches.
 */

export type Tab = "offers" | "bag" | "day";

/**
 * Tabs rather than a stack.
 *
 * Offers used to sit sixth in a scroll of seven blocks, so the one thing the
 * player acts on was four cards deep. A segmented control puts it one tap away
 * and never below the fold.
 */
export function tabBar(state: ShiftState, tab: Tab): string {
  const used = state.bag.filter((s) => s.orderId !== null).length;
  const button = (id: Tab, label: string, count: number | null): string =>
    `<button class="tab ${tab === id ? "on" : ""}" data-tab="${id}">
       ${label}${count !== null && count > 0 ? `<i>${count}</i>` : ""}
     </button>`;

  return `<div class="tabs">
    ${button("offers", "Orders", state.offers.length)}
    ${button("bag", "Bag", used)}
    ${button("day", "Day", null)}
  </div>`;
}


/** Distances are already kilometres — the projection does the work. */
const km = (v: number): string => `${v.toFixed(1)} km`;

const SLOT_NEED: Record<string, string> = {
  HOT: "Hot bag",
  COLD: "Cold bag",
  AMBIENT: "Any slot",
};




/**
 * What this trip burns, and what is left of the fee once it has.
 *
 * A fee is meaningless without the fuel behind it — a ₹44 order that costs ₹18
 * to reach is a worse deal than a ₹30 one next door, and the app never tells a
 * real rider that. Petrol runs about ₹2.19 a kilometre against ₹0.21 on a swap
 * scooter, which is the entire argument for the vehicle ladder.
 */
function fuelLine(
  state: ShiftState,
  cfg: GameConfig,
  pickupId: string,
  dropId: string,
  fee: number,
): string {
  const vehicle = vehicleOf(state.vehicleId, cfg);
  if (vehicle.energy === "none") return "";

  const tripKm = distance(state.locationId, pickupId) + distance(pickupId, dropId);
  const cost = energyCost(tripKm, vehicle);
  const net = fee - cost;
  const thin = net < fee * 0.6;

  return `
    <div class="fuelline ${thin ? "thin" : ""}">
      <span>Fuel for this trip</span>
      <span class="fuelnums">−${rupees(cost)} · <b>${rupees(net)} left</b></span>
    </div>`;
}

function offerCard(state: ShiftState, cfg: GameConfig, orderId: string): string {
  const order = state.offers.find((o) => o.id === orderId);
  if (!order) return "";

  const est = estimate(state, order, cfg);
  const room = canAccept(state, order.id);
  const spare = est.window - est.total;
  const tierWord =
    order.tier === "EXPRESS" ? "Express" : order.tier === "STANDARD" ? "Standard" : "Scheduled";

  return `
    <article class="offer ${est.verdict}" data-preview="${esc(order.id)}">
      <div class="offer-head">
        <span class="tier ${order.tier}">${tierWord}</span>
        <span class="countdown">${mins(order.expiresAt - state.clock)}</span>
      </div>

      <div class="payout">
        <b>${rupees(order.fee)}</b>
        <span>${km(order.distance)} · ${SLOT_NEED[order.temp] ?? ""}</span>
      </div>
      ${fuelLine(state, cfg, order.pickupId, order.dropId, order.fee)}

      ${routeStack(order.pickupId, order.dropId, {
        pickupNote: `Ready in about ${mins(order.shownPrep)}`,
        dropNote: `Deliver within ${mins(est.window)}`,
      })}

      <!-- A real rider glances at an order and simply knows whether it fits. The
           player has no such instinct, so the app renders it — from the prep time
           the platform advertises, which is exactly how it misleads. -->
      <div class="fit ${est.verdict}">
        <span class="fitword">${VERDICT_LABEL[est.verdict]}</span>
        <span class="fitwhy">${mins(est.total)} of work · ${
          spare > 0 ? `${mins(spare)} spare` : `${mins(-spare)} over`
        }</span>
      </div>

      <div class="offer-actions">
        <button class="reject" data-reject="${esc(order.id)}">Reject</button>
        <button class="accept" data-accept="${esc(order.id)}" ${room ? "" : "disabled"}>
          ${room ? "Accept" : "Bag full"}
        </button>
      </div>
    </article>`;
}

export function offersBlock(state: ShiftState, cfg: GameConfig): string {
  if (state.offers.length === 0) {
    return `<section class="block">
      <h2>New orders</h2>
      <p class="empty">Nothing on offer. Wait, or move somewhere busier.</p>
    </section>`;
  }

  const cards = [...state.offers]
    .sort((a, b) => a.expiresAt - b.expiresAt)
    .map((o) => offerCard(state, cfg, o.id))
    .join("");

  return `<section class="block">
    <h2>New orders <span class="count">${state.offers.length}</span></h2>
    <div class="offers">${cards}</div>
  </section>`;
}

export function bagBlock(state: ShiftState): string {
  const used = state.bag.filter((s) => s.orderId !== null).length;
  const slots = state.bag
    .map((s) => `<i class="bagpip ${s.kind.toLowerCase()} ${s.orderId ? "full" : ""}"></i>`)
    .join("");

  if (state.carried.length === 0) {
    return `<section class="block">
      <h2>Your bag <span class="slots">${slots}</span></h2>
      <p class="empty">Empty. Accept something.</p>
    </section>`;
  }

  const rows = [...state.carried]
    .sort((a, b) => a.order.dueAt - b.order.dueAt)
    .map((c) => {
      const left = c.order.dueAt - state.clock;
      const collected = c.leg === "TO_DROP";
      return `
        <article class="task ${urgency(left)}" data-go="${esc(
          collected ? c.order.dropId : c.order.pickupId,
        )}">
          <div class="task-head">
            <span class="step">${collected ? "Deliver" : "Collect"}</span>
            <span class="due">${left < 0 ? `${mins(-left)} late` : `${mins(left)} left`}</span>
          </div>
          ${routeStack(c.order.pickupId, c.order.dropId, { done: collected ? "pickup" : null })}
        </article>`;
    })
    .join("");

  return `<section class="block">
    <h2>Your bag <span class="slots">${slots}</span><span class="count">${used}/${state.bag.length}</span></h2>
    <div class="tasks">${rows}</div>
  </section>`;
}

export function feedBlock(state: ShiftState): string {
  const lines = state.log.slice(-3).reverse();
  if (lines.length === 0) return "";
  return `<div class="feed">${lines
    .map((l, i) => {
      const flag = l.includes("the app said") || l.includes("late");
      return `<div class="${i === 0 ? "newest" : ""} ${flag ? "flag" : ""}">${esc(l)}</div>`;
    })
    .join("")}</div>`;
}

/** The pinned primary action. Sits in the thumb zone, as every rider app does. */
export function actionBlock(state: ShiftState): string {
  const stops = new Map<string, number>();
  for (const c of state.carried) {
    const id = c.leg === "TO_PICKUP" ? c.order.pickupId : c.order.dropId;
    stops.set(id, Math.min(stops.get(id) ?? Infinity, c.order.dueAt - state.clock));
  }

  const best = [...stops.entries()].sort((a, b) => a[1] - b[1])[0];
  const vehicle = vehicleOf(state.vehicleId, state.cfg);

  if (canRefill(state)) {
    const restored = vehicle.rangeKm - state.rangeLeft;
    const billed = vehicle.refillIsWholeUnit ? vehicle.rangeKm : restored;
    return `<div class="sheet-action">
      <button class="go" data-refill="1">
        <span class="golabel">${vehicle.refillIsWholeUnit ? "Swap battery" : "Fill up"}</span>
        <span class="gometa">${rupees(energyCost(billed, vehicle))} · ${vehicle.refillMinutes} min · back to ${Math.round(vehicle.rangeKm)} km</span>
      </button>
      <button class="wait" data-wait="15">Skip</button>
    </div>`;
  }

  if (!best) {
    return `<div class="sheet-action">
      <button class="wait wide" data-wait="15">Wait 15 min</button>
      <button class="wait" data-wait="40">40 min</button>
    </div>`;
  }

  const [id, slack] = best;
  const serves = state.carried.filter(
    (c) => (c.leg === "TO_PICKUP" ? c.order.pickupId : c.order.dropId) === id,
  ).length;

  return `<div class="sheet-action">
    <button class="go" data-go="${esc(id)}">
      <span class="golabel">Ride to ${esc(node(id).name)}</span>
      <span class="gometa">${mins(rideMinutes(state, state.locationId, id))}${
        serves > 1 ? ` · ${serves} orders` : ""
      } · ${slack < 0 ? "late" : `${mins(slack)} spare`}${
        vehicle.energy === "none"
          ? ""
          : ` · ${rupees(energyCost(distance(state.locationId, id), vehicle))} fuel`
      }</span>
    </button>
    <button class="wait" data-wait="15">Wait</button>
  </div>`;
}


/* ------------------------------------------------------------ going on duty */


