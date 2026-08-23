import "./style.css";
import { node } from "./sim/city.js";
import { DEFAULT_ECONOMY, nextMilestone } from "./sim/economy.js";
import {
  accept,
  canAccept,
  createShift,
  endShift,
  fmt,
  idle,
  demandNow,
  isOver,
  reject,
  rideMinutes,
  travelTo,
  type ShiftState,
} from "./sim/shift.js";
import { esc, mins, rupees, urgency } from "./ui/format.js";
import { renderMap } from "./ui/map.js";
import { estimate, VERDICT_LABEL } from "./ui/verdict.js";

const cfg = DEFAULT_ECONOMY;
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

let state: ShiftState = createShift(Math.floor(Math.random() * 1e9), cfg);
let finished = false;
let preview: string | null = null;

const onTimeCount = (): number => state.completed.filter((c) => !c.late).length;
const earned = (): number => state.completed.reduce((s, c) => s + c.paid, 0);

/* ---------------------------------------------------------------- top bar */

/**
 * How the hour reads to a rider. Order volume swings about six-fold across a
 * shift, and knowing that the 8pm block is worth three of the 4pm ones is the
 * single most valuable thing a veteran knows — so the game says it out loud
 * rather than making the player infer it from an offer queue.
 */
function busyness(demand: number): { word: string; cls: string } {
  if (demand >= 3) return { word: "Slammed", cls: "hot" };
  if (demand >= 1.8) return { word: "Busy", cls: "warm" };
  if (demand >= 0.9) return { word: "Ticking over", cls: "" };
  return { word: "Dead", cls: "cold" };
}

function topBar(): string {
  const left = Math.max(0, cfg.shiftMinutes - state.clock);
  const elapsed = (state.clock / cfg.shiftMinutes) * 100;
  const busy = busyness(demandNow(state));

  // The day bar doubles as the demand curve: one tick per hour of the shift,
  // tall where the orders are. The player can see the evening block coming.
  const hoursInShift = Math.ceil(cfg.shiftMinutes / 60);
  const peakDemand = Math.max(...cfg.demandByHour);
  const marks = Array.from({ length: hoursInShift }, (_, offset) => {
    const demand = cfg.demandByHour[(cfg.startHour + offset) % 24] ?? 1;
    const pos = (offset / hoursInShift) * 100;
    const height = Math.max(8, (demand / peakDemand) * 100);
    return `<i class="peak" style="left:${pos}%;width:${100 / hoursInShift}%;height:${height}%"></i>`;
  }).join("");

  return `
    <header class="top">
      <div class="clock">
        <b>${fmt(state.clock, cfg)}</b>
        <span class="busy ${busy.cls}">${busy.word}</span>
      </div>
      <div class="cash">
        <b>${rupees(earned())}</b>
        <span>${mins(left)} of shift left</span>
      </div>
      <div class="daybar" aria-hidden="true">
        ${marks}
        <i class="now" style="left:${Math.min(100, elapsed)}%"></i>
      </div>
    </header>`;
}


/* ------------------------------------------------------------- milestone */

function milestoneBar(): string {
  const done = onTimeCount();
  const next = nextMilestone(done, cfg);

  if (!next) {
    return `<div class="goal done"><b>Every bonus cleared.</b><span>${done} on time</span></div>`;
  }

  const previous = cfg.milestones.filter((m) => m.orders <= done).pop()?.orders ?? 0;
  const span = next.orders - previous;
  const pct = ((done - previous) / span) * 100;
  const close = next.short <= 3;

  return `
    <div class="goal ${close ? "close" : ""}">
      <div class="goal-head">
        <b>${next.short} more on time</b>
        <span>unlocks ${rupees(next.bonus)} bonus</span>
      </div>
      <div class="track" role="img" aria-label="${done} of ${next.orders} on-time deliveries">
        <i style="width:${Math.max(2, pct)}%"></i>
      </div>
      <div class="goal-foot">
        <span>${done} delivered on time</span>
        <span>${next.orders}</span>
      </div>
    </div>`;
}

/* ----------------------------------------------------------------- offers */

const SLOT_NEED: Record<string, string> = {
  HOT: "Needs a hot slot",
  COLD: "Needs a cold slot",
  AMBIENT: "Fits any slot",
};

