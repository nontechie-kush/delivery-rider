import {
  CAMERA_DEPTH,
  CAMERA_HEIGHT,
  DRAW_DISTANCE,
  LANES,
  ROAD_WIDTH,
  SEGMENT_LENGTH,
  percentRemaining,
  project,
  segmentAt,
  type Point,
  type Segment,
} from "./road.js";
import {
  createRide,
  rideResult,
  stepRide,
  type Hazard,
  type RideOptions,
  type RideResult,
  type RideState,
} from "./ride.js";

/**
 * Draws the ride and takes the player's input.
 *
 * Controls are lane-based rather than analogue: hold left or right, hold to go
 * faster. On a phone that means thumbs on the bottom corners, which is the only
 * control scheme that works one-handed at a bus stop — and lane-splitting
 * through stopped traffic is the most recognisable thing about riding a
 * two-wheeler in an Indian city.
 */

const SKY = "#0d1a24";
const GROUND_A = "#1b2a1e";
const GROUND_B = "#182619";
const ROAD_A = "#33383a";
const ROAD_B = "#2e3335";
const RUMBLE_A = "#c9d1cc";
const RUMBLE_B = "#7c847f";
const LANE = "#cfd6d1";

const HAZARD_FILL: Record<Hazard["kind"], string> = {
  car: "#3f5a7a",
  auto: "#c9a227",
  truck: "#6a4a3a",
  bike: "#4a5a52",
  pothole: "#141715",
};

export interface RideHandle {
  cancel: () => void;
}

/**
 * Runs a ride to completion inside `host`, resolving with what it cost.
 * Never rejects — a ride the player abandons still returns a result, because
 * the sim has to be able to move the clock forward regardless.
 */
