import { vehicleOf, type GameConfig } from "../sim/config.js";
import { endShift, type ShiftState } from "../sim/shift.js";
import { duration, esc, mins, rupees } from "./format.js";

/**
 * The two screens that bookend a day.
 *
 * Both were burying their own point. The start screen led with a location row
 * and put the slot commitment — the actual decision — below it, with no
 * information to make it on. The summary presented the guarantee, which is the
 * emotional peak of the whole day, as the second row of a table.
 */

const km = (v: number): string => `${v.toFixed(1)} km`;

/* --------------------------------------------------------------- start */

/**
 * Booking a window is the decision here, so the day's shape comes first: you
 * cannot sensibly pick a slot without seeing when the orders actually are.
 */
export function startScreen(
  cfg: GameConfig,
  located: string | null,
  locating: boolean,
  chosen: string,
): string {
  const peak = Math.max(...cfg.demandByHour);
  const hours = Array.from({ length: 20 }, (_, i) => (cfg.dayStartHour + i) % 24);

  const curve = hours
    .map((hour) => {
      const demand = cfg.demandByHour[hour] ?? 0;
      const inSlot = cfg.slots.find((s) => hour >= s.fromHour && hour < s.toHour);
      const picked = inSlot !== undefined && inSlot.id === chosen;
      return `<i class="${inSlot ? "inslot" : ""} ${picked ? "picked" : ""}"
                 style="height:${Math.max(6, (demand / peak) * 100)}%"></i>`;
    })
    .join("");

  const slots = cfg.slots
    .map((s) => {
      const picked = s.id === chosen;
      return `
        <label class="slot ${picked ? "on" : ""}" data-slot="${esc(s.id)}">
          <span class="slot-when">
            <b>${esc(s.label)}</b>
            <span>${s.fromHour}:00–${s.toHour}:00</span>
          </span>
          <span class="slot-need">${s.minDeliveries} deliveries<br><span>no more than ${s.rejectionsAllowed} rejection</span></span>
          <span class="slot-pay">${rupees(s.guarantee)}</span>
        </label>`;
    })
    .join("");

  return `
    <div class="start">
      <h1>Your shift, your call</h1>
      <p class="sub">Work when you like. Book a window and you get a floor under
        the day — provided you meet every term of it.</p>

      <div class="daychart">
        <div class="bars">${curve}</div>
        <div class="axis"><span>6am</span><span>1pm</span><span>8pm</span><span>2am</span></div>
      </div>

      <div class="slots">
        ${slots}
        <label class="slot ${chosen === "" ? "on" : ""}" data-slot="">
          <span class="slot-when"><b>No commitment</b><span>Any hours</span></span>
          <span class="slot-need">Reject what you like<br><span>no floor under earnings</span></span>
          <span class="slot-pay free">—</span>
        </label>
      </div>

      <div class="locrow ${locating ? "busy" : ""}">
        <span class="locpin" aria-hidden="true"></span>
        <span>${locating ? "Finding you…" : located ? esc(located) : "We'll start you wherever you are."}</span>
      </div>

      <button class="primary" data-begin="1">Go on duty</button>
      <p class="foot">Orders only arrive while you're online.</p>
    </div>`;
}

/* -------------------------------------------------------------- summary */

/**
 * The day, told as an outcome rather than a receipt.
 *
 * The guarantee is the loudest thing that happens in a day — met or missed, all
 * or nothing — so it gets a verdict line of its own instead of a table row. The
 * costs follow, quieter, because they are context rather than news.
 */
export function summaryScreen(state: ShiftState, cfg: GameConfig): string {
  const s = endShift(state);
  const vehicle = vehicleOf(state.vehicleId, cfg);
  const perHour = s.minutesOnline > 20 ? (s.net / s.minutesOnline) * 60 : null;

  const verdict = s.slot
    ? s.slot.met
      ? `<div class="verdict good">
           <b>${esc(s.slot.slot.label)} guarantee met</b>
           <span>${s.slot.delivered} of ${s.slot.slot.minDeliveries} delivered${
             s.guaranteeTopUp > 0 ? ` · topped up ${rupees(s.guaranteeTopUp)}` : " · you earned past it anyway"
           }</span>
         </div>`
      : `<div class="verdict bad">
           <b>${esc(s.slot.slot.label)} guarantee lost</b>
           <span>${esc(s.slot.reason ?? "")} It pays nothing.</span>
         </div>`
    : "";

  const voided = s.incentivesVoided
    ? `<div class="verdict bad">
         <b>Incentives void</b>
         <span>Acceptance fell to ${Math.round((s.acceptance ?? 0) * 100)}%. The day's bonuses are gone.</span>
       </div>`
    : "";

  return `
    <div class="summary">
      <span class="eyebrow">Day complete</span>
      <div class="net">${rupees(s.net)}</div>
      <p class="netsub">
        ${s.ordersDelivered} delivered over ${duration(s.minutesOnline)}${
          perHour !== null ? ` · <b>${rupees(perHour)}/hr</b> after costs` : ""
        }
      </p>

      ${verdict}
      ${voided}

      <table class="ledger">
        <tr><td>Delivery fees${s.ordersLate > 0 ? ` <em>${s.ordersLate} late, half paid</em>` : ""}</td>
            <td>${rupees(s.fees)}</td></tr>
        <tr><td>Incentive${s.incentivesVoided ? " <em>void</em>" : ` <em>${s.ordersOnTime} on time</em>`}</td>
            <td>${s.milestones > 0 ? rupees(s.milestones) : "—"}</td></tr>
        ${
          s.guaranteeTopUp > 0
            ? `<tr><td>Guarantee top-up</td><td>${rupees(s.guaranteeTopUp)}</td></tr>`
            : ""
        }
        <tr class="out"><td>${vehicle.refillIsWholeUnit ? "Battery" : "Petrol"} <em>${km(s.unitsRidden)}</em></td>
            <td>−${rupees(s.energySpent)}</td></tr>
        ${
          s.bribesPaid > 0
            ? `<tr class="out"><td>Handed over at the roadside <em>jumped lights</em></td>
                 <td>−${rupees(s.bribesPaid)}</td></tr>`
            : ""
        }
        <tr class="out"><td>Wear, data, the rest</td>
            <td>−${rupees(s.expenses - s.energySpent - s.bribesPaid)}</td></tr>
      </table>

      ${
        s.minutesWaitingHidden > 1
          ? `<p class="aside">You stood waiting <b>${mins(s.minutesWaiting)}</b> at pickups.
               <span>${mins(s.minutesWaitingHidden)} of it NOW never showed you.</span></p>`
          : `<p class="aside">You stood waiting <b>${mins(s.minutesWaiting)}</b> at pickups.</p>`
      }
      ${s.undelivered > 0 ? `<p class="aside bad">${s.undelivered} order(s) never left your bag.</p>` : ""}

      <button class="primary" data-restart="1">Another day</button>
    </div>`;
}
