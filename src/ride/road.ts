/**
 * Pseudo-3D road, using the standard Out Run technique.
 *
 * There is no library for this — every implementation is written from the same
 * well-known algorithm, documented at Lou's Pseudo 3D Page and implemented most
 * readably in Jake Gordon's javascript-racer (MIT). The projection and the
 * front-to-back clipping below follow that reference, because a hand-rolled
 * version of it collapsed the road into flat bands.
 *
 * The idea: the road is a list of segments at increasing depth. Each has a near
 * point and a far point, both projected by dividing by distance. Draw them from
 * nearest to furthest, clipping each against the highest thing drawn so far, and
 * the eye assembles a road out of trapezoids.
 */

export interface Point {
  world: { x: number; y: number; z: number };
  camera: { x: number; y: number; z: number };
  screen: { x: number; y: number; w: number; scale: number };
}

export interface Segment {
  index: number;
  p1: Point;
  p2: Point;
  /** Bend applied per segment. Accumulates into a sweeping curve. */
  curve: number;
  /** Alternating band, so movement is visible on a plain surface. */
  dark: boolean;
  /** Screen y above which this segment is hidden by nearer road. */
  clip: number;
}

export const SEGMENT_LENGTH = 200;
export const ROAD_WIDTH = 2000;
export const LANES = 3;
export const DRAW_DISTANCE = 260;
export const CAMERA_HEIGHT = 1000;

/** 100° field of view, expressed as the distance from eye to projection plane. */
export const CAMERA_DEPTH = 1 / Math.tan(((100 / 2) * Math.PI) / 180);

function point(z: number): Point {
  return {
    world: { x: 0, y: 0, z },
    camera: { x: 0, y: 0, z: 0 },
    screen: { x: 0, y: 0, w: 0, scale: 0 },
  };
}

/**
 * Builds a road with long sweeping bends. Gurgaon's arterials are mostly
 * straight with gentle curves, so nothing hairpin — the interest comes from the
 * traffic, not the geometry.
 */
export function buildRoad(segmentCount: number, rand: () => number): Segment[] {
  const road: Segment[] = [];
  let curve = 0;
  let hold = 0;

  for (let i = 0; i < segmentCount; i++) {
    if (hold <= 0) {
      curve = rand() < 0.5 ? (rand() - 0.5) * 5 : 0;
      hold = 30 + Math.floor(rand() * 60);
    }
    hold -= 1;

    road.push({
      index: i,
      p1: point(i * SEGMENT_LENGTH),
      p2: point((i + 1) * SEGMENT_LENGTH),
      curve,
      dark: Math.floor(i / 3) % 2 === 0,
      clip: 0,
    });
  }
  return road;
}

/**
 * Projects one point onto the screen.
 *
 * `cameraX` is the rider's lateral position in world units, `cameraY` their eye
 * height above the road, `cameraZ` how far along they are.
 */
export function project(
  p: Point,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  width: number,
  height: number,
): void {
  p.camera.x = p.world.x - cameraX;
  p.camera.y = p.world.y - cameraY;
  // Never divide by zero for a segment level with the eye.
  p.camera.z = Math.max(1, p.world.z - cameraZ);

  p.screen.scale = CAMERA_DEPTH / p.camera.z;
  p.screen.x = Math.round(width / 2 + (p.screen.scale * p.camera.x * width) / 2);
  p.screen.y = Math.round(height / 2 - (p.screen.scale * p.camera.y * height) / 2);
  p.screen.w = Math.round((p.screen.scale * ROAD_WIDTH * width) / 2);
}

export function segmentAt(road: Segment[], z: number): Segment {
  const index = Math.floor(z / SEGMENT_LENGTH);
  return road[((index % road.length) + road.length) % road.length]!;
}

/** How far through its segment a depth sits, 0 to 1. */
export function percentRemaining(z: number): number {
  return (z % SEGMENT_LENGTH) / SEGMENT_LENGTH;
}

/**
 * Accumulated bend over the visible stretch, used to push the rider outward on
 * a curve. Leaning into a bend at speed is what makes a road feel like a road
 * rather than a corridor.
 */
export function curveAhead(road: Segment[], z: number, lookahead = 12): number {
  let total = 0;
  for (let i = 0; i < lookahead; i++) {
    total += segmentAt(road, z + i * SEGMENT_LENGTH).curve;
  }
  return total / lookahead;
}
