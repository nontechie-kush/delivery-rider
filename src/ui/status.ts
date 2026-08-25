import { hourAt, nextMilestone, vehicleOf, type GameConfig } from "../sim/config.js";
import { minutesOnlineAt } from "../sim/duty.js";
import { node } from "../sim/city.js";
import { nearestRefill, type ShiftState } from "../sim/shift.js";
import { duration, esc, rupees } from "./format.js";
import { icons } from "./icons.js";

/** Distances are already kilometres — the projection does the work. */
const km = (v: number): string => `${v.toFixed(1)} km`;

/**
 * The always-on status block.
 *
 * The old sheet stacked seven bordered cards — earnings, fuel, commitment,
 * incentive, feed, offers, bag — all with the same left-stripe treatment, so
 * nothing stood out and the only thing the player acts on sat sixth. This
 * replaces four of those cards with two rows of type.
 *
 * The rule the whole redesign runs on: a card means something you act on.
 * Status is type on the background. Chrome is reserved for decisions.
 */

/**
 * How the hour reads to a rider, and what it means for them.
 *
 * "Slammed" on its own is a mood, not information — it does not tell the player
 * whether to work, rest or reposition. So it carries the thing it actually
 * implies: roughly how many offers an hour to expect. Volume swings six-fold
 * across a day, which is the single most useful thing to know at a glance.
 */
export function busyness(
  demand: number,
  cfg: GameConfig,
): { word: string; cls: string; perHour: number } {
  const gap = cfg.offerIntervalMean / Math.max(0.05, demand);
  const perHour = Math.max(1, Math.round(60 / gap));

  if (demand >= 3) return { word: "Slammed", cls: "hot", perHour };
  if (demand >= 1.8) return { word: "Busy", cls: "warm", perHour };
  if (demand >= 0.9) return { word: "Steady", cls: "", perHour };
  return { word: "Quiet", cls: "cold", perHour };
}

