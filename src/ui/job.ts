import { node } from "../sim/city.js";
import { nextMilestone, type GameConfig } from "../sim/config.js";
import { rideMinutes, type Completed, type ShiftState } from "../sim/shift.js";
import { esc, mins, rupees, urgency } from "./format.js";

/**
 * What the rider is doing right now, and what just happened.
 *
 * The screen used to give half its height to a map that was permanently on and
 * rarely useful, pushing both the incoming orders and the job in hand into a
 * scroll. Real rider apps show a list while idle and a map only while
 * navigating, so the map moved behind a button and this took its place: when
 * you are carrying something, the job in hand is the screen.
 */

/** The stop the rider should serve next: whatever goes late soonest. */
export function nextStop(state: ShiftState): { nodeId: string; slack: number; serves: number } | null {
  const stops = new Map<string, { slack: number; serves: number }>();
  for (const c of state.carried) {
    const id = c.leg === "TO_PICKUP" ? c.order.pickupId : c.order.dropId;
    const slack = c.order.dueAt - state.clock;
    const at = stops.get(id);
    if (at) {
      at.serves += 1;
      at.slack = Math.min(at.slack, slack);
    } else {
      stops.set(id, { slack, serves: 1 });
    }
  }

  const best = [...stops.entries()].sort((a, b) => a[1].slack - b[1].slack)[0];
  return best ? { nodeId: best[0], slack: best[1].slack, serves: best[1].serves } : null;
}

/**
 * The job in hand, at the top of the screen and never scrolled past.
 *
 * Shows only the next stop in full. Everything else in the bag is one compact
 * line each, because a rider carrying four orders needs to know the next move,
 * not to read four cards.
 */
export function jobBlock(state: ShiftState): string {
  const next = nextStop(state);
  if (!next) return "";

  const here = node(next.nodeId);
  const ride = rideMinutes(state, state.locationId, next.nodeId);
  const band = urgency(next.slack);

  // Everything served by this stop, then everything else, compact.
  const atThisStop = state.carried.filter(
    (c) => (c.leg === "TO_PICKUP" ? c.order.pickupId : c.order.dropId) === next.nodeId,
  );
  const elsewhere = state.carried.filter((c) => !atThisStop.includes(c));

  const lines = atThisStop
    .map((c) => {
      const left = c.order.dueAt - state.clock;
      return `<li class="${urgency(left)}">
        <span>${c.leg === "TO_PICKUP" ? "Collect" : "Deliver"} · ${rupees(c.order.fee)}</span>
        <b>${left < 0 ? `${mins(-left)} late` : `${mins(left)} left`}</b>
      </li>`;
    })
    .join("");

  const rest =
    elsewhere.length > 0
      ? `<div class="alsocarrying">
           <span>Also carrying</span>
           <ul>${elsewhere
             .sort((a, b) => a.order.dueAt - b.order.dueAt)
             .map((c) => {
               const target = c.leg === "TO_PICKUP" ? c.order.pickupId : c.order.dropId;
               const left = c.order.dueAt - state.clock;
               return `<li class="${urgency(left)}">
                 <span>${esc(node(target).name)}</span>
                 <b>${left < 0 ? `${mins(-left)} late` : `${mins(left)} left`}</b>
               </li>`;
             })
             .join("")}</ul>
         </div>`
      : "";

  return `
    <section class="job ${band}">
      <div class="job-head">
        <span class="job-step">${atThisStop[0]?.leg === "TO_PICKUP" ? "Collect from" : "Deliver to"}</span>
        <span class="job-due">${next.slack < 0 ? `${mins(-next.slack)} late` : `${mins(next.slack)} left`}</span>
      </div>
      <h1>${esc(here.name)}</h1>
      <p class="job-where">${esc(here.area)} · ${mins(ride)} away${
        next.serves > 1 ? ` · ${next.serves} orders here` : ""
      }</p>
      <ul class="job-orders">${lines}</ul>
      ${rest}
    </section>`;
}

/**
 * The beat after a delivery lands.
 *
 * Deliveries used to happen silently into a log, which meant the moment the
 * whole loop builds toward — did that one land, what did it pay, am I closer to
 * the bonus — passed without being seen. This is short on purpose: a verdict, a
 * number, and how much nearer the milestone got.
 */
export function outcomeScreen(
  state: ShiftState,
  cfg: GameConfig,
  landed: Completed[],
): string {
  if (landed.length === 0) return "";

  const late = landed.filter((c) => c.late);
  const paid = landed.reduce((sum, c) => sum + c.paid, 0);
  const allLate = late.length === landed.length;
  const onTime = state.completed.filter((c) => !c.late).length;
  const next = nextMilestone(onTime, cfg);

  // The lie is worth naming at the moment it cost you something.
  const worstWait = [...landed].sort((a, b) => b.waited - b.waitShown - (a.waited - a.waitShown))[0];
  const hidden = worstWait ? worstWait.waited - worstWait.waitShown : 0;

  const lines = landed
    .map((c) => {
      const where = esc(node(c.order.dropId).name);
      return c.late
        ? `<li class="bad"><span>${where}</span><b>${rupees(c.paid)} <em>${mins(c.lateBy)} late, half paid</em></b></li>`
        : `<li><span>${where}</span><b>${rupees(c.paid)} <em>on time</em></b></li>`;
    })
    .join("");

  return `
    <div class="outcome ${allLate ? "bad" : late.length > 0 ? "mixed" : "good"}">
      <span class="oc-mark">${allLate ? "Late" : late.length > 0 ? "Mixed" : "Delivered"}</span>
      <div class="oc-pay">${rupees(paid)}</div>

      <ul class="oc-list">${lines}</ul>

      ${
        allLate
          ? `<p class="oc-note bad">No bonus credit for ${landed.length > 1 ? "these" : "this one"}.</p>`
          : ""
      }
      ${
        hidden > 2
          ? `<p class="oc-note warn">You waited ${mins(worstWait!.waited)} at
               ${esc(node(worstWait!.order.pickupId).name)}. The app said ${mins(worstWait!.waitShown)}.</p>`
          : ""
      }

      <div class="oc-goal">
        ${
          next
            ? `<b>${next.short} more on time</b><span>for ${rupees(next.bonus)}</span>`
            : `<b>All incentives cleared</b><span>${onTime} on time today</span>`
        }
      </div>

      <button class="primary" data-dismiss="1">
        ${state.carried.length > 0 ? "Next stop" : "Back to orders"}
      </button>
    </div>`;
}
