import "./style.css";
import { node } from "./sim/city.js";
import { DEFAULT_ECONOMY, nextMilestone } from "./sim/economy.js";
import {
  accept,
  canAccept,
  createShift,
  demandNow,
  endShift,
  fmt,
  idle,
  isOver,
  reject,
  rideMinutes,
  travelTo,
  type ShiftState,
} from "./sim/shift.js";
import { esc, mins, rupees, urgency } from "./ui/format.js";
import { renderMap } from "./ui/map.js";
import { routeStack } from "./ui/route.js";
import { estimate, VERDICT_LABEL } from "./ui/verdict.js";

/**
 * NOW Partner — the rider-facing app of a fictional quick-commerce platform.
 *
 * Laid out in the grammar every real rider app shares: duty state at the top,
 * today's earnings as the largest number on screen, an incentive strip, and
 * order cards built around the stacked pickup-to-drop route. The player is
 * meant to feel like they are using the tool, not reading a dashboard about it.
 */

const cfg = DEFAULT_ECONOMY;
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

let state: ShiftState = createShift(Math.floor(Math.random() * 1e9), cfg);
let finished = false;
let preview: string | null = null;
let mapOpen = true;

const onTimeCount = (): number => state.completed.filter((c) => !c.late).length;
const earned = (): number => state.completed.reduce((s, c) => s + c.paid, 0);
const km = (units: number): string => `${(units * 0.7).toFixed(1)} km`;

/* ------------------------------------------------------------ app chrome */

function statusBar(): string {
  return `
    <div class="statusbar">
      <span class="brand">NOW <em>partner</em></span>
      <span class="sig" aria-hidden="true">▮▮▯</span>
    </div>`;
}

/** How the hour reads to a rider — order volume swings about six-fold a day. */
function busyness(demand: number): { word: string; cls: string } {
  if (demand >= 3) return { word: "Slammed", cls: "hot" };
  if (demand >= 1.8) return { word: "Busy", cls: "warm" };
  if (demand >= 0.9) return { word: "Steady", cls: "" };
  return { word: "Quiet", cls: "cold" };
}

function dutyBar(): string {
  const busy = busyness(demandNow(state));
  return `
    <div class="duty">
      <span class="online"><i aria-hidden="true"></i> On duty</span>
      <span class="time">${fmt(state.clock, cfg)}</span>
      <span class="demand ${busy.cls}">${busy.word}</span>
    </div>`;
}

function earningsHeader(): string {
  const left = Math.max(0, cfg.shiftMinutes - state.clock);
  const elapsed = (state.clock / cfg.shiftMinutes) * 100;
  const hoursInShift = Math.ceil(cfg.shiftMinutes / 60);
  const peak = Math.max(...cfg.demandByHour);

  // The bar doubles as the day's demand curve, so the evening block is visible
  // before it arrives. Knowing what is coming is most of the skill.
  const bars = Array.from({ length: hoursInShift }, (_, offset) => {
    const demand = cfg.demandByHour[(cfg.startHour + offset) % 24] ?? 1;
    return `<i style="height:${Math.max(9, (demand / peak) * 100)}%"></i>`;
  }).join("");

  return `
    <header class="earnings">
      <span class="label">Today's earnings</span>
      <div class="amt">${rupees(earned())}</div>
      <div class="subline">
        <span>${state.completed.length} delivered</span>
        <span>${km(state.unitsRidden)} ridden</span>
        <span>${mins(left)} left</span>
      </div>
      <div class="daycurve" aria-hidden="true">
        ${bars}
        <span class="nowline" style="left:${Math.min(100, elapsed)}%"></span>
      </div>
    </header>`;
}

function incentiveStrip(): string {
  const done = onTimeCount();
  const next = nextMilestone(done, cfg);

  if (!next) {
    return `<div class="incentive cleared">
      <b>All incentives cleared</b><span>${done} on time today</span>
    </div>`;
  }

  const previous = cfg.milestones.filter((m) => m.orders <= done).pop()?.orders ?? 0;
  const pct = ((done - previous) / (next.orders - previous)) * 100;
  const close = next.short <= 3;

  return `
    <div class="incentive ${close ? "close" : ""}">
      <div class="inc-head">
        <b>${next.short} more on time</b>
        <span>${rupees(next.bonus)}</span>
      </div>
      <div class="bar"><i style="width:${Math.max(3, pct)}%"></i></div>
      <div class="inc-foot"><span>${done} on time</span><span>${next.orders}</span></div>
    </div>`;
}

