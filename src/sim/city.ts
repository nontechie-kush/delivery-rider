import type { AddressKind, CityNode, Drop, Pickup, VenueKind } from "./types.js";

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
 * Business names are invented and deliberately so. The neighbourhoods, markets
 * and roads are real; the tenants are not. Each name is written to sit in the
 * same register as the chain it evokes — a sweet shop reads as a sweet shop,
 * a delivery-only kitchen reads as one — so an Indian player recognises the
 * *kind* of place instantly without the game carrying a real trademark.
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

interface DropPlace extends Place {
  address: AddressKind;
}

/**
 * Where you collect. Twenty-two venues across the real market clusters —
 * Sector 29's restaurant strip, Galleria in Phase 4, the old Sector 14 market,
 * Cyber Hub — because that is where Gurgaon's kitchens actually are, and
 * clustering them is what makes a batched run worth planning.
 *
 * All of it inside one rider's patch. A first pass spread these down Sohna Road
 * and into South City 2, which stretched the zone to nine kilometres and cost
 * the day 42% of its income in travel: that is two rider zones, not one.
 * Gurgaon genuinely has this venue density inside the smaller footprint.
 */
const PICKUP_PLACES: (Place & { venue: VenueKind })[] = [
  // Sector 29 — Leisure Valley. The restaurant strip.
  { id: "bj", name: "Biryani Junction", area: "Sector 29", venue: "biryani", lat: 28.467, lon: 77.068 },
  { id: "nw", name: "Nawabi Handi", area: "Sector 29", venue: "biryani", lat: 28.4663, lon: 77.0672 },
  { id: "wk", name: "Wok This Way", area: "Sector 29", venue: "chinese", lat: 28.4658, lon: 77.0695 },
  { id: "bb", name: "Burger Baron", area: "Sector 29", venue: "fastfood", lat: 28.4675, lon: 77.0701 },

  // Galleria Market, DLF Phase 4. Cafés and bakeries.
  { id: "fc", name: "Filter Coffee Co", area: "Galleria, Phase 4", venue: "cafe", lat: 28.4685, lon: 77.0855 },
  { id: "ck", name: "Copper Kettle", area: "Galleria, Phase 4", venue: "cafe", lat: 28.4692, lon: 77.0861 },
  { id: "bt", name: "Bake Theory", area: "Galleria, Phase 4", venue: "cafe", lat: 28.4679, lon: 77.0848 },

  // Sushant Lok Phase 1.
  { id: "qk", name: "QuickKart", area: "Sushant Lok", venue: "darkstore", lat: 28.467, lon: 77.082 },
  { id: "mm", name: "Momo Mahal", area: "Sushant Lok", venue: "chinese", lat: 28.4655, lon: 77.0812 },
  { id: "lj", name: "Lala Ji Sweets", area: "Sushant Lok", venue: "sweets", lat: 28.4648, lon: 77.0805 },

  // Old Gurgaon. Sector 14 and 15 markets.
  { id: "gm", name: "Green Mart", area: "Sector 14", venue: "grocery", lat: 28.470, lon: 77.035 },
  { id: "gs", name: "Ganga Mishthan Bhandar", area: "Sector 14", venue: "sweets", lat: 28.4712, lon: 77.0362 },
  { id: "sd", name: "Sardar Ji Da Dhaba", area: "Sector 15", venue: "dhaba", lat: 28.4622, lon: 77.0405 },
  { id: "zm", name: "ZipMart", area: "Sector 15", venue: "darkstore", lat: 28.4631, lon: 77.0418 },

  // Cyber Hub and Cyber City. Office-hours volume.
  { id: "ro", name: "Roastery No. 9", area: "Cyber Hub", venue: "cafe", lat: 28.4952, lon: 77.0888 },
  { id: "pr", name: "Pizza Republic", area: "Cyber Hub", venue: "fastfood", lat: 28.4946, lon: 77.0895 },
  { id: "hp", name: "Highway Pind", area: "Cyber City", venue: "dhaba", lat: 28.4938, lon: 77.0872 },

  // Sohna Road. The long southern haul.
  { id: "tm", name: "TenMinute Mart", area: "Sector 46", venue: "darkstore", lat: 28.4392, lon: 77.0618 },
  { id: "cw", name: "Chung Wah Kitchen", area: "Sector 31", venue: "chinese", lat: 28.4548, lon: 77.0562 },
  { id: "db", name: "Daily Bazaar", area: "South City 1", venue: "grocery", lat: 28.4512, lon: 77.0588 },

  // Golf Course Road and South City.
  { id: "hb", name: "Hyderabad House", area: "South City 1", venue: "biryani", lat: 28.4521, lon: 77.0605 },
  { id: "cc", name: "Chicken Coop", area: "Golf Course Rd", venue: "fastfood", lat: 28.4455, lon: 77.0972 },
];

