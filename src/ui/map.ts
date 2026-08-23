import { BOUNDS, NODES, ROADS, node } from "../sim/city.js";
import type { ShiftState } from "../sim/shift.js";
import { esc, urgency } from "./format.js";

/**
 * A map of Gurgaon drawn from the same coordinates the simulation routes over,
 * so what the player sees and what the clock charges them are the same thing.
 *
 * Its job is to make "do these two orders share a route?" something you can see
 * rather than compute — which is the whole decision the prototype tests. Nodes
 * are buttons: tapping one rides there.
 */

const PAD = 1.4; // kilometres of margin around the drawn area

interface Pending {
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
      stops.set(id, { slack, count: 1 });
    }
  }
  return stops;
}

export function renderMap(state: ShiftState, previewOrderId: string | null): string {
  const stops = pendingStops(state);
  const here = node(state.locationId);
  const preview = previewOrderId
    ? (state.offers.find((o) => o.id === previewOrderId) ?? null)
    : null;

  const minX = BOUNDS.minX - PAD;
  const minY = BOUNDS.minY - PAD;
  const width = BOUNDS.maxX - BOUNDS.minX + PAD * 2;
  const height = BOUNDS.maxY - BOUNDS.minY + PAD * 2;

  const roads = ROADS.map(
    (road) =>
      `<polyline class="road ${road.major ? "major" : ""}" points="${road.points
        .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
        .join(" ")}" />`,
  ).join("");

  // Spokes from where the rider stands to everything still owed to someone.
  const routes = [...stops.entries()]
    .map(([id, stop]) => {
      const to = node(id);
      return `<line class="leg ${urgency(stop.slack)}" x1="${here.x.toFixed(2)}" y1="${here.y.toFixed(
        2,
      )}" x2="${to.x.toFixed(2)}" y2="${to.y.toFixed(2)}" />`;
    })
    .join("");

  const previewLine = preview
    ? (() => {
        const p = node(preview.pickupId);
        const d = node(preview.dropId);
        return `<line class="preview" x1="${here.x.toFixed(2)}" y1="${here.y.toFixed(2)}" x2="${p.x.toFixed(
          2,
        )}" y2="${p.y.toFixed(2)}" />
                <line class="preview solid" x1="${p.x.toFixed(2)}" y1="${p.y.toFixed(2)}" x2="${d.x.toFixed(
                  2,
                )}" y2="${d.y.toFixed(2)}" />`;
      })()
    : "";

  const dots = NODES.map((n) => {
    const stop = stops.get(n.id);
    const classes = [
      "node",
      n.kind === "PICKUP" ? "pickup" : "drop",
      stop ? `pending ${urgency(stop.slack)}` : "",
      n.id === state.locationId ? "here" : "",
      preview?.pickupId === n.id ? "pv-pickup" : "",
      preview?.dropId === n.id ? "pv-drop" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const label = stop && stop.count > 1 ? `${stop.count}` : "";

    return `<g class="${classes}" data-go="${esc(n.id)}" tabindex="0" role="button"
               aria-label="Ride to ${esc(n.name)}, ${esc(n.area)}">
              <circle class="hit" cx="${n.x.toFixed(2)}" cy="${n.y.toFixed(2)}" r="1.1" />
              <circle class="pip" cx="${n.x.toFixed(2)}" cy="${n.y.toFixed(2)}" r="${
                n.id === state.locationId ? 0.52 : 0.38
              }" />
              ${label ? `<text class="badge" x="${n.x.toFixed(2)}" y="${(n.y + 0.15).toFixed(2)}">${label}</text>` : ""}
              <text class="name" x="${n.x.toFixed(2)}" y="${(n.y - 0.72).toFixed(2)}">${esc(n.name)}</text>
            </g>`;
  }).join("");

  return `
    <svg class="map" viewBox="${minX.toFixed(2)} ${minY.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)}"
         preserveAspectRatio="xMidYMid meet" role="group" aria-label="Gurgaon delivery area">
      <g class="roads">${roads}</g>
      <g class="legs">${routes}${previewLine}</g>
      <g class="nodes">${dots}</g>
    </svg>`;
}
