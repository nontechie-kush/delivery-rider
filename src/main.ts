import "./style.css";
import { node } from "./sim/city.js";
import { DEFAULT_CONFIG } from "./sim/config.js";
import { commit } from "./sim/duty.js";
import {
  accept,
  createShift,
  idle,
  isOver,
  refill,
  reject,
  startDuty,
  travelTo,
  type ShiftState,
} from "./sim/shift.js";
import { esc } from "./ui/format.js";
import { renderMap } from "./ui/map.js";
import { launchRide } from "./ride/launch.js";
import { locateMessage, locateRider } from "./ui/locate.js";
import { actionBlock, offersBlock } from "./ui/panels.js";
import { jobBlock, outcomeScreen } from "./ui/job.js";
import { startScreen, summaryScreen } from "./ui/screens.js";
import { dayBlock, statusStrip } from "./ui/status.js";
import type { Completed } from "./sim/shift.js";

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


type Phase = "start" | "working" | "riding" | "outcome" | "done";
type Overlay = "none" | "map" | "day";

let state: ShiftState = createShift(Math.floor(Math.random() * 1e9), cfg);
let phase: Phase = "start";
let preview: string | null = null;
let overlay: Overlay = "none";
/** Deliveries that landed on the ride just finished, shown once then cleared. */
let landed: Completed[] = [];
/** Which offer has its fare breakdown open, if any. */
let openFee: string | null = null;

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


/**
 * The floating status pill. Delivery Hero calls theirs the Bubble: duty state
 * and earnings, always visible, never in the way of the map.
 */
/**
 * The map, on demand.
 *
 * It used to occupy the upper half of the screen permanently, which pushed both
 * the incoming orders and the job in hand into a scroll. Real rider apps show a
 * list while idle and a map while navigating — so it lives behind a button now,
 * and earns the whole screen when opened.
 */
function mapOverlay(): string {
  return `
    <div class="overlay">
      <div class="ov-head">
        <div>
          <b>Where the orders are</b>
          <span>Brighter means busier. Tap a place to ride there.</span>
        </div>
        <button class="ov-close" data-overlay="none" aria-label="Close">Close</button>
      </div>
      <div class="ov-map">${renderMap(state, preview, true)}</div>
      <div class="ov-foot"><span class="pulse"></span> You're at ${esc(node(state.locationId).name)}</div>
    </div>`;
}

function dayOverlay(): string {
  return `
    <div class="overlay">
      <div class="ov-head">
        <div><b>Today</b><span>Earnings, fuel and your booked window.</span></div>
        <button class="ov-close" data-overlay="none" aria-label="Close">Close</button>
      </div>
      <div class="ov-body">
        ${dayBlock(state, cfg)}
        <div class="endshift"><button data-end="1">Go off duty</button></div>
      </div>
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
  const scrolled = app.querySelector(".work")?.scrollTop ?? 0;

  if (phase === "start") {
    app.innerHTML = `
      <div class="statusbar"><span class="brand">NOW <em>partner</em></span></div>
      ${startScreen(cfg, locateNote, locating, chosenSlot)}`;
    return;
  }

  if (phase === "riding") {
    // Only paint the stage once; the ride owns it from then on.
    if (!app.querySelector(".ridestage")) {
      app.innerHTML = `<div class="ridestage"></div>`;
    }
    return;
  }

  if (phase === "outcome") {
    app.innerHTML = `
      <div class="statusbar"><span class="brand">NOW <em>partner</em></span></div>
      ${outcomeScreen(state, cfg, landed)}`;
    return;
  }

  if (phase === "done") {
    app.innerHTML = `<div class="statusbar"><span class="brand">NOW <em>partner</em></span></div>${summaryScreen(state, cfg)}`;
    return;
  }

  // The whole screen goes to the task in hand: the job when carrying something,
  // the incoming orders when not. The map and the day's numbers are overlays,
  // because neither is what the player is doing.
  app.innerHTML = `
    <div class="statusbar">
      <span class="brand">NOW <em>partner</em></span>
      <span class="chrome-tools">
        <button data-overlay="map">Map</button>
        <button data-overlay="day">Today</button>
      </span>
    </div>

    ${statusStrip(state, cfg)}

    <div class="work">
      ${jobBlock(state)}
      ${offersBlock(state, cfg, openFee)}
    </div>

    ${actionBlock(state)}
    ${overlay === "map" ? mapOverlay() : overlay === "day" ? dayOverlay() : ""}`;

  const scroller = app.querySelector(".work");
  if (scroller && scrolled > 0) scroller.scrollTop = scrolled;
}

/**
 * Ride there, then arrive.
 *
 * The ride is a UI layer over a sim that stays authoritative: it plays out, and
 * what it cost is handed back as extra minutes. Everything downstream —
 * deadlines, fuel, the guarantee — is still worked out by the simulation.
 */
async function rideTo(destId: string): Promise<void> {
  phase = "riding";
  render();

  const outcome = await launchRide(
    app?.querySelector<HTMLElement>(".ridestage"),
    state,
    cfg,
    destId,
  );

  // Snapshot before arriving, so the outcome beat knows what actually landed.
  const before = state.completed.length;
  travelTo(state, destId, outcome.extraMinutes);
  landed = state.completed.slice(before);
  if (outcome.redsRun > 0) {
    state.log.push(
      `Ran ${outcome.redsRun} red light${outcome.redsRun > 1 ? "s" : ""} getting there.`,
    );
  }

  preview = null;

  // A delivery is the moment the whole loop builds toward, so it gets a beat
  // rather than a line in a log. The day ending still wins over it.
  if (isOver(state)) phase = "done";
  else if (landed.length > 0) phase = "outcome";
  else phase = "working";

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
    "[data-accept],[data-reject],[data-go],[data-wait],[data-end],[data-restart],[data-begin],[data-slot],[data-refill],[data-overlay],[data-dismiss],[data-fee]",
  );
  if (!hit) return;

  const d = hit.dataset;

  if (d["fee"]) {
    openFee = openFee === d["fee"] ? null : d["fee"];
    render();
    return;
  }

  if (d["overlay"]) {
    overlay = d["overlay"] as Overlay;
    render();
    return;
  }

  if (d["dismiss"]) {
    landed = [];
    phase = "working";
    render();
    return;
  }

  if (d["slot"] !== undefined) {
    chosenSlot = d["slot"];
    render();
    return;
  }

  if (d["begin"]) {
    beginDay();
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
  openFee = null;
  finishIfOver();
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
