import "./style.css";
import { NODES, node, travelMinutes } from "./sim/city.js";
import { DEFAULT_ECONOMY, nextMilestone } from "./sim/economy.js";
import {
  accept,
  canAccept,
  createShift,
  endShift,
  fmt,
  idle,
  isOver,
  reject,
  travelTo,
  type ShiftState,
} from "./sim/shift.js";
import type { Order } from "./sim/types.js";

const cfg = DEFAULT_ECONOMY;
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

let state: ShiftState = createShift(Math.floor(Math.random() * 1e9), cfg);
let finished = false;

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const mins = (n: number) => `${Math.round(n)}m`;
const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);

/** Minutes left before an accepted order goes late. */
function slack(order: Order): number {
  return order.dueAt - state.clock;
}

function urgencyClass(minutesLeft: number): string {
  if (minutesLeft < 0) return "red";
  if (minutesLeft < 12) return "amber";
  return "green";
}

function hud(): string {
  const onTime = state.completed.filter((c) => !c.late).length;
  const next = nextMilestone(onTime, cfg);
  const earned = state.completed.reduce((s, c) => s + c.paid, 0);
  const left = cfg.shiftMinutes - state.clock;

  return `
    <div class="hud">
      <div><b>${fmt(state.clock)}</b><span>${mins(Math.max(0, left))} left</span></div>
      <div><b>${onTime}</b><span>on time${state.completed.length > onTime ? ` · ${state.completed.length - onTime} late` : ""}</span></div>
      <div><b class="${next && next.short <= 3 ? "amber" : ""}">${next ? `+${next.short}` : "—"}</b><span>${next ? `for ${rupees(next.bonus)}` : "all cleared"}</span></div>
      <div><b>${rupees(earned)}</b><span>fees so far</span></div>
    </div>`;
}

function bagPanel(): string {
  const slots = state.bag
    .map((s) => `<span class="slot ${s.orderId ? "full" : ""}">${s.kind}${s.orderId ? ` ${s.orderId}` : ""}</span>`)
    .join("");
  return `<div class="panel"><h2>Bag</h2><div class="slots">${slots}</div></div>`;
}

function carriedPanel(): string {
  if (state.carried.length === 0) {
    return `<div class="panel"><h2>Carrying</h2><div class="dim">Nothing. Take something.</div></div>`;
  }

  const rows = state.carried
    .map((c) => {
      const target = c.leg === "TO_PICKUP" ? c.order.pickupId : c.order.dropId;
      const left = slack(c.order);
      const verb = c.leg === "TO_PICKUP" ? "collect at" : "drop at";
      return `
        <div class="row">
          <span class="tag ${c.order.tier}">${c.order.tier}</span>
          <span class="grow">${c.order.id} · ${verb} <b>${esc(node(target).name)}</b></span>
          <span class="${urgencyClass(left)}">${left < 0 ? `LATE ${mins(-left)}` : mins(left)}</span>
          <span class="dim">${rupees(c.order.fee)}</span>
        </div>`;
    })
    .join("");

  return `<div class="panel"><h2>Carrying (${state.carried.length})</h2>${rows}</div>`;
}

function offersPanel(): string {
  if (state.offers.length === 0) {
    return `<div class="panel"><h2>Offers</h2><div class="dim">Queue is empty. Wait, or ride on.</div></div>`;
  }

  const rows = [...state.offers]
    .sort((a, b) => a.expiresAt - b.expiresAt)
    .map((o) => {
      const room = canAccept(state, o.id);
      const expiresIn = o.expiresAt - state.clock;
      const ride = travelMinutes(state.locationId, o.pickupId);
      return `
        <div class="row">
          <span class="tag ${o.tier}">${o.tier}</span>
          <span class="grow">
            <b>${rupees(o.fee)}</b> ${o.temp.toLowerCase()} ·
            ${esc(node(o.pickupId).name)} → ${esc(node(o.dropId).name)}<br>
            <span class="dim">${mins(ride)} ride · ${mins(o.shownPrep)} prep · ${mins(cfg.tiers[o.tier].window)} window</span>
          </span>
          <span class="dim">gone in ${mins(expiresIn)}</span>
          <button class="go" data-accept="${o.id}" ${room ? "" : "disabled"}>${room ? "Take" : "No room"}</button>
          <button class="stop" data-reject="${o.id}">Pass</button>
        </div>`;
    })
    .join("");

  return `<div class="panel"><h2>Offers</h2>${rows}</div>`;
}

