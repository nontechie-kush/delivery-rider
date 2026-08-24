import { node } from "../sim/city.js";
import { energyCost, vehicleOf, type GameConfig } from "../sim/config.js";
import { distance } from "../sim/city.js";
import { canAccept, canRefill, rideMinutes, type ShiftState } from "../sim/shift.js";
import { esc, mins, rupees, urgency } from "./format.js";
import { icons, withIcon } from "./icons.js";
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
 * What the rider actually keeps.
 *
 * This used to read "−₹14 · ₹14 left", which is two numbers and no sentence.
 * A rider does not think in deductions; they think about what lands in their
 * pocket. So the kept figure leads and the fuel is the smaller half of it, with
 * a bar because a fee half-eaten by petrol should be visible before it is read.
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
  const keep = Math.max(0, fee - cost);
  const keptShare = fee > 0 ? (keep / fee) * 100 : 0;
  const thin = keep < fee * 0.6;

  return `
    <div class="keep ${thin ? "thin" : ""}">
      <div class="keep-split">
        <span class="keep-yours" style="width:${keptShare.toFixed(0)}%"></span>
      </div>
      <div class="keep-row">
        ${withIcon("wallet", `You keep <b>${rupees(keep)}</b>`, "keep-main")}
        ${withIcon("fuel", `${rupees(cost)} fuel · ${tripKm.toFixed(1)} km`, "keep-sub")}
      </div>
    </div>`;
}

function offerCard(
  state: ShiftState,
  cfg: GameConfig,
  orderId: string,
  openFee: string | null,
): string {
  const order = state.offers.find((o) => o.id === orderId);
  if (!order) return "";

  const est = estimate(state, order, cfg);
  const room = canAccept(state, order.id);
  const spare = est.window - est.total;
  const open = openFee === order.id;
  const tier = cfg.tiers[order.tier];
  const billableKm = Math.max(0, order.distance - tier.freeKm);
  const expiring = order.expiresAt - state.clock <= 4;
  // While a job is live, taking another order is an addition to it, not a
  // competing action — so the button says so and stops shouting.
  const busy = state.carried.length > 0;
  const tierWord =
    order.tier === "EXPRESS" ? "Express" : order.tier === "STANDARD" ? "Standard" : "Scheduled";

  return `
    <article class="offer ${est.verdict}" data-preview="${esc(order.id)}">
      <div class="offer-head">
        <span class="tier ${order.tier}">${tierWord}</span>
        <span class="countdown ${expiring ? "soon" : ""}">
          ${icons.clock}<span>gone in ${mins(order.expiresAt - state.clock)}</span>
        </span>
      </div>

      <div class="payout">
        <button class="fee" data-fee="${esc(order.id)}" aria-expanded="${open}">
          <b>${rupees(order.fee)}</b>${icons.info}
        </button>
        <span class="payout-meta">
          ${withIcon("route", km(order.distance))}
          ${withIcon("bag", SLOT_NEED[order.temp] ?? "")}
        </span>
      </div>

      ${
        open
          ? `<dl class="feebreak">
               <div><dt>Base fare, ${tierWord.toLowerCase()}</dt><dd>${rupees(tier.base)}</dd></div>
               <div><dt>First ${tier.freeKm} km</dt><dd>included</dd></div>
               <div><dt>${billableKm.toFixed(1)} km beyond that × ${rupees(tier.perKm)}</dt><dd>${rupees(billableKm * tier.perKm)}</dd></div>
               <div class="feetotal"><dt>Offered</dt><dd>${rupees(order.fee)}</dd></div>
             </dl>`
          : ""
      }
      ${fuelLine(state, cfg, order.pickupId, order.dropId, order.fee)}

      ${routeStack(order.pickupId, order.dropId, {
        pickupNote: `Ready in about ${mins(order.shownPrep)}`,
        dropNote: `${mins(Math.max(0, order.dueAt - state.clock))} left to deliver`,
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
        <button class="accept ${busy ? "secondary" : ""}" data-accept="${esc(order.id)}" ${room ? "" : "disabled"}>
          ${room ? (busy ? "Add to run" : "Accept") : "Bag full"}
        </button>
      </div>
    </article>`;
}

export function offersBlock(state: ShiftState, cfg: GameConfig, openFee: string | null = null): string {
  if (state.offers.length === 0) {
    return `<section class="block">
      <h2>${state.carried.length > 0 ? "Add to your run" : "New orders"}</h2>
      <p class="empty">Nothing on offer. Wait, or move somewhere busier.</p>
    </section>`;
  }

  const cards = [...state.offers]
    .sort((a, b) => a.expiresAt - b.expiresAt)
    .map((o) => offerCard(state, cfg, o.id, openFee))
    .join("");

  const busy = state.carried.length > 0;
  return `<section class="block">
    <h2>${busy ? "Add to your run" : "New orders"}
      <span class="count">${state.offers.length}</span></h2>
    ${
      busy
        ? `<p class="hint">Taking one that shares your route is how a run pays.
             Taking one that does not is how a run goes late.</p>`
        : ""
    }
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
    return `<div class="actionbar">
      <button class="go" data-refill="1">
        <span class="golabel">${vehicle.refillIsWholeUnit ? "Swap battery" : "Fill up"}</span>
        <span class="gometa">${rupees(energyCost(billed, vehicle))} · ${vehicle.refillMinutes} min · back to ${Math.round(vehicle.rangeKm)} km</span>
      </button>
      <button class="wait" data-wait="15">Skip</button>
    </div>`;
  }

  if (!best) {
    return `<div class="actionbar">
      <button class="wait wide" data-wait="15">Wait 15 min</button>
      <button class="wait" data-wait="40">40 min</button>
    </div>`;
  }

  const [id, slack] = best;
  const serves = state.carried.filter(
    (c) => (c.leg === "TO_PICKUP" ? c.order.pickupId : c.order.dropId) === id,
  ).length;

  return `<div class="actionbar">
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


