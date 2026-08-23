import { NODES, node } from "../sim/city.js";
import type { ShiftState } from "../sim/shift.js";
import { esc, urgency } from "./format.js";

/**
 * A dot map, not a picture. Its only job is to make "do these two orders share a
 * route?" something the player can see rather than compute — which is the whole
 * decision the prototype exists to test.
 *
 * Nodes are buttons: tapping one rides there. Direct manipulation beats a list of
 * destination buttons underneath a diagram of the same places.
 */

const PAD = 1.1;
const MIN = 0;
const MAX = 10;

interface Pending {
  nodeId: string;
  slack: number;
  count: number;
}

function pendingStops(state: ShiftState): Map<string, Pending> {
  const stops = new Map<string, Pending>();
  for (const c of state.carried) {
    const id = c.leg === "TO_PICKUP" ? c.order.pickupId : c.order.dropId;
    const slack = c.order.dueAt - state.clock;
    const existing = stops.get(id);
    if (existing) {
      existing.count += 1;
      existing.slack = Math.min(existing.slack, slack);
    } else {
      stops.set(id, { nodeId: id, slack, count: 1 });
    }
  }
  return stops;
}

/** `previewId` highlights the pickup→drop line for an offer being considered. */
export function renderMap(state: ShiftState, previewOrderId: string | null): string {
  const stops = pendingStops(state);
  const here = node(state.locationId);
  const preview = previewOrderId
    ? (state.offers.find((o) => o.id === previewOrderId) ?? null)
    : null;

  const grid = Array.from({ length: 6 }, (_, i) => {
    const v = MIN + ((MAX - MIN) / 5) * i;
    return `<line class="grid" x1="${MIN - PAD}" y1="${v}" x2="${MAX + PAD}" y2="${v}" />
            <line class="grid" x1="${v}" y1="${MIN - PAD}" x2="${v}" y2="${MAX + PAD}" />`;
  }).join("");

  // Faint spokes from where you stand to everything you still owe someone.
  const routes = [...stops.values()]
    .map((s) => {
      const to = node(s.nodeId);
      return `<line class="route ${urgency(s.slack)}" x1="${here.x}" y1="${here.y}" x2="${to.x}" y2="${to.y}" />`;
    })
    .join("");

  const previewLine = preview
    ? (() => {
        const p = node(preview.pickupId);
        const d = node(preview.dropId);
        return `<line class="preview" x1="${here.x}" y1="${here.y}" x2="${p.x}" y2="${p.y}" />
                <line class="preview solid" x1="${p.x}" y1="${p.y}" x2="${d.x}" y2="${d.y}" />`;
      })()
    : "";

  const dots = NODES.map((n) => {
    const stop = stops.get(n.id);
    const isHere = n.id === state.locationId;
    const isPreviewPickup = preview?.pickupId === n.id;
    const isPreviewDrop = preview?.dropId === n.id;

    const classes = [
      "node",
      n.kind === "PICKUP" ? "pickup" : "drop",
      stop ? `pending ${urgency(stop.slack)}` : "",
      isHere ? "here" : "",
      isPreviewPickup ? "preview-pickup" : "",
      isPreviewDrop ? "preview-drop" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const label = stop && stop.count > 1 ? `${stop.count}` : "";

    return `<g class="${classes}" data-go="${esc(n.id)}" tabindex="0" role="button"
               aria-label="Ride to ${esc(n.name)}">
              <circle class="hit" cx="${n.x}" cy="${n.y}" r="0.95" />
              <circle class="pip" cx="${n.x}" cy="${n.y}" r="${isHere ? 0.5 : 0.36}" />
              ${label ? `<text class="count" x="${n.x}" y="${n.y + 0.13}">${label}</text>` : ""}
              <text class="name" x="${n.x}" y="${n.y - 0.72}">${esc(shortName(n.name))}</text>
            </g>`;
  }).join("");

  return `
    <svg class="map" viewBox="${MIN - PAD} ${MIN - PAD} ${MAX - MIN + PAD * 2} ${MAX - MIN + PAD * 2}"
         role="group" aria-label="Neighbourhood map">
      ${grid}${routes}${previewLine}${dots}
    </svg>`;
}

/** Map labels have to fit next to a dot, so long names get trimmed to their head. */
function shortName(name: string): string {
  const words = name.split(" ");
  return words.length <= 2 ? name : `${words[0]} ${words[1]}`;
}
