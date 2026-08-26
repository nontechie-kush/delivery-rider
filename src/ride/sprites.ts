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

/**
 * A cow, rear view, sitting exactly where it wants to be.
 *
 * Wide and pale so it reads at distance as something you cannot simply lean
 * around, which is the point: the horn does nothing and a bat does nothing.
 */
function cow(b: Brush): void {
  // Back legs.
  rect(b, -0.26, 0, 0.12, 0.34, "#3a3630");
  rect(b, 0.14, 0, 0.12, 0.34, "#3a3630");

  // Body, pale and heavy.
  rect(b, -0.4, 0.3, 0.8, 0.42, "#cfc6b4");
  // Haunches catch the light differently to the flank.
  rect(b, -0.4, 0.52, 0.8, 0.2, "#ded5c3");
  // The brown patch every second cow on a Gurgaon road seems to have.
  rect(b, -0.22, 0.36, 0.26, 0.22, "#8a6f52");

  // Tail down the middle, and ears either side of the head.
  rect(b, -0.03, 0.18, 0.06, 0.5, "#b3a894");
  rect(b, -0.14, 0.7, 0.28, 0.18, "#cfc6b4");
  rect(b, -0.24, 0.76, 0.1, 0.08, "#b3a894");
  rect(b, 0.14, 0.76, 0.1, 0.08, "#b3a894");
}

/** A street dog, small and low and going sideways. */
function dog(b: Brush): void {
  rect(b, -0.16, 0, 0.05, 0.16, "#6b5a45");
  rect(b, 0.11, 0, 0.05, 0.16, "#6b5a45");
  rect(b, -0.18, 0.14, 0.36, 0.2, "#7d6a52");
  // Head low and forward, tail up. Reads as motion even standing still.
  rect(b, -0.26, 0.2, 0.12, 0.14, "#8a755b");
  rect(b, 0.16, 0.3, 0.06, 0.16, "#6b5a45");
}

const PAINTERS: Record<Hazard["kind"], (b: Brush) => void> = {
  cow,
  dog,
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


/**
 * The swing, drawn as the thing that is actually swinging.
 *
 * A rotating straight line read as an axe, because a rotating straight line is
 * an axe. Road Rash's kick worked because it was unmistakably a leg: a thigh,
 * a knee, a boot, pivoting from the hip. So each of these is drawn as its own
 * object rather than as one primitive rotated by a different amount.
 *
 * `progress` runs 0 to 1 across the swing.
 */
export function drawSwing(
  ctx: CanvasRenderingContext2D,
  weapon: "none" | "chain" | "bat",
  cx: number,
  cy: number,
  scale: number,
  side: -1 | 1,
  progress: number,
): void {
  // Out fast, back slow — a strike is not a symmetrical motion.
  const extend = progress < 0.35 ? progress / 0.35 : 1 - (progress - 0.35) / 0.65;
  const reach = scale * extend;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(side, 1);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (weapon === "none") {
    // A leg: thigh out from the hip, shin dropping, boot on the end. The knee
    // straightens as it extends, which is what sells it as a kick.
    const knee = { x: reach * 0.55, y: -scale * 0.05 + (1 - extend) * scale * 0.18 };
    const foot = { x: reach * 1.0, y: scale * 0.1 - extend * scale * 0.04 };

    ctx.strokeStyle = "#3d4a44";
    ctx.lineWidth = scale * 0.17;
    ctx.beginPath();
    ctx.moveTo(0, -scale * 0.1);
    ctx.lineTo(knee.x, knee.y);
    ctx.lineTo(foot.x, foot.y);
    ctx.stroke();

    ctx.fillStyle = "#141816";
    ctx.beginPath();
    ctx.ellipse(foot.x, foot.y, scale * 0.16, scale * 0.1, -0.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (weapon === "chain") {
    // Links, drawn as a sagging arc rather than a rod. A chain has no spine.
    const links = 9;
    ctx.strokeStyle = "#aeb8b1";
    ctx.lineWidth = scale * 0.075;
    for (let i = 1; i <= links; i++) {
      const f = i / links;
      const x = reach * 1.15 * f;
      const y = -scale * 0.12 + Math.sin(f * Math.PI) * scale * 0.3 * (1 - extend * 0.6);
      ctx.beginPath();
      ctx.ellipse(x, y, scale * 0.07, scale * 0.045, f * 0.9, 0, Math.PI * 2);
      ctx.stroke();
    }
    // The arm holding it.
    ctx.strokeStyle = "#3d4a44";
    ctx.lineWidth = scale * 0.13;
    ctx.beginPath();
    ctx.moveTo(0, -scale * 0.2);
    ctx.lineTo(reach * 0.3, -scale * 0.16);
    ctx.stroke();
  } else {
    // A bat: a handle, a taper, and a fat end that is obviously the business end.
    const tipX = reach * 1.05;
    const tipY = -scale * 0.16;

    ctx.strokeStyle = "#3d4a44";
    ctx.lineWidth = scale * 0.13;
    ctx.beginPath();
    ctx.moveTo(0, -scale * 0.2);
    ctx.lineTo(reach * 0.28, tipY);
    ctx.stroke();

    const grad = ctx.createLinearGradient(reach * 0.28, tipY, tipX, tipY);
    grad.addColorStop(0, "#8c5a2f");
    grad.addColorStop(1, "#c98f52");
    ctx.strokeStyle = grad;
    ctx.lineWidth = scale * 0.1;
    ctx.beginPath();
    ctx.moveTo(reach * 0.28, tipY);
    ctx.lineTo(tipX * 0.72, tipY);
    ctx.stroke();

    ctx.lineWidth = scale * 0.2;
    ctx.beginPath();
    ctx.moveTo(tipX * 0.72, tipY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
  }

  // A smear behind the arc, so a fast swing reads at sixty frames a second.
  if (extend > 0.3) {
    ctx.globalAlpha = 0.18 * extend;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = scale * 0.06;
    ctx.beginPath();
    ctx.arc(0, -scale * 0.1, reach * 0.95, -0.75, 0.3);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}
