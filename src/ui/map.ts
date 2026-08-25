import { BOUNDS, NODES, PICKUPS, ROADS, node } from "../sim/city.js";
import { venueGlyphs } from "./icons.js";
import { demandAt } from "../sim/config.js";
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

/**
 * Heat around each pickup: how much work that corner is throwing off right now.
 *
 * Dispatch offers from the stores nearest the rider, so where the orders are is
 * genuinely positional information — and the reason riders cluster at hotspots
 * between jobs rather than parking wherever they finished.
 */
function heatLayer(state: ShiftState): string {
  const demand = demandAt(state.clock, state.cfg);

  return PICKUPS.map((p) => {
    // Recent offers from this pickup, as a stand-in for how hot it is.
    const recent = state.offers.filter((o) => o.pickupId === p.id).length;
    const heat = Math.min(1, (demand / 4.4) * 0.7 + recent * 0.18);
    if (heat < 0.06) return "";

    return `<circle class="heat" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}"
              r="${(1.1 + heat * 2.6).toFixed(2)}" opacity="${(heat * 0.5).toFixed(2)}" />`;
  }).join("");
}

export function renderMap(
  state: ShiftState,
  previewOrderId: string | null,
  showHeat = false,
): string {
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

  // Twelve labels on a nine-kilometre map collide into mush. Place them greedily
  // — try above the dot, then below — and drop any that still overlap something
  // already placed. Whatever matters right now is placed first, so the labels
  // that survive are the ones the player needs.
  const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const LABEL_H = 0.62;
  const priority = (id: string): number =>
    id === state.locationId ? 0 : stops.has(id) ? 1 : NODES.find((n) => n.id === id)?.kind === "PICKUP" ? 2 : 3;

  const labelFor = (n: (typeof NODES)[number]): string => {
    const halfWidth = Math.max(1.1, n.name.length * 0.21);
    for (const dy of [-0.78, 1.05]) {
      const box = { x1: n.x - halfWidth, x2: n.x + halfWidth, y1: n.y + dy - LABEL_H / 2, y2: n.y + dy + LABEL_H / 2 };
      const clash = placed.some(
        (p) => box.x1 < p.x2 && box.x2 > p.x1 && box.y1 < p.y2 && box.y2 > p.y1,
      );
      if (!clash) {
        placed.push(box);
        return `<text class="name" x="${n.x.toFixed(2)}" y="${(n.y + dy).toFixed(2)}">${esc(n.name)}</text>`;
      }
    }
    return "";
  };

  const labels = new Map<string, string>();
  for (const n of [...NODES].sort((a, b) => priority(a.id) - priority(b.id))) {
    labels.set(n.id, labelFor(n));
  }

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
              <circle class="hit" cx="${n.x.toFixed(2)}" cy="${n.y.toFixed(2)}" r="0.9" />
              <circle class="pip" cx="${n.x.toFixed(2)}" cy="${n.y.toFixed(2)}" r="${
                n.id === state.locationId ? 0.34 : 0.24
              }" />
              ${
                // A glyph per archetype, so twenty-two pickups can be told
                // apart at a glance instead of by reading every label.
                n.kind === "PICKUP" && !label
                  ? `<g class="glyph" transform="translate(${n.x.toFixed(2)} ${n.y.toFixed(2)}) scale(0.62)">${
                      venueGlyphs[n.venue]
                    }</g>`
                  : ""
              }
              ${label ? `<text class="badge" x="${n.x.toFixed(2)}" y="${(n.y + 0.13).toFixed(2)}">${label}</text>` : ""}
              ${labels.get(n.id) ?? ""}
            </g>`;
  }).join("");

  return `
    <svg class="map" viewBox="${minX.toFixed(2)} ${minY.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)}"
         preserveAspectRatio="xMidYMid meet" role="group" aria-label="Gurgaon delivery area">
      ${showHeat ? `<g class="heatmap">${heatLayer(state)}</g>` : ""}
      <g class="roads">${roads}</g>
      <g class="legs">${routes}${previewLine}</g>
      <g class="nodes">${dots}</g>
    </svg>`;
}
