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
import { actionBlock, bagBlock, offersBlock, tabBar, type Tab } from "./ui/panels.js";
import { startScreen, summaryScreen } from "./ui/screens.js";
import { dayBlock, statusStrip } from "./ui/status.js";

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
let tab: Tab = "offers";

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
 * A single pill saying where the rider is. Everything it used to carry —
 * earnings, clock, how busy it is — now lives in the status strip, where it is
 * readable rather than crammed over a map.
 */
function bubble(): string {
  return `<div class="bubble"><span class="pulse" aria-hidden="true"></span>
    <span>${esc(node(state.locationId).name)}</span></div>`;
}

function mapLayer(): string {
  return `<div class="maplayer">${renderMap(state, preview)}${bubble()}</div>`;
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

  if (phase === "done") {
    app.innerHTML = `<div class="statusbar"><span class="brand">NOW <em>partner</em></span></div>${summaryScreen(state, cfg)}`;
    return;
  }

  app.innerHTML = `
    <div class="statusbar">
      <span class="brand">NOW <em>partner</em></span>
      <span class="online"><i aria-hidden="true"></i> On duty</span>
    </div>

    ${statusStrip(state, cfg)}

    ${mapLayer()}

    <div class="sheet ${sheet}">
      <button class="grabber" data-sheet="cycle" aria-label="Resize panel"><i></i></button>
      ${tabBar(state, tab)}
      <div class="sheet-scroll">
        ${
          tab === "offers"
            ? offersBlock(state, cfg)
            : tab === "bag"
              ? bagBlock(state)
              : dayBlock(state, cfg)
        }
        ${tab === "day" ? '<div class="endshift"><button data-end="1">Go off duty</button></div>' : ""}
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

  travelTo(state, destId, outcome.extraMinutes);
  if (outcome.redsRun > 0) {
    state.log.push(
      `Ran ${outcome.redsRun} red light${outcome.redsRun > 1 ? "s" : ""} getting there.`,
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
    "[data-accept],[data-reject],[data-go],[data-wait],[data-end],[data-restart],[data-sheet],[data-begin],[data-slot],[data-refill],[data-tab]",
  );
  if (!hit) return;

  const d = hit.dataset;

  if (d["tab"]) {
    tab = d["tab"] as Tab;
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