function offerCard(orderId: string): string {
  const order = state.offers.find((o) => o.id === orderId);
  if (!order) return "";

  const est = estimate(state, order, cfg);
  const room = canAccept(state, order.id);
  const expiresIn = order.expiresAt - state.clock;
  const spare = est.window - est.total;

  const tierWord =
    order.tier === "EXPRESS" ? "Express" : order.tier === "STANDARD" ? "Standard" : "Scheduled";

  // Every line names where the time goes. The first pass listed the same numbers
  // without saying which leg each belonged to, which made them unreadable.
  const legs = [
    `<tr><td>Ride to ${esc(node(order.pickupId).name)}</td><td>${mins(est.toPickup)}</td></tr>`,
    `<tr class="claim"><td>Wait while they make it <em>app's estimate</em></td><td>${
      est.waitClaimed < 0.5 ? "ready" : mins(est.waitClaimed)
    }</td></tr>`,
    `<tr><td>Ride to ${esc(node(order.dropId).name)}</td><td>${mins(est.toDrop)}</td></tr>`,
    est.queue > 0
      ? `<tr><td>Orders already in your bag</td><td>+${mins(est.queue)}</td></tr>`
      : "",
    `<tr class="sum"><td>Your trip</td><td>${mins(est.total)}</td></tr>`,
    `<tr class="allow"><td>${tierWord} — time you're given</td><td>${mins(est.window)}</td></tr>`,
  ].join("");

  return `
    <article class="offer ${est.verdict}" data-preview="${esc(order.id)}">
      <div class="offer-top">
        <span class="fee">${rupees(order.fee)}</span>
        <span class="verdict ${est.verdict}">
          ${VERDICT_LABEL[est.verdict]}
          <em>${spare > 0 ? `${mins(spare)} spare` : `${mins(-spare)} over`}</em>
        </span>
      </div>

      <table class="legs">${legs}</table>

      <p class="slotneed ${room ? "" : "blocked"}">
        ${SLOT_NEED[order.temp] ?? ""}${room ? "" : " — no room in your bag"}
      </p>

      <div class="offer-actions">
        <button class="take" data-accept="${esc(order.id)}" ${room ? "" : "disabled"}>
          ${room ? "Take it" : "Bag is full"}
        </button>
        <button class="pass" data-reject="${esc(order.id)}">Pass</button>
        <span class="expiry">gone in ${mins(expiresIn)}</span>
      </div>
    </article>`;
}

function offersSection(): string {
  if (state.offers.length === 0) {
    return `
      <section>
        <h2>New orders</h2>
        <p class="empty">Nothing on offer. Wait a while, or get moving.</p>
      </section>`;
  }

  const cards = [...state.offers]
    .sort((a, b) => a.expiresAt - b.expiresAt)
    .map((o) => offerCard(o.id))
    .join("");

  return `<section><h2>New orders</h2><div class="offers">${cards}</div></section>`;
}

/* ---------------------------------------------------------------- carrying */

function carryingSection(): string {
  const total = state.bag.length;
  const free = state.bag.filter((s) => s.orderId === null).length;

  if (state.carried.length === 0) {
    return `
      <section>
        <h2>In your bag <span class="cap">${total - free} of ${total}</span></h2>
        <p class="empty">Empty. Take something.</p>
      </section>`;
  }

  const rows = [...state.carried]
    .sort((a, b) => a.order.dueAt - b.order.dueAt)
    .map((c) => {
      const target = c.leg === "TO_PICKUP" ? c.order.pickupId : c.order.dropId;
      const left = c.order.dueAt - state.clock;
      const state_ = urgency(left);
      return `
        <li class="${state_}">
          <span class="what">${c.leg === "TO_PICKUP" ? "Collect from" : "Deliver to"}
            <b>${esc(node(target).name)}</b></span>
          <span class="when">${left < 0 ? `${mins(-left)} late` : `${mins(left)} left`}</span>
        </li>`;
    })
    .join("");

  return `
    <section>
      <h2>In your bag <span class="cap">${total - free} of ${total}</span></h2>
      <ul class="carrying">${rows}</ul>
    </section>`;
}

/* ------------------------------------------------------------------ moving */

function moveSection(): string {
  const stops = new Map<string, number>();
  for (const c of state.carried) {
    const id = c.leg === "TO_PICKUP" ? c.order.pickupId : c.order.dropId;
    stops.set(id, Math.min(stops.get(id) ?? Infinity, c.order.dueAt - state.clock));
  }

  const next = [...stops.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, 1)
    .map(([id, slack]) => {
      const serves = state.carried.filter(
        (c) => (c.leg === "TO_PICKUP" ? c.order.pickupId : c.order.dropId) === id,
      ).length;
      return `
        <button class="primary" data-go="${esc(id)}">
          Ride to ${esc(node(id).name)}
          <em>${mins(rideMinutes(state, state.locationId, id))}${serves > 1 ? ` · ${serves} orders here` : ""} · ${
            slack < 0 ? "already late" : `${mins(slack)} to spare`
          }</em>
        </button>`;
    })
    .join("");

  return `
    <section class="move">
      <h2>You're at ${esc(node(state.locationId).name)}</h2>
      ${next || '<p class="empty">Nowhere you need to be.</p>'}
      <div class="minor">
        <button data-wait="10">Wait 10 min</button>
        <button data-wait="25">Wait 25 min</button>
        <button data-end="1" class="quiet">End shift early</button>
      </div>
      <p class="hint">Tap any dot on the map to ride there.</p>
    </section>`;
}

