import "./style.css";
import { distance, node } from "./sim/city.js";
import { DEFAULT_CONFIG, trafficAt } from "./sim/config.js";
import { commit, minutesOnlineAt } from "./sim/duty.js";
import {
  accept,
  createShift,
  demandNow,
  fmt,
  idle,
  isOver,
  refill,
  reject,
  rideMinutes,
  startDuty,
  travelTo,
  type ShiftState,
} from "./sim/shift.js";
import { duration, esc, rupees } from "./ui/format.js";
import { renderMap } from "./ui/map.js";
import { runRide } from "./ride/screen.js";
import { locateMessage, locateRider } from "./ui/locate.js";
import {
  actionBlock,
  bagBlock,
  commitmentBlock,
  earningsBlock,
  feedBlock,
  fuelBlock,
  incentiveBlock,
  offersBlock,
  startScreen,
  summaryScreen,
} from "./ui/panels.js";

/**
 * NOW Partner — the rider app of a fictional quick-commerce platform.
 *
 * Structured the way production rider apps are: a persistent map underneath, a
 * sheet over it that the rider can minimise, half-expand or pull up full, and a
 * floating status bubble. Delivery Hero's redesign calls this the Dynamic Sheet;
 * Uber, DoorDash and the Indian platforms all converge on the same shape,
 * because the map has to stay visible while the work list stays reachable.
 */

const cfg = DEFAULT_CONFIG;
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

type SheetState = "peek" | "half" | "full";
const SHEET_ORDER: SheetState[] = ["peek", "half", "full"];

type Phase = "start" | "working" | "riding" | "done";

let state: ShiftState = createShift(Math.floor(Math.random() * 1e9), cfg);
let phase: Phase = "start";
let preview: string | null = null;
let sheet: SheetState = "half";

/** Where the rider actually is, resolved once at the start of the day. */
let startNodeId = "qk";
let locateNote: string | null = null;
let locating = true;
let chosenSlot = "";

/**
 * Ask for the rider's position the moment the app opens, exactly as a rider app
 * does. It never blocks: denied, timed out or unsupported all fall through to
 * the dark store and the day starts anyway.
 */
async function findRider(): Promise<void> {
  const outcome = await locateRider();
  if (outcome.kind === "located") startNodeId = outcome.nodeId;
  locateNote = locateMessage(outcome);
  locating = false;
  // Only repaint if the player is still on the start screen — they may have
  // gone on duty while the fix was still coming in.
  if (phase === "start") render();
}

const earnedSoFar = (): number => state.completed.reduce((s, c) => s + c.paid, 0);

/** How the hour reads to a rider. Volume swings roughly six-fold across a day. */
function busyness(demand: number): { word: string; cls: string } {
  if (demand >= 3) return { word: "Slammed", cls: "hot" };
  if (demand >= 1.8) return { word: "Busy", cls: "warm" };
  if (demand >= 0.9) return { word: "Steady", cls: "" };
  return { word: "Quiet", cls: "cold" };
}

/**
 * The floating status pill. Delivery Hero calls theirs the Bubble: duty state
 * and earnings, always visible, never in the way of the map.
 */
function bubble(): string {
  const busy = busyness(demandNow(state));
  return `
    <div class="bubble">
      <span class="pulse" aria-hidden="true"></span>
      <span class="bub-main">${rupees(earnedSoFar())}</span>
      <span class="bub-sub">${fmt(state.clock, cfg)} · ${duration(
        minutesOnlineAt(state.duty, state.clock),
      )} on · <b class="${busy.cls}">${busy.word}</b></span>
    </div>`;
}

function mapLayer(): string {
  return `
    <div class="maplayer">
      ${renderMap(state, preview)}
      ${bubble()}
      <div class="whereami">at ${esc(node(state.locationId).name)}</div>
    </div>`;
}