/* --------------------------------------------------------------- offers */

const SLOT_NEED: Record<string, string> = {
  HOT: "Hot bag",
  COLD: "Cold bag",
  AMBIENT: "Any slot",
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

  return `
    <article class="offer ${est.verdict}" data-preview="${esc(order.id)}">
      <div class="offer-head">
        <span class="tier ${order.tier}">${tierWord}</span>
        <span class="countdown">${mins(expiresIn)}</span>
      </div>

      <div class="payout">
        <b>${rupees(order.fee)}</b>
        <span>${km(order.distance)} · ${SLOT_NEED[order.temp] ?? ""}</span>
      </div>

      ${routeStack(order.pickupId, order.dropId, {
        pickupNote: `Ready in about ${mins(order.shownPrep)}`,
        dropNote: `Deliver within ${mins(est.window)}`,
      })}

      <!-- A real rider glances at an order and just knows whether it fits. The
           player has no such instinct, so the app renders it — using the prep
           time the platform advertises, which is exactly how it misleads. -->
      <div class="fit ${est.verdict}">
        <span class="fitword">${VERDICT_LABEL[est.verdict]}</span>
        <span class="fitwhy">
          ${mins(est.total)} of work${est.queue > 0 ? ` incl. bag` : ""} ·
          ${spare > 0 ? `${mins(spare)} spare` : `${mins(-spare)} over`}
        </span>
      </div>

      <div class="offer-actions">
        <button class="reject" data-reject="${esc(order.id)}">Reject</button>
        <button class="accept" data-accept="${esc(order.id)}" ${room ? "" : "disabled"}>
          ${room ? "Accept" : "Bag full"}
        </button>
      </div>
    </article>`;
}

function offersSection(): string {
  if (state.offers.length === 0) {
    return `<section class="block">
      <h2>New orders</h2>
      <p class="empty">No orders right now. Wait, or move to a busier spot.</p>
    </section>`;
  }

  const cards = [...state.offers]
    .sort((a, b) => a.expiresAt - b.expiresAt)
    .map((o) => offerCard(o.id))
    .join("");

  return `<section class="block">
    <h2>New orders <span class="count">${state.offers.length}</span></h2>
    <div class="offers">${cards}</div>
  </section>`;
}

/* --------------------------------------------------------------- active */

