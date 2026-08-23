import type { CityNode, Pickup } from "./types.js";

/**
 * Gurgaon, approximately.
 *
 * Real places at real coordinates, projected to kilometres. The geography is
 * genuine — Cyber Hub really is north-east of Sector 29, Sohna Road really is a
 * long haul south, Palam Vihar really is the awkward western outlier — so the
 * routing decisions the player makes are the ones a real rider makes here.
 *
 * Coordinates are hand-entered and accurate to a few hundred metres, which is
 * enough for relative geography. Phase 3 replaces this with an OpenStreetMap
 * extract processed at build time; this is the cheap version of the same idea.
 *
 * Business names are invented and deliberately so. The neighbourhoods are real;
 * the brands operating in them are not, because real ones are a trademark
 * problem and satire is worth more than recognition.
 */

/** Degrees to kilometres at Gurgaon's latitude. */
const KM_PER_DEG_LAT = 110.9;
const KM_PER_DEG_LON = 97.5;

/** Projection origin: west edge for x, north edge for y. */
const ORIGIN_LON = 77.028;
const NORTH_LAT = 28.500;

function project(lat: number, lon: number): { x: number; y: number } {
  return {
    x: (lon - ORIGIN_LON) * KM_PER_DEG_LON,
    // Screen y grows downward, so north has to flip.
    y: (NORTH_LAT - lat) * KM_PER_DEG_LAT,
  };
}

interface Place {
  id: string;
  name: string;
  area: string;
  lat: number;
  lon: number;
}

const PICKUP_PLACES: (Place & { prepMean: number; prepSpread: number; optimism: number })[] = [
  // Dark store in the middle of the zone. Picks packaged goods off a shelf in
  // three minutes and barely needs to lie about it — which is why EXPRESS exists.
  {
    id: "qk", name: "QuickKart", area: "Sushant Lok",
    lat: 28.467, lon: 77.082, prepMean: 3, prepSpread: 1.5, optimism: 0.12,
  },
  // Sector 29 is Gurgaon's restaurant district. Biryani is cooked to order and
  // the app shows you less than half the real wait.
  {
    id: "bj", name: "Biryani Junction", area: "Sector 29",
    lat: 28.467, lon: 77.068, prepMean: 22, prepSpread: 8, optimism: 0.55,
  },
  {
    id: "fc", name: "Filter Coffee Co", area: "Galleria, Phase 4",
    lat: 28.4685, lon: 77.0855, prepMean: 8, prepSpread: 3, optimism: 0.2,
  },
  // Old Gurgaon, at the western edge of the zone. Someone has to walk a
  // supermarket basket, and getting out there at all is a commitment.
  {
    id: "gm", name: "Green Mart", area: "Sector 14",
    lat: 28.470, lon: 77.035, prepMean: 13, prepSpread: 5, optimism: 0.35,
  },
];

/**
 * Handover minutes are the honest part nobody models: a metro-side handover to
 * someone standing on the pavement takes two minutes, a gated high-rise on Golf
 * Course Road takes seven by the time the guard, the lift and the floor are
 * done with you. Learning which is which is the Knowledge axis in miniature.
 */
const DROP_PLACES: (Place & { handover: number })[] = [
  { id: "d1", name: "Huda City Centre", area: "Sector 29", lat: 28.4595, lon: 77.0724, handover: 2 },
  { id: "d2", name: "IFFCO Chowk", area: "Sector 17", lat: 28.472, lon: 77.072, handover: 2.5 },
  { id: "d3", name: "Sikanderpur", area: "MG Road", lat: 28.4815, lon: 77.093, handover: 3 },
  { id: "d4", name: "DLF Phase 3", area: "Sector 24", lat: 28.493, lon: 77.098, handover: 6 },
  { id: "d5", name: "Sector 42", area: "Golf Course Rd", lat: 28.445, lon: 77.098, handover: 7 },
  { id: "d6", name: "Sector 45", area: "South City", lat: 28.436, lon: 77.068, handover: 5 },
  { id: "d7", name: "Sector 15", area: "Old Gurgaon", lat: 28.462, lon: 77.04, handover: 3.5 },
  { id: "d8", name: "Sushant Lok C", area: "Block C", lat: 28.4585, lon: 77.0895, handover: 5.5 },
];