function beginDay(): void {
  // Rebuild from the located start rather than moving the rider there, so the
  // day genuinely begins where they are standing.
  state = createShift(Math.floor(Math.random() * 1e9), cfg, startNodeId);
  if (chosenSlot) commit(state.duty, chosenSlot, state.clock, cfg);

  // Skip the empty early hours to whenever the booked window opens, or to the
  // lunch peak if nothing was booked. Nobody wants to sit through 6am.
  const slot = cfg.slots.find((s) => s.id === chosenSlot);
  const openAt = ((slot ? slot.fromHour : 12) - cfg.dayStartHour) * 60;
  if (openAt > 0) idle(state, openAt);

  startDuty(state);
  phase = "working";
  sheet = "half";
  render();
}

/**
 * Repaint only the map.
 *
 * Hovering an offer draws its route, and rebuilding the whole app for that
 * threw away the sheet's scroll position — so reaching for Accept scrolled the
 * button out from under the cursor. Nothing but the map depends on `preview`,
 * so nothing but the map needs redrawing.
 */
function renderPreview(): void {
  const layer = app?.querySelector(".maplayer");
  const svg = layer?.querySelector("svg");
  if (!layer || !svg) return;
  svg.outerHTML = renderMap(state, preview);
}

function render(): void {
  if (!app) return;

  // A full repaint replaces the scroll container, which would otherwise dump
  // the player back at the top of the sheet after every accept or ride.
  const scrolled = app.querySelector(".sheet-scroll")?.scrollTop ?? 0;

  if (phase === "start") {
    app.innerHTML = `
      <div class="statusbar">
        <span class="brand">NOW <em>partner</em></span>
      </div>
      ${startScreen(cfg, locateNote, locating)}`;
    return;
  }

  if (phase === "riding") {
    // Only paint the stage once; the ride owns it from then on.
    if (!app.querySelector(".ridestage")) {
      app.innerHTML = `<div class="ridestage"></div>`;
    }
    return;
  }

  if (phase === "done") {
    app.innerHTML = `<div class="statusbar"><span class="brand">NOW <em>partner</em></span></div>${summaryScreen(state, cfg)}`;
    return;
  }

  app.innerHTML = `
    <div class="statusbar">
      <span class="brand">NOW <em>partner</em></span>
      <span class="online"><i aria-hidden="true"></i> On duty</span>
    </div>

    ${mapLayer()}

    <div class="sheet ${sheet}">
      <button class="grabber" data-sheet="cycle" aria-label="Resize panel"><i></i></button>
      <div class="sheet-scroll">
        ${earningsBlock(state, cfg)}
        ${fuelBlock(state, cfg)}
        ${commitmentBlock(state, cfg)}
        ${incentiveBlock(state, cfg)}
        ${feedBlock(state)}
        ${offersBlock(state, cfg)}
        ${bagBlock(state)}
        <div class="endshift"><button data-end="1">Go off duty</button></div>
      </div>
      ${actionBlock(state)}
    </div>`;

  const scroller = app.querySelector(".sheet-scroll");
  if (scroller && scrolled > 0) scroller.scrollTop = scrolled;
}

/**
 * Ride there, then arrive.
 *
 * The ride is a UI layer over a sim that stays authoritative: it plays out, and
 * what it cost in spills is handed back to travelTo as extra minutes. Everything
 * downstream — deadlines, fuel, the guarantee — is worked out by the simulation
 * exactly as before.
 */
