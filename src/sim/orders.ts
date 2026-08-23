import { DROPS, PICKUPS, distance, pickup } from "./city.js";
import { orderFee, type EconomyConfig } from "./economy.js";
import type { Rng } from "./rng.js";
import type { Order, Temp, Tier } from "./types.js";

/** What each place actually sends out. Generation policy, not city geography. */
const TEMPS: Record<string, readonly Temp[]> = {
  qk: ["COLD", "AMBIENT", "AMBIENT", "COLD"],
  bj: ["HOT", "HOT", "HOT"],
  fc: ["HOT", "HOT", "COLD"],
  gm: ["AMBIENT", "AMBIENT", "COLD"],
};

/** EXPRESS is a quick-commerce promise. Only the dark store can make it. */
const EXPRESS_PICKUP_ID = "qk";

function weightedTier(rng: Rng, cfg: EconomyConfig): Tier {
  const tiers = Object.keys(cfg.tiers) as Tier[];
  const total = tiers.reduce((sum, t) => sum + cfg.tiers[t].weight, 0);
  let roll = rng.float(0, total);
  for (const tier of tiers) {
    roll -= cfg.tiers[tier].weight;
    if (roll <= 0) return tier;
  }
  return "STANDARD";
}

/**
 * One offer. `dueAt` is provisional — the real deadline is stamped on acceptance,
 * because the window runs from when the rider takes it, not when it appeared.
 */
export function generateOrder(
  rng: Rng,
  now: number,
  seq: number,
  cfg: EconomyConfig,
): Order {
  const tier = weightedTier(rng, cfg);
  const t = cfg.tiers[tier];

  const pickupId =
    tier === "EXPRESS" ? EXPRESS_PICKUP_ID : rng.pick(PICKUPS).id;

  // Only drops the tier can legitimately promise.
  const reachable = DROPS.filter((d) => distance(pickupId, d.id) <= t.maxDistance);
  const drop = rng.pick(reachable.length > 0 ? reachable : DROPS);

  const dist = distance(pickupId, drop.id);
  const place = pickup(pickupId);

  const truePrep = Math.max(
    1,
    rng.float(place.prepMean - place.prepSpread, place.prepMean + place.prepSpread),
  );
  // The app never over-reports. That is the whole point of the mechanic.
  const shownPrep = truePrep * (1 - place.optimism);

  const temps = TEMPS[pickupId] ?? ["AMBIENT"];

  return {
    id: `o${seq}`,
    tier,
    temp: rng.pick(temps),
    pickupId,
    dropId: drop.id,
    offeredAt: now,
    expiresAt: now + cfg.offerLifetime,
    dueAt: now + t.window,
    distance: dist,
    fee: orderFee(tier, dist, cfg),
    truePrep,
    shownPrep,
  };
}

/**
 * Game-minutes until the next offer appears.
 *
 * `demand` is the hour's multiplier on arrival rate, so a lunch peak of 4.4
 * divides the gap to roughly a quarter and the 5pm trough stretches it out.
 * Floored so a dead hour still trickles rather than stopping dead.
 */
export function nextOfferGap(rng: Rng, cfg: EconomyConfig, demand: number): number {
  const base = cfg.offerIntervalMean / Math.max(0.05, demand);
  return rng.float(base * 0.4, base * 1.6);
}
