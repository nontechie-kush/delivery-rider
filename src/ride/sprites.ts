import type { Hazard } from "./ride.js";

/**
 * Vehicles drawn from canvas primitives — no image assets, so nothing to load,
 * nothing to licence, and everything scales cleanly at any distance.
 *
 * All of it is a rear view, because the rider is behind it. That is what makes
 * the shapes readable at a glance: tail lights, a tailgate, the black canopy of
 * an auto. A box has none of those cues, which is why boxes read as boxes.
 *
 * Every sprite draws upward from `baseY`, the point where it touches the road,
 * so a vehicle sits on the tarmac rather than floating above it.
 */

interface Brush {
  ctx: CanvasRenderingContext2D;
  cx: number;
  baseY: number;
  w: number;
  h: number;
}

const rect = (b: Brush, x: number, y: number, w: number, h: number, fill: string): void => {
  b.ctx.fillStyle = fill;
  b.ctx.fillRect(b.cx + x * b.w, b.baseY - y * b.h - h * b.h, w * b.w, h * b.h);
};

/** A wheel, drawn slightly below the base so it reads as touching the road. */
const wheel = (b: Brush, x: number, radius: number): void => {
  const r = radius * b.w;
  b.ctx.fillStyle = "#0f1210";
  b.ctx.beginPath();
  b.ctx.ellipse(b.cx + x * b.w, b.baseY - r * 0.55, r, r * 0.92, 0, 0, Math.PI * 2);
  b.ctx.fill();
  // A lighter hub, so wheels do not vanish into the tarmac.
  b.ctx.fillStyle = "#39413c";
  b.ctx.beginPath();
  b.ctx.ellipse(b.cx + x * b.w, b.baseY - r * 0.55, r * 0.38, r * 0.36, 0, 0, Math.PI * 2);
  b.ctx.fill();
};

function car(b: Brush): void {
  wheel(b, -0.34, 0.15);
  wheel(b, 0.34, 0.15);

  rect(b, -0.5, 0.06, 1, 0.5, "#3f5a7a");
  // Cabin, inset and darker, with a windscreen band.
  rect(b, -0.4, 0.5, 0.8, 0.34, "#33495f");
  rect(b, -0.34, 0.58, 0.68, 0.2, "#16222c");

  // Tail lights and a bumper, which is what says "this is the back of a car".
  rect(b, -0.46, 0.24, 0.16, 0.12, "#d8483a");
  rect(b, 0.3, 0.24, 0.16, 0.12, "#d8483a");
  rect(b, -0.5, 0.06, 1, 0.07, "#28313a");
}

/**
 * An auto rickshaw: yellow body, black canopy, open back. Two rear wheels, not
 * one — the single wheel is at the front where you cannot see it.
 */
function auto(b: Brush): void {
  wheel(b, -0.3, 0.14);
  wheel(b, 0.3, 0.14);

  rect(b, -0.42, 0.06, 0.84, 0.42, "#e8b21f");
  // Canopy over an open back.
  rect(b, -0.46, 0.46, 0.92, 0.12, "#1b1f1c");
  rect(b, -0.38, 0.58, 0.76, 0.3, "#1b1f1c");
  // The dark opening, with the passenger bench across it.
  rect(b, -0.32, 0.2, 0.64, 0.3, "#241f10");
  rect(b, -0.32, 0.2, 0.64, 0.07, "#8a6d16");
  rect(b, -0.42, 0.06, 0.84, 0.06, "#3f3a1c");
}

function truck(b: Brush): void {
  wheel(b, -0.36, 0.16);
  wheel(b, 0.36, 0.16);
  wheel(b, -0.2, 0.15);
  wheel(b, 0.2, 0.15);

  rect(b, -0.5, 0.08, 1, 0.86, "#6a4a3a");
  // Tailgate slats, and the painted band Indian trucks carry.
  rect(b, -0.44, 0.16, 0.88, 0.6, "#7d5a45");
  for (const y of [0.24, 0.42, 0.6]) rect(b, -0.44, y, 0.88, 0.04, "#57402f");
  rect(b, -0.5, 0.78, 1, 0.1, "#c25a3a");
  rect(b, -0.46, 0.1, 0.14, 0.08, "#d8483a");
  rect(b, 0.32, 0.1, 0.14, 0.08, "#d8483a");
}

