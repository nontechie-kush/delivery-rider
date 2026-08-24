import { node } from "../sim/city.js";
import { energyCost, hourAt, nextMilestone, vehicleOf, type GameConfig } from "../sim/config.js";
import { minutesOnlineAt } from "../sim/duty.js";
import { distance } from "../sim/city.js";
import { canAccept, canRefill, endShift, nearestRefill, rideMinutes, type ShiftState } from "../sim/shift.js";
import { duration, esc, mins, rupees, urgency } from "./format.js";
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
  const online = minutesOnlineAt(state.duty, state.clock);
  const elapsed = (state.clock / cfg.dayMinutes) * 100;
  const hours = Math.ceil(cfg.dayMinutes / 60);
  const peak = Math.max(...cfg.demandByHour);

  // The day bar is also the demand curve, so the evening rush is visible before
  // it lands. Knowing what is coming is most of the skill this game teaches.
  const bars = Array.from({ length: hours }, (_, offset) => {
    const demand = cfg.demandByHour[(cfg.dayStartHour + offset) % 24] ?? 1;
    return `<i style="height:${Math.max(9, (demand / peak) * 100)}%"></i>`;
  }).join("");

  // Earnings and time on duty are the two numbers a rider watches, so they get
  // equal weight. Hours online is what every other figure here is per-unit of.
  return `
    <div class="earnings">
      <div class="etop">
        <div>
          <span class="label">Today's earnings</span>
          <div class="amt">${rupees(earned)}</div>
        </div>
        <div class="ontime">
          <span class="label">On duty</span>
          <div class="amt small">${duration(online)}</div>
        </div>
      </div>
      <div class="subline">
        <span>${state.completed.length} delivered</span>
        <span>${km(state.unitsRidden)}</span>
        <span>${online > 20 ? `${rupees((earned / online) * 60)}/hr` : "—"}</span>
      </div>
      <div class="daycurve" aria-hidden="true">
        ${bars}<span class="nowline" style="left:${Math.min(100, elapsed)}%"></span>
      </div>
    </div>`;
}

/**
 * The range gauge. Electric riders need this far more than petrol ones: seventy
 * kilometres between swaps, and only two stations in the zone.
 */
