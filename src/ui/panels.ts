import { node } from "../sim/city.js";
import { nextMilestone, type GameConfig } from "../sim/config.js";
import { canAccept, endShift, rideMinutes, type ShiftState } from "../sim/shift.js";
import { esc, mins, rupees, urgency } from "./format.js";
import { routeStack } from "./route.js";
import { estimate, VERDICT_LABEL } from "./verdict.js";

/**
 * Everything that lives inside the sheet. Kept out of main.ts so that file stays
 * about composition and sheet mechanics rather than markup.
 */

/** Distances are already kilometres — the projection does the work. */
const km = (v: number): string => `${v.toFixed(1)} km`;

const SLOT_NEED: Record<string, string> = {
  HOT: "Hot bag",
  COLD: "Cold bag",
  AMBIENT: "Any slot",
};

export function earningsBlock(state: ShiftState, cfg: GameConfig): string {
  const earned = state.completed.reduce((s, c) => s + c.paid, 0);
  const left = Math.max(0, cfg.dayMinutes - state.clock);
  const elapsed = (state.clock / cfg.dayMinutes) * 100;
  const hours = Math.ceil(cfg.dayMinutes / 60);
  const peak = Math.max(...cfg.demandByHour);

  // The day bar is also the demand curve, so the evening rush is visible before
  // it lands. Knowing what is coming is most of the skill this game teaches.
  const bars = Array.from({ length: hours }, (_, offset) => {
    const demand = cfg.demandByHour[(cfg.dayStartHour + offset) % 24] ?? 1;
    return `<i style="height:${Math.max(9, (demand / peak) * 100)}%"></i>`;
  }).join("");

  return `
    <div class="earnings">
      <span class="label">Today's earnings</span>
      <div class="amt">${rupees(earned)}</div>
      <div class="subline">
        <span>${state.completed.length} delivered</span>
        <span>${km(state.unitsRidden)}</span>
        <span>${mins(left)} left</span>
      </div>
      <div class="daycurve" aria-hidden="true">
        ${bars}<span class="nowline" style="left:${Math.min(100, elapsed)}%"></span>
      </div>
    </div>`;
}

export function incentiveBlock(state: ShiftState, cfg: GameConfig): string {
  const done = state.completed.filter((c) => !c.late).length;
  const next = nextMilestone(done, cfg);

  if (!next) {
    return `<div class="incentive cleared">
      <b>All incentives cleared</b><span>${done} on time</span>
    </div>`;
  }

  const previous = cfg.milestones.filter((m) => m.orders <= done).pop()?.orders ?? 0;
  const pct = ((done - previous) / (next.orders - previous)) * 100;
  const close = next.short <= 3;

  return `
    <div class="incentive ${close ? "close" : ""}">
      <div class="inc-head">
        <b>${next.short} more on time</b><span>${rupees(next.bonus)}</span>
      </div>
      <div class="bar"><i style="width:${Math.max(3, pct)}%"></i></div>
      <div class="inc-foot"><span>${done} on time</span><span>${next.orders}</span></div>
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
    .map((s) => `<i class="slot ${s.kind.toLowerCase()} ${s.orderId ? "full" : ""}"></i>`)
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
      } · ${slack < 0 ? "late" : `${mins(slack)} spare`}</span>
    </button>
    <button class="wait" data-wait="15">Wait</button>
  </div>`;
}

export function summaryScreen(state: ShiftState): string {
  const s = endShift(state);

  return `
    <div class="summary">
      <span class="label">Shift complete</span>
      <div class="amt">${rupees(s.net)}</div>
      <span class="paidout">paid to your account</span>

      <table>
        <tr><td>${s.ordersDelivered} deliveries${
          s.ordersLate > 0 ? ` <em>${s.ordersLate} late</em>` : ""
        }</td><td>${rupees(s.fees)}</td></tr>
        <tr><td>Incentive · ${s.ordersOnTime} on time</td>
            <td>${s.milestones > 0 ? rupees(s.milestones) : "—"}</td></tr>
        <tr class="cost"><td>Fuel, data, wear <em>${km(s.unitsRidden)}</em></td>
            <td>−${rupees(s.expenses)}</td></tr>
      </table>

      <p class="waited">
        Stood waiting <b>${mins(s.minutesWaiting)}</b> at pickups.
        ${
          s.minutesWaitingHidden > 1
            ? `<span class="flag">${mins(s.minutesWaitingHidden)} of it NOW never showed you.</span>`
            : ""
        }
        ${s.undelivered > 0 ? `<span class="flag">${s.undelivered} order(s) never left your bag.</span>` : ""}
      </p>

      <button class="go" data-restart="1"><span class="golabel">Go on duty again</span></button>
    </div>`;
}
