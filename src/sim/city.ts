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

/** Longitude/latitude to the zone's local kilometre grid. */
export function project(lat: number, lon: number): { x: number; y: number } {
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

const PICKUP_PLACES: Place[] = [
  { id: "qk", name: "QuickKart", area: "Sushant Lok", lat: 28.467, lon: 77.082 },
  { id: "bj", name: "Biryani Junction", area: "Sector 29", lat: 28.467, lon: 77.068 },
  { id: "fc", name: "Filter Coffee Co", area: "Galleria, Phase 4", lat: 28.4685, lon: 77.0855 },
  { id: "gm", name: "Green Mart", area: "Sector 14", lat: 28.470, lon: 77.035 },
];

const DROP_PLACES: Place[] = [
  { id: "d1", name: "Huda City Centre", area: "Sector 29", lat: 28.4595, lon: 77.0724 },
  { id: "d2", name: "IFFCO Chowk", area: "Sector 17", lat: 28.472, lon: 77.072 },
  { id: "d3", name: "Sikanderpur", area: "MG Road", lat: 28.4815, lon: 77.093 },
  { id: "d4", name: "DLF Phase 3", area: "Sector 24", lat: 28.493, lon: 77.098 },
  { id: "d5", name: "Sector 42", area: "Golf Course Rd", lat: 28.445, lon: 77.098 },
  { id: "d6", name: "Sector 45", area: "South City", lat: 28.436, lon: 77.068 },
  { id: "d7", name: "Sector 15", area: "Old Gurgaon", lat: 28.462, lon: 77.04 },
  { id: "d8", name: "Sushant Lok C", area: "Block C", lat: 28.4585, lon: 77.0895 },
];

// Geography lives here; how each place behaves lives in config.ts.
export const PICKUPS: readonly Pickup[] = PICKUP_PLACES.map((p) => ({
  id: p.id, name: p.name, area: p.area, kind: "PICKUP" as const, ...project(p.lat, p.lon),
}));

export const DROPS: readonly CityNode[] = DROP_PLACES.map((p) => ({
  id: p.id, name: p.name, area: p.area, kind: "DROP" as const, ...project(p.lat, p.lon),
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

/**
 * The node closest to a real-world position, and how far off it is.
 *
 * The play area is one zone of Gurgaon, so a player anywhere else lands far
 * outside it. Rather than refuse, we snap them to the nearest node and say how
 * far away they really are — the game is still playable from Bengaluru, it just
 * admits you are not actually in Sushant Lok.
 */
export function nearestNode(lat: number, lon: number): { node: CityNode; km: number } {
  const here = project(lat, lon);
  let best = NODES[0]!;
  let bestKm = Infinity;

  for (const n of NODES) {
    const km = Math.hypot(n.x - here.x, n.y - here.y);
    if (km < bestKm) {
      bestKm = km;
      best = n;
    }
  }
  return { node: best, km: bestKm };
}

/** Whether a real-world position falls inside the drawn zone. */
export function insideZone(lat: number, lon: number): boolean {
  const p = project(lat, lon);
  return (
    p.x >= BOUNDS.minX - 1 &&
    p.x <= BOUNDS.maxX + 1 &&
    p.y >= BOUNDS.minY - 1 &&
    p.y <= BOUNDS.maxY + 1
  );
}

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
