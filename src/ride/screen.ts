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
import { createAudio } from "./audio.js";
import { drawPlayerBike, drawSwing, drawVehicle } from "./sprites.js";
import {
  argue,
  createRide,
  nextSignal,
  payBribe,
  rideResult,
  signalIsRed,
  stepRide,
  TOP_SPEED,
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

/**
 * Palettes, and the light in them.
 *
 * Every colour used to be a flat fill under a flat sky, which is why the road
 * read as a band of grey rather than as distance. Two things change that and
 * neither needs a new renderer: a sky that is a gradient rather than one
 * colour, and fog that dissolves the far road into that sky's horizon.
 *
 * The daytime values here are the 17:00 golden-hour palette from the visual
 * direction, hardcoded. This is the proof slice: one hour, to find out whether
 * canvas 2D reaches the bar before the clock-driven version gets built.
 */
export interface Palette {
  skyTop: string;
  skyMid: string;
  skyHorizon: string;
  /** What distance dissolves into. Matches the horizon or the road goes nowhere. */
  fog: string;
  /** Higher is thicker. Dusk holds more in the air than midday does. */
  fogDensity: number;
  groundA: string;
  groundB: string;
  roadA: string;
  roadB: string;
  rumbleA: string;
  rumbleB: string;
  lane: string;
}

/**
 * The day, as seven keyframes.
 *
 * The shift runs 06:00 to 02:00, so the hour is quoted on a 6-to-26 scale and
 * never has to wrap. Values come straight from the visual direction; the point
 * is that a rider should be able to name the hour from one frame with the HUD
 * switched off.
 */
const KEYFRAMES: readonly (readonly [number, Palette])[] = [
  [6, {
    skyTop: "#1e2c3d", skyMid: "#2e4257", skyHorizon: "#7b8fa3",
    fog: "#6a7e92", fogDensity: 6.8,
    groundA: "#232b26", groundB: "#1e251f",
    roadA: "#2a2e33", roadB: "#262a2e",
    rumbleA: "#8a94a0", rumbleB: "#55606b", lane: "#7d8894",
  }],
  [9, {
    skyTop: "#4a82ae", skyMid: "#6fa3c7", skyHorizon: "#c8d8e2",
    fog: "#b3c6d4", fogDensity: 3.2,
    groundA: "#3e4a36", groundB: "#37422f",
    roadA: "#4a4f52", roadB: "#44494c",
    rumbleA: "#e8ecea", rumbleB: "#98a0a2", lane: "#e4e9e6",
  }],
  [13, {
    skyTop: "#7fa0b4", skyMid: "#9fb8c4", skyHorizon: "#eff2ee",
    fog: "#dce2de", fogDensity: 4.0,
    groundA: "#4a5240", groundB: "#434b3a",
    roadA: "#5a5e60", roadB: "#55595b",
    rumbleA: "#f4f6f2", rumbleB: "#a8aea8", lane: "#f0f2ee",
  }],
  [17, {
    skyTop: "#4a4a5e", skyMid: "#c4643a", skyHorizon: "#f0b268",
    fog: "#d9a075", fogDensity: 4.4,
    groundA: "#3a3a2e", groundB: "#33332a",
    roadA: "#4a423c", roadB: "#443c37",
    rumbleA: "#e8dcc8", rumbleB: "#9a8e7c", lane: "#e8dcc8",
  }],
  [20, {
    skyTop: "#0f1622", skyMid: "#1a2434", skyHorizon: "#2c3a4e",
    fog: "#24303f", fogDensity: 5.6,
    groundA: "#1a2118", groundB: "#161c15",
    roadA: "#23272b", roadB: "#1f2326",
    rumbleA: "#7a8288", rumbleB: "#4a5158", lane: "#8a9298",
  }],
  [23, {
    skyTop: "#070b12", skyMid: "#0b0f16", skyHorizon: "#1c2028",
    fog: "#161a20", fogDensity: 6.2,
    groundA: "#0f1712", groundB: "#0d140f",
    roadA: "#212527", roadB: "#1d2123",
    rumbleA: "#6e766f", rumbleB: "#454b47", lane: "#7d857f",
  }],
  // 02:00. The same night, an hour colder, so the last stretch keeps drifting
  // rather than sitting still from 23:00 onward.
  [26, {
    skyTop: "#05080e", skyMid: "#070a11", skyHorizon: "#14181f",
    fog: "#0f1319", fogDensity: 7.0,
    groundA: "#0b120e", groundB: "#090f0b",
    roadA: "#1b1f21", roadB: "#181b1d",
    rumbleA: "#5e665f", rumbleB: "#3a403c", lane: "#6a726c",
  }],
];

/** Golden hour, kept named because the tests and the direction both cite it. */
export const GOLDEN: Palette = KEYFRAMES[3]![1];
export const NIGHT: Palette = KEYFRAMES[5]![1];

// All colour literals in this file are lowercase, so a mixed palette and a
// keyframe palette compare equal instead of differing only by spelling.
const hex = (c: string): [number, number, number] => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
];

