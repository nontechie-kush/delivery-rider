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
import { drawPlayerBike, drawVehicle } from "./sprites.js";
import {
  argue,
  createRide,
  nextSignal,
  payBribe,
  rideResult,
  signalIsRed,
  stepRide,
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
  label: {
    to: string;
    orders: number;
    topSpeedKmh: number;
    /** How far the journey is, so the HUD can count it down in kilometres. */
    km: number;
    /** Game-minutes the journey should take at a normal pace. */
    etaMinutes: number;
    /** Game-minutes until the tightest thing in the bag goes late, if anything is. */
    slackMinutes: number | null;
  },
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
      <div class="ridestats">
        <div class="rs"><b class="rs-km">${label.km.toFixed(1)}</b><span>km to go</span></div>
        <div class="rs"><b class="rs-eta">${Math.round(label.etaMinutes)}</b><span>min out</span></div>
      </div>
      <div class="ridespeed"><b>0</b><span>km/h</span></div>
      <div class="ridelight" hidden><i></i><span></span></div>
      <div class="ridemeter"><i></i></div>
      <div class="ridecontrols">
        <div class="rc-row minor">
          <button class="rc small horn" data-horn="1" aria-label="Horn">HORN</button>
          <button class="rc small brake" data-brake="1" aria-label="Brake">BRAKE</button>
          <button class="rc small hit" data-hit="1" aria-label="Swing">
            <span class="hit-label">KICK</span>
          </button>
        </div>
        <div class="rc-row">
          <button class="rc left" data-steer="-1" aria-label="Left"></button>
          <button class="rc gas" data-gas="1" aria-label="Accelerate"><span>GO</span></button>
          <button class="rc right" data-steer="1" aria-label="Right"></button>
        </div>
      </div>
      <div class="ridehint">Hold GO · both arrows to squeeze through a gap</div>
      <div class="police" hidden>
        <div class="pol-card">
          <b>Pulled over</b>
          <p>You jumped the light. He wants <span class="pol-amt"></span> to forget it.</p>
          <div class="pol-acts">
            <button class="pol-pay" data-bribe="1">Pay <span class="pol-amt2"></span><em>6 sec</em></button>
            <button class="pol-argue" data-argue="1">Argue<em>~22 sec, might cost nothing</em></button>
          </div>
        </div>
      </div>
    </div>`;

  const canvas = host.querySelector<HTMLCanvasElement>(".ridecanvas")!;
  const meter = host.querySelector<HTMLElement>(".ridemeter i")!;
  const speedo = host.querySelector<HTMLElement>(".ridespeed b")!;
  const kmLeft = host.querySelector<HTMLElement>(".rs-km")!;
  const etaOut = host.querySelector<HTMLElement>(".rs-eta")!;
  const stats = host.querySelector<HTMLElement>(".ridestats")!;
  const lightBox = host.querySelector<HTMLElement>(".ridelight")!;
  const police = host.querySelector<HTMLElement>(".police")!;
  const hitLabel = host.querySelector<HTMLElement>(".hit-label")!;
  const lightText = host.querySelector<HTMLElement>(".ridelight span")!;
  const ctx = canvas.getContext("2d")!;

  const input = {
    steer: 0,
    throttle: false,
    brake: false,
    horn: false,
    squeeze: false,
    hit: false,
  };
  const held = new Set<string>();

  const syncSteer = (): void => {
    input.steer = (held.has("1") ? 1 : 0) - (held.has("-1") ? 1 : 0);
    // Holding both is not a contradiction, it is pulling your elbows in.
    input.squeeze = held.has("1") && held.has("-1");
  };

  // The roadside negotiation, which pauses everything until it is settled.
  const onSettle = (event: Event): void => {
    const el = (event.target as Element)?.closest<HTMLElement>("[data-bribe],[data-argue]");
    if (!el) return;
    event.preventDefault();
    if (el.dataset["bribe"]) payBribe(ride);
    else argue(ride);
  };
  host.addEventListener("click", onSettle);

  const onDown = (event: PointerEvent): void => {
    const el = (event.target as Element)?.closest<HTMLElement>("[data-steer],[data-gas]");
    if (!el) return;
    event.preventDefault();
    if (el.dataset["gas"]) input.throttle = true;
    else if (el.dataset["horn"]) input.horn = true;
    else if (el.dataset["brake"]) input.brake = true;
    else if (el.dataset["hit"]) input.hit = true;
    else if (el.dataset["steer"]) {
      held.add(el.dataset["steer"]);
      syncSteer();
    }
  };
  const onUp = (): void => {
    input.throttle = false;
    input.horn = false;
    input.brake = false;
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
    } else if (event.key === "h") {
      input.horn = down;
    } else if (event.key === "f" || event.key === "Enter") {
      input.hit = down;
    } else if (event.key === "Shift") {
      input.squeeze = down;
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
    host.removeEventListener("click", onSettle);
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
      // A strike is a tap, not a hold, so it is spent the frame it is read.
      input.hit = false;
      resize(canvas);
      draw(ctx, canvas, ride);
      meter.style.width = `${Math.min(100, (ride.z / ride.finishZ) * 100)}%`;
      speedo.textContent = String(Math.round(ride.speed * label.topSpeedKmh));

      // Count the journey down in the units the player thinks in, and project
      // an arrival from the pace actually being held rather than a fixed guess.
      const progress = Math.min(1, ride.z / ride.finishZ);
      const remainingKm = label.km * (1 - progress);
      kmLeft.textContent = remainingKm.toFixed(1);

      const held = Math.max(0.25, ride.speed);
      const eta = label.etaMinutes * (1 - progress) * (1 / Math.max(0.6, held));
      etaOut.textContent = String(Math.max(0, Math.round(eta)));

      // Red when the projection says this one is not going to make it.
      const willBeLate = label.slackMinutes !== null && eta > label.slackMinutes;
      stats.className = `ridestats ${willBeLate ? "late" : ""}`;

      hitLabel.textContent = ride.combat.weapon === "none" ? "KICK" : ride.combat.weapon.toUpperCase();

      if (ride.heldBy) {
        police.hidden = false;
        for (const el of police.querySelectorAll(".pol-amt, .pol-amt2")) {
          el.textContent = `₹${ride.heldBy.demanded}`;
        }
      } else {
        police.hidden = true;
      }

      // Warn about the next light only once it is close enough to act on.
      const ahead = nextSignal(ride);
      const near = ahead !== null && ahead.z - ride.z < 7000;
      const red = ahead !== null && signalIsRed(ahead, ride.elapsed);
      lightBox.hidden = !near && ride.waiting <= 0;
      if (!lightBox.hidden) {
        lightBox.className = `ridelight ${ride.waiting > 0 ? "held" : red ? "red" : "green"}`;
        // Distance to it, because "red ahead" without a distance is not
        // something a rider can act on.
        const away = ahead ? Math.max(0, Math.round((ahead.z - ride.z) / 55)) : 0;
        lightText.textContent =
          ride.waiting > 0
            ? "Waiting for green"
            : red
              ? `Red · ${away} m`
              : `Green · ${away} m`;
      }

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

  drawSignals(ctx, canvas, ride, playerX);
  drawPickups(ctx, canvas, ride, playerX);
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

/**
 * The signal, made impossible to miss.
 *
 * It used to be a small lamp on a thin bar, dead centre — the one place a truck
 * is most likely to be. Now the whole gantry carries the colour, a wash lies
 * across the tarmac approaching a red, and the stop line is drawn wide, so the
 * state is readable from the shape of the road rather than from one dot.
 */
function drawSignals(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  ride: RideState,
  playerX: number,
): void {
  const { width: w, height: h } = canvas;
  const probe: Point = {
    world: { x: 0, y: 0, z: 0 },
    camera: { x: 0, y: 0, z: 0 },
    screen: { x: 0, y: 0, w: 0, scale: 0 },
  };

  const visible = ride.signals
    .filter((s) => s.z > ride.z - 400 && s.z < ride.z + 52000)
    .sort((a, b) => b.z - a.z);

  for (const s of visible) {
    probe.world.x = 0;
    probe.world.y = 0;
    probe.world.z = s.z;
    project(probe, playerX, CAMERA_HEIGHT, ride.z, w, h);
    if (probe.screen.w <= 1) continue;

    const red = signalIsRed(s, ride.elapsed);
    const colour = red ? "#ff3b22" : "#2fd97f";
    const wide = probe.screen.w;

    // A wash over the tarmac ahead of a red, so the road itself carries the
    // warning rather than a lamp that a truck can stand in front of.
    if (red) {
      const fade = Math.max(0, Math.min(0.3, (18000 - (s.z - ride.z)) / 90000));
      if (fade > 0) {
        ctx.fillStyle = `rgba(255,59,34,${fade.toFixed(3)})`;
        ctx.fillRect(probe.screen.x - wide, probe.screen.y - wide * 0.1, wide * 2, h - probe.screen.y);
      }
    }

    // The stop line, full road width.
    ctx.fillStyle = red ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.28)";
    ctx.fillRect(probe.screen.x - wide, probe.screen.y - wide * 0.03, wide * 2, Math.max(2, wide * 0.055));

    // Uprights and the beam, all in the signal's colour.
    const postH = wide * 0.95;
    const postW = Math.max(2, wide * 0.07);
    ctx.fillStyle = "#141917";
    ctx.fillRect(probe.screen.x - wide - postW, probe.screen.y - postH, postW, postH);
    ctx.fillRect(probe.screen.x + wide, probe.screen.y - postH, postW, postH);

    const beamH = Math.max(3, wide * 0.16);
    ctx.fillStyle = colour;
    ctx.fillRect(probe.screen.x - wide - postW, probe.screen.y - postH, wide * 2 + postW * 2, beamH);

    // A glow so it reads at distance, where the bar is only a few pixels tall.
    ctx.globalAlpha = 0.35;
    ctx.fillRect(
      probe.screen.x - wide - postW,
      probe.screen.y - postH - beamH,
      wide * 2 + postW * 2,
      beamH * 3,
    );
    ctx.globalAlpha = 1;
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
    const sh = sw * (haz.kind === "truck" ? 1.25 : haz.kind === "pothole" ? 0.2 : 0.8);
    if (sw < 1) continue;

    drawVehicle(ctx, haz.kind, probe.screen.x, probe.screen.y, sw, sh);
  }
}

function drawRider(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, ride: RideState): void {
  const { width: w, height: h } = canvas;
  // Wobble when staggered from a hit, so a spill reads without a message.
  const lean = ride.stagger > 0 ? Math.sin(ride.elapsed * 42) * 0.18 : 0;
  drawPlayerBike(ctx, w / 2, h * 0.9, w * 0.15, lean, ride.stagger > 0);

  // The swing, drawn as an arc out to whichever side it went.
  const c = ride.combat;
  if (c.swing <= 0) return;

  const reach = w * (c.weapon === "chain" ? 0.3 : c.weapon === "bat" ? 0.24 : 0.17);
  const progress = 1 - c.swing / 0.28;
  const angle = (-0.5 + progress * 1.1) * c.swingSide;
  const cx = w / 2;
  const cy = h * 0.83;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.strokeStyle = c.weapon === "none" ? "#e8ebe3" : c.weapon === "chain" ? "#b9c2bb" : "#a9713f";
  ctx.lineWidth = c.weapon === "bat" ? w * 0.022 : w * 0.014;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(reach * c.swingSide, -reach * 0.25);
  ctx.stroke();

  // A smear behind the swing so a fast arc reads at 60fps.
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  ctx.arc(0, 0, reach, angle - 0.5 * c.swingSide, angle, c.swingSide < 0);
  ctx.stroke();
  ctx.restore();
}

/** A chain or a bat lying in the road, worth swerving toward. */
function drawPickups(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  ride: RideState,
  playerX: number,
): void {
  const { width: w, height: h } = canvas;
  const probe: Point = {
    world: { x: 0, y: 0, z: 0 },
    camera: { x: 0, y: 0, z: 0 },
    screen: { x: 0, y: 0, w: 0, scale: 0 },
  };

  for (const pk of ride.pickups) {
    if (pk.taken || pk.z < ride.z || pk.z > ride.z + 30000) continue;
    probe.world.x = pk.x * ROAD_WIDTH;
    probe.world.y = 0;
    probe.world.z = pk.z;
    project(probe, playerX, CAMERA_HEIGHT, ride.z, w, h);
    if (probe.screen.w <= 1) continue;

    const size = Math.max(2, probe.screen.w * 0.16);
    ctx.save();
    ctx.translate(probe.screen.x, probe.screen.y - size * 0.3);
    // A slow spin, so it reads as a thing to take rather than a thing to dodge.
    ctx.rotate(Math.sin(ride.elapsed * 2 + pk.z) * 0.4);
    ctx.strokeStyle = pk.kind === "chain" ? "#c6cfc8" : "#b5763f";
    ctx.lineWidth = Math.max(1.5, size * 0.22);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.lineTo(size, 0);
    ctx.stroke();
    ctx.restore();
  }
}