function movePanel(): string {
  // Stops that actually serve something you are carrying, closest first.
  const useful = new Map<string, number>();
  for (const c of state.carried) {
    const id = c.leg === "TO_PICKUP" ? c.order.pickupId : c.order.dropId;
    useful.set(id, Math.min(useful.get(id) ?? Infinity, slack(c.order)));
  }

  const buttons = [...useful.entries()]
    .sort((a, b) => travelMinutes(state.locationId, a[0]) - travelMinutes(state.locationId, b[0]))
    .map(([id, soonest]) => {
      const ride = travelMinutes(state.locationId, id);
      const serves = state.carried.filter(
        (c) => (c.leg === "TO_PICKUP" ? c.order.pickupId : c.order.dropId) === id,
      ).length;
      return `<button class="go" data-go="${id}">${esc(node(id).name)} · ${mins(ride)}${serves > 1 ? ` · ${serves} orders` : ""} <span class="${urgencyClass(soonest)}">●</span></button>`;
    })
    .join("");

  const others = NODES.filter((n) => n.id !== state.locationId && !useful.has(n.id))
    .map((n) => `<button data-go="${n.id}">${esc(n.name)} · ${mins(travelMinutes(state.locationId, n.id))}</button>`)
    .join("");

  return `
    <div class="panel">
      <h2>At ${esc(node(state.locationId).name)} — ride to</h2>
      <div class="row">${buttons || '<span class="dim">Nowhere to be.</span>'}</div>
      <div class="row">
        <button data-wait="10">Wait 10m</button>
        <button data-wait="25">Wait 25m</button>
        <button data-end="1" class="stop">End shift</button>
      </div>
      <details><summary class="dim">Ride somewhere else</summary><div class="row">${others}</div></details>
    </div>`;
}

function logPanel(): string {
  const lines = state.log.slice(-40).reverse().map((l) => `<div>${esc(l)}</div>`).join("");
  return `<div class="panel"><h2>Log</h2><div id="log">${lines}</div></div>`;
}

function summaryPanel(): string {
  const sum = endShift(state);
  const hidden = sum.minutesWaitingHidden;

  return `
    <div class="panel end">
      <h2>Shift over</h2>
      <table>
        <tr><td>${sum.ordersDelivered} delivered, ${sum.ordersOnTime} on time</td><td>${rupees(sum.fees)}</td></tr>
        <tr><td>Milestone bonus <span class="dim">(on-time only)</span></td><td>${rupees(sum.milestones)}</td></tr>
        <tr><td class="dim">Fuel, data, wear</td><td class="dim">−${rupees(sum.expenses)}</td></tr>
        <tr class="total"><td>Take-home</td><td>${rupees(sum.net)}</td></tr>
      </table>
      <div class="row dim">
        Stood waiting ${mins(sum.minutesWaiting)} at pickups.
        ${hidden > 1 ? `<span class="amber">${mins(hidden)} of it the app never showed you.</span>` : ""}
        ${sum.undelivered > 0 ? `<span class="red">${sum.undelivered} still in your bag.</span>` : ""}
      </div>
      <div class="row"><button class="go" data-restart="1">Another shift</button></div>
    </div>`;
}

function render(): void {
  if (!app) return;

  if (finished) {
    app.innerHTML = `<h1>Shift — prototype</h1>${summaryPanel()}${logPanel()}`;
    return;
  }

  app.innerHTML = [
    "<h1>Shift — prototype</h1>",
    hud(),
    offersPanel(),
    carriedPanel(),
    bagPanel(),
    movePanel(),
    logPanel(),
  ].join("");
}

function finishIfOver(): void {
  if (isOver(state)) finished = true;
}

app.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest("button");
  if (!button) return;

  const { accept: take, reject: pass, go, wait, end, restart } = button.dataset;

  if (take) accept(state, take);
  else if (pass) reject(state, pass);
  else if (go) travelTo(state, go);
  else if (wait) idle(state, Number(wait));
  else if (end) finished = true;
  else if (restart) {
    state = createShift(Math.floor(Math.random() * 1e9), cfg);
    finished = false;
  } else return;

  if (!restart) finishIfOver();
  render();
});

render();