export function fuelBlock(state: ShiftState, cfg: GameConfig): string {
  const vehicle = vehicleOf(state.vehicleId, cfg);
  if (vehicle.energy === "none") return "";

  const frac = state.rangeLeft / vehicle.rangeKm;
  const low = frac <= cfg.lowRangeWarning;
  const stop = nearestRefill(state);
  const unreachable = stop !== null && stop.km > state.rangeLeft;

  return `
    <div class="fuel ${low ? "low" : ""} ${unreachable ? "stranded" : ""}">
      <div class="fuel-head">
        <b>${Math.round(state.rangeLeft)} km left</b>
        <span>${esc(vehicle.name)} · ${rupees(state.energySpent)} spent today</span>
      </div>
      <div class="bar"><i style="width:${Math.max(2, frac * 100)}%"></i></div>
      ${
        stop
          ? `<div class="fuel-foot">${
              unreachable
                ? `Nearest ${vehicle.refillIsWholeUnit ? "swap" : "pump"} is ${km(stop.km)} away — further than you can ride.`
                : `Nearest ${vehicle.refillIsWholeUnit ? "swap" : "pump"}: ${esc(node(stop.nodeId).name)}, ${km(stop.km)}`
            }</div>`
          : ""
      }
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

export function summaryScreen(state: ShiftState, cfg: GameConfig): string {
  const s = endShift(state);
  const vehicle = vehicleOf(state.vehicleId, cfg);

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
        ${
          s.slot
            ? `<tr><td>${esc(s.slot.slot.label)} guarantee <em>${
                s.slot.met ? "terms met" : esc(s.slot.reason ?? "")
              }</em></td><td>${s.guaranteeTopUp > 0 ? rupees(s.guaranteeTopUp) : "—"}</td></tr>`
            : ""
        }
        ${
          s.incentivesVoided
            ? `<tr class="void"><td>Incentives void <em>acceptance ${Math.round(
                (s.acceptance ?? 0) * 100,
              )}%</em></td><td>₹0</td></tr>`
            : ""
        }
        <tr class="cost"><td>${
          vehicle.refillIsWholeUnit ? "Battery swaps" : "Petrol"
        } <em>${km(s.unitsRidden)} ridden</em></td><td>−${rupees(s.energySpent)}</td></tr>
        <tr class="cost"><td>Wear, data, the rest</td>
            <td>−${rupees(s.expenses - s.energySpent)}</td></tr>
      </table>

      <p class="waited">
        <b>${duration(s.minutesOnline)}</b> on duty
        ${s.minutesOnline > 20 ? `· <b>${rupees((s.net / s.minutesOnline) * 60)}/hr</b> after costs` : ""}<br>
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

/* ------------------------------------------------------------ going on duty */

/**
 * The screen before the day starts. Real riders open the app, see what the
 * platform is offering, decide whether to commit to a window, and only then go
 * on duty — so the game asks the same three questions in the same order.
 */
export function startScreen(
  cfg: GameConfig,
  located: string | null,
  locating: boolean,
): string {
  const slots = cfg.slots
    .map(
      (s) => `
      <label class="slotpick" data-slot="${esc(s.id)}">
        <input type="radio" name="slot" value="${esc(s.id)}" />
        <span class="slotbody">
          <b>${esc(s.label)}</b>
          <span class="slothours">${s.fromHour}:00–${s.toHour}:00</span>
          <span class="slotterms">Deliver ${s.minDeliveries}, stay online the whole
            window, reject at most ${s.rejectionsAllowed}. Miss any one and it
            pays nothing at all.</span>
        </span>
        <span class="slotpay">${rupees(s.guarantee)}</span>
      </label>`,
    )
    .join("");

  return `
    <div class="start">
      <span class="label">Good morning</span>
      <h1>Ready to go on duty?</h1>

      <div class="locrow ${locating ? "busy" : ""}">
        <span class="locpin" aria-hidden="true"></span>
        <span class="loctext">${
          locating
            ? "Finding you…"
            : located
              ? esc(located)
              : "We'll start you wherever you are."
        }</span>
      </div>

      <h2>Book a window <span class="count">optional</span></h2>
      <p class="slotintro">
        Hit every term and you can't earn less than the guarantee. Break one and
        it's worth nothing at all.
      </p>
      <div class="slotpicks">
        ${slots}
        <label class="slotpick" data-slot="">
          <input type="radio" name="slot" value="" checked />
          <span class="slotbody">
            <b>No commitment</b>
            <span class="slotterms">Work when you like. Reject what you like.
              No floor under your earnings.</span>
          </span>
          <span class="slotpay free">—</span>
        </label>
      </div>

      <button class="go" data-begin="1">
        <span class="golabel">Go on duty</span>
        <span class="gometa">Orders only arrive while you're online</span>
      </button>
    </div>`;
}

/**
 * The booked window, while it is live.
 *
 * A guarantee the player cannot see is a guarantee they will break by accident:
 * every term is lost silently — one rejection too many, a few minutes off duty —
 * and finding out at settlement is a bug report, not a mechanic. So this states
 * what is at stake and what is left of it, the whole time it applies.
 */
export function commitmentBlock(state: ShiftState, cfg: GameConfig): string {
  const c = state.duty.commitment;
  if (!c) return "";

  const slot = cfg.slots.find((s) => s.id === c.slotId);
  if (!slot) return "";

  const hour = hourAt(state.clock, cfg);
  const before = hour < slot.fromHour;
  const after = hour >= slot.toHour;
  const broken = c.brokenReason !== null;
  const rejectsLeft = slot.rejectionsAllowed - c.rejections;

  const short = slot.minDeliveries - c.delivered;
  const done = short <= 0;

  const status = broken
    ? `<span class="cmt-dead">Lost — ${esc(c.brokenReason ?? "")}</span>`
    : before
      ? `<span class="cmt-wait">Starts at ${slot.fromHour}:00</span>`
      : after && !done
        ? `<span class="cmt-dead">Window closed ${short} short. Pays nothing.</span>`
        : after
          ? `<span class="cmt-ok">Window closed. Terms met.</span>`
          : `<span class="cmt-live">Until ${slot.toHour}:00 · ${
              rejectsLeft > 0 ? `${rejectsLeft} rejection left` : "no rejections left"
            }</span>`;

  // The delivery count is the term that actually bites, so it gets the bar.
  // Being one short pays exactly the same as never showing up.
  const pct = Math.min(100, (c.delivered / slot.minDeliveries) * 100);

  return `
    <div class="commitment ${broken || (after && !done) ? "dead" : after ? "done" : before ? "waiting" : "live"}">
      <div class="cmt-head">
        <b>${esc(slot.label)}</b>
        <span class="cmt-pay">${broken || (after && !done) ? "₹0" : rupees(slot.guarantee)}</span>
      </div>
      <div class="cmt-need">
        <span>${done ? "All " : ""}${c.delivered} of ${slot.minDeliveries} delivered${
          done ? "" : ` · ${short} to go`
        }</span>
      </div>
      <div class="bar"><i style="width:${Math.max(3, pct)}%"></i></div>
      <div class="cmt-status">${status}</div>
    </div>`;
}
