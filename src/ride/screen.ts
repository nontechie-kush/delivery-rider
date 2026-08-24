import {
  DRAW_DISTANCE,
  ROAD_WIDTH,
  SEGMENT_LENGTH,
  project,
  segmentAt,
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

function draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, ride: RideState): void {
  const { width: w, height: h } = canvas;

  ctx.fillStyle = SKY;
  ctx.fillRect(0, 0, w, h / 2);

  const base = segmentAt(ride.road, ride.z);
  const baseIndex = base.index;
  let curveX = 0;
  let curveDx = 0;
  let maxY = h;

  // Back to front, so nearer segments paint over further ones.
  const strips: { seg: Segment; y: number; wide: number; x: number }[] = [];

  for (let i = 0; i < DRAW_DISTANCE; i++) {
    const seg = ride.road[(baseIndex + i) % ride.road.length]!;
    const z = baseIndex * SEGMENT_LENGTH + i * SEGMENT_LENGTH;
    const p = project(z, curveX, ride.z, ride.x * ROAD_WIDTH, w, h);

    curveDx += seg.curve;
    curveX += curveDx;

    if (p.screenY >= maxY) continue;
    maxY = p.screenY;
    strips.push({ seg, y: p.screenY, wide: p.screenW, x: p.screenX });
  }

  for (let i = strips.length - 1; i >= 0; i--) {
    const s = strips[i]!;
    const next = strips[i - 1] ?? s;
    const top = s.y;
    const bottom = i === 0 ? h : next.y;
    if (bottom <= top) continue;

    ctx.fillStyle = s.seg.dark ? GROUND_A : GROUND_B;
    ctx.fillRect(0, top, w, bottom - top);

    // Rumble strips read as edges and give the speed somewhere to register.
    const rumble = s.wide * 1.13;
    ctx.fillStyle = s.seg.dark ? RUMBLE_A : RUMBLE_B;
    ctx.fillRect(s.x - rumble, top, rumble * 2, bottom - top);

    ctx.fillStyle = s.seg.dark ? ROAD_A : ROAD_B;
    ctx.fillRect(s.x - s.wide, top, s.wide * 2, bottom - top);

    if (s.seg.dark && s.wide > 6) {
      ctx.fillStyle = LANE;
      const laneW = Math.max(1, s.wide * 0.02);
      for (const off of [-0.34, 0.34]) {
        ctx.fillRect(s.x + s.wide * off - laneW / 2, top, laneW, bottom - top);
      }
    }
  }

  drawHazards(ctx, canvas, ride);
  drawRider(ctx, canvas, ride);
}

function drawHazards(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, ride: RideState): void {
  const { width: w, height: h } = canvas;

  const visible = ride.hazards
    .filter((haz) => haz.z > ride.z - 200 && haz.z < ride.z + DRAW_DISTANCE * SEGMENT_LENGTH)
    .sort((a, b) => b.z - a.z);

  for (const haz of visible) {
    const p = project(haz.z, 0, ride.z, ride.x * ROAD_WIDTH, w, h);
    if (p.scale <= 0 || p.screenW <= 0) continue;

    const sw = p.screenW * haz.width * 1.9;
    const sh = sw * (haz.kind === "truck" ? 1.15 : haz.kind === "pothole" ? 0.22 : 0.82);
    const sx = p.screenX + p.screenW * haz.x;
    const sy = p.screenY - sh;

    ctx.fillStyle = HAZARD_FILL[haz.kind];
    ctx.fillRect(sx - sw / 2, sy, sw, sh);

    if (haz.kind !== "pothole" && sw > 8) {
      // A dark band reads as a windscreen and tells you which way it faces.
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(sx - sw / 2, sy + sh * 0.14, sw, sh * 0.3);
    }
  }
}

function drawRider(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, ride: RideState): void {
  const { width: w, height: h } = canvas;
  const bw = w * 0.11;
  const bh = bw * 1.25;
  const cx = w / 2;
  const cy = h * 0.9;

  // Lean into the bend, and wobble when staggered from a hit.
  const lean = ride.stagger > 0 ? Math.sin(ride.elapsed * 40) * 0.16 : 0;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(lean);

  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(0, bh * 0.5, bw * 0.62, bw * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  // The bag, which is the whole job, sat above the rear wheel.
  ctx.fillStyle = ride.stagger > 0 ? "#c0503f" : "#00e39b";
  ctx.fillRect(-bw * 0.36, -bh * 0.62, bw * 0.72, bh * 0.5);

  ctx.fillStyle = "#1d2320";
  ctx.fillRect(-bw * 0.22, -bh * 0.16, bw * 0.44, bh * 0.62);

  ctx.fillStyle = "#e8ebe3";
  ctx.fillRect(-bw * 0.16, -bh * 0.9, bw * 0.32, bh * 0.3);

  ctx.restore();
}