/**
 * The last few things that happened. Without this the app's under-reported prep
 * times are undetectable — the player waits twenty minutes after being told six
 * and reads it as a bug rather than as the platform lying to them.
 */
function recentSection(): string {
  const lines = state.log.slice(-4).reverse();
  if (lines.length === 0) return "";

  const items = lines
    .map((l, i) => {
      const flagged = l.includes("the app said") || l.includes("late");
      return `<li class="${i === 0 ? "newest" : ""} ${flagged ? "flag" : ""}">${esc(l)}</li>`;
    })
    .join("");

  return `<section><h2>Just now</h2><ul class="recent">${items}</ul></section>`;
}

/* ----------------------------------------------------------------- summary */

function summary(): string {
  const s = endShift(state);
  const hidden = s.minutesWaitingHidden;

  return `
    <div class="summary">
      <h2>Shift over</h2>
      <table>
        <tr><td>${s.ordersDelivered} delivered${s.ordersLate > 0 ? `, ${s.ordersLate} late` : ""}</td>
            <td>${rupees(s.fees)}</td></tr>
        <tr><td>Bonus for ${s.ordersOnTime} on time</td>
            <td>${s.milestones > 0 ? rupees(s.milestones) : "—"}</td></tr>
        <tr class="cost"><td>Fuel, data, wear <span class="dimmer">${(s.unitsRidden * 0.7).toFixed(0)} km</span></td><td>−${rupees(s.expenses)}</td></tr>
        <tr class="total"><td>Take home</td><td>${rupees(s.net)}</td></tr>
      </table>

      <p class="waited">
        You rode <b>${(s.unitsRidden * 0.7).toFixed(0)} km</b> and spent
        <b>${mins(s.minutesWaiting)}</b> standing at pickups.
        ${hidden > 1 ? `<span class="flag">${mins(hidden)} of that the app never showed you.</span>` : ""}
        ${s.undelivered > 0 ? `<span class="flag">${s.undelivered} order(s) never made it out of your bag.</span>` : ""}
      </p>

      <button class="primary" data-restart="1">Start another shift</button>
    </div>`;
}

/* ------------------------------------------------------------------ render */

function render(): void {
  if (!app) return;

  if (finished) {
    app.innerHTML = summary();
    return;
  }

  app.innerHTML = [
    topBar(),
    milestoneBar(),
    `<div class="mapwrap">${renderMap(state, preview)}</div>`,
    moveSection(),
    recentSection(),
    offersSection(),
    carryingSection(),
  ].join("");
}

function finishIfOver(): void {
  if (isOver(state)) finished = true;
}

/* ------------------------------------------------------------------ events */

app.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const hit = target.closest<HTMLElement>("[data-accept],[data-reject],[data-go],[data-wait],[data-end],[data-restart]");
  if (!hit) return;

  const d = hit.dataset;

  if (d["accept"]) accept(state, d["accept"]);
  else if (d["reject"]) reject(state, d["reject"]);
  else if (d["go"]) travelTo(state, d["go"]);
  else if (d["wait"]) idle(state, Number(d["wait"]));
  else if (d["end"]) finished = true;
  else if (d["restart"]) {
    state = createShift(Math.floor(Math.random() * 1e9), cfg);
    finished = false;
    preview = null;
    render();
    return;
  } else return;

  preview = null;
  finishIfOver();
  render();
});

// Hovering an offer draws its route on the map, so "does this fit my trip?" is
// answered by looking rather than by arithmetic.
app.addEventListener("pointerover", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const card = target.closest<HTMLElement>("[data-preview]");
  const id = card?.dataset["preview"] ?? null;
  if (id !== preview) {
    preview = id;
    render();
  }
});

// Keyboard equivalent of the map's tappable dots.
app.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const go = target.closest<HTMLElement>("[data-go]")?.dataset["go"];
  if (!go) return;
  event.preventDefault();
  travelTo(state, go);
  finishIfOver();
  render();
});

render();