/** Clock as a wall time, since slots are quoted in wall hours. */
function wallClock(state: ShiftState, cfg: GameConfig): string {
  const hour = hourAt(state.clock, cfg);
  const minute = Math.floor(state.clock) % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Anything the player needs to know right now but has not asked about: a tank
 * that will not reach a pump, a guarantee about to slip. Only shown when true,
 * so an empty row is the normal state and a full one means act.
 */
function warnings(state: ShiftState, cfg: GameConfig): string {
  const out: string[] = [];

  const vehicle = vehicleOf(state.vehicleId, cfg);
  if (vehicle.energy !== "none") {
    const frac = state.rangeLeft / vehicle.rangeKm;
    const stop = nearestRefill(state);
    const word = vehicle.refillIsWholeUnit ? "swap" : "pump";
    if (stop && stop.km > state.rangeLeft) {
      out.push(`<span class="warn bad">Nearest ${word} is ${km(stop.km)} — further than you can ride</span>`);
    } else if (frac <= cfg.lowRangeWarning && stop) {
      // Offer the way there rather than only announcing the problem, the way a
      // navigation app would. The remaining range is already on screen, so this
      // says what to do about it rather than repeating the number.
      out.push(
        `<button class="warn act" data-go="${esc(stop.nodeId)}">
           ${word === "swap" ? "Swap" : "Fill up"} at ${esc(node(stop.nodeId).name)}, ${km(stop.km)} →
         </button>`,
      );
    }
  }

  const c = state.duty.commitment;
  if (c) {
    const slot = cfg.slots.find((s) => s.id === c.slotId);
    if (slot && c.brokenReason) {
      out.push(`<span class="warn bad">${esc(slot.label)} guarantee lost</span>`);
    } else if (slot) {
      const hour = hourAt(state.clock, cfg);
      const live = hour >= slot.fromHour && hour < slot.toHour;
      const short = slot.minDeliveries - c.delivered;
      if (live && short > 0) {
        out.push(
          `<span class="warn${c.rejections >= slot.rejectionsAllowed ? " tight" : ""}">${short} more for ${rupees(slot.guarantee)}</span>`,
        );
      }
    }
  }

  return out.length > 0 ? `<div class="warnrow">${out.join("")}</div>` : "";
}

/**
 * Range, always on.
 *
 * The restructure left this only in the Today overlay and as a warning below
 * 20%, so on a full tank there was no fuel indicator anywhere — which is no use
 * for a resource the player is supposed to manage. It sits in the status row as
 * a figure and a short bar, and takes colour as it drains.
 *
 * A 249 km petrol tank barely moves across a 120 km day. Seventy kilometres of
 * battery moves visibly, which is the point of the ladder.
 */
function rangeReadout(state: ShiftState, cfg: GameConfig): string {
  const vehicle = vehicleOf(state.vehicleId, cfg);
  if (vehicle.energy === "none") return "";

  const frac = Math.max(0, Math.min(1, state.rangeLeft / vehicle.rangeKm));
  const stop = nearestRefill(state);
  const stranded = stop !== null && stop.km > state.rangeLeft;
  const band = stranded ? "bad" : frac <= cfg.lowRangeWarning ? "low" : "";

  return `
    <span class="stat-fuel ${band}" title="${esc(vehicle.name)}">
      ${icons.fuel}
      <span class="fuel-km">${Math.round(state.rangeLeft)} km</span>
      <span class="fuel-bar"><i style="width:${Math.max(3, frac * 100).toFixed(0)}%"></i></span>
    </span>`;
}

export function statusStrip(state: ShiftState, cfg: GameConfig): string {
  const earned = state.completed.reduce((s, c) => s + c.paid, 0);
  const online = minutesOnlineAt(state.duty, state.clock);
  const onTime = state.completed.filter((c) => !c.late).length;
  const next = nextMilestone(onTime, cfg);
  const busy = busyness(cfg.demandByHour[hourAt(state.clock, cfg)] ?? 1, cfg);

  // The milestone is the day's tension, so it gets the only bar up here.
  const previous = cfg.milestones.filter((m) => m.orders <= onTime).pop()?.orders ?? 0;
  const pct = next ? ((onTime - previous) / (next.orders - previous)) * 100 : 100;
  const close = next !== null && next.short <= 3;

  return `
    <div class="status">
      <div class="statrow">
        <span class="stat-time">${wallClock(state, cfg)}</span>
        <span class="stat-cash">${rupees(earned)}</span>
        <span class="stat-on">${duration(online)}</span>
        ${rangeReadout(state, cfg)}
        <span class="stat-busy ${busy.cls}">
          ${busy.word}<em>~${busy.perHour} offers/hr</em>
        </span>
      </div>

      <div class="goalrow ${close ? "close" : ""} ${next ? "" : "done"}">
        <div class="goalbar"><i style="width:${Math.max(2, Math.min(100, pct))}%"></i></div>
        <span class="goaltext">${
          next
            ? `<b>${next.short} more on time</b> for ${rupees(next.bonus)}`
            : `<b>All incentives cleared</b>`
        }</span>
      </div>

      ${warnings(state, cfg)}
    </div>`;
}

/** The occasional-check panel: money, fuel, the booked window, what just happened. */
export function dayBlock(state: ShiftState, cfg: GameConfig): string {
  const earned = state.completed.reduce((s, c) => s + c.paid, 0);
  const vehicle = vehicleOf(state.vehicleId, cfg);
  const c = state.duty.commitment;
  const slot = c ? cfg.slots.find((s) => s.id === c.slotId) : undefined;
  const frac = vehicle.energy === "none" ? 1 : state.rangeLeft / vehicle.rangeKm;

  const rows: string[] = [
    `<div class="dr"><span>Earned</span><b>${rupees(earned)}</b></div>`,
    `<div class="dr"><span>Delivered</span><b>${state.completed.length}${
      state.completed.length > 0
        ? ` <em>${state.completed.filter((x) => !x.late).length} on time</em>`
        : ""
    }</b></div>`,
    `<div class="dr"><span>Ridden</span><b>${km(state.unitsRidden)}</b></div>`,
    `<div class="dr"><span>${vehicle.refillIsWholeUnit ? "Battery" : "Petrol"} spent</span><b>${rupees(state.energySpent)}</b></div>`,
  ];

  if (vehicle.energy !== "none") {
    const stop = nearestRefill(state);
    rows.push(`
      <div class="dr wide">
        <span>${esc(vehicle.name)}</span>
        <b>${Math.round(state.rangeLeft)} km of range</b>
        <div class="minibar ${frac <= cfg.lowRangeWarning ? "low" : ""}"><i style="width:${Math.max(2, frac * 100)}%"></i></div>
        ${stop ? `<em>Nearest ${vehicle.refillIsWholeUnit ? "swap" : "pump"}: ${esc(node(stop.nodeId).name)}, ${km(stop.km)}</em>` : ""}
      </div>`);
  }

  if (slot && c) {
    rows.push(`
      <div class="dr wide ${c.brokenReason ? "bad" : ""}">
        <span>${esc(slot.label)} · ${slot.fromHour}:00–${slot.toHour}:00</span>
        <b>${c.brokenReason ? "₹0" : rupees(slot.guarantee)}</b>
        <em>${
          c.brokenReason
            ? esc(c.brokenReason)
            : `${c.delivered} of ${slot.minDeliveries} delivered · ${Math.max(0, slot.rejectionsAllowed - c.rejections)} rejection left`
        }</em>
      </div>`);
  }

  const feed = state.log
    .slice(-6)
    .reverse()
    .map((l) => {
      const flag = l.includes("the app said") || l.includes("late") || l.includes("red light");
      return `<li class="${flag ? "flag" : ""}">${esc(l)}</li>`;
    })
    .join("");

  return `<section class="block">
    <div class="dayrows">${rows.join("")}</div>
    ${feed ? `<h2>Just now</h2><ul class="feed">${feed}</ul>` : ""}
  </section>`;
}
