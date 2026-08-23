import { DROPS, PICKUPS, distance, pickup } from "./city.js";
import { orderFee, type EconomyConfig } from "./economy.js";
import type { Rng } from "./rng.js";
import type { CityNode, Order, Temp, Tier } from "./types.js";

/** What each place actually sends out. Generation policy, not city geography. */
const TEMPS: Record<string, readonly Temp[]> = {
  qk: ["COLD", "AMBIENT", "AMBIENT", "COLD"],
  bj: ["HOT", "HOT", "HOT"],
  fc: ["HOT", "HOT", "COLD"],
  gm: ["AMBIENT", "AMBIENT", "COLD"],
};

/** EXPRESS is a quick-commerce promise. Only the dark store can make it. */
const EXPRESS_PICKUP_ID = "qk";

/**
 * Picks a drop weighted toward the nearby ones.
 *
 * Real dispatch does not fling a rider ten kilometres across Gurgaon at random —
 * it assigns from the orders closest to them, which is the entire reason dark
 * stores exist. Uniform selection over a 12 km city produced a median hop of
 * 5.4 km and a rider covering 160 km a shift; measured reality is 70–100 km over
 * 20–30 orders, so the short hops have to dominate.
 *
 * The long haul still turns up, just rarely — and distance pay makes it worth
 * considering when it does.
 */
function weightedDrop(rng: Rng, pickupId: string, candidates: readonly CityNode[]): CityNode {
  const weights = candidates.map((d) => 1 / (1 + distance(pickupId, d.id) ** 1.4));
  const total = weights.reduce((sum, w) => sum + w, 0);

  let roll = rng.float(0, total);
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll <= 0) {
      const picked = candidates[i];
      if (picked) return picked;
    }
  }
  return rng.pick(candidates);
}

/**
 * Picks a pickup weighted toward the rider's current position.
 *
 * Platforms assign from the stores nearest the rider — that is the whole reason
 * riders cluster at hotspots between orders, and the reason a dark store is
 * built where it is. Selecting pickups uniformly instead had riders criss-
 * crossing Gurgaon between a Cyber Hub collection and a Sohna Road one, burning
 * 175 km a shift against a measured 70–100.
 *
 * Consequence worth keeping: where the player idles now decides what they are
 * offered next, so the gap between orders is a positioning decision.
 */
function weightedPickup(rng: Rng, nearNodeId: string): (typeof PICKUPS)[number] {
  const weights = PICKUPS.map((p) => 1 / (1 + distance(nearNodeId, p.id) ** 1.6));
  const total = weights.reduce((sum, w) => sum + w, 0);

  let roll = rng.float(0, total);
  for (let i = 0; i < PICKUPS.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll <= 0) {
      const picked = PICKUPS[i];
      if (picked) return picked;
    }
  }
  return rng.pick(PICKUPS);
}

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
  /** Where the rider is standing. Dispatch offers from stores near them. */
  nearNodeId: string,
): Order {
  const tier = weightedTier(rng, cfg);
  const t = cfg.tiers[tier];

  const pickupId =
    tier === "EXPRESS" ? EXPRESS_PICKUP_ID : weightedPickup(rng, nearNodeId).id;

  // Only drops the tier can legitimately promise.
  const reachable = DROPS.filter((d) => distance(pickupId, d.id) <= t.maxDistance);
  const drop = weightedDrop(rng, pickupId, reachable.length > 0 ? reachable : DROPS);

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
