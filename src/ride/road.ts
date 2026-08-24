/**
 * Pseudo-3D road, the way Out Run and Road Rash did it.
 *
 * There is no 3D here. The road is a list of segments at increasing depth, each
 * projected to the screen by dividing by distance. Draw them back to front and
 * the eye assembles a road. It ran on a Genesis, so it will run on a phone, and
 * it costs a fraction of what a real 3D city would.
 */

export interface Segment {
  index: number;
  /** World depth at the start of this segment. */
  z: number;
  /** Horizontal curve applied per segment. Accumulates into a bend. */
  curve: number;
  /** Alternating band, so the road reads as moving. */
  dark: boolean;
}

export interface Projected {
  screenX: number;
  screenY: number;
  screenW: number;
  scale: number;
}

export const SEGMENT_LENGTH = 200;
/** Segments drawn ahead of the camera. Beyond this the road is a smudge. */
export const DRAW_DISTANCE = 90;
/** Half-width of the road in world units. */
export const ROAD_WIDTH = 1400;
/** How far the camera sits from the projection plane. Sets the field of view. */
const CAMERA_DEPTH = 0.55;
const CAMERA_HEIGHT = 900;

/**
 * Builds a road with gentle bends. Gurgaon's arterials are mostly straight with
 * long sweeping curves, so nothing hairpin — the interest comes from traffic,
 * not from the geometry.
 */
export function buildRoad(segmentCount: number, rand: () => number): Segment[] {
  const road: Segment[] = [];
  let curve = 0;
  let hold = 0;

  for (let i = 0; i < segmentCount; i++) {
    if (hold <= 0) {
      // Mostly straight, occasionally a long bend one way or the other.
      curve = rand() < 0.45 ? (rand() - 0.5) * 3.4 : 0;
      hold = 25 + Math.floor(rand() * 45);
    }
    hold -= 1;

    road.push({ index: i, z: i * SEGMENT_LENGTH, curve, dark: Math.floor(i / 3) % 2 === 0 });
  }
  return road;
}

/**
 * Projects a point at world depth `z` and lateral offset `x` onto the screen.
 * `cameraX` shifts with the player so the road swings as they move across it.
 */
export function project(
  z: number,
  x: number,
  cameraZ: number,
  cameraX: number,
  width: number,
  height: number,
): Projected {
  // Never divide by zero when a segment is level with the camera.
  const depth = Math.max(1, z - cameraZ);
  const scale = CAMERA_DEPTH / (depth / 1000);

  return {
    screenX: Math.round(width / 2 + (scale * (x - cameraX) * width) / 2),
    screenY: Math.round(height / 2 + (scale * CAMERA_HEIGHT * height) / 2 / 1000),
    screenW: Math.round((scale * ROAD_WIDTH * width) / 2),
    scale,
  };
}

/** The segment the camera is currently sitting in. */
export function segmentAt(road: Segment[], z: number): Segment {
  const index = Math.floor(z / SEGMENT_LENGTH) % road.length;
  return road[((index % road.length) + road.length) % road.length]!;
}

/**
 * Accumulated bend over the visible stretch, used to push the rider outward on
 * a curve. Leaning into a bend at speed is what makes the road feel like a road
 * rather than a corridor.
 */
export function curveAhead(road: Segment[], z: number, lookahead = 12): number {
  let total = 0;
  for (let i = 0; i < lookahead; i++) {
    total += segmentAt(road, z + i * SEGMENT_LENGTH).curve;
  }
  return total / lookahead;
}