export function runRide(
  host: HTMLElement,
  opts: RideOptions,
  label: { to: string; orders: number },
): { promise: Promise<RideResult>; handle: RideHandle } {
  const ride = createRide(opts);

  host.innerHTML = `
    <div class="ridewrap">
      <canvas class="ridecanvas"></canvas>
      <div class="ridehud">
        <div class="ridedest">
          <span>Riding to</span><b>${label.to}</b>
        </div>
        <div class="ridebag">${label.orders} in the bag</div>
      </div>
      <div class="ridemeter"><i></i></div>
      <div class="ridecontrols">
        <button class="rc left" data-steer="-1" aria-label="Left"></button>
        <button class="rc gas" data-gas="1" aria-label="Accelerate"><span>GO</span></button>
        <button class="rc right" data-steer="1" aria-label="Right"></button>
      </div>
      <div class="ridehint">Hold GO. Steer with the arrows. Traffic hurts.</div>
    </div>`;

  const canvas = host.querySelector<HTMLCanvasElement>(".ridecanvas")!;
  const meter = host.querySelector<HTMLElement>(".ridemeter i")!;
  const ctx = canvas.getContext("2d")!;

  const input = { steer: 0, throttle: false, brake: false };
  const held = new Set<string>();

  const syncSteer = (): void => {
    input.steer = (held.has("1") ? 1 : 0) - (held.has("-1") ? 1 : 0);
  };

  const onDown = (event: PointerEvent): void => {
    const el = (event.target as Element)?.closest<HTMLElement>("[data-steer],[data-gas]");
    if (!el) return;
    event.preventDefault();
    if (el.dataset["gas"]) input.throttle = true;
    else if (el.dataset["steer"]) {
      held.add(el.dataset["steer"]);
      syncSteer();
    }
  };
  const onUp = (): void => {
    input.throttle = false;
    held.clear();
    syncSteer();
  };

  const onKey = (event: KeyboardEvent, down: boolean): void => {
    if (event.key === "ArrowLeft" || event.key === "a") {
      down ? held.add("-1") : held.delete("-1");
    } else if (event.key === "ArrowRight" || event.key === "d") {
      down ? held.add("1") : held.delete("1");
    } else if (event.key === " " || event.key === "ArrowUp" || event.key === "w") {
      input.throttle = down;
    } else if (event.key === "ArrowDown" || event.key === "s") {
      input.brake = down;
    } else return;
    event.preventDefault();
    syncSteer();
  };

  const keyDown = (e: KeyboardEvent): void => onKey(e, true);
  const keyUp = (e: KeyboardEvent): void => onKey(e, false);

  host.addEventListener("pointerdown", onDown);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp);

  let raf = 0;
  let last = performance.now();
  let cancelled = false;

  const teardown = (): void => {
    cancelAnimationFrame(raf);
    host.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("keydown", keyDown);
    window.removeEventListener("keyup", keyUp);
  };

  const promise = new Promise<RideResult>((resolve) => {
    const frame = (now: number): void => {
      // Clamp so a backgrounded tab does not teleport the rider down the road.
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (!cancelled) stepRide(ride, input, dt);
      resize(canvas);
      draw(ctx, canvas, ride);
      meter.style.width = `${Math.min(100, (ride.z / ride.finishZ) * 100)}%`;

      if (ride.done || cancelled) {
        teardown();
        resolve(rideResult(ride));
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });

  return {
    promise,
    handle: {
      cancel: () => {
        cancelled = true;
      },
    },
  };
}

function resize(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function polygon(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number,
  fill: string,
): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draws the road from nearest segment to furthest, clipping each against the
 * highest thing already drawn. Front to back with clipping is what stops far
 * segments painting over near ones, and it is why this runs at all on a phone.
 */
function draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, ride: RideState): void {
  const { width: w, height: h } = canvas;

  ctx.fillStyle = SKY;
  ctx.fillRect(0, 0, w, h);

  const base = segmentAt(ride.road, ride.z);
  const basePercent = percentRemaining(ride.z);
  const playerX = ride.x * ROAD_WIDTH;

  let maxy = h;
  let x = 0;
  let dx = -(base.curve * basePercent);

  for (let n = 0; n < DRAW_DISTANCE; n++) {
    const seg = ride.road[(base.index + n) % ride.road.length]!;
    // Segments that wrapped past the end of the array sit behind the camera in
    // world terms; shift them forward so they project ahead of it.
    const loops = Math.floor((base.index + n) / ride.road.length);
    const zOffset = loops * ride.road.length * SEGMENT_LENGTH;

    seg.p1.world.z = (seg.index * SEGMENT_LENGTH) + zOffset;
    seg.p2.world.z = ((seg.index + 1) * SEGMENT_LENGTH) + zOffset;
    seg.clip = maxy;

    project(seg.p1, playerX - x, CAMERA_HEIGHT, ride.z, w, h);
    project(seg.p2, playerX - x - dx, CAMERA_HEIGHT, ride.z, w, h);

    x += dx;
    dx += seg.curve;

    if (seg.p1.camera.z <= CAMERA_DEPTH || seg.p2.screen.y >= maxy) continue;

    drawSegment(ctx, w, seg);
    maxy = seg.p2.screen.y;
  }

  drawHazards(ctx, canvas, ride, playerX);
  drawRider(ctx, canvas, ride);
}

function drawSegment(ctx: CanvasRenderingContext2D, width: number, seg: Segment): void {
  const p1 = seg.p1.screen;
  const p2 = seg.p2.screen;

  // Verge either side of the tarmac.
  ctx.fillStyle = seg.dark ? GROUND_A : GROUND_B;
  ctx.fillRect(0, p2.y, width, p1.y - p2.y);

  const r1 = (p1.w / Math.max(6, 2 * LANES)) * 1.4;
  const r2 = (p2.w / Math.max(6, 2 * LANES)) * 1.4;
  const rumble = seg.dark ? RUMBLE_A : RUMBLE_B;

  polygon(ctx, p1.x - p1.w - r1, p1.y, p1.x - p1.w, p1.y, p2.x - p2.w, p2.y, p2.x - p2.w - r2, p2.y, rumble);
  polygon(ctx, p1.x + p1.w + r1, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x + p2.w + r2, p2.y, rumble);
  polygon(ctx, p1.x - p1.w, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x - p2.w, p2.y, seg.dark ? ROAD_A : ROAD_B);

  // Lane markings only on the light bands, so they dash as the road moves.
  if (!seg.dark) return;
  const l1 = (p1.w / Math.max(6, LANES)) * 0.06;
  const l2 = (p2.w / Math.max(6, LANES)) * 0.06;
  const lane1 = (p1.w * 2) / LANES;
  const lane2 = (p2.w * 2) / LANES;
  let lx1 = p1.x - p1.w + lane1;
  let lx2 = p2.x - p2.w + lane2;

  for (let lane = 1; lane < LANES; lane++) {
    polygon(ctx, lx1 - l1, p1.y, lx1 + l1, p1.y, lx2 + l2, p2.y, lx2 - l2, p2.y, LANE);
    lx1 += lane1;
    lx2 += lane2;
  }
}

function drawHazards(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  ride: RideState,
  playerX: number,
): void {
  const { width: w, height: h } = canvas;

  // Furthest first, so nearer traffic paints over it.
  const visible = ride.hazards
    .filter((haz) => haz.z > ride.z + 60 && haz.z < ride.z + DRAW_DISTANCE * SEGMENT_LENGTH * 0.35)
    .sort((a, b) => b.z - a.z);

  const probe: Point = {
    world: { x: 0, y: 0, z: 0 },
    camera: { x: 0, y: 0, z: 0 },
    screen: { x: 0, y: 0, w: 0, scale: 0 },
  };

  for (const haz of visible) {
    probe.world.x = haz.x * ROAD_WIDTH;
    probe.world.y = 0;
    probe.world.z = haz.z;
    project(probe, playerX, CAMERA_HEIGHT, ride.z, w, h);

    if (probe.screen.scale <= 0 || probe.screen.w <= 0) continue;

    const sw = probe.screen.w * haz.width * 2.1;
    const sh = sw * (haz.kind === "truck" ? 1.25 : haz.kind === "pothole" ? 0.18 : 0.85);
    if (sw < 1) continue;

    ctx.fillStyle = HAZARD_FILL[haz.kind];
    ctx.fillRect(probe.screen.x - sw / 2, probe.screen.y - sh, sw, sh);

    if (haz.kind !== "pothole" && sw > 10) {
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(probe.screen.x - sw / 2, probe.screen.y - sh + sh * 0.12, sw, sh * 0.3);
    }
  }
}

function drawRider(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, ride: RideState): void {
  const { width: w, height: h } = canvas;
  const bw = w * 0.13;
  const bh = bw * 1.2;
  const cx = w / 2;
  const cy = h * 0.88;

  // Lean into the bend, and wobble when staggered from a hit.
  const lean = ride.stagger > 0 ? Math.sin(ride.elapsed * 42) * 0.18 : 0;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(lean);

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.ellipse(0, bh * 0.46, bw * 0.6, bw * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#1d2320";
  ctx.fillRect(-bw * 0.2, -bh * 0.1, bw * 0.4, bh * 0.56);

  // The bag, which is the whole job.
  ctx.fillStyle = ride.stagger > 0 ? "#c0503f" : "#00e39b";
  ctx.fillRect(-bw * 0.34, -bh * 0.56, bw * 0.68, bh * 0.46);

  ctx.fillStyle = "#e8ebe3";
  ctx.fillRect(-bw * 0.15, -bh * 0.82, bw * 0.3, bh * 0.28);

  ctx.restore();
}