/**
 * Where you deliver. The handover is the honest cost nobody models, and the
 * address type is what predicts it — a metro gate takes two minutes, a gated
 * Golf Course Road tower takes seven by the time the guard, the lift and the
 * floor are done with you.
 */
const DROP_PLACES: DropPlace[] = [
  { id: "d1", name: "Huda City Centre", area: "Sector 29", address: "metro", lat: 28.4595, lon: 77.0724 },
  { id: "d2", name: "IFFCO Chowk", area: "Sector 17", address: "metro", lat: 28.472, lon: 77.072 },
  { id: "d3", name: "Sikanderpur", area: "MG Road", address: "metro", lat: 28.4815, lon: 77.093 },
  { id: "d4", name: "DLF Phase 3", area: "Sector 24", address: "gated", lat: 28.493, lon: 77.098 },
  { id: "d5", name: "Sector 42", area: "Golf Course Rd", address: "gated", lat: 28.445, lon: 77.098 },
  { id: "d6", name: "Sector 45", area: "South City", address: "condo", lat: 28.436, lon: 77.068 },
  { id: "d7", name: "Sector 15", area: "Old Gurgaon", address: "market", lat: 28.462, lon: 77.04 },
  { id: "d8", name: "Sushant Lok C", area: "Block C", address: "condo", lat: 28.4585, lon: 77.0895 },
  { id: "d9", name: "Cyber City", area: "Phase 2", address: "office", lat: 28.4945, lon: 77.0885 },
  { id: "d10", name: "Ardee City", area: "Sector 52", address: "gated", lat: 28.4482, lon: 77.0698 },
  { id: "d11", name: "Sector 31", area: "Huda Market", address: "market", lat: 28.4552, lon: 77.0551 },
  { id: "d12", name: "Vipul Trade Centre", area: "Sohna Road", address: "office", lat: 28.4318, lon: 77.0452 },
  { id: "d13", name: "Malibu Towne", area: "Sohna Road", address: "gated", lat: 28.4295, lon: 77.0498 },
  { id: "d14", name: "Sector 56", area: "Golf Course Ext", address: "condo", lat: 28.4312, lon: 77.0985 },
  { id: "d15", name: "South City 2", area: "Sector 49", address: "gated", lat: 28.4285, lon: 77.0535 },
  { id: "d16", name: "Sector 14 Market", area: "Old Gurgaon", address: "market", lat: 28.4708, lon: 77.0358 },
];

export const PICKUPS: readonly Pickup[] = PICKUP_PLACES.map((p) => ({
  id: p.id, name: p.name, area: p.area, venue: p.venue,
  kind: "PICKUP" as const, ...project(p.lat, p.lon),
}));

export const DROPS: readonly Drop[] = DROP_PLACES.map((p) => ({
  id: p.id, name: p.name, area: p.area, address: p.address,
  kind: "DROP" as const, ...project(p.lat, p.lon),
}));

/**
 * A union rather than the shared base, so `kind === "PICKUP"` narrows to a
 * Pickup and its venue archetype is reachable without a cast.
 */
export const NODES: readonly (Pickup | Drop)[] = [...PICKUPS, ...DROPS];

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