const mixHex = (a: string, b: string, t: number): string => {
  const [ar, ag, ab] = hex(a);
  const [br, bg, bb] = hex(b);
  const to = (x: number, y: number): string =>
    Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${to(ar, br)}${to(ag, bg)}${to(ab, bb)}`;
};

/**
 * The palette for a moment in the day, blended between its two keyframes.
 *
 * Resolved once when a ride starts rather than every frame: a leg lasts
 * seconds, so the light does not meaningfully move inside one, and holding it
 * still keeps the sky gradient cache from rebuilding on every single frame.
 */
export function paletteAt(hour: number): Palette {
  const first = KEYFRAMES[0]!;
  const last = KEYFRAMES[KEYFRAMES.length - 1]!;
  if (hour <= first[0]) return first[1];
  if (hour >= last[0]) return last[1];

  let lo = first;
  let hi = last;
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    const a = KEYFRAMES[i]!;
    const b = KEYFRAMES[i + 1]!;
    if (hour >= a[0] && hour <= b[0]) {
      lo = a;
      hi = b;
      break;
    }
  }

  const t = (hour - lo[0]) / (hi[0] - lo[0]);
  const a = lo[1];
  const b = hi[1];
  return {
    skyTop: mixHex(a.skyTop, b.skyTop, t),
    skyMid: mixHex(a.skyMid, b.skyMid, t),
    skyHorizon: mixHex(a.skyHorizon, b.skyHorizon, t),
    fog: mixHex(a.fog, b.fog, t),
    fogDensity: a.fogDensity + (b.fogDensity - a.fogDensity) * t,
    groundA: mixHex(a.groundA, b.groundA, t),
    groundB: mixHex(a.groundB, b.groundB, t),
    roadA: mixHex(a.roadA, b.roadA, t),
    roadB: mixHex(a.roadB, b.roadB, t),
    rumbleA: mixHex(a.rumbleA, b.rumbleA, t),
    rumbleB: mixHex(a.rumbleB, b.rumbleB, t),
    lane: mixHex(a.lane, b.lane, t),
  };
}

/**
 * The sky, cached.
 *
 * A gradient object is expensive to build and identical every frame, so it is
 * made once per size-and-palette and reused. Allocating one inside the draw
 * loop is the standard way to make a canvas game stutter on a mid-range phone.
 */
let skyCache: { key: string; grad: CanvasGradient } | null = null;

export function skyFor(ctx: CanvasRenderingContext2D, h: number, pal: Palette): CanvasGradient {
  const horizon = h / 2;
  const key = `${horizon}|${pal.skyTop}`;
  if (skyCache && skyCache.key === key) return skyCache.grad;

  const grad = ctx.createLinearGradient(0, 0, 0, horizon);
  grad.addColorStop(0, pal.skyTop);
  grad.addColorStop(0.62, pal.skyMid);
  grad.addColorStop(1, pal.skyHorizon);
  skyCache = { key, grad };
  return grad;
}

/**
 * How much of a segment survives the haze between it and the camera.
 *
 * Exponential in the square of the distance, which is the falloff Jake
 * Gordon's racer uses and roughly what the eye expects: nothing at your wheel,
 * almost everything by the horizon.
 */
export function fogAt(n: number, density: number): number {
  const d = n / DRAW_DISTANCE;
  return 1 / Math.exp(d * d * density);
}

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
    /** Hour of the shift on a 6-to-26 scale, which picks the light. */
    hour: number;
    /** Pixel width the ride is drawn at before being scaled up. */
    renderWidth: number;
  },
): { promise: Promise<RideResult>; handle: RideHandle } {
  const ride = createRide(opts);
  // The light for this leg. A ride lasts seconds, so it is fixed for the
  // duration rather than recomputed per frame.
  const pal = paletteAt(label.hour);

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
        ${
          label.slackMinutes === null
            ? ""
            : `<div class="rs"><b class="rs-left">${Math.round(label.slackMinutes)}</b><span>min left</span></div>`
        }
      </div>
      <div class="ridespeed"><b>0</b><span>km/h</span></div>
      <div class="ridelight" hidden><i></i><span></span></div>
      <div class="ridefork" hidden>
        <b class="fk-side left"></b>
        <b class="fk-side right"></b>
      </div>
      <div class="ridemeter"><i></i>${label.slackMinutes === null ? "" : '<u class="ghost"></u>'}</div>
      <div class="ridecontrols">
        <div class="rc-row minor">
          <button class="rc small horn" data-horn="1" aria-label="Horn">HORN</button>
          <button class="rc small brake" data-brake="1" aria-label="Brake">BRAKE</button>
          <button class="rc small hit" data-hit="1" aria-label="Swing">
            <span class="hit-label">KICK</span><em>F</em>
          </button>
        </div>
        <div class="rc-row">
          <button class="rc left" data-steer="-1" aria-label="Left"></button>
          <button class="rc gas" data-gas="1" aria-label="Accelerate"><span>GO</span></button>
          <button class="rc right" data-steer="1" aria-label="Right"></button>
        </div>
      </div>
      <div class="ridehint">
        <span><b>GO</b> throttle</span>
        <span><b>F</b> swing</span>
        <span><b>H</b> horn</span>
        <span><b>Shift</b> or both arrows — squeeze</span>
      </div>
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

  const wrap = host.querySelector<HTMLElement>(".ridewrap")!;
  const canvas = host.querySelector<HTMLCanvasElement>(".ridecanvas")!;
  const meterBox = host.querySelector<HTMLElement>(".ridemeter")!;
  const meter = host.querySelector<HTMLElement>(".ridemeter i")!;
  const speedo = host.querySelector<HTMLElement>(".ridespeed b")!;
  const kmLeft = host.querySelector<HTMLElement>(".rs-km")!;
  const timeLeft = host.querySelector<HTMLElement>(".rs-left");
  const ghost = host.querySelector<HTMLElement>(".ridemeter .ghost");
  const stats = host.querySelector<HTMLElement>(".ridestats")!;
  const lightBox = host.querySelector<HTMLElement>(".ridelight")!;
  const police = host.querySelector<HTMLElement>(".police")!;
  const hitLabel = host.querySelector<HTMLElement>(".hit-label")!;
  const lightText = host.querySelector<HTMLElement>(".ridelight span")!;
  const forkBox = host.querySelector<HTMLElement>(".ridefork")!;
  const forkLeft = host.querySelector<HTMLElement>(".fk-side.left")!;
  const forkRight = host.querySelector<HTMLElement>(".fk-side.right")!;
  const ctx = canvas.getContext("2d")!;
  // The ride is drawn here, small, and scaled up on the way out.
  const buffer = document.createElement("canvas");
  const bufCtx = buffer.getContext("2d")!;

  const input = {
    steer: 0,
    throttle: false,
    brake: false,
    horn: false,
    squeeze: false,
    hit: false,
  };
  const held = new Set<string>();

  // Shift is its own way to squeeze, tracked separately: syncSteer used to
  // assign input.squeeze outright, so it wiped the Shift key a line after the
  // key handler set it and squeezing by keyboard never once took effect.
  let shiftHeld = false;

  const syncSteer = (): void => {
    input.steer = (held.has("1") ? 1 : 0) - (held.has("-1") ? 1 : 0);
    // Holding both is not a contradiction, it is pulling your elbows in.
    input.squeeze = shiftHeld || (held.has("1") && held.has("-1"));
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
    // Every button, not just the two. HORN, BRAKE and KICK were listed in the
    // branches below but not in this selector, so pressing them did nothing at
    // all — which is why the horn was silent even before there was any audio.
    const el = (event.target as Element)?.closest<HTMLElement>(
      "[data-steer],[data-gas],[data-horn],[data-brake],[data-hit]",
    );
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
      shiftHeld = down;
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

  const audio = createAudio();

  let raf = 0;
  let last = performance.now();
  // Sound follows changes in the sim, so these track what was true last frame.
  // Never allowed to fall: a clock that goes backwards is the thing being fixed.
  let spent = 0;
  let heardCrashes = 0;
  let heardLanded = 0;
  let heardWeapon = ride.combat.weapon;
  let cancelled = false;

  const teardown = (): void => {
    audio.stop();
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

      // Sound, driven off the sim rather than off the input: the horn is heard
      // when the rider actually leans on it, and an impact is heard because one
      // happened, not because a button was pressed.
      audio.setSpeed(ride.speed);
      audio.horn(input.horn && !ride.heldBy);
      if (ride.crashes > heardCrashes) audio.crash();
      if (ride.combat.landed > heardLanded) audio.hit();
      if (ride.combat.weapon !== heardWeapon) audio.pickup();
      heardCrashes = ride.crashes;
      heardLanded = ride.combat.landed;
      heardWeapon = ride.combat.weapon;

      // A strike is a tap, not a hold, so it is spent the frame it is read.
      input.hit = false;
      resize(canvas, buffer, label.renderWidth);
      draw(bufCtx, buffer, ride, pal);
      present(ctx, canvas, buffer);
      meter.style.width = `${Math.min(100, (ride.z / ride.finishZ) * 100)}%`;
      speedo.textContent = String(Math.round(ride.speed * label.topSpeedKmh));

      // Count the journey down in the units the player thinks in, and project
      // an arrival from the pace actually being held rather than a fixed guess.
      const progress = Math.min(1, ride.z / ride.finishZ);
      const remainingKm = label.km * (1 - progress);
      kmLeft.textContent = remainingKm.toFixed(1);

      // Game-minutes spent so far. The old readout divided the estimate by
      // current speed, which clamped at 0.6 — so standstill, crawling and half
      // throttle all displayed the same number and it then snapped by a third
      // the instant the throttle went down. It also swung 67% where the sim
      // charges 33%, telling the player throttle mattered twice as much as it
      // does.
      //
      // A clock is a clock: this only ever counts up, at the rate real time is
      // passing, and crashes take a visible bite out of it. Throttle earns you
      // distance, not minutes — which is the deal Crazy Taxi and OutRun made.
      spent = Math.max(spent, spentMinutes(ride, label.etaMinutes));

      if (timeLeft && ghost && label.slackMinutes !== null) {
        const left = label.slackMinutes - spent;
        timeLeft.textContent = String(Math.max(0, Math.round(left)));

        // The ghost is the share of the time budget already gone, against the
        // share of the journey already done. Ahead of it means arriving early.
        // No arithmetic for the player, and nothing that can jump.
        const burned = Math.min(1, spent / Math.max(0.5, label.slackMinutes));
        ghost.style.left = `${burned * 100}%`;
        const behind = burned > progress;
        stats.className = `ridestats ${behind ? "late" : ""}`;
        meterBox.className = `ridemeter ${behind ? "behind" : "ahead"}`;
      }

      hitLabel.textContent = ride.combat.weapon === "none" ? "KICK" : ride.combat.weapon.toUpperCase();

      // Squeezing changed nothing you could see, which made it feel broken even
      // though it was working. Now the whole frame narrows while it is held.
      wrap.classList.toggle("squeezing", input.squeeze && ride.speed > 0.05);

      if (ride.heldBy) {
        police.hidden = false;
        for (const el of police.querySelectorAll(".pol-amt, .pol-amt2")) {
          el.textContent = `₹${ride.heldBy.demanded}`;
        }
      } else {
        police.hidden = true;
      }

      // Name the two ways while there is still time to pick one. A decision
      // read at the last moment is a coin toss, so this appears early and the
      // quick side is marked rather than left to be guessed.
      const fork = ride.forks.find((f) => !f.resolved && f.z > ride.z && f.z - ride.z < 30000);
      forkBox.hidden = !fork;
      if (fork) {
        const fastLeft = fork.fastSide < 0;
        forkLeft.textContent = fastLeft ? fork.fastLabel : fork.slowLabel;
        forkRight.textContent = fastLeft ? fork.slowLabel : fork.fastLabel;
        forkLeft.className = `fk-side left ${fastLeft ? "quick" : "clear"}`;
        forkRight.className = `fk-side right ${fastLeft ? "clear" : "quick"}`;
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

/**
 * Game-minutes the ride has cost so far.
 *
 * Linear in elapsed real time, plus whatever crashes and stops have added.
 * Deliberately not a function of current speed: speed decides how much road
 * gets covered per minute, and the minutes themselves pass regardless.
 */
export function spentMinutes(ride: RideState, etaMinutes: number): number {
  const expected = ride.finishZ / TOP_SPEED;
  return etaMinutes * (ride.elapsed / Math.max(0.001, expected)) + ride.minutesLost;
}

/**
 * Sizes the display canvas and the small buffer the ride is actually drawn in.
 *
 * The buffer keeps the display's aspect ratio so nothing stretches, and its
 * width is fixed by config — everything drawn inside it is therefore in buffer
 * pixels, which is the point: at this size a vehicle is tens of pixels across
 * rather than hundreds, and every one of them can be placed deliberately.
 */
/** Only what these two actually touch, so both are testable without a DOM. */
interface Surface {
  width: number;
  height: number;
}
interface Displayed extends Surface {
  clientWidth: number;
  clientHeight: number;
}
interface Blitter {
  imageSmoothingEnabled: boolean;
  drawImage: (src: never, x: number, y: number, w: number, h: number) => void;
}

export function resize(canvas: Displayed, buffer: Surface, width: number): void {
  // Guarded rather than assumed: this is reachable outside a browser, and a
  // renderer that throws on a missing global is a renderer that cannot be
  // tested at all.
  const dpr =
    typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const bw = Math.max(64, Math.round(width));
  const bh = Math.max(64, Math.round(width * (h / w)));
  if (buffer.width !== bw || buffer.height !== bh) {
    buffer.width = bw;
    buffer.height = bh;
  }
}

/**
 * Blits the buffer up to the display, hard-edged.
 *
 * Smoothing off is the whole trick. Interpolating the upscale would hand back
 * exactly the soft, edgeless quality the small buffer exists to get rid of, and
 * would cost the fill saving as well.
 */
export function present(ctx: Blitter, canvas: Surface, buffer: Surface): void {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buffer as never, 0, 0, canvas.width, canvas.height);
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
function draw(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  ride: RideState,
  pal: Palette,
): void {
  const { width: w, height: h } = canvas;

  // Filled to the full height, not just to the horizon: cresting a hill puts
  // road above the halfway line, and a sky that stopped there would leave a
  // band of nothing behind it. The gradient clamps to its last stop below the
  // horizon anyway, and the verge draws over it.
  ctx.fillStyle = skyFor(ctx, h, pal);
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

    drawSegment(ctx, w, seg, pal, n);
    maxy = seg.p2.screen.y;
  }

  drawForks(ctx, canvas, ride, playerX);
  drawSignals(ctx, canvas, ride, playerX);
  drawPickups(ctx, canvas, ride, playerX);
  drawHazards(ctx, canvas, ride, playerX);
  drawRider(ctx, canvas, ride);
}

function drawSegment(
  ctx: CanvasRenderingContext2D,
  width: number,
  seg: Segment,
  pal: Palette,
  distance: number,
): void {
  const p1 = seg.p1.screen;
  const p2 = seg.p2.screen;

  // Verge either side of the tarmac.
  ctx.fillStyle = seg.dark ? pal.groundA : pal.groundB;
  ctx.fillRect(0, p2.y, width, p1.y - p2.y);

  const r1 = (p1.w / Math.max(6, 2 * LANES)) * 1.4;
  const r2 = (p2.w / Math.max(6, 2 * LANES)) * 1.4;
  const rumble = seg.dark ? pal.rumbleA : pal.rumbleB;

  polygon(ctx, p1.x - p1.w - r1, p1.y, p1.x - p1.w, p1.y, p2.x - p2.w, p2.y, p2.x - p2.w - r2, p2.y, rumble);
  polygon(ctx, p1.x + p1.w + r1, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x + p2.w + r2, p2.y, rumble);
  polygon(ctx, p1.x - p1.w, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x - p2.w, p2.y, seg.dark ? pal.roadA : pal.roadB);

  // Lane markings only on the light bands, so they dash as the road moves.
  if (!seg.dark) {
    fogBand(ctx, width, seg, pal, distance);
    return;
  }
  const l1 = (p1.w / Math.max(6, LANES)) * 0.06;
  const l2 = (p2.w / Math.max(6, LANES)) * 0.06;
  const lane1 = (p1.w * 2) / LANES;
  const lane2 = (p2.w * 2) / LANES;
  let lx1 = p1.x - p1.w + lane1;
  let lx2 = p2.x - p2.w + lane2;

  for (let lane = 1; lane < LANES; lane++) {
    polygon(ctx, lx1 - l1, p1.y, lx1 + l1, p1.y, lx2 + l2, p2.y, lx2 - l2, p2.y, pal.lane);
    lx1 += lane1;
    lx2 += lane2;
  }

  fogBand(ctx, width, seg, pal, distance);
}

/** Haze over one finished segment band, thickening with distance. */
function fogBand(
  ctx: CanvasRenderingContext2D,
  width: number,
  seg: Segment,
  pal: Palette,
  distance: number,
): void {
  const clear = fogAt(distance, pal.fogDensity);
  if (clear > 0.995) return;
  ctx.globalAlpha = 1 - clear;
  ctx.fillStyle = pal.fog;
  ctx.fillRect(0, seg.p2.screen.y, width, seg.p1.screen.y - seg.p2.screen.y + 1);
  ctx.globalAlpha = 1;
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

  // Tucked in while squeezing: the rider physically narrows, which is the cue
  // that says the gap just got passable. Nothing on screen said so before.
  const tuck = ride.squeezing ? 0.72 : 1;
  if (ride.squeezing) drawSqueezeLines(ctx, w, h, ride.elapsed);
  drawPlayerBike(ctx, w / 2, h * 0.9, w * 0.15 * tuck, lean, ride.stagger > 0);

  // The swing, drawn as whatever is actually swinging.
  const c = ride.combat;
  if (c.swing <= 0) return;
  drawSwing(ctx, c.weapon, w / 2, h * 0.84, w * 0.16, c.swingSide, 1 - c.swing / 0.28);
}

/**
 * A fork: an overhead gantry naming both ways, and the divider between them.
 *
 * The gantry has to be readable early — a decision you meet at the last moment
 * is a coin toss, not a choice — so it is drawn from a long way out and the
 * quick side is marked. The divider is what makes the choice binding: by the
 * time you reach it you are left of it or right of it, and that is that.
 */
function drawForks(
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

  for (const f of ride.forks) {
    const gap = f.z - ride.z;
    if (gap < -600 || gap > 34000) continue;

    probe.world.x = 0;
    probe.world.y = 0;
    probe.world.z = f.z;
    project(probe, playerX, CAMERA_HEIGHT, ride.z, w, h);
    const scale = probe.screen.w;
    if (scale <= 2) continue;

    // The divider island, sitting on the centre line.
    if (!f.resolved) {
      const dw = Math.max(2, scale * 0.1);
      const dh = Math.max(3, scale * 0.34);
      ctx.fillStyle = "#c8cdc6";
      ctx.fillRect(probe.screen.x - dw / 2, probe.screen.y - dh, dw, dh);
      ctx.fillStyle = "#1c1f1d";
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(probe.screen.x - dw / 2, probe.screen.y - dh + (dh / 3) * i, dw, dh * 0.11);
      }
    }

    // The gantry itself, as a shape. The lettering lives in the DOM instead —
    // at this buffer width canvas text would be about three pixels tall, and
    // the readout beside the signal warning is where a rider already looks.
    if (gap < 1200 || scale < 8) continue;
    const boardW = scale * 1.5;
    const boardH = Math.max(4, scale * 0.3);
    const top = probe.screen.y - scale * 1.35;
    const left = probe.screen.x - boardW / 2;

    ctx.fillStyle = "rgba(10,14,12,0.9)";
    ctx.fillRect(left, top, boardW, boardH);
    ctx.fillStyle = "#5c6b60";
    ctx.fillRect(left, top, boardW, Math.max(1, boardH * 0.12));
    // Legs down to the verge, and a stripe on the side that is quick.
    ctx.fillRect(left, top, Math.max(1, scale * 0.04), boardH);
    ctx.fillRect(left + boardW, top, Math.max(1, scale * 0.04), boardH);
    ctx.fillStyle = "#ffb02e";
    const half = boardW / 2;
    ctx.fillRect(
      f.fastSide < 0 ? left : left + half,
      top + boardH * 0.62,
      half,
      Math.max(1, boardH * 0.2),
    );
  }
}

/**
 * Speed lines converging on the vanishing point.
 *
 * Squeezing costs top speed, so without a cue it reads as the bike bogging down
 * for no reason. Lines rushing past sell it as deliberate rather than broken.
 */
function drawSqueezeLines(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  elapsed: number,
): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = Math.max(1, w * 0.003);
  for (let i = 0; i < 14; i++) {
    // Each line runs its own loop, offset so they do not pulse in unison.
    const phase = ((elapsed * 2.4 + i * 0.137) % 1) ** 2;
    const side = i % 2 === 0 ? -1 : 1;
    const spread = 0.06 + (i / 14) * 0.44;
    const x = w / 2 + side * spread * w * (0.25 + phase * 3);
    const y = h * (0.5 + phase * 0.48);
    ctx.globalAlpha = 0.55 * (1 - phase);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + side * w * 0.06 * phase, y + h * 0.05 * phase);
    ctx.stroke();
  }
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
    ctx.translate(probe.screen.x, probe.screen.y);

    if (pk.kind === "langar") {
      // A stall: a canopy on two poles with a pot under it. Drawn standing on
      // the verge rather than spinning in the air, because it is a place and
      // not a power-up.
      ctx.fillStyle = "#1f2a24";
      ctx.fillRect(-size * 0.08, -size * 1.1, size * 0.16, size * 1.1);
      ctx.fillRect(size * 0.72, -size * 1.1, size * 0.16, size * 1.1);
      // Canopy. Saffron, because that is the colour these actually are.
      ctx.fillStyle = "#e8913a";
      ctx.beginPath();
      ctx.moveTo(-size * 0.45, -size * 1.05);
      ctx.lineTo(size * 1.25, -size * 1.05);
      ctx.lineTo(size * 1.05, -size * 1.35);
      ctx.lineTo(-size * 0.25, -size * 1.35);
      ctx.closePath();
      ctx.fill();
      // The pot, and a table to stand it on.
      ctx.fillStyle = "#8d6a45";
      ctx.fillRect(-size * 0.2, -size * 0.5, size * 1.2, size * 0.12);
      ctx.fillStyle = "#d8dee0";
      ctx.beginPath();
      ctx.ellipse(size * 0.4, -size * 0.58, size * 0.3, size * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }

    ctx.translate(0, -size * 0.3);
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