async function rideTo(destId: string): Promise<void> {
  const km = distance(state.locationId, destId);
  const seconds = Math.max(
    cfg.rideSecondsMin,
    Math.min(cfg.rideSecondsMax, km * cfg.rideSecondsPerKm),
  );

  // Rush hour puts more between you and the drop, and a full bag handles worse.
  const density = Math.min(1, (trafficAt(state.clock, cfg) - 0.8) / 0.6);
  const load = state.carried.length / state.bag.length;

  phase = "riding";
  render();

  const stage = app?.querySelector<HTMLElement>(".ridestage");
  if (!stage) {
    // No canvas to ride on — never strand the player, just travel.
    travelTo(state, destId);
    phase = "working";
    finishIfOver();
    render();
    return;
  }

  const { promise } = runRide(
    stage,
    {
      seconds,
      density: Math.max(0, density),
      load,
      seed: Math.floor(Math.random() * 1e9),
      signalWaitSeconds: cfg.signalWaitSeconds,
      signalRunCrashChance: cfg.signalRunCrashChance,
    },
    { to: node(destId).name, orders: state.carried.length, topSpeedKmh: cfg.rideTopSpeedKmh },
  );

  const result = await promise;

  // How hard the journey was ridden decides how long it took. Flat out arrives
  // at ridePaceFloor of the estimate, gently at ridePaceCeiling — so the
  // throttle buys time rather than only costing risk.
  const span = cfg.ridePaceCeiling - cfg.ridePaceFloor;
  const paceFactor = cfg.ridePaceCeiling - result.pace * span;
  const base = rideMinutes(state, state.locationId, destId);
  const paceMinutes = base * (paceFactor - 1);

  travelTo(state, destId, result.minutesLost + paceMinutes);
  if (result.redsRun > 0) {
    state.log.push(
      `Ran ${result.redsRun} red light${result.redsRun > 1 ? "s" : ""} getting there.`,
    );
  }
  phase = "working";
  sheet = "peek";
  preview = null;
  finishIfOver();
  render();
}

function finishIfOver(): void {
  if (isOver(state)) phase = "done";
}

/* --------------------------------------------------------------- events */

app.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const hit = target.closest<HTMLElement>(
    "[data-accept],[data-reject],[data-go],[data-wait],[data-end],[data-restart],[data-sheet],[data-begin],[data-slot],[data-refill]",
  );
  if (!hit) return;

  const d = hit.dataset;

  if (d["slot"] !== undefined) {
    chosenSlot = d["slot"];
    return; // the radio handles its own visual state
  }

  if (d["begin"]) {
    beginDay();
    return;
  }

  if (d["sheet"]) {
    const index = SHEET_ORDER.indexOf(sheet);
    sheet = SHEET_ORDER[(index + 1) % SHEET_ORDER.length] ?? "half";
    render();
    return;
  }

  if (d["go"]) {
    void rideTo(d["go"]);
    return;
  }

  if (d["accept"]) accept(state, d["accept"]);
  else if (d["reject"]) reject(state, d["reject"]);
  else if (d["refill"]) refill(state);
  else if (d["wait"]) idle(state, Number(d["wait"]));
  else if (d["end"]) phase = "done";
  else if (d["restart"]) {
    phase = "start";
    chosenSlot = "";
    preview = null;
    render();
    return;
  } else return;

  preview = null;
  finishIfOver();
  render();
});

/* Dragging the sheet. Delegated so it survives a re-render. */
let dragFrom: number | null = null;
let dragStarted: SheetState = "half";

app.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!target.closest(".grabber")) return;
  dragFrom = event.clientY;
  dragStarted = sheet;
});

app.addEventListener("pointerup", (event) => {
  if (dragFrom === null) return;
  const moved = event.clientY - dragFrom;
  dragFrom = null;

  // Only a deliberate drag changes state; a tap falls through to the click
  // handler above, which cycles. Both gestures land somewhere sensible.
  if (Math.abs(moved) < 24) return;

  const index = SHEET_ORDER.indexOf(dragStarted);
  const next = moved < 0 ? index + 1 : index - 1;
  const clamped = Math.max(0, Math.min(SHEET_ORDER.length - 1, next));
  const resolved = SHEET_ORDER[clamped];
  if (resolved && resolved !== sheet) {
    sheet = resolved;
    render();
  }
});

// Hovering an offer draws its trip on the map, so "does this fit my route?" is
// answered by looking rather than by arithmetic.
app.addEventListener("pointerover", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const id = target.closest<HTMLElement>("[data-preview]")?.dataset["preview"] ?? null;
  if (id !== preview) {
    preview = id;
    renderPreview();
  }
});

app.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("button")) return;
  const go = target.closest<HTMLElement>("[data-go]")?.dataset["go"];
  if (!go) return;
  event.preventDefault();
  void rideTo(go);
});

void findRider();
render();
