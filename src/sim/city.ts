import type { CityNode, Pickup } from "./types.js";

/**
 * Twelve nodes: four pickups and eight drops, laid out on a 10x10 grid.
 *
 * The three pickups clustered around (2..4, 3..6) are the "hotspot" — the
 * documented pattern of restaurants and dark stores concentrating, which is what
 * makes batching possible at all. Green Mart sits out on its own so that taking
 * a Green Mart order is a real commitment rather than a free add-on.
 *
 * Brands are invented. Real ones are a trademark problem and satire is worth more.
 */
export const PICKUPS: readonly Pickup[] = [
  // A dark store picks packaged goods off a shelf. Genuinely two or three
  // minutes, and it barely needs to lie about it. This is why EXPRESS can exist.
  { id: "qk", name: "QuickKart Dark Store", kind: "PICKUP", x: 2, y: 3, prepMean: 3, prepSpread: 1.5, optimism: 0.12 },
  // Biryani is cooked to order. Twenty-odd minutes is the honest number, and the
  // app shows you less than half of it — which is the whole mechanic.
  { id: "bj", name: "Biryani Junction", kind: "PICKUP", x: 4, y: 4, prepMean: 22, prepSpread: 8, optimism: 0.55 },
  // Coffee and a snack: quick, and roughly honest about it.
  { id: "fc", name: "Filter Coffee Co", kind: "PICKUP", x: 3, y: 6, prepMean: 8, prepSpread: 3, optimism: 0.2 },
  // Someone has to walk a supermarket basket. Out of the way, and it adds up.
  { id: "gm", name: "Green Mart", kind: "PICKUP", x: 7, y: 2, prepMean: 13, prepSpread: 5, optimism: 0.35 },
] as const;

export const DROPS: readonly CityNode[] = [
  { id: "d1", name: "Silver Oaks Apts", kind: "DROP", x: 1, y: 7 },
  { id: "d2", name: "Lake View Residency", kind: "DROP", x: 5, y: 9 },
  { id: "d3", name: "MG Cross", kind: "DROP", x: 6, y: 5 },
  { id: "d4", name: "Tech Park Gate 3", kind: "DROP", x: 9, y: 6 },
  { id: "d5", name: "Old Town Gully", kind: "DROP", x: 1, y: 1 },
  { id: "d6", name: "Rose Villa", kind: "DROP", x: 8, y: 9 },
  { id: "d7", name: "Metro Station Rd", kind: "DROP", x: 5, y: 1 },
  { id: "d8", name: "Hillside Block C", kind: "DROP", x: 9, y: 1 },
] as const;

export const NODES: readonly CityNode[] = [...PICKUPS, ...DROPS];

const BY_ID = new Map<string, CityNode>(NODES.map((n) => [n.id, n]));

export function node(id: string): CityNode {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown node id: ${id}`);
  return found;
}

export function pickup(id: string): Pickup {
  const found = PICKUPS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown pickup id: ${id}`);
  return found;
}

/** Straight-line grid distance. */
export function distance(fromId: string, toId: string): number {
  const a = node(fromId);
  const b = node(toId);
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Roads are not straight lines. This is the stand-in for the road-class traffic
 * model that arrives in Phase 3 with real OSM data.
 */
const DETOUR = 1.25;

/** Game-minutes per grid unit at the starting vehicle's speed. */
export const BIKE_MIN_PER_UNIT = 1.75;

export function travelMinutes(fromId: string, toId: string, minPerUnit = BIKE_MIN_PER_UNIT): number {
  return distance(fromId, toId) * DETOUR * minPerUnit;
}

/** The rider starts and ends the shift here. */
export const START_NODE_ID = "qk";