function tasksSection(): string {
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
          ${routeStack(c.order.pickupId, c.order.dropId, {
            done: collected ? "pickup" : null,
          })}
        </article>`;
    })
    .join("");

  return `<section class="block">
    <h2>Your bag <span class="slots">${slots}</span> <span class="count">${used}/${state.bag.length}</span></h2>
    <div class="tasks">${rows}</div>
  </section>`;
}

/* ----------------------------------------------------------------- move */

function actionBar(): string {
  const stops = new Map<string, number>();
  for (const c of state.carried) {
    const id = c.leg === "TO_PICKUP" ? c.order.pickupId : c.order.dropId;
    stops.set(id, Math.min(stops.get(id) ?? Infinity, c.order.dueAt - state.clock));
  }

  const best = [...stops.entries()].sort((a, b) => a[1] - b[1])[0];

  if (!best) {
    return `
      <div class="actionbar">
        <button class="wait" data-wait="15">Wait 15 min</button>
        <button class="wait" data-wait="40">Wait 40 min</button>
      </div>`;
  }

  const [id, slack] = best;
  const serves = state.carried.filter(
    (c) => (c.leg === "TO_PICKUP" ? c.order.pickupId : c.order.dropId) === id,
  ).length;

  return `
    <div class="actionbar">
      <button class="go" data-go="${esc(id)}">
        <span class="golabel">Ride to ${esc(node(id).name)}</span>
        <span class="gometa">
          ${mins(rideMinutes(state, state.locationId, id))}${serves > 1 ? ` · ${serves} orders` : ""}
          · ${slack < 0 ? "late" : `${mins(slack)} spare`}
        </span>
      </button>
      <button class="wait" data-wait="15">Wait</button>
    </div>`;
}

/* -------------------------------------------------------------- summary */

function summary(): string {
  const s = endShift(state);

  return `
    ${statusBar()}
    <div class="summary">
      <span class="label">Shift complete</span>
      <div class="amt">${rupees(s.net)}</div>
      <span class="paidout">paid to your account</span>

      <table>
        <tr><td>${s.ordersDelivered} deliveries${s.ordersLate > 0 ? ` <em>${s.ordersLate} late</em>` : ""}</td>
            <td>${rupees(s.fees)}</td></tr>
        <tr><td>Incentive · ${s.ordersOnTime} on time</td>
            <td>${s.milestones > 0 ? rupees(s.milestones) : "—"}</td></tr>
        <tr class="cost"><td>Fuel, data, wear <em>${km(s.unitsRidden)}</em></td>
            <td>−${rupees(s.expenses)}</td></tr>
      </table>

      <p class="waited">
        Stood waiting <b>${mins(s.minutesWaiting)}</b> at pickups.
        ${s.minutesWaitingHidden > 1 ? `<span class="flag">${mins(s.minutesWaitingHidden)} of it NOW never showed you.</span>` : ""}
        ${s.undelivered > 0 ? `<span class="flag">${s.undelivered} order(s) never left your bag.</span>` : ""}
      </p>

      <button class="go" data-restart="1"><span class="golabel">Go on duty again</span></button>
    </div>`;
}

/* --------------------------------------------------------------- render */

function feed(): string {
  const lines = state.log.slice(-3).reverse();
  if (lines.length === 0) return "";
  return `<div class="feed">${lines
    .map((l, i) => {
      const flag = l.includes("the app said") || l.includes("late");
      return `<div class="${i === 0 ? "newest" : ""} ${flag ? "flag" : ""}">${esc(l)}</div>`;
    })
    .join("")}</div>`;
}

function render(): void {
  if (!app) return;

  if (finished) {
    app.innerHTML = summary();
    return;
  }

  app.innerHTML = [
    statusBar(),
    dutyBar(),
    earningsHeader(),
    incentiveStrip(),
    `<section class="mapblock ${mapOpen ? "open" : ""}">
       <button class="maptoggle" data-map="1">
         ${mapOpen ? "Hide map" : "Show map"} · at ${esc(node(state.locationId).name)}
       </button>
       ${mapOpen ? `<div class="mapwrap">${renderMap(state, preview)}</div>` : ""}
     </section>`,
    feed(),
    offersSection(),
    tasksSection(),
    `<div class="endshift"><button data-end="1">Go off duty</button></div>`,
    actionBar(),
  ].join("");
}

function finishIfOver(): void {
  if (isOver(state)) finished = true;
}

/* --------------------------------------------------------------- events */

app.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const hit = target.closest<HTMLElement>(
    "[data-accept],[data-reject],[data-go],[data-wait],[data-end],[data-restart],[data-map]",
  );
  if (!hit) return;

  const d = hit.dataset;

  if (d["accept"]) accept(state, d["accept"]);
  else if (d["reject"]) reject(state, d["reject"]);
  else if (d["go"]) travelTo(state, d["go"]);
  else if (d["wait"]) idle(state, Number(d["wait"]));
  else if (d["end"]) finished = true;
  else if (d["map"]) mapOpen = !mapOpen;
  else if (d["restart"]) {
    state = createShift(Math.floor(Math.random() * 1e9), cfg);
    finished = false;
    preview = null;
    render();
    return;
  } else return;

  if (!d["map"]) {
    preview = null;
    finishIfOver();
  }
  render();
});

// Hovering an offer draws its trip on the map, so "does this fit my route?" is
// answered by looking rather than by arithmetic.
app.addEventListener("pointerover", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const id = target.closest<HTMLElement>("[data-preview]")?.dataset["preview"] ?? null;
  if (id !== preview) {
    preview = id;
    render();
  }
});

app.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const go = target.closest<HTMLElement>("[data-go]")?.dataset["go"];
  if (!go || target.closest("button")) return;
  event.preventDefault();
  travelTo(state, go);
  finishIfOver();
  render();
});

render();
