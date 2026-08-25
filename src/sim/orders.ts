import { DROPS, PICKUPS, distance } from "./city.js";
import { orderFee, placeOf, type GameConfig } from "./config.js";
import type { Rng } from "./rng.js";
import type { CityNode, Order, Tier } from "./types.js";


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
function weightedDrop(rng: Rng, pickupId: string, candidates: readonly CityNode[], cfg: GameConfig): CityNode {
  const weights = candidates.map((d) => 1 / (1 + distance(pickupId, d.id) ** cfg.dropProximityBias));
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
function weightedPickup(rng: Rng, nearNodeId: string, cfg: GameConfig): (typeof PICKUPS)[number] {
  const weights = PICKUPS.map((p) => 1 / (1 + distance(nearNodeId, p.id) ** cfg.pickupProximityBias));
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

function weightedTier(rng: Rng, cfg: GameConfig): Tier {
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
  cfg: GameConfig,
  /** Where the rider is standing. Dispatch offers from stores near them. */
  nearNodeId: string,
): Order {
  const tier = weightedTier(rng, cfg);
  const t = cfg.tiers[tier];

  const pickupId =
    tier === "EXPRESS" ? EXPRESS_PICKUP_ID : weightedPickup(rng, nearNodeId, cfg).id;

  // Only drops the tier can legitimately promise.
  const reachable = DROPS.filter((d) => distance(pickupId, d.id) <= t.maxDistance);
  const drop = weightedDrop(rng, pickupId, reachable.length > 0 ? reachable : DROPS, cfg);

  const dist = distance(pickupId, drop.id);
  const place = placeOf(pickupId, cfg);

  const prepLow = Math.max(1, place.prepMean - place.prepSpread);
  const prepHigh = Math.max(prepLow, place.prepMean + place.prepSpread);
  const truePrep = rng.float(prepLow, prepHigh);
  // What the card shows is the kitchen's range, not a number worked back from
  // today's draw. The player therefore knows what Biryani Junction is like and
  // still does not know what today holds — the risk survives, the lie does not.
  const shownPrep = (prepLow + prepHigh) / 2;

  const temps = place.temps.length > 0 ? place.temps : cfg.defaultPlace.temps;

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
    prepLow,
    prepHigh,
  };
}

/**
 * Game-minutes until the next offer appears.
 *
 * `demand` is the hour's multiplier on arrival rate, so a lunch peak of 4.4
 * divides the gap to roughly a quarter and the 5pm trough stretches it out.
 * Floored so a dead hour still trickles rather than stopping dead.
 */
export function nextOfferGap(rng: Rng, cfg: GameConfig, demand: number): number {
  const base = cfg.offerIntervalMean / Math.max(0.05, demand);
  return rng.float(base * 0.4, base * 1.6);
}