export const PICKUPS: readonly Pickup[] = PICKUP_PLACES.map((p) => ({
  id: p.id,
  name: p.name,
  area: p.area,
  kind: "PICKUP" as const,
  // Collecting is quick once it is actually bagged; the wait is the prep, not this.
  handover: 1.5,
  ...project(p.lat, p.lon),
  prepMean: p.prepMean,
  prepSpread: p.prepSpread,
  optimism: p.optimism,
}));

export const DROPS: readonly CityNode[] = DROP_PLACES.map((p) => ({
  id: p.id,
  name: p.name,
  area: p.area,
  kind: "DROP" as const,
  handover: p.handover,
  ...project(p.lat, p.lon),
}));

export const NODES: readonly CityNode[] = [...PICKUPS, ...DROPS];

/**
 * The arterials, so the map reads as a city rather than a scatter plot. Riders
 * do not travel in straight lines and these are the roads they actually use.
 */
const ROAD_PATHS: { name: string; major: boolean; points: [number, number][] }[] = [
  {
    name: "NH-48",
    major: true,
    points: [[28.4985, 77.0885], [28.4835, 77.0785], [28.4720, 77.0720], [28.4560, 77.0505], [28.4430, 77.0340]],
  },
  {
    name: "Golf Course Road",
    major: true,
    points: [[28.4815, 77.0930], [28.4655, 77.0955], [28.4450, 77.0980], [28.4350, 77.0995]],
  },
  {
    name: "MG Road",
    major: true,
    points: [[28.4815, 77.0930], [28.4775, 77.0825], [28.4720, 77.0720]],
  },
  {
    name: "Sohna Road",
    major: false,
    points: [[28.4560, 77.0505], [28.4450, 77.0560], [28.4360, 77.0680], [28.4330, 77.0790]],
  },
  {
    name: "Old Delhi-Gurgaon Road",
    major: false,
    points: [[28.4930, 77.0980], [28.4810, 77.0640], [28.4700, 77.0350]],
  },
  {
    name: "Sector 29 link",
    major: false,
    points: [[28.4720, 77.0720], [28.4670, 77.0680], [28.4595, 77.0724], [28.4670, 77.0820], [28.4685, 77.0855]],
  },
  {
    name: "Sushant Lok spine",
    major: false,
    points: [[28.4670, 77.0820], [28.4585, 77.0895], [28.4450, 77.0980]],
  },
  {
    name: "Old Gurgaon link",
    major: false,
    points: [[28.4700, 77.0350], [28.4620, 77.0400], [28.4560, 77.0505]],
  },
];

export const ROADS = ROAD_PATHS.map((road) => ({
  name: road.name,
  major: road.major,
  points: road.points.map(([lat, lon]) => project(lat, lon)),
}));

/** Bounds of the drawn area, so the map can frame itself. */
export const BOUNDS = (() => {
  const xs = [...NODES.map((n) => n.x), ...ROADS.flatMap((r) => r.points.map((p) => p.x))];
  const ys = [...NODES.map((n) => n.y), ...ROADS.flatMap((r) => r.points.map((p) => p.y))];
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
})();

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

/** Straight-line distance in kilometres. */
export function distance(fromId: string, toId: string): number {
  const a = node(fromId);
  const b = node(toId);
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Roads are not straight lines, and Gurgaon's are less straight than most —
 * sector grids, service roads, and a handful of places you simply cannot turn
 * right. Phase 3 replaces this constant with real routing over OSM geometry.
 */
const DETOUR = 1.25;

/**
 * Minutes per kilometre at the starting vehicle's speed, before congestion.
 * With the detour factor this lands near 2.6 min/km off-peak and about 3.5 at
 * the evening peak — Bengaluru's measured peak is 3.6, and Gurgaon is no kinder.
 */
export const BIKE_MIN_PER_KM = 2.08;

export function travelMinutes(fromId: string, toId: string, minPerKm = BIKE_MIN_PER_KM): number {
  return distance(fromId, toId) * DETOUR * minPerKm;
}

/** The rider starts the shift at the dark store. */
export const START_NODE_ID = "qk";
