import "./style.css";
import { node } from "./sim/city.js";
import { DEFAULT_CONFIG } from "./sim/config.js";
import {
  accept,
  createShift,
  demandNow,
  fmt,
  idle,
  isOver,
  reject,
  travelTo,
  type ShiftState,
} from "./sim/shift.js";
import { esc, rupees } from "./ui/format.js";
import { renderMap } from "./ui/map.js";
import {
  actionBlock,
  bagBlock,
  earningsBlock,
  feedBlock,
  incentiveBlock,
  offersBlock,
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

let state: ShiftState = createShift(Math.floor(Math.random() * 1e9), cfg);
let finished = false;
let preview: string | null = null;
let sheet: SheetState = "half";

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
      <span class="bub-sub">${fmt(state.clock, cfg)} · <b class="${busy.cls}">${busy.word}</b></span>
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

function render(): void {
  if (!app) return;

  if (finished) {
    app.innerHTML = `<div class="statusbar"><span class="brand">NOW <em>partner</em></span></div>${summaryScreen(state)}`;
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
        ${incentiveBlock(state, cfg)}
        ${feedBlock(state)}
        ${offersBlock(state, cfg)}
        ${bagBlock(state)}
        <div class="endshift"><button data-end="1">Go off duty</button></div>
      </div>
      ${actionBlock(state)}
    </div>`;
}

function finishIfOver(): void {
  if (isOver(state)) finished = true;
}

/* --------------------------------------------------------------- events */

app.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const hit = target.closest<HTMLElement>(
    "[data-accept],[data-reject],[data-go],[data-wait],[data-end],[data-restart],[data-sheet]",
  );
  if (!hit) return;

  const d = hit.dataset;

  if (d["sheet"]) {
    const index = SHEET_ORDER.indexOf(sheet);
    sheet = SHEET_ORDER[(index + 1) % SHEET_ORDER.length] ?? "half";
    render();
    return;
  }

  if (d["accept"]) accept(state, d["accept"]);
  else if (d["reject"]) reject(state, d["reject"]);
  else if (d["go"]) {
    travelTo(state, d["go"]);
    // Riding is the moment the map matters, so drop the sheet out of the way.
    sheet = "peek";
  } else if (d["wait"]) idle(state, Number(d["wait"]));
  else if (d["end"]) finished = true;
  else if (d["restart"]) {
    state = createShift(Math.floor(Math.random() * 1e9), cfg);
    finished = false;
    preview = null;
    sheet = "half";
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
    render();
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
  travelTo(state, go);
  sheet = "peek";
  finishIfOver();
  render();
});

render();