/** Another two-wheeler, seen from behind: one wheel, a rider, a helmet. */
function bike(b: Brush): void {
  wheel(b, 0, 0.13);
  rect(b, -0.16, 0.1, 0.32, 0.34, "#3a4a42");
  rect(b, -0.2, 0.4, 0.4, 0.34, "#4a5a52");
  rect(b, -0.13, 0.72, 0.26, 0.2, "#cdd4cf");
  rect(b, -0.24, 0.36, 0.06, 0.1, "#2a332e");
  rect(b, 0.18, 0.36, 0.06, 0.1, "#2a332e");
}

function pothole(b: Brush): void {
  b.ctx.fillStyle = "#33393a";
  b.ctx.beginPath();
  b.ctx.ellipse(b.cx, b.baseY, b.w * 0.5, b.w * 0.14, 0, 0, Math.PI * 2);
  b.ctx.fill();
  b.ctx.fillStyle = "#0e1110";
  b.ctx.beginPath();
  b.ctx.ellipse(b.cx, b.baseY, b.w * 0.42, b.w * 0.1, 0, 0, Math.PI * 2);
  b.ctx.fill();
}

const PAINTERS: Record<Hazard["kind"], (b: Brush) => void> = {
  car,
  auto,
  truck,
  bike,
  pothole,
};

export function drawVehicle(
  ctx: CanvasRenderingContext2D,
  kind: Hazard["kind"],
  cx: number,
  baseY: number,
  width: number,
  height: number,
): void {
  // Below a couple of pixels the detail is noise; a smudge reads better.
  if (width < 3) {
    ctx.fillStyle = kind === "pothole" ? "#141715" : "#46514b";
    ctx.fillRect(cx - width / 2, baseY - height, Math.max(1, width), Math.max(1, height));
    return;
  }
  PAINTERS[kind]({ ctx, cx, baseY, w: width, h: height });
}

/**
 * The player's own scooter, with the delivery bag on the back.
 *
 * Drawn a little larger than life and always dead centre, because it is the
 * thing the eye tracks. The bag turns red on a spill so a crash reads instantly
 * without a message.
 */
export function drawPlayerBike(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  width: number,
  lean: number,
  hurt: boolean,
): void {
  const w = width;
  const h = width * 1.35;

  ctx.save();
  ctx.translate(cx, baseY);
  ctx.rotate(lean);

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.52, w * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();

  const b: Brush = { ctx, cx: 0, baseY: 0, w, h };

  wheel(b, 0, 0.17);
  // Body and seat.
  rect(b, -0.19, 0.12, 0.38, 0.3, "#2b332e");
  rect(b, -0.23, 0.38, 0.46, 0.1, "#1b201d");

  // Rider: jacket, then helmet.
  rect(b, -0.21, 0.46, 0.42, 0.3, "#3d4a44");
  rect(b, -0.14, 0.74, 0.28, 0.22, "#e8ebe3");
  rect(b, -0.14, 0.78, 0.28, 0.08, "#1b201d");

  // The bag, which is the whole job.
  ctx.fillStyle = hurt ? "#e0604a" : "#00e39b";
  ctx.fillRect(-w * 0.28, -h * 0.66, w * 0.56, h * 0.26);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(-w * 0.28, -h * 0.58, w * 0.56, h * 0.05);

  // Mirrors, which give the silhouette its width at a glance.
  ctx.fillStyle = "#1b201d";
  ctx.fillRect(-w * 0.34, -h * 0.72, w * 0.08, h * 0.05);
  ctx.fillRect(w * 0.26, -h * 0.72, w * 0.08, h * 0.05);

  ctx.restore();
}
